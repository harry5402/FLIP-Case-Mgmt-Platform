require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { query } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
const uploadsDir = path.join(__dirname, "uploads");
const templateUploadsDir = path.join(uploadsDir, "templates");
fs.mkdirSync(templateUploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

const upload = multer({ storage: multer.memoryStorage() });
const sessions = new Map();

const ADMIN_EMAIL = "hlesak@fleneriplaw.com";
const ADMIN_PASSWORD = "Flener224!!";

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

const sessionFromRequest = (req) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return sessions.get(token) || null;
};

const requireSession = (req, res, next) => {
  const session = sessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.session = session;
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session || req.session.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

const ensureAdminUser = async () => {
  const passwordHash = hashPassword(ADMIN_PASSWORD);
  await query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email)
     DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = 'admin'`,
    ["Harry Lesak", ADMIN_EMAIL, passwordHash]
  );
};

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const result = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [
    email.trim(),
  ]);
  if (!result.rows.length) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const user = result.rows[0];
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const token = crypto.randomUUID();
  const session = {
    token,
    userId: user.id,
    name: user.name || "",
    email: user.email,
    role: user.role,
  };
  sessions.set(token, session);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name || "",
      email: user.email,
      role: user.role,
    },
  });
});

app.get("/api/auth/me", requireSession, async (req, res) => {
  res.json({ user: req.session });
});

app.post("/api/auth/logout", requireSession, async (req, res) => {
  sessions.delete(req.session.token);
  res.json({ ok: true });
});

app.get("/api/users", requireSession, requireAdmin, async (req, res) => {
  const result = await query(
    "SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC"
  );
  res.json(result.rows);
});

app.post("/api/users", requireSession, requireAdmin, async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const passwordHash = hashPassword(password);
  const result = await query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'user')
     RETURNING id, name, email, role, created_at`,
    [name || "", email.trim(), passwordHash]
  );
  res.status(201).json(result.rows[0]);
});

app.use("/api", requireSession);

app.get("/api/users/options", async (req, res) => {
  const result = await query(
    "SELECT id, name, email FROM users ORDER BY lower(email)"
  );
  res.json(result.rows);
});

app.get("/api/tasks/my", async (req, res) => {
  const result = await query(
    `SELECT t.*, c.case_name, d.name AS defendant_name
     FROM tasks t
     JOIN cases c ON c.id = t.case_id
     JOIN defendants d ON d.id = t.defendant_id
     WHERE t.assigned_to_user_id = $1
       AND t.status = 'Open'
     ORDER BY t.due_date NULLS LAST, t.created_at DESC`,
    [req.session.userId]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      defendantId: row.defendant_id,
      taskType: row.task_type,
      dueDate: row.due_date,
      status: row.status,
      caseName: row.case_name,
      defendantName: row.defendant_name,
    }))
  );
});

app.post("/api/tasks", async (req, res) => {
  const { caseId, defendantId, taskType, assignedToUserId, dueDate } = req.body;
  if (!caseId || !defendantId || !taskType || !assignedToUserId || !dueDate) {
    return res.status(400).json({ error: "Missing required task fields." });
  }

  const result = await query(
    `INSERT INTO tasks
      (case_id, defendant_id, task_type, assigned_to_user_id, due_date, status, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,'Open',$6)
     RETURNING *`,
    [
      caseId,
      defendantId,
      taskType,
      assignedToUserId,
      dueDate,
      req.session.userId,
    ]
  );
  res.status(201).json(result.rows[0]);
});

app.put("/api/tasks/:id/complete", async (req, res) => {
  const result = await query(
    `UPDATE tasks
     SET status = 'Complete'
     WHERE id = $1
       AND assigned_to_user_id = $2
     RETURNING id`,
    [req.params.id, req.session.userId]
  );

  if (!result.rows.length) {
    return res.status(404).json({ error: "Task not found." });
  }

  res.json({ ok: true });
});

app.post(
  "/api/cases/:id/templates",
  upload.fields([
    { name: "templateFile", maxCount: 1 },
    { name: "dataFile", maxCount: 1 },
  ]),
  async (req, res) => {
    const templateFile = req.files?.templateFile?.[0];
    const dataFile = req.files?.dataFile?.[0];
    if (!templateFile || !dataFile) {
      return res
        .status(400)
        .json({ error: "Both template files are required." });
    }

    const saveUpload = (file) => {
      const originalName = file.originalname || "template";
      const ext = path.extname(originalName) || ".bin";
      const baseName = path
        .basename(originalName, ext)
        .replace(/[^a-zA-Z0-9-_ ]/g, "")
        .trim();
      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}-${(baseName || "file").replace(/\s+/g, "-")}${ext}`;
      const filePath = path.join(templateUploadsDir, fileName);
      fs.writeFileSync(filePath, file.buffer);
      return `/uploads/templates/${fileName}`;
    };

    const templateFileUrl = saveUpload(templateFile);
    const dataFileUrl = saveUpload(dataFile);
    const displayName =
      (req.body.displayName || "").trim() ||
      path.basename(templateFile.originalname || "Template Package");

    const result = await query(
      `INSERT INTO case_templates (case_id, display_name, file_url, template_file_url, data_file_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, display_name, file_url, template_file_url, data_file_url, created_at`,
      [
        req.params.id,
        displayName,
        templateFileUrl,
        templateFileUrl,
        dataFileUrl,
      ]
    );

    const row = result.rows[0];
    res.status(201).json({
      id: row.id,
      displayName: row.display_name,
      fileUrl: row.file_url,
      templateFileUrl: row.template_file_url || row.file_url,
      dataFileUrl: row.data_file_url || null,
      createdAt: row.created_at,
    });
  }
);

app.get("/api/cases/:id/templates", async (req, res) => {
  const result = await query(
    `SELECT id, display_name, file_url, template_file_url, data_file_url, created_at
     FROM case_templates
     WHERE case_id = $1
     ORDER BY created_at DESC`,
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      fileUrl: row.file_url,
      templateFileUrl: row.template_file_url || row.file_url,
      dataFileUrl: row.data_file_url || null,
      createdAt: row.created_at,
    }))
  );
});

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
  notes: row.notes || "",
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
    notes,
  } = req.body;

  if (!caseName || !clientName) {
    return res.status(400).json({ error: "caseName and clientName are required" });
  }

  const now = new Date().toISOString().slice(0, 10);
  const result = await query(
    `INSERT INTO cases
      (case_name, client_name, plaintiff, brand_name, ip_claims_summary, plaintiff_profit_per_unit,
       jurisdiction, case_number, judge, status, recent_status, filed_date, updated_at, updated_by, court, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
      notes || "",
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
    notes,
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
      court = COALESCE($7, court),
      notes = COALESCE($13, notes)
     WHERE id = $14
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
      notes,
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
    `SELECT d.*, n.legal_status AS negotiation_legal_status
     FROM defendants d
     LEFT JOIN LATERAL (
       SELECT legal_status
       FROM negotiations
       WHERE defendant_id = d.id
       ORDER BY id DESC
       LIMIT 1
     ) n ON TRUE
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
      status: row.negotiation_legal_status || row.status,
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

app.get("/api/groups/:id", async (req, res) => {
  const result = await query(
    `SELECT g.id,
            g.case_id,
            g.group_name,
            g.plaintiff_rep_name,
            g.defendant_rep_email,
            g.status,
            c.case_name,
            c.client_name,
            c.brand_name,
            c.ip_claims_summary,
            c.plaintiff_profit_per_unit,
            c.jurisdiction,
            c.case_number,
            c.judge,
            c.updated_at,
            c.updated_by
     FROM groups g
     JOIN cases c ON c.id = g.case_id
     WHERE g.id = $1`,
    [req.params.id]
  );
  if (!result.rows.length) {
    return res.status(404).json({ error: "Group not found" });
  }
  const row = result.rows[0];
  res.json({
    id: row.id,
    caseId: row.case_id,
    groupName: row.group_name,
    plaintiffRepName: row.plaintiff_rep_name,
    defendantRepEmail: row.defendant_rep_email,
    status: row.status,
    caseInfo: {
      caseName: row.case_name,
      clientName: row.client_name,
      brandName: row.brand_name,
      ipClaimsSummary: row.ip_claims_summary,
      plaintiffProfitPerUnit: row.plaintiff_profit_per_unit,
      jurisdiction: row.jurisdiction,
      caseNumber: row.case_number,
      judge: row.judge,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    },
  });
});

app.get("/api/groups/:id/defendants", async (req, res) => {
  const result = await query(
    `SELECT d.*, n.legal_status AS negotiation_legal_status
     FROM defendants d
     LEFT JOIN LATERAL (
       SELECT legal_status
       FROM negotiations
       WHERE defendant_id = d.id
       ORDER BY id DESC
       LIMIT 1
     ) n ON TRUE
     WHERE d.group_id = $1
     ORDER BY
       COALESCE(NULLIF(regexp_replace(d.doe_number, '[^0-9]', '', 'g'), ''), '0')::int`,
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      doeNumber: row.doe_number,
      groupName: row.group_name,
      platform: row.platform,
      merchantId: row.merchant_id,
      backendId: row.backend_id,
      name: row.name,
      email: row.email,
      status: row.negotiation_legal_status || row.status,
      defendantRepEmail: row.defendant_rep_email,
      defendantRepName: row.defendant_rep_name,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      notes: row.notes,
      listingsCount: row.listings_count ?? 0,
    }))
  );
});

app.get("/api/groups/:id/listings", async (req, res) => {
  const result = await query(
    `SELECT l.*, d.name AS defendant_name
     FROM listings l
     JOIN defendants d ON d.id = l.defendant_id
     WHERE d.group_id = $1
     ORDER BY d.name`,
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      defendantName: row.defendant_name,
      defendantId: row.defendant_id,
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
    notes,
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
      updated_by = COALESCE($12, updated_by),
      notes = COALESCE($13, notes)
     WHERE id = $14
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
      notes,
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

app.get("/api/defendants/:id/negotiation", async (req, res) => {
  const result = await query(
    "SELECT * FROM negotiations WHERE defendant_id = $1 ORDER BY id LIMIT 1",
    [req.params.id]
  );
  if (!result.rows.length) {
    return res.json({});
  }
  const row = result.rows[0];
  res.json({
    legalStatus: row.legal_status,
    plaintiffLastOffer: row.plaintiff_last_offer,
    defendantLastOffer: row.defendant_last_offer,
    settlementDate: row.settlement_date,
    settlementAmount: row.settlement_amount,
    agreementUploaded: row.agreement_uploaded,
  });
});

app.put("/api/defendants/:id/negotiation", async (req, res) => {
  const {
    legalStatus,
    plaintiffLastOffer,
    defendantLastOffer,
    settlementDate,
    settlementAmount,
    agreementUploaded,
  } = req.body;

  const updated = await query(
    `UPDATE negotiations
     SET legal_status = $2,
         plaintiff_last_offer = $3,
         defendant_last_offer = $4,
         settlement_date = $5,
         settlement_amount = $6,
         agreement_uploaded = $7
     WHERE defendant_id = $1
     RETURNING *`,
    [
      req.params.id,
      legalStatus || null,
      plaintiffLastOffer ?? null,
      defendantLastOffer ?? null,
      settlementDate || null,
      settlementAmount ?? null,
      agreementUploaded || null,
    ]
  );

  if (!updated.rows.length) {
    await query(
      `INSERT INTO negotiations
        (defendant_id, legal_status, plaintiff_last_offer, defendant_last_offer, settlement_date, settlement_amount, agreement_uploaded)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        req.params.id,
        legalStatus || null,
        plaintiffLastOffer ?? null,
        defendantLastOffer ?? null,
        settlementDate || null,
        settlementAmount ?? null,
        agreementUploaded || null,
      ]
    );
  }

  // Keep defendant status aligned with negotiation legal status for table views.
  await query(
    `UPDATE defendants
     SET status = COALESCE($2, status)
     WHERE id = $1`,
    [req.params.id, legalStatus || null]
  );

  res.json({ ok: true });
});

app.get("/api/defendants/:id/collection", async (req, res) => {
  const result = await query(
    "SELECT * FROM collections WHERE defendant_id = $1 ORDER BY id LIMIT 1",
    [req.params.id]
  );
  if (!result.rows.length) {
    return res.json({});
  }
  const row = result.rows[0];
  res.json({
    settlementCollectedDate: row.settlement_collected_date,
    collectedAmount: row.collected_amount,
    settlementPaymentId: row.settlement_payment_id,
    restrainedFundsCollectedAmount: row.restrained_funds_collected_amount,
    totalCollectedAmount: row.total_collected_amount,
  });
});

app.put("/api/defendants/:id/collection", async (req, res) => {
  const {
    settlementCollectedDate,
    collectedAmount,
    settlementPaymentId,
    restrainedFundsCollectedAmount,
    totalCollectedAmount,
  } = req.body;

  const updated = await query(
    `UPDATE collections
     SET settlement_collected_date = $2,
         collected_amount = $3,
         settlement_payment_id = $4,
         restrained_funds_collected_amount = $5,
         total_collected_amount = $6
     WHERE defendant_id = $1
     RETURNING *`,
    [
      req.params.id,
      settlementCollectedDate || null,
      collectedAmount ?? null,
      settlementPaymentId || null,
      restrainedFundsCollectedAmount ?? null,
      totalCollectedAmount ?? null,
    ]
  );

  if (!updated.rows.length) {
    await query(
      `INSERT INTO collections
        (defendant_id, settlement_collected_date, collected_amount, settlement_payment_id, restrained_funds_collected_amount, total_collected_amount)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        req.params.id,
        settlementCollectedDate || null,
        collectedAmount ?? null,
        settlementPaymentId || null,
        restrainedFundsCollectedAmount ?? null,
        totalCollectedAmount ?? null,
      ]
    );
  }

  res.json({ ok: true });
});

app.get("/api/defendants/:id/bookkeeping", async (req, res) => {
  const result = await query(
    "SELECT * FROM bookkeeping WHERE defendant_id = $1 ORDER BY id LIMIT 1",
    [req.params.id]
  );
  if (!result.rows.length) {
    return res.json({});
  }
  const row = result.rows[0];
  res.json({
    status: row.status,
    agreementProcessed: row.agreement_processed,
  });
});

app.put("/api/defendants/:id/bookkeeping", async (req, res) => {
  const { status, agreementProcessed } = req.body;

  const updated = await query(
    `UPDATE bookkeeping
     SET status = $2,
         agreement_processed = $3
     WHERE defendant_id = $1
     RETURNING *`,
    [req.params.id, status || null, agreementProcessed || null]
  );

  if (!updated.rows.length) {
    await query(
      `INSERT INTO bookkeeping (defendant_id, status, agreement_processed)
       VALUES ($1,$2,$3)`,
      [req.params.id, status || null, agreementProcessed || null]
    );
  }

  res.json({ ok: true });
});

const start = async () => {
  await ensureAdminUser();
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });
};

start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
