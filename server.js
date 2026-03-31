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
const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SESSION_TTL_HOURS = parsePositiveInt(process.env.SESSION_TTL_HOURS, 12);
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
const IDLE_TIMEOUT_MINUTES = parsePositiveInt(
  process.env.IDLE_TIMEOUT_MINUTES,
  60
);
const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = parsePositiveInt(process.env.LOGIN_MAX_ATTEMPTS, 8);
const LOGIN_WINDOW_MS =
  parsePositiveInt(process.env.LOGIN_WINDOW_MINUTES, 15) * 60 * 1000;
const BODY_LIMIT = process.env.BODY_LIMIT || "1mb";
const UPLOAD_MAX_FILE_MB = parsePositiveInt(process.env.UPLOAD_MAX_FILE_MB, 10);
const LITIGATION_TABS = [
  "NDIL",
  "GAND",
  "NDIN",
  "WDPA",
  "EDWI",
  "FAIKERZ",
  "ARCHIVED",
];

const allowedOriginSet = new Set(
  String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
if (!isProduction) {
  allowedOriginSet.add("http://localhost:3000");
  allowedOriginSet.add("http://127.0.0.1:3000");
}

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin and server-to-server requests with no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOriginSet.size === 0) return callback(null, true);
      if (allowedOriginSet.has(origin)) return callback(null, true);
      return callback(new Error("Blocked by CORS policy"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: BODY_LIMIT }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';"
  );
  next();
});
if (isProduction) {
  app.use((req, res, next) => {
    const proto = req.headers["x-forwarded-proto"];
    if (req.secure || proto === "https") return next();
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  });
}

const publicDir = path.join(__dirname, "public");
app.use(express.static(publicDir, { dotfiles: "ignore" }));
const uploadsDir = path.join(__dirname, "uploads");
const templateUploadsDir = path.join(uploadsDir, "templates");
fs.mkdirSync(templateUploadsDir, { recursive: true });
app.use("/uploads", express.static(uploadsDir));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: UPLOAD_MAX_FILE_MB * 1024 * 1024,
    files: 2,
  },
});
const sessions = new Map();
const loginAttempts = new Map();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "hlesak@fleneriplaw.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Flener224!!";
if (isProduction && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
  throw new Error(
    "Set ADMIN_EMAIL and ADMIN_PASSWORD in production environment variables."
  );
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (
      !session.expiresAt ||
      session.expiresAt <= now ||
      (session.lastActivityAt && now - session.lastActivityAt > IDLE_TIMEOUT_MS)
    ) {
      sessions.delete(token);
    }
  }
  for (const [key, attempt] of loginAttempts.entries()) {
    if (now > attempt.windowStart + LOGIN_WINDOW_MS * 2) {
      loginAttempts.delete(key);
    }
  }
}, 60 * 1000).unref();

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

const loginAttemptKey = (req, email) => {
  const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
  return `${String(ip)}|${String(email || "").trim().toLowerCase()}`;
};

const getLoginAttemptState = (key) => {
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current) return { count: 0, windowStart: now, blockedUntil: 0 };
  if (now > current.windowStart + LOGIN_WINDOW_MS) {
    const reset = { count: 0, windowStart: now, blockedUntil: 0 };
    loginAttempts.set(key, reset);
    return reset;
  }
  return current;
};

const isFileExtensionAllowed = (fileName, allowedExtensions) => {
  const ext = path.extname(fileName || "").toLowerCase();
  return allowedExtensions.includes(ext);
};

const sessionFromRequest = (req) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const session = sessions.get(token) || null;
  if (!session) return null;
  const now = Date.now();
  if (now > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  if (session.lastActivityAt && now - session.lastActivityAt > IDLE_TIMEOUT_MS) {
    sessions.delete(token);
    return null;
  }
  session.lastActivityAt = now;
  return session;
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

const safeJson = (value) => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return JSON.stringify({ error: "unserializable" });
  }
};

const writeAuditLog = async (req, entry) => {
  try {
    await query(
      `INSERT INTO audit_logs
        (user_id, user_email, action, entity_type, entity_id, before_data, after_data, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)`,
      [
        req.session?.userId || null,
        req.session?.email || null,
        entry.action,
        entry.entityType,
        entry.entityId || null,
        safeJson(entry.before),
        safeJson(entry.after),
        safeJson(entry.metadata),
      ]
    );
  } catch (error) {
    console.error("Failed to write audit log:", error.message);
  }
};

const ensureAuditLogTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      user_email TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      before_data JSONB,
      after_data JSONB,
      metadata JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    "CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC)"
  );
};

const ensureCaseUpdatedAtTimestamp = async () => {
  await query(`
    ALTER TABLE cases
    ALTER COLUMN updated_at TYPE TIMESTAMPTZ
    USING (
      CASE
        WHEN updated_at IS NULL THEN NULL
        ELSE updated_at AT TIME ZONE 'UTC'
      END
    )
  `);
};

const ensureCaseDocketOnlyColumn = async () => {
  await query(`
    ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS is_docket_only BOOLEAN NOT NULL DEFAULT FALSE
  `);
};

const ensureLitigationTables = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS litigation_case_state (
      case_id UUID PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      archived_at TIMESTAMPTZ,
      archived_by TEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS litigation_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
      action TEXT,
      internal_due_date DATE,
      final_due_date DATE,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS litigation_collections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
      platform TEXT,
      sent_to_platform TEXT,
      acknowledged TEXT,
      breakdown TEXT,
      all_def_accounted_for TEXT,
      money_received TEXT,
      sent_to_plaintiff TEXT,
      notes TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
};

const normalizeLitigationTab = (jurisdiction) => {
  const normalized = String(jurisdiction || "")
    .trim()
    .toUpperCase();
  return LITIGATION_TABS.includes(normalized) && normalized !== "ARCHIVED"
    ? normalized
    : null;
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
  const emailTrimmed = email.trim();
  const attemptKey = loginAttemptKey(req, emailTrimmed);
  const attemptState = getLoginAttemptState(attemptKey);
  if (attemptState.blockedUntil && Date.now() < attemptState.blockedUntil) {
    return res.status(429).json({
      error: "Too many failed login attempts. Try again in a few minutes.",
    });
  }

  const result = await query("SELECT * FROM users WHERE lower(email) = lower($1)", [
    emailTrimmed,
  ]);
  if (!result.rows.length) {
    const nextCount = attemptState.count + 1;
    loginAttempts.set(attemptKey, {
      count: nextCount,
      windowStart: attemptState.windowStart,
      blockedUntil:
        nextCount >= LOGIN_MAX_ATTEMPTS ? Date.now() + LOGIN_WINDOW_MS : 0,
    });
    return res.status(401).json({ error: "Invalid credentials." });
  }

  const user = result.rows[0];
  if (!verifyPassword(password, user.password_hash)) {
    const nextCount = attemptState.count + 1;
    loginAttempts.set(attemptKey, {
      count: nextCount,
      windowStart: attemptState.windowStart,
      blockedUntil:
        nextCount >= LOGIN_MAX_ATTEMPTS ? Date.now() + LOGIN_WINDOW_MS : 0,
    });
    return res.status(401).json({ error: "Invalid credentials." });
  }
  loginAttempts.delete(attemptKey);

  const token = crypto.randomUUID();
  const session = {
    token,
    userId: user.id,
    name: user.name || "",
    email: user.email,
    role: user.role,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
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
    session: {
      idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
      sessionTtlHours: SESSION_TTL_HOURS,
    },
  });
});

app.get("/api/auth/me", requireSession, async (req, res) => {
  res.json({
    user: req.session,
    session: {
      idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES,
      sessionTtlHours: SESSION_TTL_HOURS,
    },
  });
});

app.post("/api/auth/logout", requireSession, async (req, res) => {
  sessions.delete(req.session.token);
  res.json({ ok: true });
});

app.post("/api/auth/logout-all", requireSession, async (req, res) => {
  let deleted = 0;
  for (const [token, session] of sessions.entries()) {
    if (session.userId === req.session.userId) {
      sessions.delete(token);
      deleted += 1;
    }
  }
  await writeAuditLog(req, {
    action: "auth.logout_all",
    entityType: "user",
    entityId: req.session.userId,
    before: null,
    after: { sessionsInvalidated: deleted },
  });
  res.json({ ok: true, sessionsInvalidated: deleted });
});

app.post("/api/auth/change-password", requireSession, async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res
      .status(400)
      .json({ error: "Old password and new password are required." });
  }
  if (String(newPassword).length < 8) {
    return res
      .status(400)
      .json({ error: "New password must be at least 8 characters." });
  }
  if (oldPassword === newPassword) {
    return res
      .status(400)
      .json({ error: "New password must be different from old password." });
  }

  const userResult = await query(
    "SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1",
    [req.session.userId]
  );
  if (!userResult.rows.length) {
    return res.status(404).json({ error: "User not found." });
  }
  const user = userResult.rows[0];
  if (!verifyPassword(oldPassword, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  await query("UPDATE users SET password_hash = $2 WHERE id = $1", [
    req.session.userId,
    hashPassword(newPassword),
  ]);
  await writeAuditLog(req, {
    action: "auth.change_password",
    entityType: "user",
    entityId: req.session.userId,
    before: null,
    after: { changed: true },
    metadata: { source: "self_service" },
  });

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
  await writeAuditLog(req, {
    action: "users.create",
    entityType: "user",
    entityId: result.rows[0].id,
    before: null,
    after: result.rows[0],
  });
  res.status(201).json(result.rows[0]);
});

app.post("/api/users/:id/logout-all", requireSession, requireAdmin, async (req, res) => {
  const userResult = await query(
    "SELECT id, email FROM users WHERE id = $1 LIMIT 1",
    [req.params.id]
  );
  if (!userResult.rows.length) {
    return res.status(404).json({ error: "User not found." });
  }

  let deleted = 0;
  for (const [token, session] of sessions.entries()) {
    if (session.userId === req.params.id) {
      sessions.delete(token);
      deleted += 1;
    }
  }

  await writeAuditLog(req, {
    action: "admin.logout_all_sessions",
    entityType: "user",
    entityId: req.params.id,
    before: null,
    after: {
      sessionsInvalidated: deleted,
      targetEmail: userResult.rows[0].email,
    },
  });

  res.json({ ok: true, sessionsInvalidated: deleted });
});

app.get("/api/audit-logs", requireSession, requireAdmin, async (req, res) => {
  const limit = Math.min(parsePositiveInt(req.query.limit, 100), 500);
  const result = await query(
    `SELECT id, user_id, user_email, action, entity_type, entity_id, before_data, after_data, metadata, created_at
     FROM audit_logs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json(result.rows);
});

app.use("/api", requireSession);

app.get("/api/users/options", async (req, res) => {
  const result = await query(
    "SELECT id, name, email FROM users ORDER BY lower(email)"
  );
  res.json(result.rows);
});

app.get("/api/litigation/cases", async (req, res) => {
  const requestedTab = String(req.query.tab || "NDIL").toUpperCase();
  if (!LITIGATION_TABS.includes(requestedTab)) {
    return res.status(400).json({ error: "Invalid tab." });
  }

  const result = await query(
    `SELECT
        c.id,
        c.case_name,
        c.case_number,
        c.jurisdiction,
        COALESCE(c.is_docket_only, FALSE) AS is_docket_only,
        c.status,
        COALESCE(defs.count, 0) AS defendant_count,
        COALESCE(state.archived, FALSE) AS archived,
        COALESCE(a.created_at, c.updated_at, c.created_at) AS most_recent_edit_at,
        COALESCE(a.user_email, c.updated_by, '') AS most_recent_edit_by
     FROM cases c
     LEFT JOIN litigation_case_state state ON state.case_id = c.id
     LEFT JOIN (
       SELECT case_id, COUNT(*)::int AS count
       FROM defendants
       GROUP BY case_id
     ) defs ON defs.case_id = c.id
     LEFT JOIN LATERAL (
       SELECT created_at, user_email
       FROM audit_logs
       WHERE entity_type = 'case'
         AND entity_id = c.id::text
       ORDER BY created_at DESC
       LIMIT 1
     ) a ON TRUE
     WHERE (
       ($1 = 'ARCHIVED' AND COALESCE(state.archived, FALSE) = TRUE)
       OR
       ($1 <> 'ARCHIVED'
         AND COALESCE(state.archived, FALSE) = FALSE
         AND UPPER(COALESCE(c.jurisdiction, '')) = $1
         AND (
           COALESCE(c.is_docket_only, FALSE) = TRUE
           OR UPPER(COALESCE(c.status, '')) = 'ACTIVE'
         )
       )
     )
     ORDER BY COALESCE(a.created_at, c.updated_at, c.created_at) DESC NULLS LAST`,
    [requestedTab]
  );

  res.json(
    result.rows.map((row) => ({
      id: row.id,
      caseName: row.case_name,
      caseNumber: row.case_number,
      jurisdiction: row.jurisdiction,
      isDocketOnly: row.is_docket_only,
      defendantCount: row.defendant_count,
      archived: row.archived,
      mostRecentEditAt: row.most_recent_edit_at,
      mostRecentEditBy: row.most_recent_edit_by,
    }))
  );
});

app.get("/api/litigation/cases/:id/entries", async (req, res) => {
  const result = await query(
    `SELECT id, action, internal_due_date, final_due_date, notes, sort_order
     FROM litigation_actions
     WHERE case_id = $1
     ORDER BY sort_order, updated_at, id`,
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      action: row.action || "",
      internalDueDate: row.internal_due_date,
      finalDueDate: row.final_due_date,
      notes: row.notes || "",
      sortOrder: row.sort_order,
    }))
  );
});

app.put("/api/litigation/cases/:id/entries", async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
  if (!entries) {
    return res.status(400).json({ error: "entries array is required." });
  }

  await query("DELETE FROM litigation_actions WHERE case_id = $1", [req.params.id]);
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] || {};
    await query(
      `INSERT INTO litigation_actions
        (case_id, action, internal_due_date, final_due_date, notes, sort_order, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)`,
      [
        req.params.id,
        entry.action || null,
        entry.internalDueDate || null,
        entry.finalDueDate || null,
        entry.notes || null,
        i,
        req.session?.name || req.session?.email || null,
      ]
    );
  }

  await writeAuditLog(req, {
    action: "litigation.entries.save",
    entityType: "case",
    entityId: req.params.id,
    before: null,
    after: { count: entries.length },
  });

  res.json({ ok: true });
});

app.get("/api/litigation/cases/:id/collections", async (req, res) => {
  const result = await query(
    `SELECT id, platform, sent_to_platform, acknowledged, breakdown, all_def_accounted_for, money_received, sent_to_plaintiff, notes, sort_order
     FROM litigation_collections
     WHERE case_id = $1
     ORDER BY sort_order, updated_at, id`,
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      platform: row.platform || "",
      sentToPlatform: row.sent_to_platform || "",
      acknowledged: row.acknowledged || "",
      breakdown: row.breakdown || "",
      allDefAccountedFor: row.all_def_accounted_for || "",
      moneyReceived: row.money_received || "",
      sentToPlaintiff: row.sent_to_plaintiff || "",
      notes: row.notes || "",
      sortOrder: row.sort_order,
    }))
  );
});

app.put("/api/litigation/cases/:id/collections", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) {
    return res.status(400).json({ error: "rows array is required." });
  }

  await query("DELETE FROM litigation_collections WHERE case_id = $1", [req.params.id]);
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || {};
    await query(
      `INSERT INTO litigation_collections
        (case_id, platform, sent_to_platform, acknowledged, breakdown, all_def_accounted_for, money_received, sent_to_plaintiff, notes, sort_order, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)`,
      [
        req.params.id,
        row.platform || null,
        row.sentToPlatform || null,
        row.acknowledged || null,
        row.breakdown || null,
        row.allDefAccountedFor || null,
        row.moneyReceived || null,
        row.sentToPlaintiff || null,
        row.notes || null,
        i,
        req.session?.name || req.session?.email || null,
      ]
    );
  }

  await writeAuditLog(req, {
    action: "litigation.collections.save",
    entityType: "case",
    entityId: req.params.id,
    before: null,
    after: { count: rows.length },
  });

  res.json({ ok: true });
});

app.put("/api/litigation/cases/:id/archive", async (req, res) => {
  const archived = Boolean(req.body?.archived);
  await query(
    `INSERT INTO litigation_case_state (case_id, archived, archived_at, archived_by)
     VALUES ($1,$2,CASE WHEN $2 THEN NOW() ELSE NULL END,CASE WHEN $2 THEN $3 ELSE NULL END)
     ON CONFLICT (case_id)
     DO UPDATE SET
       archived = EXCLUDED.archived,
       archived_at = EXCLUDED.archived_at,
       archived_by = EXCLUDED.archived_by`,
    [req.params.id, archived, req.session?.name || req.session?.email || null]
  );

  await writeAuditLog(req, {
    action: archived ? "litigation.archive" : "litigation.reopen",
    entityType: "case",
    entityId: req.params.id,
    before: null,
    after: { archived },
  });

  res.json({ ok: true, archived });
});

app.get("/api/tasks/my", async (req, res) => {
  const result = await query(
    `SELECT t.*,
            c.case_name,
            d.name AS defendant_name,
            g.group_name
     FROM tasks t
     JOIN cases c ON c.id = t.case_id
     LEFT JOIN defendants d ON d.id = t.defendant_id
     LEFT JOIN groups g ON g.id = t.group_id
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
      groupId: row.group_id,
      targetType: row.group_id ? "group" : "defendant",
      taskType: row.task_type,
      dueDate: row.due_date,
      status: row.status,
      caseName: row.case_name,
      defendantName: row.defendant_name,
      groupName: row.group_name,
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
  await writeAuditLog(req, {
    action: "tasks.create",
    entityType: "task",
    entityId: result.rows[0].id,
    before: null,
    after: result.rows[0],
  });
  res.status(201).json(result.rows[0]);
});

app.post("/api/groups/:id/tasks", async (req, res) => {
  const { taskType, assignedToUserId, dueDate } = req.body;
  if (!taskType || !assignedToUserId || !dueDate) {
    return res.status(400).json({ error: "Missing required task fields." });
  }

  const groupResult = await query("SELECT case_id FROM groups WHERE id = $1", [
    req.params.id,
  ]);
  if (!groupResult.rows.length) {
    return res.status(404).json({ error: "Group not found." });
  }
  const caseId = groupResult.rows[0].case_id;

  const result = await query(
    `INSERT INTO tasks
      (case_id, group_id, defendant_id, task_type, assigned_to_user_id, due_date, status, created_by_user_id)
     VALUES ($1,$2,NULL,$3,$4,$5,'Open',$6)
     RETURNING *`,
    [caseId, req.params.id, taskType, assignedToUserId, dueDate, req.session.userId]
  );
  await writeAuditLog(req, {
    action: "tasks.create_group",
    entityType: "task",
    entityId: result.rows[0].id,
    before: null,
    after: result.rows[0],
  });

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
  await writeAuditLog(req, {
    action: "tasks.complete",
    entityType: "task",
    entityId: req.params.id,
    before: { status: "Open" },
    after: { status: "Complete" },
  });

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
    const templateAllowed = [".doc", ".docx"];
    const dataAllowed = [".csv", ".xlsx", ".xls"];
    if (!isFileExtensionAllowed(templateFile.originalname, templateAllowed)) {
      return res.status(400).json({
        error: "Template file must be .doc or .docx",
      });
    }
    if (!isFileExtensionAllowed(dataFile.originalname, dataAllowed)) {
      return res.status(400).json({
        error: "Merge data file must be .csv, .xlsx, or .xls",
      });
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
    await writeAuditLog(req, {
      action: "templates.upload",
      entityType: "case_template",
      entityId: row.id,
      before: null,
      after: {
        caseId: req.params.id,
        displayName: row.display_name,
        templateFileUrl: row.template_file_url || row.file_url,
        dataFileUrl: row.data_file_url || null,
      },
    });
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
  isDocketOnly: row.is_docket_only || false,
});

const mapIpClaim = (row) => ({
  id: row.id,
  caseId: row.case_id,
  defendantId: row.defendant_id,
  brandName: row.brand_name,
  type: row.type,
  subType: row.sub_type,
  applicationDate: row.application_date,
  registrationDate: row.registration_date,
  serialNumber: row.serial_number,
  registrationNumber: row.registration_number,
  specimenFolder: row.specimen_folder,
  listingsCount: row.listings_count,
  defendantCount: row.defendant_count,
});

const touchCase = async (caseId, session) => {
  await query(
    `UPDATE cases
     SET updated_at = NOW(),
         updated_by = $2
     WHERE id = $1`,
    [caseId, session?.name || session?.email || "System"]
  );
};

app.get("/api/cases", async (req, res) => {
  const result = await query(
    "SELECT * FROM cases WHERE COALESCE(is_docket_only, FALSE) = FALSE ORDER BY created_at DESC"
  );
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
    isDocketOnly,
  } = req.body;

  if (!caseName || !clientName) {
    return res.status(400).json({ error: "caseName and clientName are required" });
  }

  const now = new Date().toISOString();
  const result = await query(
    `INSERT INTO cases
      (case_name, client_name, plaintiff, brand_name, ip_claims_summary, plaintiff_profit_per_unit,
       jurisdiction, case_number, judge, status, recent_status, filed_date, updated_at, updated_by, court, notes, is_docket_only)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
      Boolean(isDocketOnly),
    ]
  );
  await writeAuditLog(req, {
    action: "cases.create",
    entityType: "case",
    entityId: result.rows[0].id,
    before: null,
    after: mapCase(result.rows[0]),
  });

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
    notes,
  } = req.body;
  const actor = req.session?.name || req.session?.email || updatedBy || null;

  const existing = await query("SELECT * FROM cases WHERE id = $1", [req.params.id]);
  if (!existing.rows.length) {
    return res.status(404).json({ error: "Case not found" });
  }

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
      updated_at = NOW(),
      court = COALESCE($7, court),
      notes = COALESCE($12, notes)
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
      actor,
      notes,
      req.params.id,
    ]
  );

  await writeAuditLog(req, {
    action: "cases.update",
    entityType: "case",
    entityId: req.params.id,
    before: mapCase(existing.rows[0]),
    after: mapCase(result.rows[0]),
  });

  res.json(mapCase(result.rows[0]));
});

app.get("/api/cases/:id/ip-claims", async (req, res) => {
  const result = await query(
    `SELECT *
     FROM ip_claims
     WHERE case_id = $1
     ORDER BY application_date DESC NULLS LAST, id DESC`,
    [req.params.id]
  );
  res.json(result.rows.map(mapIpClaim));
});

app.post("/api/cases/:id/ip-claims", async (req, res) => {
  const {
    brandName,
    type,
    subType,
    applicationDate,
    registrationDate,
    serialNumber,
    registrationNumber,
    specimenFolder,
    listingsCount,
    defendantCount,
  } = req.body || {};

  const result = await query(
    `INSERT INTO ip_claims
      (case_id, brand_name, type, sub_type, application_date, registration_date, serial_number, registration_number, specimen_folder, listings_count, defendant_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      req.params.id,
      brandName || null,
      type || null,
      subType || null,
      applicationDate || null,
      registrationDate || null,
      serialNumber || null,
      registrationNumber || null,
      specimenFolder || null,
      listingsCount ?? null,
      defendantCount ?? null,
    ]
  );
  const created = mapIpClaim(result.rows[0]);
  await touchCase(req.params.id, req.session);
  await writeAuditLog(req, {
    action: "ip_claims.create",
    entityType: "ip_claim",
    entityId: created.id,
    before: null,
    after: created,
  });
  res.status(201).json(created);
});

app.put("/api/ip-claims/:id", async (req, res) => {
  const {
    brandName,
    type,
    subType,
    applicationDate,
    registrationDate,
    serialNumber,
    registrationNumber,
    specimenFolder,
    listingsCount,
    defendantCount,
  } = req.body || {};

  const existing = await query("SELECT * FROM ip_claims WHERE id = $1", [req.params.id]);
  if (!existing.rows.length) {
    return res.status(404).json({ error: "IP claim not found" });
  }

  const result = await query(
    `UPDATE ip_claims SET
      brand_name = COALESCE($1, brand_name),
      type = COALESCE($2, type),
      sub_type = COALESCE($3, sub_type),
      application_date = COALESCE($4, application_date),
      registration_date = COALESCE($5, registration_date),
      serial_number = COALESCE($6, serial_number),
      registration_number = COALESCE($7, registration_number),
      specimen_folder = COALESCE($8, specimen_folder),
      listings_count = COALESCE($9, listings_count),
      defendant_count = COALESCE($10, defendant_count)
     WHERE id = $11
     RETURNING *`,
    [
      brandName,
      type,
      subType,
      applicationDate,
      registrationDate,
      serialNumber,
      registrationNumber,
      specimenFolder,
      listingsCount,
      defendantCount,
      req.params.id,
    ]
  );
  const updated = mapIpClaim(result.rows[0]);
  await touchCase(existing.rows[0].case_id, req.session);
  await writeAuditLog(req, {
    action: "ip_claims.update",
    entityType: "ip_claim",
    entityId: updated.id,
    before: mapIpClaim(existing.rows[0]),
    after: updated,
  });
  res.json(updated);
});

app.post(
  "/api/cases/:id/defendants/import",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "CSV file is required" });
    }
    if (!isFileExtensionAllowed(req.file.originalname, [".csv"])) {
      return res.status(400).json({ error: "Only .csv files are allowed" });
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

    const headers = Object.keys(records[0] || {});
    const normalizedHeaderMap = new Map(
      headers.map((header) => [
        String(header || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ""),
        header,
      ])
    );
    const parseMapping = (raw) => {
      if (!raw) return {};
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    };
    const mappingInput = parseMapping(req.body?.mapping);
    const resolveHeader = (...candidates) => {
      for (const candidate of candidates) {
        if (!candidate) continue;
        const direct = headers.find((h) => h === candidate);
        if (direct) return direct;
        const normalized = String(candidate)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (normalizedHeaderMap.has(normalized)) {
          return normalizedHeaderMap.get(normalized);
        }
      }
      return null;
    };

    const mappedHeaders = {
      seller: resolveHeader(mappingInput.seller, "SELLER", "Seller"),
      platform: resolveHeader(mappingInput.platform, "PLATFORM", "Platform"),
      businessName: resolveHeader(
        mappingInput.businessName,
        "BUSINESS NAME",
        "BusinessName"
      ),
      locatedIn: resolveHeader(mappingInput.locatedIn, "LOCATED IN", "LocatedIn"),
      sellerLocation: resolveHeader(
        mappingInput.sellerLocation,
        "SELLER LOCATION",
        "SellerLocation"
      ),
      sellerUrl: resolveHeader(mappingInput.sellerUrl, "SELLER_URL", "SellerURL"),
    };

    if (!mappedHeaders.seller || !mappedHeaders.platform) {
      return res.status(400).json({
        error:
          "Seller and Platform mappings are required. Please map both columns.",
      });
    }

    const valueFromRow = (row, key) => {
      const header = mappedHeaders[key];
      if (!header) return "";
      return String(row[header] || "").trim();
    };

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

    const filtered = records.filter((row) => valueFromRow(row, "seller") !== "");

    filtered.forEach((row) => {
      doeCounter += 1;
      values.push(
        req.params.id,
        `Doe ${doeCounter}`,
        "",
        valueFromRow(row, "platform"),
        "",
        "",
        valueFromRow(row, "seller"),
        "",
        valueFromRow(row, "businessName"),
        valueFromRow(row, "locatedIn"),
        valueFromRow(row, "sellerLocation"),
        valueFromRow(row, "sellerUrl"),
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
    await touchCase(req.params.id, req.session);
    await writeAuditLog(req, {
      action: "defendants.bulk_import",
      entityType: "case",
      entityId: req.params.id,
      before: null,
      after: {
        imported: filtered.length,
        startingDoe: maxDoe + 1,
        mapping: mappedHeaders,
      },
    });

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

app.get("/api/groups/:id/negotiation", async (req, res) => {
  const result = await query(
    "SELECT * FROM group_negotiations WHERE group_id = $1 LIMIT 1",
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

app.put("/api/groups/:id/negotiation", async (req, res) => {
  const {
    legalStatus,
    plaintiffLastOffer,
    defendantLastOffer,
    settlementDate,
    settlementAmount,
    agreementUploaded,
  } = req.body;

  const beforeResult = await query(
    "SELECT * FROM group_negotiations WHERE group_id = $1 LIMIT 1",
    [req.params.id]
  );

  await query(
    `INSERT INTO group_negotiations
      (group_id, legal_status, plaintiff_last_offer, defendant_last_offer, settlement_date, settlement_amount, agreement_uploaded, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (group_id)
     DO UPDATE SET
       legal_status = EXCLUDED.legal_status,
       plaintiff_last_offer = EXCLUDED.plaintiff_last_offer,
       defendant_last_offer = EXCLUDED.defendant_last_offer,
       settlement_date = EXCLUDED.settlement_date,
       settlement_amount = EXCLUDED.settlement_amount,
       agreement_uploaded = EXCLUDED.agreement_uploaded,
       updated_at = NOW()`,
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

  const defendantsResult = await query(
    "SELECT id FROM defendants WHERE group_id = $1",
    [req.params.id]
  );
  const defendantIds = defendantsResult.rows.map((row) => row.id);

  if (defendantIds.length) {
    await query(
      `UPDATE defendants
       SET status = COALESCE($2, status)
       WHERE id = ANY($1::uuid[])`,
      [defendantIds, legalStatus || null]
    );

    await query(
      `UPDATE negotiations
       SET legal_status = $2,
           plaintiff_last_offer = $3,
           defendant_last_offer = $4,
           settlement_date = $5,
           settlement_amount = $6,
           agreement_uploaded = $7
       WHERE defendant_id = ANY($1::uuid[])`,
      [
        defendantIds,
        legalStatus || null,
        plaintiffLastOffer ?? null,
        defendantLastOffer ?? null,
        settlementDate || null,
        settlementAmount ?? null,
        agreementUploaded || null,
      ]
    );

    await query(
      `INSERT INTO negotiations
        (defendant_id, legal_status, plaintiff_last_offer, defendant_last_offer, settlement_date, settlement_amount, agreement_uploaded)
       SELECT d.id, $2, $3, $4, $5, $6, $7
       FROM defendants d
       WHERE d.group_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM negotiations n WHERE n.defendant_id = d.id
         )`,
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
  await writeAuditLog(req, {
    action: "groups.negotiation_update",
    entityType: "group",
    entityId: req.params.id,
    before: beforeResult.rows[0] || null,
    after: {
      legalStatus: legalStatus || null,
      plaintiffLastOffer: plaintiffLastOffer ?? null,
      defendantLastOffer: defendantLastOffer ?? null,
      settlementDate: settlementDate || null,
      settlementAmount: settlementAmount ?? null,
      agreementUploaded: agreementUploaded || null,
      appliedToDefendantCount: defendantIds.length,
    },
  });

  res.json({ ok: true });
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
  await writeAuditLog(req, {
    action: "groups.create",
    entityType: "group",
    entityId: group.id,
    before: null,
    after: {
      id: group.id,
      caseId: req.params.id,
      groupName: group.group_name,
      plaintiffRepName: group.plaintiff_rep_name,
      defendantRepEmail: group.defendant_rep_email,
      status: group.status,
      defendantIds,
    },
  });

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
    if (!isFileExtensionAllowed(req.file.originalname, [".csv"])) {
      return res.status(400).json({ error: "Only .csv files are allowed" });
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

    const headers = Object.keys(records[0] || {});
    const normalizedHeaderMap = new Map(
      headers.map((header) => [
        String(header || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ""),
        header,
      ])
    );
    const parseMapping = (raw) => {
      if (!raw) return {};
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    };
    const mappingInput = parseMapping(req.body?.mapping);
    const resolveHeader = (...candidates) => {
      for (const candidate of candidates) {
        if (!candidate) continue;
        const direct = headers.find((h) => h === candidate);
        if (direct) return direct;
        const normalized = String(candidate)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (normalizedHeaderMap.has(normalized)) {
          return normalizedHeaderMap.get(normalized);
        }
      }
      return null;
    };

    const mappedHeaders = {
      seller: resolveHeader(mappingInput.seller, "SELLER", "Seller"),
      platform: resolveHeader(mappingInput.platform, "PLATFORM", "Platform"),
      productId: resolveHeader(mappingInput.productId, "No.", "No", "PRODUCT ID"),
      title: resolveHeader(mappingInput.title, "TITLE", "Title"),
      infType: resolveHeader(mappingInput.infType, "INF_TYPE", "InfType", "INF Type"),
      url: resolveHeader(mappingInput.url, "URL", "Url"),
      screenshotEvidence: resolveHeader(
        mappingInput.screenshotEvidence,
        "SCREENSHOT EVIDENCE",
        "ScreenshotEvidence"
      ),
      remark: resolveHeader(mappingInput.remark, "REMARK", "Remark"),
    };

    if (!mappedHeaders.seller || !mappedHeaders.platform) {
      return res.status(400).json({
        error:
          "Seller and Platform mappings are required. Please map both columns.",
      });
    }

    const valueFromRow = (row, key) => {
      const header = mappedHeaders[key];
      if (!header) return "";
      return String(row[header] || "").trim();
    };

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
      const platform = valueFromRow(row, "platform");
      const seller = valueFromRow(row, "seller");
      const key = `${platform.toLowerCase()}|${seller.toLowerCase()}`;
      const defendantId = byKey.get(key);
      if (!defendantId) {
        skipped += 1;
        return;
      }

      imported += 1;
      values.push(
        defendantId,
        valueFromRow(row, "productId"),
        "",
        valueFromRow(row, "title"),
        valueFromRow(row, "infType"),
        valueFromRow(row, "url"),
        valueFromRow(row, "screenshotEvidence"),
        "",
        "",
        valueFromRow(row, "remark"),
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
    await touchCase(req.params.id, req.session);

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
    await writeAuditLog(req, {
      action: "listings.bulk_import",
      entityType: "case",
      entityId: req.params.id,
      before: null,
      after: { imported, skipped, mapping: mappedHeaders },
    });

    res.json({ imported, skipped });
  }
);

app.post(
  "/api/cases/:id/defendants/patch-from-listings",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "CSV file is required" });
    }
    if (!isFileExtensionAllowed(req.file.originalname, [".csv"])) {
      return res.status(400).json({ error: "Only .csv files are allowed" });
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

    const headers = Object.keys(records[0] || {});
    const normalizedHeaderMap = new Map(
      headers.map((header) => [
        String(header || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ""),
        header,
      ])
    );
    const parseMapping = (raw) => {
      if (!raw) return {};
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    };
    const mappingInput = parseMapping(req.body?.mapping);
    const resolveHeader = (...candidates) => {
      for (const candidate of candidates) {
        if (!candidate) continue;
        const direct = headers.find((h) => h === candidate);
        if (direct) return direct;
        const normalized = String(candidate)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        if (normalizedHeaderMap.has(normalized)) {
          return normalizedHeaderMap.get(normalized);
        }
      }
      return null;
    };

    const mappedHeaders = {
      seller: resolveHeader(mappingInput.seller, "SELLER", "Seller"),
      platform: resolveHeader(mappingInput.platform, "PLATFORM", "Platform"),
      merchantId: resolveHeader(mappingInput.merchantId, "MERCHANT ID", "Merchant ID"),
      location: resolveHeader(
        mappingInput.location,
        "MERCHANT COUNTRY",
        "Merchant Country",
        "Location",
        "Located In"
      ),
    };

    if (!mappedHeaders.seller || !mappedHeaders.platform) {
      return res.status(400).json({
        error: "Seller and Platform mappings are required.",
      });
    }
    if (!mappedHeaders.merchantId && !mappedHeaders.location) {
      return res.status(400).json({
        error: "Map at least Merchant ID or Location to patch defendants.",
      });
    }

    const valueFromRow = (row, key) => {
      const header = mappedHeaders[key];
      if (!header) return "";
      return String(row[header] || "").trim();
    };

    const defendants = await query(
      "SELECT id, platform, name, merchant_id, located_in FROM defendants WHERE case_id = $1",
      [req.params.id]
    );
    const byKey = new Map();
    defendants.rows.forEach((row) => {
      const key = `${(row.platform || "").toLowerCase()}|${(row.name || "")
        .toLowerCase()
        .trim()}`;
      byKey.set(key, row);
    });

    let matched = 0;
    let skipped = 0;
    const patchMap = new Map();

    records.forEach((row) => {
      const platform = valueFromRow(row, "platform");
      const seller = valueFromRow(row, "seller");
      if (!platform || !seller) {
        skipped += 1;
        return;
      }
      const key = `${platform.toLowerCase()}|${seller.toLowerCase()}`;
      const defendant = byKey.get(key);
      if (!defendant) {
        skipped += 1;
        return;
      }
      matched += 1;
      const merchantId = valueFromRow(row, "merchantId");
      const location = valueFromRow(row, "location");
      if (!merchantId && !location) return;
      const existing = patchMap.get(defendant.id) || {};
      patchMap.set(defendant.id, {
        merchantId: existing.merchantId || merchantId || "",
        location: existing.location || location || "",
      });
    });

    let patched = 0;
    for (const [defendantId, patch] of patchMap.entries()) {
      const result = await query(
        `UPDATE defendants
         SET merchant_id = COALESCE(NULLIF($2, ''), merchant_id),
             located_in = COALESCE(NULLIF($3, ''), located_in),
             updated_at = CURRENT_DATE,
             updated_by = $4
         WHERE id = $1
         RETURNING id`,
        [
          defendantId,
          patch.merchantId || "",
          patch.location || "",
          req.session?.name || req.session?.email || "System",
        ]
      );
      if (result.rows.length) patched += 1;
    }

    if (patched > 0) {
      await touchCase(req.params.id, req.session);
    }

    await writeAuditLog(req, {
      action: "defendants.patch_from_listings",
      entityType: "case",
      entityId: req.params.id,
      before: null,
      after: { patched, matched, skipped, mapping: mappedHeaders },
    });

    res.json({ patched, matched, skipped });
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

  const existing = await query("SELECT * FROM defendants WHERE id = $1", [
    req.params.id,
  ]);
  if (!existing.rows.length) {
    return res.status(404).json({ error: "Defendant not found" });
  }

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

  await writeAuditLog(req, {
    action: "defendants.update",
    entityType: "defendant",
    entityId: req.params.id,
    before: existing.rows[0],
    after: result.rows[0],
  });

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

  const beforeResult = await query(
    "SELECT * FROM negotiations WHERE defendant_id = $1 ORDER BY id LIMIT 1",
    [req.params.id]
  );
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
  const afterResult = await query(
    "SELECT * FROM negotiations WHERE defendant_id = $1 ORDER BY id LIMIT 1",
    [req.params.id]
  );
  await writeAuditLog(req, {
    action: "defendants.negotiation_update",
    entityType: "defendant",
    entityId: req.params.id,
    before: beforeResult.rows[0] || null,
    after: afterResult.rows[0] || null,
  });

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

  const beforeResult = await query(
    "SELECT * FROM collections WHERE defendant_id = $1 ORDER BY id LIMIT 1",
    [req.params.id]
  );
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
  const afterResult = await query(
    "SELECT * FROM collections WHERE defendant_id = $1 ORDER BY id LIMIT 1",
    [req.params.id]
  );
  await writeAuditLog(req, {
    action: "defendants.collection_update",
    entityType: "defendant",
    entityId: req.params.id,
    before: beforeResult.rows[0] || null,
    after: afterResult.rows[0] || null,
  });

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

  const beforeResult = await query(
    "SELECT * FROM bookkeeping WHERE defendant_id = $1 ORDER BY id LIMIT 1",
    [req.params.id]
  );
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
  const afterResult = await query(
    "SELECT * FROM bookkeeping WHERE defendant_id = $1 ORDER BY id LIMIT 1",
    [req.params.id]
  );
  await writeAuditLog(req, {
    action: "defendants.bookkeeping_update",
    entityType: "defendant",
    entityId: req.params.id,
    before: beforeResult.rows[0] || null,
    after: afterResult.rows[0] || null,
  });

  res.json({ ok: true });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, req, res, next) => {
  if (err && err.message === "Blocked by CORS policy") {
    return res.status(403).json({ error: "Origin not allowed." });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

const start = async () => {
  await ensureAuditLogTable();
  await ensureCaseUpdatedAtTimestamp();
  await ensureCaseDocketOnlyColumn();
  await ensureLitigationTables();
  await ensureAdminUser();
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });
};

start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
