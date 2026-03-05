require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const { parse } = require("csv-parse/sync");
const { query } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const upload = multer({ storage: multer.memoryStorage() });

const mapCase = (row) => ({
  id: row.id,
  caseName: row.case_name,
  title: row.case_name,
  clientName: row.client_name,
  plaintiff: row.plaintiff,
  brandName: row.brand_name,
  ipClaimsSummary: row.ip_claims_summary,
  plaintiffProfitPerUnit: row.plaintiff_profit_per_unit,
  jurisdiction: row.jurisdiction,
  caseNumber: row.case_number,
  judge: row.judge,
  status: row.status,
  recentStatus: row.recent_status,
  filedDate: row.filed_date,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
  court: row.court,
  defendants: [],
  docketEntries: [],
  notes: "",
  ipClaims: [],
});

app.get("/api/cases", async (req, res) => {
  const result = await query("SELECT * FROM cases ORDER BY created_at DESC");
  res.json(result.rows.map(mapCase));
});

app.get("/api/cases/:id", async (req, res) => {
  const result = await query("SELECT * FROM cases WHERE id = $1", [req.params.id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Case not found" });
  }
  res.json(mapCase(result.rows[0]));
});

app.post("/api/cases", async (req, res) => {
  const {
    caseName,
    clientName,
    plaintiff,
    brandName,
    ipClaimsSummary,
    plaintiffProfitPerUnit,
    jurisdiction,
    caseNumber,
    judge,
    status,
    updatedBy,
  } = req.body;

  if (!caseName || !clientName) {
    return res.status(400).json({ error: "caseName and clientName are required" });
  }

  const now = new Date().toISOString().slice(0, 10);
  const result = await query(
    `INSERT INTO cases
      (case_name, client_name, plaintiff, brand_name, ip_claims_summary, plaintiff_profit_per_unit,
       jurisdiction, case_number, judge, status, recent_status, filed_date, updated_at, updated_by, court)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      caseName,
      clientName,
      plaintiff || null,
      brandName || null,
      ipClaimsSummary || null,
      plaintiffProfitPerUnit || 0,
      jurisdiction || null,
      caseNumber || null,
      judge || null,
      status || "Undelivered",
      "New Case · Today",
      now,
      now,
      updatedBy || null,
      jurisdiction || null,
    ]
  );

  res.status(201).json(mapCase(result.rows[0]));
});

app.put("/api/cases/:id", async (req, res) => {
  const {
    caseName,
    clientName,
    plaintiff,
    brandName,
    ipClaimsSummary,
    plaintiffProfitPerUnit,
    jurisdiction,
    caseNumber,
    judge,
    status,
    updatedBy,
    updatedAt,
  } = req.body;

  const result = await query(
    `UPDATE cases SET
      case_name = COALESCE($1, case_name),
      client_name = COALESCE($2, client_name),
      plaintiff = COALESCE($3, plaintiff),
      brand_name = COALESCE($4, brand_name),
      ip_claims_summary = COALESCE($5, ip_claims_summary),
      plaintiff_profit_per_unit = COALESCE($6, plaintiff_profit_per_unit),
      jurisdiction = COALESCE($7, jurisdiction),
      case_number = COALESCE($8, case_number),
      judge = COALESCE($9, judge),
      status = COALESCE($10, status),
      updated_by = COALESCE($11, updated_by),
      updated_at = COALESCE($12, updated_at),
      court = COALESCE($7, court)
     WHERE id = $13
     RETURNING *`,
    [
      caseName,
      clientName,
      plaintiff,
      brandName,
      ipClaimsSummary,
      plaintiffProfitPerUnit,
      jurisdiction,
      caseNumber,
      judge,
      status,
      updatedBy,
      updatedAt,
      req.params.id,
    ]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Case not found" });
  }

  res.json(mapCase(result.rows[0]));
});

app.post(
  "/api/cases/:id/defendants/import",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "CSV file is required" });
    }

    const csvText = req.file.buffer.toString("utf-8");
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!records.length) {
      return res.status(400).json({ error: "No rows found in CSV" });
    }

    const headerKeys = Object.keys(records[0] || {}).map((key) =>
      key.trim().toUpperCase()
    );
    if (!headerKeys.includes("SELLER") || !headerKeys.includes("PLATFORM")) {
      return res.status(400).json({
        error:
          "CSV headers must include SELLER and PLATFORM. Please upload the sellers CSV.",
      });
    }

    const existing = await query(
      "SELECT doe_number FROM defendants WHERE case_id = $1",
      [req.params.id]
    );
    const maxDoe = existing.rows.reduce((max, row) => {
      const match = String(row.doe_number || "").match(/\\d+/);
      const num = match ? Number(match[0]) : 0;
      return Math.max(max, num);
    }, 0);

    const values = [];
    const placeholders = [];
    let index = 1;
    let doeCounter = maxDoe;

    const filtered = records.filter(
      (row) => (row.SELLER || row.Seller || "").trim() !== ""
    );

    filtered.forEach((row) => {
      doeCounter += 1;
      values.push(
        req.params.id,
        `Doe ${doeCounter}`,
        "",
        row.PLATFORM || row.Platform || "",
        "",
        "",
        row.SELLER || row.Seller || "",
        "",
        row["BUSINESS NAME"] || row.BusinessName || "",
        row["LOCATED IN"] || row.LocatedIn || "",
        row["SELLER LOCATION"] || row.SellerLocation || "",
        row["SELLER_URL"] || row.SellerURL || "",
        "",
        "",
        ""
      );
      placeholders.push(
        `($${index},$${index + 1},$${index + 2},$${index + 3},$${index + 4},$${index + 5},$${index + 6},$${index + 7},$${index + 8},$${index + 9},$${index + 10},$${index + 11},$${index + 12},$${index + 13},$${index + 14})`
      );
      index += 15;
    });

    if (values.length === 0) {
      return res.status(400).json({ error: "No valid seller rows found." });
    }

    await query(
      `INSERT INTO defendants
        (case_id, doe_number, group_name, platform, merchant_id, backend_id,
         name, email, business_name, located_in, seller_location, seller_url,
         status, defendant_rep_email, defendant_rep_name)
       VALUES ${placeholders.join(",")}`,
      values
    );

    res.json({ imported: filtered.length, startingDoe: maxDoe + 1 });
  }
);

app.get("/api/cases/:id/defendants", async (req, res) => {
  const result = await query(
    `SELECT d.*
     FROM defendants d
     WHERE d.case_id = $1
     ORDER BY
       COALESCE(NULLIF(regexp_replace(d.doe_number, '[^0-9]', '', 'g'), ''), '0')::int`,
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      doeNumber: row.doe_number,
      groupName: row.group_name,
      groupId: row.group_id,
      platform: row.platform,
      merchantId: row.merchant_id,
      backendId: row.backend_id,
      name: row.name,
      email: row.email,
      status: row.status,
      defendantRepEmail: row.defendant_rep_email,
      defendantRepName: row.defendant_rep_name,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      notes: row.notes,
      listingsCount: row.listings_count ?? 0,
    }))
  );
});

app.get("/api/cases/:id/groups", async (req, res) => {
  const result = await query(
    `SELECT g.*,
            COALESCE(c.cnt, 0) AS defendant_count
     FROM groups g
     LEFT JOIN (
       SELECT group_id, COUNT(*)::int AS cnt
       FROM defendants
       WHERE case_id = $1
       GROUP BY group_id
     ) c ON c.group_id = g.id
     WHERE g.case_id = $1
     ORDER BY g.group_name`,
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      groupName: row.group_name,
      plaintiffRepName: row.plaintiff_rep_name,
      defendantRepEmail: row.defendant_rep_email,
      status: row.status,
      defendantCount: row.defendant_count,
    }))
  );
});

app.post("/api/cases/:id/groups", async (req, res) => {
  const { groupName, plaintiffRepName, defendantRepEmail, status, defendantIds } =
    req.body;

  if (!groupName || !Array.isArray(defendantIds) || defendantIds.length === 0) {
    return res.status(400).json({
      error: "groupName and at least one defendant are required",
    });
  }

  const groupResult = await query(
    `INSERT INTO groups
      (case_id, group_name, plaintiff_rep_name, defendant_rep_email, status)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [
      req.params.id,
      groupName,
      plaintiffRepName || null,
      defendantRepEmail || null,
      status || null,
    ]
  );

  const group = groupResult.rows[0];

  await query(
    `UPDATE defendants
     SET group_id = $1, group_name = $2
     WHERE id = ANY($3::uuid[])`,
    [group.id, group.group_name, defendantIds]
  );

  res.status(201).json({
    id: group.id,
    groupName: group.group_name,
  });
});

app.post(
  "/api/cases/:id/listings/import",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "CSV file is required" });
    }

    const csvText = req.file.buffer.toString("utf-8");
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!records.length) {
      return res.status(400).json({ error: "No rows found in CSV" });
    }

    const headerKeys = Object.keys(records[0] || {}).map((key) =>
      key.trim().toUpperCase()
    );
    if (!headerKeys.includes("SELLER") || !headerKeys.includes("PLATFORM")) {
      return res.status(400).json({
        error:
          "CSV headers must include SELLER and PLATFORM. Please upload the listings CSV.",
      });
    }

    const defendants = await query(
      "SELECT id, platform, name FROM defendants WHERE case_id = $1",
      [req.params.id]
    );
    const byKey = new Map();
    defendants.rows.forEach((row) => {
      const key = `${(row.platform || "").toLowerCase()}|${(row.name || "")
        .toLowerCase()
        .trim()}`;
      byKey.set(key, row.id);
    });

    const values = [];
    const placeholders = [];
    let index = 1;
    let imported = 0;
    let skipped = 0;

    records.forEach((row) => {
      const platform = (row.PLATFORM || row.Platform || "").trim();
      const seller = (row.SELLER || row.Seller || "").trim();
      const key = `${platform.toLowerCase()}|${seller.toLowerCase()}`;
      const defendantId = byKey.get(key);
      if (!defendantId) {
        skipped += 1;
        return;
      }

      imported += 1;
      values.push(
        defendantId,
        row["No."] || row.No || "",
        "",
        row.TITLE || row.Title || "",
        row.INF_TYPE || row.InfType || "",
        row.URL || row.Url || "",
        row["SCREENSHOT EVIDENCE"] || row.ScreenshotEvidence || "",
        "",
        "",
        row.REMARK || row.Remark || "",
        ""
      );
      placeholders.push(
        `($${index},$${index + 1},$${index + 2},$${index + 3},$${index + 4},$${index + 5},$${index + 6},$${index + 7},$${index + 8},$${index + 9},$${index + 10})`
      );
      index += 11;
    });

    if (values.length === 0) {
      return res.status(400).json({ error: "No listings matched defendants." });
    }

    await query(
      `INSERT INTO listings
        (defendant_id, product_id, marketplace_id, title, inf_type, url,
         screenshots, test_purchase, test_purchase_status, notes, listing_copyright_links)
       VALUES ${placeholders.join(",")}`,
      values
    );

    await query(
      `UPDATE defendants d
       SET listings_count = l.count
       FROM (
         SELECT defendant_id, COUNT(*)::int AS count
         FROM listings
         WHERE defendant_id IN (SELECT id FROM defendants WHERE case_id = $1)
         GROUP BY defendant_id
       ) l
       WHERE d.id = l.defendant_id`,
      [req.params.id]
    );

    res.json({ imported, skipped });
  }
);

app.put("/api/defendants/:id", async (req, res) => {
  const {
    doeNumber,
    groupName,
    platform,
    merchantId,
    backendId,
    name,
    email,
    status,
    defendantRepEmail,
    defendantRepName,
    updatedAt,
    updatedBy,
  } = req.body;

  const result = await query(
    `UPDATE defendants SET
      doe_number = COALESCE($1, doe_number),
      group_name = COALESCE($2, group_name),
      platform = COALESCE($3, platform),
      merchant_id = COALESCE($4, merchant_id),
      backend_id = COALESCE($5, backend_id),
      name = COALESCE($6, name),
      email = COALESCE($7, email),
      status = COALESCE($8, status),
      defendant_rep_email = COALESCE($9, defendant_rep_email),
      defendant_rep_name = COALESCE($10, defendant_rep_name),
      updated_at = COALESCE($11, updated_at),
      updated_by = COALESCE($12, updated_by)
     WHERE id = $13
     RETURNING *`,
    [
      doeNumber,
      groupName,
      platform,
      merchantId,
      backendId,
      name,
      email,
      status,
      defendantRepEmail,
      defendantRepName,
      updatedAt,
      updatedBy,
      req.params.id,
    ]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Defendant not found" });
  }

  res.json(result.rows[0]);
});

app.get("/api/defendants/:id/listings", async (req, res) => {
  const result = await query(
    "SELECT * FROM listings WHERE defendant_id = $1",
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      marketplaceId: row.marketplace_id,
      url: row.url,
      sales: row.sales,
      screenshotDate: row.screenshot_date,
      screenshots: row.screenshots,
      testPurchase: row.test_purchase,
      testPurchaseStatus: row.test_purchase_status,
      notes: row.notes,
      listingCopyrightLinks: row.listing_copyright_links,
    }))
  );
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
