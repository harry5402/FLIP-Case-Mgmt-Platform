const express = require("express");
const router = express.Router();
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// In-memory job store: jobId -> { state, urls: [{url, status, note}], pdfPath, createdAt }
const jobs = new Map();

// Prune jobs older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      if (job.pdfPath) {
        try { fs.unlinkSync(job.pdfPath); } catch (_) {}
      }
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000);

// POST /api/automations/exhibit2/start
router.post("/exhibit2/start", upload.single("csv"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No CSV file uploaded" });

  let rows;
  try {
    rows = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    return res.status(400).json({ error: "Failed to parse CSV: " + err.message });
  }

  // Normalise column names to lowercase for lookup
  const normalisedRows = rows.map(r => {
    const out = {};
    for (const [k, v] of Object.entries(r)) out[k.toLowerCase()] = v;
    return out;
  });

  const hasUrl = normalisedRows.length > 0 && "url" in normalisedRows[0];
  if (!hasUrl) return res.status(400).json({ error: 'CSV must have a "url" column' });

  const jobId = crypto.randomBytes(8).toString("hex");
  const urlEntries = normalisedRows.map(r => ({
    url: r.url,
    meta: Object.fromEntries(Object.entries(r).filter(([k]) => k !== "url")),
    status: "pending",
    note: "",
  }));

  const matter = (req.body.matter || "").trim();
  const operator = (req.body.operator || "").trim();

  jobs.set(jobId, {
    state: "running",
    urls: urlEntries,
    pdfPath: null,
    matter,
    operator,
    createdAt: Date.now(),
  });

  // Fire off background processing — don't await
  processExhibit2Job(jobId).catch(err => {
    console.error("[exhibit2] Job error:", err);
    const job = jobs.get(jobId);
    if (job) job.state = "error";
  });

  res.json({ jobId, urls: urlEntries.map(u => u.url) });
});

// GET /api/automations/exhibit2/:jobId/status
router.get("/exhibit2/:jobId/status", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({
    state: job.state,
    urls: job.urls.map(u => ({ url: u.url, status: u.status, note: u.note })),
  });
});

// GET /api/automations/exhibit2/:jobId/download
router.get("/exhibit2/:jobId/download", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.state !== "done" || !job.pdfPath) return res.status(409).json({ error: "PDF not ready" });
  const filename = `exhibit2_${req.params.jobId}.pdf`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");
  fs.createReadStream(job.pdfPath).pipe(res);
});

// ── Core processing ────────────────────────────────────────────────────────

async function processExhibit2Job(jobId) {
  let playwright;
  try {
    playwright = require("playwright");
  } catch (_) {
    const job = jobs.get(jobId);
    if (job) {
      job.state = "error";
      job.urls.forEach(u => { u.status = "failed"; u.note = "Playwright not installed on server"; });
    }
    return;
  }

  let PDFDocument, Image;
  try {
    PDFDocument = require("pdfkit");
    Image = require("sharp");
  } catch (_) {
    // Try alternate image lib
    Image = null;
  }

  let pdflib;
  try {
    pdflib = require("pdf-lib");
  } catch (_) {}

  const job = jobs.get(jobId);
  if (!job) return;

  const browser = await playwright.chromium.launch({ headless: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibit2-"));
  const screenshotPaths = [];

  try {
    for (let i = 0; i < job.urls.length; i++) {
      const entry = job.urls[i];
      entry.status = "capturing";
      const screenshotPath = path.join(tmpDir, `page_${i}.png`);

      try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        await page.goto(entry.url, { waitUntil: "networkidle", timeout: 30000 });
        await page.screenshot({ path: screenshotPath, fullPage: true });
        await context.close();
        entry.status = "done";
        entry.screenshotPath = screenshotPath;
        screenshotPaths.push({ index: i, path: screenshotPath, entry });
      } catch (err) {
        entry.status = "failed";
        entry.note = err.message.slice(0, 120);
        entry.screenshotPath = null;
        screenshotPaths.push({ index: i, path: null, entry });
      }
    }
  } finally {
    await browser.close();
  }

  // Build PDF
  const pdfPath = path.join(tmpDir, "exhibit2.pdf");
  await buildPdf(pdfPath, screenshotPaths, job);

  job.pdfPath = pdfPath;
  job.state = "done";
}

async function buildPdf(pdfPath, pages, job) {
  // Use pdfkit if available, otherwise fall back to a minimal PDF writer
  let PDFDocument;
  try {
    PDFDocument = require("pdfkit");
  } catch (_) {
    PDFDocument = null;
  }

  if (PDFDocument) {
    await buildPdfWithPdfkit(pdfPath, pages, job, PDFDocument);
  } else {
    await buildPdfMinimal(pdfPath, pages, job);
  }
}

const HEADER_HEIGHT = 80; // px at 72dpi equivalent
const FOOTER_HEIGHT = 24;
const FONT_SIZE_SMALL = 8;
const FONT_SIZE_NORMAL = 10;
const PADDING = 10;

async function buildPdfWithPdfkit(pdfPath, pages, job, PDFDocument) {
  const total = pages.length;

  return new Promise((resolve, reject) => {
    // We create one doc per page and merge — actually pdfkit supports multi-page
    // We need to know image dimensions first; process synchronously per page.
    const Jimp = tryRequire("jimp");
    const sharp = tryRequire("sharp");

    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Cover page
    const hasCover = job.matter || job.operator;
    if (hasCover) {
      doc.addPage({ size: [595, 842] });
      doc.fontSize(20).font("Helvetica-Bold").text("EXHIBIT 2", PADDING, 80, { align: "center", width: 595 - PADDING * 2 });
      doc.moveDown(1);
      if (job.matter) doc.fontSize(14).font("Helvetica").text(job.matter, { align: "center" });
      doc.moveDown(0.5);
      doc.fontSize(11).text("Date Generated: " + new Date().toUTCString(), { align: "center" });
      doc.moveDown(0.5);
      doc.text("Total Pages: " + total, { align: "center" });
      if (job.operator) { doc.moveDown(0.5); doc.text("Operator: " + job.operator, { align: "center" }); }
    }

    let pageNum = 0;
    for (const { index, path: imgPath, entry } of pages) {
      pageNum++;
      const capturedAt = new Date().toUTCString();

      if (!imgPath) {
        // Placeholder page for failed URL
        doc.addPage({ size: [595, 200] });
        doc.fontSize(FONT_SIZE_NORMAL).font("Helvetica-Bold").fillColor("red").text("FAILED TO CAPTURE", PADDING, PADDING);
        doc.fillColor("black").font("Helvetica").fontSize(FONT_SIZE_SMALL)
          .text("URL: " + entry.url, PADDING, PADDING + 16, { width: 575 })
          .text("Error: " + (entry.note || "Unknown error"), PADDING, PADDING + 28, { width: 575 })
          .text("Timestamp: " + capturedAt, PADDING, PADDING + 40);
        continue;
      }

      // Get image dimensions
      let imgWidth = 1440, imgHeight = 900;
      try {
        const buf = fs.readFileSync(imgPath);
        // PNG header: width at bytes 16-19, height at 20-23
        imgWidth = buf.readUInt32BE(16);
        imgHeight = buf.readUInt32BE(20);
      } catch (_) {}

      const pageWidth = imgWidth;
      const pageHeight = imgHeight + HEADER_HEIGHT + FOOTER_HEIGHT;

      doc.addPage({ size: [pageWidth, pageHeight], margin: 0 });

      // Header background
      doc.rect(0, 0, pageWidth, HEADER_HEIGHT).fill("#f8f9fa");
      doc.strokeColor("#dee2e6").lineWidth(1).moveTo(0, HEADER_HEIGHT).lineTo(pageWidth, HEADER_HEIGHT).stroke();

      // Header text
      doc.fillColor("#000000");
      doc.fontSize(FONT_SIZE_NORMAL).font("Helvetica-Bold")
        .text(`Exhibit 2 — Page ${pageNum} of ${total}`, PADDING, PADDING, { width: pageWidth - PADDING * 2, align: "right" });
      doc.fontSize(FONT_SIZE_SMALL).font("Helvetica")
        .text(entry.url, PADDING, PADDING, { width: pageWidth * 0.7, ellipsis: true });

      // Metadata lines
      let metaY = PADDING + 14;
      for (const [k, v] of Object.entries(entry.meta || {})) {
        if (!v) continue;
        const label = k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        doc.fontSize(FONT_SIZE_SMALL).font("Helvetica")
          .text(`${label}: ${v}`, PADDING, metaY, { width: pageWidth - PADDING * 2 });
        metaY += 11;
      }

      // Screenshot
      doc.image(imgPath, 0, HEADER_HEIGHT, { width: pageWidth, height: imgHeight });

      // Footer
      const footerY = HEADER_HEIGHT + imgHeight;
      doc.rect(0, footerY, pageWidth, FOOTER_HEIGHT).fill("#f8f9fa");
      doc.strokeColor("#dee2e6").lineWidth(1).moveTo(0, footerY).lineTo(pageWidth, footerY).stroke();
      doc.fillColor("#666666").fontSize(FONT_SIZE_SMALL).font("Helvetica")
        .text("Captured: " + capturedAt, PADDING, footerY + 8, { width: pageWidth - PADDING * 2, align: "center" });
    }

    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

async function buildPdfMinimal(pdfPath, pages, job) {
  // Fallback: write a plain text PDF listing all URLs and statuses
  const lines = [
    "EXHIBIT 2",
    "Generated: " + new Date().toUTCString(),
    job.matter ? "Matter: " + job.matter : null,
    job.operator ? "Operator: " + job.operator : null,
    "",
    "NOTE: PDF rendering library (pdfkit) not installed. This is a summary only.",
    "",
    ...pages.map((p, i) => `Page ${i + 1}: [${p.entry.status.toUpperCase()}] ${p.entry.url}${p.entry.note ? " — " + p.entry.note : ""}`),
  ].filter(l => l !== null).join("\n");

  // Minimal valid PDF with text
  const pdfContent = buildMinimalTextPdf(lines);
  fs.writeFileSync(pdfPath, pdfContent);
}

function buildMinimalTextPdf(text) {
  const escaped = text.replace(/[()\\]/g, c => "\\" + c).replace(/\n/g, "\\n");
  const stream = `BT /F1 10 Tf 50 750 Td 12 TL (${escaped}) Tj ET`;
  const streamLen = Buffer.byteLength(stream, "latin1");
  const pdf = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${streamLen} >>`,
    "stream",
    stream,
    "endstream endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "xref",
    "0 6",
    "0000000000 65535 f",
    "trailer << /Size 6 /Root 1 0 R >>",
    "startxref",
    "9",
    "%%EOF",
  ].join("\n");
  return pdf;
}

function tryRequire(name) {
  try { return require(name); } catch (_) { return null; }
}

// ── Edison Cover Pages ─────────────────────────────────────────────────────

// In-memory store for completed edison files: token -> { pdfBuffer, filename, createdAt }
const edisonFiles = new Map();

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [token, f] of edisonFiles.entries()) {
    if (f.createdAt < cutoff) edisonFiles.delete(token);
  }
}, 10 * 60 * 1000);

const edisonUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB total generosity
});

// POST /api/automations/edison/apply
router.post("/edison/apply", edisonUpload.array("pdfs"), async (req, res) => {
  const clientName = (req.body.clientName || "").trim();
  if (!clientName) return res.status(400).json({ error: "clientName is required" });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "No PDF files uploaded" });

  const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
  const total = req.files.length;
  const results = [];

  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    const partNum = i + 1;

    try {
      // Load the uploaded PDF
      const srcDoc = await PDFDocument.load(file.buffer);

      // Build cover page PDF in memory
      const coverDoc = await PDFDocument.create();
      const coverPage = coverDoc.addPage([612, 792]); // letter size
      const { width, height } = coverPage.getSize();

      const fontBold = await coverDoc.embedFont(StandardFonts.HelveticaBold);
      const fontReg  = await coverDoc.embedFont(StandardFonts.Helvetica);

      // "EXHIBIT 2"
      const title = "EXHIBIT 2";
      const titleSize = 36;
      const titleWidth = fontBold.widthOfTextAtSize(title, titleSize);
      coverPage.drawText(title, {
        x: (width - titleWidth) / 2,
        y: height / 2 + 60,
        size: titleSize,
        font: fontBold,
        color: rgb(0, 0, 0),
      });

      // "TO DECLARATION OF [Client Name]"
      const decLine = `TO DECLARATION OF ${clientName.toUpperCase()}`;
      const decSize = 16;
      const decWidth = fontReg.widthOfTextAtSize(decLine, decSize);
      coverPage.drawText(decLine, {
        x: (width - decWidth) / 2,
        y: height / 2 + 10,
        size: decSize,
        font: fontReg,
        color: rgb(0, 0, 0),
      });

      // "Part X of Y"
      const partLine = `Part ${partNum} of ${total}`;
      const partSize = 14;
      const partWidth = fontReg.widthOfTextAtSize(partLine, partSize);
      coverPage.drawText(partLine, {
        x: (width - partWidth) / 2,
        y: height / 2 - 24,
        size: partSize,
        font: fontReg,
        color: rgb(0.3, 0.3, 0.3),
      });

      // Merge: cover + original pages
      const mergedDoc = await PDFDocument.create();
      const [copiedCover] = await mergedDoc.copyPages(coverDoc, [0]);
      mergedDoc.addPage(copiedCover);
      const srcPageIndices = srcDoc.getPageIndices();
      const copiedPages = await mergedDoc.copyPages(srcDoc, srcPageIndices);
      copiedPages.forEach(p => mergedDoc.addPage(p));

      const pdfBytes = await mergedDoc.save();
      const token = crypto.randomBytes(12).toString("hex");
      const outName = file.originalname.replace(/\.pdf$/i, "") + `_Part${partNum}of${total}.pdf`;

      edisonFiles.set(token, {
        pdfBuffer: Buffer.from(pdfBytes),
        filename: outName,
        createdAt: Date.now(),
      });

      results.push({ name: outName, token });
    } catch (err) {
      results.push({ name: file.originalname, token: null, error: err.message });
    }
  }

  res.json({ files: results });
});

// GET /api/automations/edison/download/:token
router.get("/edison/download/:token", (req, res) => {
  const entry = edisonFiles.get(req.params.token);
  if (!entry) return res.status(404).json({ error: "File not found or expired" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${entry.filename}"`);
  res.send(entry.pdfBuffer);
});

module.exports = router;
