require("dotenv").config();

// Catch unhandled rejections so Railway logs show the real error
process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  process.exit(1);
});

const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { query, withTransaction } = require("./db");

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
const DOCKETBIRD_API_TOKEN = String(process.env.DOCKETBIRD_API_TOKEN || "").trim();
const DOCKETBIRD_API_BASE = "https://api.docketbird.com";
const LITIGATION_TABS = [
  "NDIL",
  "GAND",
  "NDIN",
  "MDFL",
  "WDPA",
  "EDWI",
  "EDMO",
  "UNFILED",
  "MBFD",
  "ARCHIVED",
];

const DOCKET_STATUS_OPTIONS = [
  "Case Filed",
  "Default Entered",
  "Default Judgement Requested",
  "Default Judgement Granted",
  "TRO Requested",
  "Negotiating",
  "TRO Signed",
  "Case Closed",
];

const DOCKETBIRD_COURT_ID_BY_JURISDICTION = {
  NDIL: "ilnd",
  GAND: "gand",
  NDIN: "innd",
  MDFL: "flmd",
  WDPA: "pawd",
  EDWI: "wied",
  EDMO: "moed",
};

const toDateOnly = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

const parseCaseNumberSignature = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[–—]/g, "-");
  if (!normalized) return null;

  let match = normalized.match(/^(\d+):(\d{2,4})-([a-z]{2})-(\d{4,6})$/i);
  if (match) {
    const [, office, yearRaw, caseType, sequence] = match;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return { office, year, caseType, sequence };
  }

  match = normalized.match(/^(\d{2,4})-([a-z]{2})-(\d{4,6})$/i);
  if (match) {
    const [, yearRaw, caseType, sequence] = match;
    const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
    return { office: null, year, caseType, sequence };
  }

  return null;
};

const buildLikelyDocketBirdCaseId = (jurisdiction, caseNumber) => {
  const signature = parseCaseNumberSignature(caseNumber);
  if (!signature) return "";
  const courtId =
    DOCKETBIRD_COURT_ID_BY_JURISDICTION[String(jurisdiction || "").toUpperCase()] || "";
  if (!courtId) return "";
  const office = signature.office || "1";
  return `${courtId}-${office}:${signature.year}-${signature.caseType}-${signature.sequence}`;
};

const docketBirdCaseMatches = (docketbirdId, caseNumber) => {
  const signature = parseCaseNumberSignature(caseNumber);
  if (!signature) return false;
  const normalizedId = String(docketbirdId || "").trim().toLowerCase();
  if (!normalizedId) return false;
  const officePattern = signature.office ? signature.office : "\\d+";
  const escapedType = signature.caseType.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^[a-z0-9]+-${officePattern}:${signature.year}-${escapedType}-${signature.sequence}$`,
    "i"
  );
  return pattern.test(normalizedId);
};

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
      if (allowedOriginSet.size === 0) return callback(new Error("Blocked by CORS policy"));
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

if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
  throw new Error(
    "ADMIN_EMAIL and ADMIN_PASSWORD must be set in environment variables."
  );
}
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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
    if (now > attempt.windowStart + LOGIN_WINDOW_MS) {
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

const requireWeeklyReportAccess = async (req, res, next) => {
  try {
    if (req.session.role === 'admin') return next();
    const result = await query(
      'SELECT allow_weekly_report FROM users WHERE id = $1 LIMIT 1',
      [req.session.userId]
    );
    if (result.rows[0]?.allow_weekly_report) return next();
    return res.status(403).json({ error: 'Access denied.' });
  } catch (err) {
    console.error('[requireWeeklyReportAccess]', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
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

const ensureUserPermissionsColumns = async () => {
  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS allow_weekly_task_cleanup BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS allow_weekly_report BOOLEAN NOT NULL DEFAULT FALSE
  `);
};

const ensureTaskCompletedAt = async () => {
  await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`);
};

const ensureWeeklyReportTable = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      week_start DATE NOT NULL,
      week_end DATE NOT NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      csv_data TEXT NOT NULL,
      generated_by TEXT
    )
  `);
  await query(`CREATE UNIQUE INDEX IF NOT EXISTS weekly_reports_week_start_idx ON weekly_reports (week_start)`);
};

const ensureCaseUpdatedAtTimestamp = async () => {
  const { rows } = await query(`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'cases' AND column_name = 'updated_at'
  `);
  if (rows[0]?.data_type === 'timestamp with time zone') return;
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
      archived_by TEXT,
      docket_defendant_count INTEGER,
      docket_status TEXT
    )
  `);
  await query(`
    ALTER TABLE litigation_case_state
    ADD COLUMN IF NOT EXISTS docket_defendant_count INTEGER
  `);
  await query(`
    ALTER TABLE litigation_case_state
    ADD COLUMN IF NOT EXISTS docket_status TEXT
  `);
  await query(`
    ALTER TABLE litigation_case_state
    ADD COLUMN IF NOT EXISTS docketbird_case_id TEXT
  `);
  await query(`
    ALTER TABLE litigation_case_state
    ADD COLUMN IF NOT EXISTS docketbird_last_synced_at TIMESTAMPTZ
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS litigation_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID REFERENCES cases(id) ON DELETE CASCADE,
      action TEXT,
      internal_due_date DATE,
      final_due_date DATE,
      notes TEXT,
      assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      is_in_progress BOOLEAN NOT NULL DEFAULT FALSE,
      is_completed BOOLEAN NOT NULL DEFAULT FALSE,
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMPTZ,
      completed_by TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  await query(`
    ALTER TABLE litigation_actions
    ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL
  `);
  await query(`
    ALTER TABLE litigation_actions
    ADD COLUMN IF NOT EXISTS assigned_to_label TEXT
  `);
  await query(`
    ALTER TABLE litigation_actions
    ADD COLUMN IF NOT EXISTS is_in_progress BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await query(`
    ALTER TABLE litigation_actions
    ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await query(`
    UPDATE litigation_actions
    SET is_in_progress = FALSE
    WHERE COALESCE(is_completed, FALSE) = TRUE
  `);
  await query(`
    ALTER TABLE litigation_actions
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await query(`
    ALTER TABLE litigation_actions
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ
  `);
  await query(`
    ALTER TABLE litigation_actions
    ADD COLUMN IF NOT EXISTS completed_by TEXT
  `);
  await query(`
    ALTER TABLE litigation_actions
    ADD COLUMN IF NOT EXISTS source TEXT
  `);
  await query(`
    ALTER TABLE litigation_actions
    ADD COLUMN IF NOT EXISTS source_reference_id TEXT
  `);
  await query(`
    DROP INDEX IF EXISTS litigation_actions_source_ref_idx
  `);
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS litigation_actions_source_ref_idx
      ON litigation_actions (case_id, source, source_reference_id)
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS litigation_action_collaborators (
      action_id UUID REFERENCES litigation_actions(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      is_in_progress BOOLEAN NOT NULL DEFAULT FALSE,
      is_complete BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMPTZ,
      completed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (action_id, user_id)
    )
  `);
  await query(`
    ALTER TABLE litigation_action_collaborators
    ADD COLUMN IF NOT EXISTS is_in_progress BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await query(`
    UPDATE litigation_action_collaborators
    SET is_in_progress = FALSE
    WHERE COALESCE(is_complete, FALSE) = TRUE
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
  await query(`
    CREATE TABLE IF NOT EXISTS mbfd_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_name TEXT NOT NULL,
      doe_number TEXT NOT NULL,
      amount NUMERIC(12, 2),
      attorney_email TEXT,
      is_completed BOOLEAN NOT NULL DEFAULT FALSE,
      is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at TIMESTAMPTZ,
      completed_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `);
  await query(`
    ALTER TABLE mbfd_items
    ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await query(`
    ALTER TABLE mbfd_items
    ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await query(`
    ALTER TABLE mbfd_items
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ
  `);
  await query(`
    ALTER TABLE mbfd_items
    ADD COLUMN IF NOT EXISTS completed_by TEXT
  `);
  await query(`
    ALTER TABLE mbfd_items
    ADD COLUMN IF NOT EXISTS notes TEXT
  `);
  await query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS source_litigation_action_id UUID REFERENCES litigation_actions(id) ON DELETE CASCADE
  `);
  await query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS task_role TEXT NOT NULL DEFAULT 'owner'
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

const fetchDocketBirdCalendarEntries = async (docketbirdCaseId) => {
  if (!DOCKETBIRD_API_TOKEN) {
    throw new Error("DOCKETBIRD_API_TOKEN is not configured.");
  }
  const url = new URL("/calendar_entries", DOCKETBIRD_API_BASE);
  url.searchParams.set("case_id", docketbirdCaseId);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${DOCKETBIRD_API_TOKEN}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `DocketBird request failed (${response.status}).`);
  }

  return Array.isArray(payload?.data?.calendar_entries)
    ? payload.data.calendar_entries
    : [];
};

const fetchDocketBirdCases = async () => {
  if (!DOCKETBIRD_API_TOKEN) {
    throw new Error("DOCKETBIRD_API_TOKEN is not configured.");
  }
  const url = new URL("/cases", DOCKETBIRD_API_BASE);
  url.searchParams.set("scope", "company");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${DOCKETBIRD_API_TOKEN}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `DocketBird request failed (${response.status}).`);
  }

  return Array.isArray(payload?.data?.cases) ? payload.data.cases : [];
};

const normalizeUserIdList = (value, ownerUserId = null) => {
  const list = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ""
      ? []
      : [value];
  const seen = new Set();
  return list
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => item !== String(ownerUserId || "").trim())
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
};

const syncLitigationActionCollaborators = async (
  actionId,
  collaboratorUserIds,
  actor,
  options = {}
) => {
  const keepIds = normalizeUserIdList(collaboratorUserIds);
  if (keepIds.length) {
    await query(
      `DELETE FROM litigation_action_collaborators
       WHERE action_id = $1
         AND user_id <> ALL($2::uuid[])`,
      [actionId, keepIds]
    );
  } else {
    await query(`DELETE FROM litigation_action_collaborators WHERE action_id = $1`, [actionId]);
  }

  for (const userId of keepIds) {
    if (options.resetNewCollaborators) {
      await query(
        `INSERT INTO litigation_action_collaborators
          (action_id, user_id, is_in_progress, is_complete, completed_at, completed_by)
         VALUES ($1, $2, FALSE, FALSE, NULL, NULL)
         ON CONFLICT (action_id, user_id)
         DO NOTHING`,
        [actionId, userId]
      );
    } else {
      await query(
        `INSERT INTO litigation_action_collaborators
          (action_id, user_id, is_in_progress, is_complete, completed_at, completed_by)
         VALUES ($1, $2, FALSE, FALSE, NULL, NULL)
         ON CONFLICT (action_id, user_id)
         DO UPDATE SET
           completed_by = litigation_action_collaborators.completed_by`,
        [actionId, userId]
      );
    }
  }
};

const syncLitigationTasks = async (caseId, entries, session) => {
  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM tasks
       WHERE case_id = $1
         AND defendant_id IS NULL
         AND group_id IS NULL
         AND task_type LIKE 'Docket:%'`,
      [caseId]
    );

    for (const entry of entries) {
      const action = String(entry.action || "").trim();
      const assignedToUserId = entry.assignedToUserId || null;
      const dueDate = entry.internalDueDate || entry.finalDueDate || null;
      if (!action || entry.isHidden) continue;

      await client.query(
        `INSERT INTO tasks
          (case_id, defendant_id, group_id, task_type, assigned_to_user_id, due_date, status, created_by_user_id, source_litigation_action_id, task_role)
         VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, 'owner')`,
        [
          caseId,
          `Docket: ${action}`,
          assignedToUserId,
          dueDate,
          entry.isCompleted ? "Complete" : entry.isInProgress ? "In Progress" : "Open",
          session?.userId || null,
          entry.id || null,
        ]
      );

      const collaborators = Array.isArray(entry.collaborators) ? entry.collaborators : [];
      for (const collaborator of collaborators) {
        const collaboratorUserId = String(collaborator?.userId || "").trim();
        if (!collaboratorUserId) continue;
        await client.query(
          `INSERT INTO tasks
            (case_id, defendant_id, group_id, task_type, assigned_to_user_id, due_date, status, created_by_user_id, source_litigation_action_id, task_role)
           VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, 'collaborator')`,
          [
            caseId,
            `Docket: ${action}`,
            collaboratorUserId,
            dueDate,
            entry.isCompleted || collaborator?.isComplete
              ? "Complete"
              : collaborator?.isInProgress
                ? "In Progress"
                : "Open",
            session?.userId || null,
            entry.id || null,
          ]
        );
      }
    }
  });
};

const loadWeeklyCleanupPermission = async (userId) => {
  if (!userId) return false;
  const result = await query(
    `SELECT allow_weekly_task_cleanup
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );
  return Boolean(result.rows[0]?.allow_weekly_task_cleanup);
};

const getWeekBounds = (refDate) => {
  const d = new Date(refDate);
  const day = d.getDay(); // 0=Sun, 6=Sat
  const daysToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + daysToMonday);
  monday.setHours(0, 0, 0, 0);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  friday.setHours(23, 59, 59, 999);
  return { weekStart: monday, weekEnd: friday };
};

const toDateString = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const escapeCsvField = (value) => {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
};

const generateWeeklyReport = async (weekStart, weekEnd, generatedBy) => {
  const weekStartStr = toDateString(weekStart);
  const weekEndStr = toDateString(weekEnd);

  const { rows } = await query(
    `SELECT
       u.name AS user_name,
       u.email AS user_email,
       t.task_type,
       t.due_date,
       t.status,
       COALESCE(t.completed_at, la.completed_at) AS effective_completed_at,
       c.case_name,
       d.name AS defendant_name,
       g.group_name
     FROM tasks t
     JOIN users u ON u.id = t.assigned_to_user_id
     LEFT JOIN cases c ON c.id = t.case_id
     LEFT JOIN defendants d ON d.id = t.defendant_id
     LEFT JOIN groups g ON g.id = t.group_id
     LEFT JOIN litigation_actions la ON la.id = t.source_litigation_action_id
     WHERE t.assigned_to_user_id IS NOT NULL
       AND (
         (t.due_date >= $1 AND t.due_date <= $2)
         OR (t.due_date < $1 AND t.status <> 'Complete')
       )
     ORDER BY u.name, t.due_date NULLS LAST`,
    [weekStartStr, weekEndStr]
  );

  const classifyTask = (row) => {
    if (row.status === 'Complete') {
      const completedAt = row.effective_completed_at ? new Date(row.effective_completed_at) : null;
      if (!completedAt) return 'Completed (date unknown)';
      const dueEnd = new Date(row.due_date);
      dueEnd.setHours(23, 59, 59, 999);
      return completedAt <= dueEnd ? 'Completed On Time' : 'Completed Late';
    }
    return 'Overdue';
  };

  const taskContext = (row) => {
    if (row.group_name) return row.group_name;
    if (row.defendant_name) return row.defendant_name;
    if (row.case_name) return row.case_name;
    return '—';
  };

  const lines = [];
  lines.push(`Week: ${weekStartStr} to ${weekEndStr}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('TASK DETAIL');
  lines.push(['User Name', 'User Email', 'Task', 'Context', 'Due Date', 'Completed At', 'Result'].map(escapeCsvField).join(','));

  const userSummary = {};

  for (const row of rows) {
    const result = classifyTask(row);
    const completedAtStr = row.effective_completed_at
      ? new Date(row.effective_completed_at).toISOString().replace('T', ' ').slice(0, 19)
      : '';
    const dueDateStr = row.due_date ? String(row.due_date).slice(0, 10) : '';

    lines.push([
      row.user_name || row.user_email,
      row.user_email,
      row.task_type,
      taskContext(row),
      dueDateStr,
      completedAtStr,
      result,
    ].map(escapeCsvField).join(','));

    const key = row.user_email;
    if (!userSummary[key]) {
      userSummary[key] = { name: row.user_name || row.user_email, email: row.user_email, onTime: 0, late: 0, overdue: 0 };
    }
    if (result === 'Completed On Time') userSummary[key].onTime++;
    else if (result === 'Completed Late') userSummary[key].late++;
    else if (result === 'Overdue') userSummary[key].overdue++;
  }

  lines.push('');
  lines.push('USER SUMMARY');
  lines.push(['User Name', 'User Email', 'Completed On Time', 'Completed Late', 'Still Overdue', 'Total Tasks'].map(escapeCsvField).join(','));
  for (const s of Object.values(userSummary)) {
    const total = s.onTime + s.late + s.overdue;
    lines.push([s.name, s.email, s.onTime, s.late, s.overdue, total].map(escapeCsvField).join(','));
  }

  const csvData = lines.join('\n');
  const result = await query(
    `INSERT INTO weekly_reports (week_start, week_end, csv_data, generated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (week_start) DO UPDATE SET csv_data = EXCLUDED.csv_data, generated_at = NOW(), generated_by = EXCLUDED.generated_by
     RETURNING id`,
    [weekStartStr, weekEndStr, csvData, generatedBy || 'system']
  );
  console.log(`[weekly-report] Generated report for week ${weekStartStr}: id=${result.rows[0]?.id}`);
  return result.rows[0];
};

const ensureAdminUser = async () => {
  const passwordHash = hashPassword(ADMIN_PASSWORD);
  await query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (email) DO NOTHING`,
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
      allowWeeklyReport: Boolean(user.allow_weekly_report),
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
    `SELECT id, name, email, role, allow_weekly_task_cleanup, allow_weekly_report, created_at
     FROM users
     ORDER BY created_at DESC`
  );
  res.json(result.rows);
});

app.post("/api/users", requireSession, requireAdmin, async (req, res) => {
  const { name, email, password, allowWeeklyTaskCleanup } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const passwordHash = hashPassword(password);
  const result = await query(
    `INSERT INTO users (name, email, password_hash, role, allow_weekly_task_cleanup)
     VALUES ($1, $2, $3, 'user', $4)
     RETURNING id, name, email, role, allow_weekly_task_cleanup, created_at`,
    [name || "", email.trim(), passwordHash, Boolean(allowWeeklyTaskCleanup)]
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

app.put("/api/users/:id/weekly-task-cleanup", requireSession, requireAdmin, async (req, res) => {
  const allowWeeklyTaskCleanup = Boolean(req.body?.allowWeeklyTaskCleanup);
  const existing = await query(
    `SELECT id, email, allow_weekly_task_cleanup
     FROM users
     WHERE id = $1`,
    [req.params.id]
  );
  if (!existing.rows.length) {
    return res.status(404).json({ error: "User not found." });
  }

  const result = await query(
    `UPDATE users
     SET allow_weekly_task_cleanup = $2
     WHERE id = $1
     RETURNING id, name, email, role, allow_weekly_task_cleanup, created_at`,
    [req.params.id, allowWeeklyTaskCleanup]
  );

  await writeAuditLog(req, {
    action: "users.weekly_task_cleanup",
    entityType: "user",
    entityId: req.params.id,
    before: {
      allowWeeklyTaskCleanup: existing.rows[0].allow_weekly_task_cleanup,
      email: existing.rows[0].email,
    },
    after: {
      allowWeeklyTaskCleanup: result.rows[0].allow_weekly_task_cleanup,
      email: result.rows[0].email,
    },
  });

  res.json(result.rows[0]);
});

app.put("/api/users/:id/weekly-report-access", requireSession, requireAdmin, async (req, res) => {
  const allow = Boolean(req.body?.allowWeeklyReport);
  const existing = await query('SELECT id, email FROM users WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'User not found.' });
  const result = await query(
    `UPDATE users SET allow_weekly_report = $2 WHERE id = $1
     RETURNING id, name, email, role, allow_weekly_task_cleanup, allow_weekly_report, created_at`,
    [req.params.id, allow]
  );
  await writeAuditLog(req, {
    action: 'users.weekly_report_access',
    entityType: 'user',
    entityId: req.params.id,
    before: { allowWeeklyReport: !allow, email: existing.rows[0].email },
    after: { allowWeeklyReport: allow, email: existing.rows[0].email },
  });
  res.json(result.rows[0]);
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

app.get("/api/litigation/mbfd-items", async (_req, res) => {
  const result = await query(
    `SELECT id, case_name, doe_number, amount, attorney_email, notes,
            is_completed, is_hidden, completed_at, completed_by,
            created_at, updated_at, updated_by
     FROM mbfd_items
     WHERE COALESCE(is_hidden, FALSE) = FALSE
     ORDER BY COALESCE(is_completed, FALSE) ASC, updated_at DESC, created_at DESC`
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      caseName: row.case_name,
      doeNumber: row.doe_number,
      amount: row.amount,
      attorneyEmail: row.attorney_email || "",
      notes: row.notes || "",
      isCompleted: row.is_completed,
      isHidden: row.is_hidden,
      completedAt: row.completed_at,
      completedBy: row.completed_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by || "",
    }))
  );
});

app.get("/api/litigation/mbfd-items/hidden", async (_req, res) => {
  const result = await query(
    `SELECT id, case_name, doe_number, amount, attorney_email, notes,
            is_completed, is_hidden, completed_at, completed_by,
            created_at, updated_at, updated_by
     FROM mbfd_items
     WHERE COALESCE(is_hidden, FALSE) = TRUE
     ORDER BY updated_at DESC, created_at DESC`
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      caseName: row.case_name,
      doeNumber: row.doe_number,
      amount: row.amount,
      attorneyEmail: row.attorney_email || "",
      notes: row.notes || "",
      isCompleted: row.is_completed,
      isHidden: row.is_hidden,
      completedAt: row.completed_at,
      completedBy: row.completed_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by || "",
    }))
  );
});

app.post("/api/litigation/mbfd-items", async (req, res) => {
  const caseName = String(req.body?.caseName || "").trim();
  const doeNumber = String(req.body?.doeNumber || "").trim();
  const attorneyEmail = String(req.body?.attorneyEmail || "").trim();
  const notes = String(req.body?.notes || "").trim();
  const amountRaw = String(req.body?.amount ?? "").trim();
  const amount = amountRaw === "" ? null : Number(amountRaw);

  if (!caseName || !doeNumber) {
    return res.status(400).json({ error: "caseName and doeNumber are required." });
  }
  if (amountRaw !== "" && !Number.isFinite(amount)) {
    return res.status(400).json({ error: "Amount must be a valid number." });
  }

  const actor = req.session?.name || req.session?.email || null;
  const result = await query(
    `INSERT INTO mbfd_items
      (case_name, doe_number, amount, attorney_email, notes, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, NOW(), $6)
     RETURNING id, case_name, doe_number, amount, attorney_email, notes,
               is_completed, is_hidden, completed_at, completed_by,
               created_at, updated_at, updated_by`,
    [caseName, doeNumber, amount, attorneyEmail || null, notes || null, actor]
  );

  await writeAuditLog(req, {
    action: "mbfd.create",
    entityType: "mbfd_item",
    entityId: result.rows[0].id,
    before: null,
    after: {
      caseName: result.rows[0].case_name,
      doeNumber: result.rows[0].doe_number,
      amount: result.rows[0].amount,
      attorneyEmail: result.rows[0].attorney_email || "",
      notes: result.rows[0].notes || "",
    },
  });

  res.status(201).json({
    id: result.rows[0].id,
    caseName: result.rows[0].case_name,
    doeNumber: result.rows[0].doe_number,
    amount: result.rows[0].amount,
    attorneyEmail: result.rows[0].attorney_email || "",
    notes: result.rows[0].notes || "",
    isCompleted: result.rows[0].is_completed,
    isHidden: result.rows[0].is_hidden,
    completedAt: result.rows[0].completed_at,
    completedBy: result.rows[0].completed_by,
    createdAt: result.rows[0].created_at,
    updatedAt: result.rows[0].updated_at,
    updatedBy: result.rows[0].updated_by || "",
  });
});

app.put("/api/litigation/mbfd-items/:id", async (req, res) => {
  const caseName = String(req.body?.caseName || "").trim();
  const doeNumber = String(req.body?.doeNumber || "").trim();
  const attorneyEmail = String(req.body?.attorneyEmail || "").trim();
  const notes = String(req.body?.notes || "").trim();
  const amountRaw = String(req.body?.amount ?? "").trim();
  const amount = amountRaw === "" ? null : Number(amountRaw);

  if (!caseName || !doeNumber) {
    return res.status(400).json({ error: "caseName and doeNumber are required." });
  }
  if (amountRaw !== "" && !Number.isFinite(amount)) {
    return res.status(400).json({ error: "Amount must be a valid number." });
  }

  const existing = await query(
    `SELECT id, case_name, doe_number, amount, attorney_email, notes
     FROM mbfd_items
     WHERE id = $1`,
    [req.params.id]
  );
  if (!existing.rows.length) {
    return res.status(404).json({ error: "MBFD item not found." });
  }

  const actor = req.session?.name || req.session?.email || null;
  const result = await query(
    `UPDATE mbfd_items
     SET case_name = $2,
         doe_number = $3,
         amount = $4,
         attorney_email = $5,
         notes = $6,
         updated_at = NOW(),
         updated_by = $7
     WHERE id = $1
     RETURNING id, case_name, doe_number, amount, attorney_email, notes,
               is_completed, is_hidden, completed_at, completed_by,
               created_at, updated_at, updated_by`,
    [req.params.id, caseName, doeNumber, amount, attorneyEmail || null, notes || null, actor]
  );

  await writeAuditLog(req, {
    action: "mbfd.update",
    entityType: "mbfd_item",
    entityId: req.params.id,
    before: {
      caseName: existing.rows[0].case_name,
      doeNumber: existing.rows[0].doe_number,
      amount: existing.rows[0].amount,
      attorneyEmail: existing.rows[0].attorney_email || "",
      notes: existing.rows[0].notes || "",
    },
    after: {
      caseName: result.rows[0].case_name,
      doeNumber: result.rows[0].doe_number,
      amount: result.rows[0].amount,
      attorneyEmail: result.rows[0].attorney_email || "",
      notes: result.rows[0].notes || "",
    },
  });

  res.json({
    id: result.rows[0].id,
    caseName: result.rows[0].case_name,
    doeNumber: result.rows[0].doe_number,
    amount: result.rows[0].amount,
    attorneyEmail: result.rows[0].attorney_email || "",
    notes: result.rows[0].notes || "",
    isCompleted: result.rows[0].is_completed,
    isHidden: result.rows[0].is_hidden,
    completedAt: result.rows[0].completed_at,
    completedBy: result.rows[0].completed_by,
    createdAt: result.rows[0].created_at,
    updatedAt: result.rows[0].updated_at,
    updatedBy: result.rows[0].updated_by || "",
  });
});

app.put("/api/litigation/mbfd-items/:id/state", async (req, res) => {
  const { isCompleted, isHidden } = req.body || {};
  const existing = await query(
    `SELECT id, case_name, doe_number, amount, attorney_email, notes, is_completed, is_hidden
     FROM mbfd_items
     WHERE id = $1`,
    [req.params.id]
  );
  if (!existing.rows.length) {
    return res.status(404).json({ error: "MBFD item not found." });
  }

  const actor = req.session?.name || req.session?.email || null;
  const result = await query(
    `UPDATE mbfd_items
     SET is_completed = $2,
         is_hidden = $3,
         completed_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         completed_by = CASE WHEN $2 THEN $4 ELSE NULL END,
         updated_at = NOW(),
         updated_by = $4
     WHERE id = $1
     RETURNING id, case_name, doe_number, amount, attorney_email,
               is_completed, is_hidden, completed_at, completed_by,
               created_at, updated_at, updated_by`,
    [req.params.id, Boolean(isCompleted), Boolean(isHidden), actor]
  );

  await writeAuditLog(req, {
    action: "mbfd.state",
    entityType: "mbfd_item",
    entityId: req.params.id,
    before: {
      isCompleted: existing.rows[0].is_completed,
      isHidden: existing.rows[0].is_hidden,
    },
    after: {
      isCompleted: result.rows[0].is_completed,
      isHidden: result.rows[0].is_hidden,
    },
  });

  res.json({
    ok: true,
    item: {
      id: result.rows[0].id,
      caseName: result.rows[0].case_name,
      doeNumber: result.rows[0].doe_number,
      amount: result.rows[0].amount,
      attorneyEmail: result.rows[0].attorney_email || "",
      notes: result.rows[0].notes || "",
      isCompleted: result.rows[0].is_completed,
      isHidden: result.rows[0].is_hidden,
      completedAt: result.rows[0].completed_at,
      completedBy: result.rows[0].completed_by,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
      updatedBy: result.rows[0].updated_by || "",
    },
  });
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
        c.judge,
        c.status,
        COALESCE(
          state.docket_status,
          CASE
            WHEN c.status = ANY($2::text[]) THEN c.status
            ELSE ''
          END
        ) AS docket_status,
        state.docketbird_case_id,
        state.docketbird_last_synced_at,
        COALESCE(state.docket_defendant_count, defs.count, 0) AS defendant_count,
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
           OR COALESCE(state.docket_status, '') <> ''
           OR c.status = ANY($2::text[])
         )
       )
     )
     ORDER BY
       COALESCE(
         NULLIF(substring(lower(COALESCE(c.case_number, '')) from 'cv-(\d{5})'), '')::int,
         2147483647
       ) ASC,
       lower(COALESCE(c.case_number, '')) ASC,
       lower(COALESCE(c.case_name, '')) ASC`,
    [requestedTab, DOCKET_STATUS_OPTIONS]
  );

  res.json(
    result.rows.map((row) => ({
      id: row.id,
      caseName: row.case_name,
      caseNumber: row.case_number,
      jurisdiction: row.jurisdiction,
      isDocketOnly: row.is_docket_only,
      judge: row.judge,
      status: row.status || "",
      docketStatus: row.docket_status || "",
      docketbirdCaseId: row.docketbird_case_id || "",
      docketbirdLastSyncedAt: row.docketbird_last_synced_at,
      defendantCount: row.defendant_count,
      archived: row.archived,
      mostRecentEditAt: row.most_recent_edit_at,
      mostRecentEditBy: row.most_recent_edit_by,
    }))
  );
});

app.get("/api/litigation/cases/:id/entries", async (req, res) => {
  const result = await query(
    `SELECT la.id, la.action, la.internal_due_date, la.final_due_date, la.notes, la.sort_order,
            la.assigned_to_user_id, la.assigned_to_label, la.is_in_progress, la.is_completed, la.is_hidden, la.completed_at, la.completed_by,
            COALESCE(collabs.collaborators, '[]'::json) AS collaborators
     FROM litigation_actions la
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'userId', lac.user_id,
           'name', u.name,
           'email', u.email,
           'isInProgress', lac.is_in_progress,
           'isComplete', lac.is_complete,
           'completedAt', lac.completed_at,
           'completedBy', lac.completed_by
         )
         ORDER BY COALESCE(u.name, u.email, '')
       ) AS collaborators
       FROM litigation_action_collaborators lac
       LEFT JOIN users u ON u.id = lac.user_id
       WHERE lac.action_id = la.id
     ) collabs ON TRUE
     WHERE la.case_id = $1
       AND COALESCE(la.is_hidden, FALSE) = FALSE
     ORDER BY la.sort_order, la.updated_at, la.id`,
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      action: row.action || "",
      internalDueDate: row.internal_due_date,
      finalDueDate: row.final_due_date,
      notes: row.notes || "",
      assignedToUserId: row.assigned_to_user_id,
      assignedToLabel: row.assigned_to_label || "",
      isInProgress: row.is_in_progress,
      isCompleted: row.is_completed,
      isHidden: row.is_hidden,
      completedAt: row.completed_at,
      completedBy: row.completed_by,
      collaborators: Array.isArray(row.collaborators) ? row.collaborators : [],
      sortOrder: row.sort_order,
    }))
  );
});

app.get("/api/litigation/cases/:id/hidden-entries", async (req, res) => {
  const result = await query(
    `SELECT la.id, la.action, la.internal_due_date, la.final_due_date, la.notes, la.sort_order,
            la.assigned_to_user_id, la.assigned_to_label, la.is_in_progress, la.is_completed, la.is_hidden, la.completed_at, la.completed_by,
            COALESCE(collabs.collaborators, '[]'::json) AS collaborators
     FROM litigation_actions la
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'userId', lac.user_id,
           'name', u.name,
           'email', u.email,
           'isInProgress', lac.is_in_progress,
           'isComplete', lac.is_complete,
           'completedAt', lac.completed_at,
           'completedBy', lac.completed_by
         )
         ORDER BY COALESCE(u.name, u.email, '')
       ) AS collaborators
       FROM litigation_action_collaborators lac
       LEFT JOIN users u ON u.id = lac.user_id
       WHERE lac.action_id = la.id
     ) collabs ON TRUE
     WHERE la.case_id = $1
       AND COALESCE(la.is_hidden, FALSE) = TRUE
     ORDER BY la.updated_at DESC, la.sort_order, la.id`,
    [req.params.id]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      action: row.action || "",
      internalDueDate: row.internal_due_date,
      finalDueDate: row.final_due_date,
      notes: row.notes || "",
      assignedToUserId: row.assigned_to_user_id,
      assignedToLabel: row.assigned_to_label || "",
      isInProgress: row.is_in_progress,
      isCompleted: row.is_completed,
      isHidden: row.is_hidden,
      completedAt: row.completed_at,
      completedBy: row.completed_by,
      collaborators: Array.isArray(row.collaborators) ? row.collaborators : [],
      sortOrder: row.sort_order,
    }))
  );
});

app.put("/api/litigation/cases/:id/entries", async (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
  if (!entries) {
    return res.status(400).json({ error: "entries array is required." });
  }

  // Track newly assigned users so we can notify them after responding
  const toNotify = []; // [{ userId, taskType, dueDate }]

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] || {};
    const collaboratorUserIds = normalizeUserIdList(
      entry.collaboratorUserIds,
      entry.assignedToUserId || null
    );
    let actionId = entry.id || null;
    if (entry.id) {
      // Check previous assignee before updating
      const prev = await query(
        `SELECT assigned_to_user_id FROM litigation_actions WHERE id = $1`,
        [entry.id]
      );
      const prevAssignee = prev.rows[0]?.assigned_to_user_id || null;
      const newAssignee = entry.assignedToUserId || null;
      // Notify if assignee changed to someone other than the person making the save
      if (newAssignee && newAssignee !== prevAssignee && newAssignee !== req.session?.userId) {
        toNotify.push({ userId: newAssignee, taskType: entry.action || "Docket action", dueDate: entry.finalDueDate || entry.internalDueDate || null });
      }

      const updated = await query(
        `UPDATE litigation_actions
         SET action = $2,
             internal_due_date = $3,
             final_due_date = $4,
             notes = $5,
             assigned_to_user_id = $6,
             assigned_to_label = $7,
             sort_order = $8,
             updated_at = NOW(),
             updated_by = $9
         WHERE id = $1
         RETURNING id`,
        [
          entry.id,
          entry.action || null,
          entry.internalDueDate || null,
          entry.finalDueDate || null,
          entry.notes || null,
          entry.assignedToUserId || null,
          entry.assignedToLabel || null,
          i,
          req.session?.name || req.session?.email || null,
        ]
      );
      actionId = updated.rows[0]?.id || actionId;
    } else {
      // New entry — notify if assigned to someone other than the person saving
      if (entry.assignedToUserId && entry.assignedToUserId !== req.session?.userId) {
        toNotify.push({ userId: entry.assignedToUserId, taskType: entry.action || "Docket action", dueDate: entry.finalDueDate || entry.internalDueDate || null });
      }

      const inserted = await query(
        `INSERT INTO litigation_actions
          (case_id, action, internal_due_date, final_due_date, notes, assigned_to_user_id, assigned_to_label, sort_order, updated_at, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)
         RETURNING id`,
        [
          req.params.id,
          entry.action || null,
          entry.internalDueDate || null,
          entry.finalDueDate || null,
          entry.notes || null,
          entry.assignedToUserId || null,
          entry.assignedToLabel || null,
          i,
          req.session?.name || req.session?.email || null,
        ]
      );
      actionId = inserted.rows[0]?.id || actionId;
    }

    if (actionId) {
      await syncLitigationActionCollaborators(actionId, collaboratorUserIds, req.session, {
        resetNewCollaborators: true,
      });
    }
  }

  const refreshed = await query(
    `SELECT la.id, la.action, la.internal_due_date, la.final_due_date, la.notes,
            la.assigned_to_user_id, la.assigned_to_label, la.is_in_progress, la.is_completed, la.is_hidden,
            COALESCE(collabs.collaborators, '[]'::json) AS collaborators
     FROM litigation_actions la
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'userId', lac.user_id,
            'name', u.name,
            'email', u.email,
            'isInProgress', lac.is_in_progress,
            'isComplete', lac.is_complete,
            'completedAt', lac.completed_at,
            'completedBy', lac.completed_by
         )
       ) AS collaborators
       FROM litigation_action_collaborators lac
       LEFT JOIN users u ON u.id = lac.user_id
       WHERE lac.action_id = la.id
     ) collabs ON TRUE
     WHERE la.case_id = $1`,
    [req.params.id]
  );
  await syncLitigationTasks(
    req.params.id,
    refreshed.rows.map((row) => ({
      id: row.id,
      action: row.action || "",
      internalDueDate: row.internal_due_date,
      finalDueDate: row.final_due_date,
      notes: row.notes || "",
      assignedToUserId: row.assigned_to_user_id,
      assignedToLabel: row.assigned_to_label || "",
      isInProgress: row.is_in_progress,
      collaborators: Array.isArray(row.collaborators) ? row.collaborators : [],
      isCompleted: row.is_completed,
      isHidden: row.is_hidden,
    })),
    req.session
  );

  await writeAuditLog(req, {
    action: "litigation.entries.save",
    entityType: "case",
    entityId: req.params.id,
    before: null,
    after: { count: entries.length },
  });

  res.json({ ok: true });

  // Fire Teams notifications after responding — never blocks the save
  if (toNotify.length > 0) {
    const caseName = (await query("SELECT case_name FROM cases WHERE id = $1", [req.params.id])).rows[0]?.case_name || null;
    for (const n of toNotify) {
      (async () => {
        try {
          const userRow = await query("SELECT email FROM users WHERE id = $1", [n.userId]);
          if (userRow.rows[0]?.email) {
            await notifyTaskAssigned(userRow.rows[0].email, {
              taskType: n.taskType,
              dueDate: n.dueDate,
              caseName,
              assignedByName: req.session?.name || req.session?.email || null,
              flipUserId: n.userId,
            }, query);
          }
        } catch (e) { console.error("[notify] docket entry assign:", e.message); }
      })();
    }
  }
});

app.put("/api/litigation/actions/:id/state", async (req, res) => {
  const { isCompleted, isHidden, isInProgress, collaboratorUserId } = req.body || {};
  const existing = await query(
    `SELECT id, case_id, action, internal_due_date, final_due_date, notes, assigned_to_user_id,
            assigned_to_label, is_in_progress, is_completed, is_hidden
     FROM litigation_actions
     WHERE id = $1`,
    [req.params.id]
  );
  if (!existing.rows.length) {
    return res.status(404).json({ error: "Litigation action not found." });
  }

  const current = existing.rows[0];
  const actor = req.session?.name || req.session?.email || null;
  if (collaboratorUserId) {
    const collaboratorResult = await query(
      `UPDATE litigation_action_collaborators
       SET is_in_progress = CASE WHEN $3 THEN FALSE ELSE $2 END,
           is_complete = $3,
           completed_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
           completed_by = CASE WHEN $3 THEN $4 ELSE NULL END
       WHERE action_id = $1
         AND user_id = $5
       RETURNING action_id, user_id, is_in_progress, is_complete, completed_at, completed_by`,
      [
        req.params.id,
        Boolean(isInProgress),
        Boolean(isCompleted),
        actor,
        collaboratorUserId,
      ]
    );
    if (!collaboratorResult.rows.length) {
      return res.status(404).json({ error: "Collaborator not found for this action." });
    }

    const caseRows = await query(
      `SELECT la.id, la.action, la.internal_due_date, la.final_due_date, la.notes,
              la.assigned_to_user_id, la.assigned_to_label, la.is_in_progress, la.is_completed, la.is_hidden,
              COALESCE(collabs.collaborators, '[]'::json) AS collaborators
       FROM litigation_actions la
       LEFT JOIN LATERAL (
         SELECT json_agg(
           json_build_object(
             'userId', lac.user_id,
             'name', u.name,
             'email', u.email,
             'isInProgress', lac.is_in_progress,
             'isComplete', lac.is_complete,
             'completedAt', lac.completed_at,
             'completedBy', lac.completed_by
           )
         ) AS collaborators
         FROM litigation_action_collaborators lac
         LEFT JOIN users u ON u.id = lac.user_id
         WHERE lac.action_id = la.id
       ) collabs ON TRUE
       WHERE la.case_id = $1`,
      [current.case_id]
    );
    await syncLitigationTasks(
      current.case_id,
      caseRows.rows.map((row) => ({
        id: row.id,
        action: row.action || "",
        internalDueDate: row.internal_due_date,
        finalDueDate: row.final_due_date,
        notes: row.notes || "",
        assignedToUserId: row.assigned_to_user_id,
        assignedToLabel: row.assigned_to_label || "",
        isInProgress: row.is_in_progress,
        collaborators: Array.isArray(row.collaborators) ? row.collaborators : [],
        isCompleted: row.is_completed,
        isHidden: row.is_hidden,
      })),
      req.session
    );

    await writeAuditLog(req, {
      action: "litigation.action.collaborator_state",
      entityType: "litigation_action",
      entityId: req.params.id,
      before: null,
      after: {
        collaboratorUserId,
        isInProgress: collaboratorResult.rows[0].is_in_progress,
        isCompleted: collaboratorResult.rows[0].is_complete,
      },
    });

    return res.json({
      ok: true,
      collaborator: {
        userId: collaboratorResult.rows[0].user_id,
        isInProgress: collaboratorResult.rows[0].is_in_progress,
        isComplete: collaboratorResult.rows[0].is_complete,
        completedAt: collaboratorResult.rows[0].completed_at,
        completedBy: collaboratorResult.rows[0].completed_by,
      },
    });
  }

  const nextCompleted = Boolean(isCompleted);
  const nextHidden = Boolean(isHidden);
  const nextInProgress = nextCompleted ? false : Boolean(isInProgress);

  const result = await query(
    `UPDATE litigation_actions
     SET is_in_progress = $2,
         is_completed = $3,
         is_hidden = $4,
         completed_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
         completed_by = CASE WHEN $3 THEN $5 ELSE NULL END,
         updated_at = NOW(),
         updated_by = $5
     WHERE id = $1
     RETURNING id, case_id, action, internal_due_date, final_due_date, notes, assigned_to_user_id, assigned_to_label, is_in_progress, is_completed, is_hidden`,
    [
      req.params.id,
      nextInProgress,
      nextCompleted,
      nextHidden,
      actor,
    ]
  );
  if (nextCompleted) {
    await query(
      `UPDATE litigation_action_collaborators
       SET is_in_progress = FALSE
       WHERE action_id = $1`,
      [req.params.id]
    );
  }

  const caseRows = await query(
    `SELECT la.id, la.action, la.internal_due_date, la.final_due_date, la.notes,
            la.assigned_to_user_id, la.assigned_to_label, la.is_in_progress, la.is_completed, la.is_hidden,
            COALESCE(collabs.collaborators, '[]'::json) AS collaborators
     FROM litigation_actions la
     LEFT JOIN LATERAL (
       SELECT json_agg(
         json_build_object(
           'userId', lac.user_id,
           'name', u.name,
           'email', u.email,
           'isInProgress', lac.is_in_progress,
           'isComplete', lac.is_complete,
           'completedAt', lac.completed_at,
           'completedBy', lac.completed_by
         )
       ) AS collaborators
       FROM litigation_action_collaborators lac
       LEFT JOIN users u ON u.id = lac.user_id
       WHERE lac.action_id = la.id
     ) collabs ON TRUE
     WHERE la.case_id = $1`,
    [current.case_id]
  );
  await syncLitigationTasks(
    current.case_id,
    caseRows.rows.map((row) => ({
      id: row.id,
      action: row.action || "",
      internalDueDate: row.internal_due_date,
      finalDueDate: row.final_due_date,
      notes: row.notes || "",
      assignedToUserId: row.assigned_to_user_id,
      assignedToLabel: row.assigned_to_label || "",
      isInProgress: row.is_in_progress,
      collaborators: Array.isArray(row.collaborators) ? row.collaborators : [],
      isCompleted: row.is_completed,
      isHidden: row.is_hidden,
    })),
    req.session
  );

  await writeAuditLog(req, {
    action: "litigation.action.state",
    entityType: "litigation_action",
    entityId: req.params.id,
    before: {
      isInProgress: current.is_in_progress,
      isCompleted: current.is_completed,
      isHidden: current.is_hidden,
    },
    after: {
      isInProgress: result.rows[0].is_in_progress,
      isCompleted: result.rows[0].is_completed,
      isHidden: result.rows[0].is_hidden,
    },
  });

  res.json({
    ok: true,
    action: {
      id: result.rows[0].id,
      caseId: result.rows[0].case_id,
      action: result.rows[0].action || "",
      internalDueDate: result.rows[0].internal_due_date,
      finalDueDate: result.rows[0].final_due_date,
      notes: result.rows[0].notes || "",
      assignedToUserId: result.rows[0].assigned_to_user_id,
      assignedToLabel: result.rows[0].assigned_to_label || "",
      isInProgress: result.rows[0].is_in_progress,
      isCompleted: result.rows[0].is_completed,
      isHidden: result.rows[0].is_hidden,
    },
  });
});

app.put("/api/litigation/cases/:id/docket-status", async (req, res) => {
  const docketStatus = String(req.body?.docketStatus || "").trim();
  if (docketStatus && !DOCKET_STATUS_OPTIONS.includes(docketStatus)) {
    return res.status(400).json({ error: "Invalid docket status." });
  }

  const existing = await query(
    `SELECT c.id, c.status, state.docket_status
     FROM cases c
     LEFT JOIN litigation_case_state state ON state.case_id = c.id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!existing.rows.length) {
    return res.status(404).json({ error: "Case not found." });
  }

  await query(
    `INSERT INTO litigation_case_state
      (case_id, archived, docket_status)
     VALUES ($1, FALSE, $2)
     ON CONFLICT (case_id)
     DO UPDATE SET docket_status = EXCLUDED.docket_status`,
    [req.params.id, docketStatus || null]
  );

  await writeAuditLog(req, {
    action: "litigation.case.docket_status",
    entityType: "case",
    entityId: req.params.id,
    before: {
      docketStatus: existing.rows[0].docket_status || "",
      caseStatus: existing.rows[0].status || "",
    },
    after: {
      docketStatus: docketStatus || "",
      caseStatus: existing.rows[0].status || "",
    },
  });

  res.json({ ok: true, docketStatus: docketStatus || "" });
});

app.put("/api/litigation/cases/:id/docketbird-link", async (req, res) => {
  const docketbirdCaseId = String(req.body?.docketbirdCaseId || "").trim();
  const existing = await query("SELECT id FROM cases WHERE id = $1", [req.params.id]);
  if (!existing.rows.length) {
    return res.status(404).json({ error: "Case not found." });
  }

  await query(
    `INSERT INTO litigation_case_state
      (case_id, archived, docketbird_case_id)
     VALUES ($1, FALSE, $2)
     ON CONFLICT (case_id)
     DO UPDATE SET docketbird_case_id = EXCLUDED.docketbird_case_id`,
    [req.params.id, docketbirdCaseId || null]
  );

  await writeAuditLog(req, {
    action: "litigation.case.docketbird_link",
    entityType: "case",
    entityId: req.params.id,
    before: null,
    after: { docketbirdCaseId: docketbirdCaseId || "" },
  });

  res.json({ ok: true, docketbirdCaseId: docketbirdCaseId || "" });
});

app.get("/api/litigation/cases/:id/docketbird-suggest", async (req, res) => {
  try {
    const caseResult = await query(
      `SELECT c.id, c.case_number, c.jurisdiction, c.case_name
       FROM cases c
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!caseResult.rows.length) {
      return res.status(404).json({ error: "Case not found." });
    }

    const docketCase = caseResult.rows[0];
    const signature = parseCaseNumberSignature(docketCase.case_number);
    if (!signature) {
      return res.status(400).json({ error: "Case number is required to suggest a DocketBird case." });
    }

    const guessedId = buildLikelyDocketBirdCaseId(docketCase.jurisdiction, docketCase.case_number);
    const companyCases = await fetchDocketBirdCases();

    let match =
      (guessedId && companyCases.find((item) => String(item.id || "").toLowerCase() === guessedId)) ||
      companyCases.find((item) => docketBirdCaseMatches(item.id, docketCase.case_number)) ||
      null;

    if (!match) {
      return res.status(404).json({
        error: "No DocketBird case match found.",
        guessedId: guessedId || null,
      });
    }

    return res.json({
      ok: true,
      docketbirdCaseId: match.id,
      title: match.title || "",
      courtId: match.court_id || "",
      guessedId: guessedId || null,
    });
  } catch (error) {
    const message = error?.message || "Unable to search DocketBird cases.";
    return res.status(502).json({ error: message });
  }
});

app.post("/api/litigation/cases/:id/docketbird-sync", async (req, res) => {
  try {
    const caseResult = await query(
      `SELECT c.id, state.docketbird_case_id
       FROM cases c
       LEFT JOIN litigation_case_state state ON state.case_id = c.id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!caseResult.rows.length) {
      return res.status(404).json({ error: "Case not found." });
    }

    const docketbirdCaseId = String(caseResult.rows[0].docketbird_case_id || "").trim();
    if (!docketbirdCaseId) {
      return res.status(400).json({ error: "DocketBird Case ID is not set for this case." });
    }

    const entries = await fetchDocketBirdCalendarEntries(docketbirdCaseId);
    let sortOrderBase = 1000;
    for (const entry of entries) {
      const sourceReferenceId = String(entry.uuid || entry.id || "").trim();
      if (!sourceReferenceId) continue;
      const title = String(entry.title || "").trim();
      const dateValue = toDateOnly(entry.iso8601_datetime);

      await query(
        `INSERT INTO litigation_actions
          (case_id, action, internal_due_date, final_due_date, notes, assigned_to_user_id,
           is_completed, is_hidden, completed_at, completed_by, source, source_reference_id,
           sort_order, updated_at, updated_by)
         VALUES ($1, $2, $3, NULL, $4, NULL, FALSE, FALSE, NULL, NULL, 'docketbird', $5, $6, NOW(), $7)
         ON CONFLICT (case_id, source, source_reference_id)
         DO UPDATE SET
           action = EXCLUDED.action,
           internal_due_date = EXCLUDED.internal_due_date,
           notes = EXCLUDED.notes,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
        [
          req.params.id,
          title || "DocketBird Entry",
          dateValue,
          "Synced from DocketBird",
          sourceReferenceId,
          sortOrderBase,
          req.session?.name || req.session?.email || null,
        ]
      );
      sortOrderBase += 1;
    }

    await query(
      `INSERT INTO litigation_case_state
        (case_id, archived, docketbird_case_id, docketbird_last_synced_at)
       VALUES ($1, FALSE, $2, NOW())
       ON CONFLICT (case_id)
       DO UPDATE SET
         docketbird_case_id = EXCLUDED.docketbird_case_id,
         docketbird_last_synced_at = NOW()`,
      [req.params.id, docketbirdCaseId]
    );

    await writeAuditLog(req, {
      action: "litigation.case.docketbird_sync",
      entityType: "case",
      entityId: req.params.id,
      before: null,
      after: {
        docketbirdCaseId,
        syncedCount: entries.length,
      },
    });

    res.json({ ok: true, syncedCount: entries.length });
  } catch (error) {
    const message = error?.message || "Unable to sync DocketBird.";
    const statusCode =
      message.includes("404") || message.toLowerCase().includes("not found") ? 404 : 502;
    return res.status(statusCode).json({ error: message });
  }
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

app.get("/api/litigation/collections-summary", async (req, res) => {
  const result = await query(
    `SELECT
        c.id AS case_id,
        c.case_name,
        c.case_number,
        c.jurisdiction,
        c.judge,
        COALESCE(state.docket_defendant_count, defs.count, 0) AS defendant_count,
        lc.id,
        lc.platform,
        lc.sent_to_platform,
        lc.acknowledged,
        lc.breakdown,
        lc.all_def_accounted_for,
        lc.money_received,
        lc.sent_to_plaintiff,
        lc.notes,
        lc.sort_order
     FROM litigation_collections lc
     JOIN cases c ON c.id = lc.case_id
     LEFT JOIN litigation_case_state state ON state.case_id = c.id
     LEFT JOIN (
       SELECT case_id, COUNT(*)::int AS count
       FROM defendants
       GROUP BY case_id
     ) defs ON defs.case_id = c.id
     WHERE COALESCE(state.archived, FALSE) = FALSE
     ORDER BY c.case_number, lc.sort_order, lc.updated_at, lc.id`
  );

  const caseMap = new Map();
  for (const row of result.rows) {
    if (!caseMap.has(row.case_id)) {
      caseMap.set(row.case_id, {
        id: row.case_id,
        caseName: row.case_name || "",
        caseNumber: row.case_number || "",
        jurisdiction: row.jurisdiction || "",
        judge: row.judge || "",
        defendantCount: row.defendant_count || 0,
        collections: [],
      });
    }
    caseMap.get(row.case_id).collections.push({
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
    });
  }

  res.json(Array.from(caseMap.values()));
});

app.put("/api/litigation/cases/:id/collections", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) {
    return res.status(400).json({ error: "rows array is required." });
  }

  await withTransaction(async (client) => {
    await client.query("DELETE FROM litigation_collections WHERE case_id = $1", [req.params.id]);
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};
      await client.query(
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
  });

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
  const canCleanupWeeklyTasks = await loadWeeklyCleanupPermission(req.session.userId);
  const result = await query(
    `SELECT t.*,
            c.case_name,
            c.jurisdiction,
            d.name AS defendant_name,
            g.group_name,
            u.name AS assigned_user_name,
            u.email AS assigned_user_email,
            docket_action.final_due_date AS fallback_final_due_date,
            docket_action.assigned_to_label AS source_action_assigned_to_label
     FROM tasks t
     LEFT JOIN cases c ON c.id = t.case_id
     LEFT JOIN defendants d ON d.id = t.defendant_id
     LEFT JOIN groups g ON g.id = t.group_id
     LEFT JOIN users u ON u.id = t.assigned_to_user_id
     LEFT JOIN LATERAL (
       SELECT la.final_due_date
             , la.assigned_to_label
             , la.is_in_progress
       FROM litigation_actions la
       WHERE la.id = t.source_litigation_action_id
       ORDER BY la.updated_at DESC NULLS LAST, la.id DESC
       LIMIT 1
     ) docket_action ON TRUE
     WHERE t.assigned_to_user_id = $1
       AND t.status <> 'Complete'
     ORDER BY COALESCE(t.due_date, docket_action.final_due_date) NULLS LAST, t.created_at DESC`,
    [req.session.userId]
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      defendantId: row.defendant_id,
      groupId: row.group_id,
      assignedToUserId: row.assigned_to_user_id,
      assignedToName: row.assigned_user_name || "",
      assignedToEmail: row.assigned_user_email || "",
      assignedToLabel: row.source_action_assigned_to_label || "",
      isInProgress: row.status === "In Progress" || Boolean(row.is_in_progress),
      canComplete:
        !row.assigned_to_user_id ||
        row.assigned_to_user_id === req.session.userId ||
        canCleanupWeeklyTasks,
      sourceLitigationActionId: row.source_litigation_action_id || null,
      taskRole: row.task_role || "owner",
      targetType: row.group_id
        ? "group"
        : row.defendant_id
          ? "defendant"
          : String(row.task_type || "").startsWith("Docket:")
            ? "docket"
            : row.case_id
              ? "case"
              : "general",
      taskType: row.task_type,
      dueDate: row.due_date || row.fallback_final_due_date,
      status: row.status,
      caseName: row.case_name,
      jurisdiction: row.jurisdiction,
      defendantName: row.defendant_name,
      groupName: row.group_name,
    }))
  );
});

app.get("/api/tasks", async (req, res) => {
  const canCleanupWeeklyTasks = await loadWeeklyCleanupPermission(req.session.userId);
  const result = await query(
    `SELECT t.*,
            c.case_name,
            c.jurisdiction,
            d.name AS defendant_name,
            g.group_name,
            u.name AS assigned_user_name,
            u.email AS assigned_user_email,
            docket_action.final_due_date AS fallback_final_due_date,
            COALESCE(docket_action.is_hidden, FALSE) AS source_action_is_hidden,
            docket_action.assigned_to_label AS source_action_assigned_to_label
     FROM tasks t
     LEFT JOIN cases c ON c.id = t.case_id
     LEFT JOIN defendants d ON d.id = t.defendant_id
     LEFT JOIN groups g ON g.id = t.group_id
     LEFT JOIN users u ON u.id = t.assigned_to_user_id
     LEFT JOIN LATERAL (
       SELECT la.final_due_date, la.is_hidden, la.assigned_to_label, la.is_in_progress
       FROM litigation_actions la
       WHERE la.id = t.source_litigation_action_id
       ORDER BY la.updated_at DESC NULLS LAST, la.id DESC
       LIMIT 1
     ) docket_action ON TRUE
     WHERE COALESCE(docket_action.is_hidden, FALSE) = FALSE
     ORDER BY COALESCE(t.due_date, docket_action.final_due_date) NULLS LAST, t.created_at DESC`
  );
  res.json(
    result.rows.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      defendantId: row.defendant_id,
      groupId: row.group_id,
      assignedToUserId: row.assigned_to_user_id,
      assignedToName: row.assigned_user_name || "",
      assignedToEmail: row.assigned_user_email || "",
      assignedToLabel: row.source_action_assigned_to_label || "",
      isInProgress: row.status === "In Progress" || Boolean(row.is_in_progress),
      canComplete:
        !row.assigned_to_user_id ||
        row.assigned_to_user_id === req.session.userId ||
        canCleanupWeeklyTasks,
      sourceLitigationActionId: row.source_litigation_action_id || null,
      taskRole: row.task_role || "owner",
      targetType: row.group_id
        ? "group"
        : row.defendant_id
          ? "defendant"
          : String(row.task_type || "").startsWith("Docket:")
            ? "docket"
            : row.case_id
              ? "case"
              : "general",
      taskType: row.task_type,
      dueDate: row.due_date || row.fallback_final_due_date,
      status: row.status,
      isHidden: Boolean(row.source_action_is_hidden),
      caseName: row.case_name,
      jurisdiction: row.jurisdiction,
      defendantName: row.defendant_name,
      groupName: row.group_name,
    }))
  );
});

app.post("/api/tasks", async (req, res) => {
  const { caseId, defendantId, taskType, assignedToUserId, dueDate } = req.body;
  if (!taskType || !dueDate) {
    return res.status(400).json({ error: "taskType and dueDate are required." });
  }

  const result = await query(
    `INSERT INTO tasks
      (case_id, defendant_id, task_type, assigned_to_user_id, due_date, status, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,'Open',$6)
     RETURNING *`,
    [
      caseId || null,
      defendantId || null,
      taskType,
      assignedToUserId || null,
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

  // Teams notification — fire and forget, never blocks response
  if (assignedToUserId && assignedToUserId !== req.session.userId) {
    (async () => {
      try {
        const userRow = await query("SELECT email FROM users WHERE id = $1", [assignedToUserId]);
        const caseName = caseId
          ? (await query("SELECT case_name FROM cases WHERE id = $1", [caseId])).rows[0]?.case_name
          : null;
        if (userRow.rows[0]?.email) {
          await notifyTaskAssigned(userRow.rows[0].email, {
            taskType,
            dueDate,
            caseName: caseName || null,
            assignedByName: req.session.name || req.session.email || null,
            flipUserId: assignedToUserId,
          }, query);
        }
      } catch (e) { console.error("[notify] task create:", e.message); }
    })();
  }

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

  // Teams notification — fire and forget
  if (assignedToUserId && assignedToUserId !== req.session.userId) {
    (async () => {
      try {
        const userRow = await query("SELECT email FROM users WHERE id = $1", [assignedToUserId]);
        const caseName = caseId
          ? (await query("SELECT case_name FROM cases WHERE id = $1", [caseId])).rows[0]?.case_name
          : null;
        if (userRow.rows[0]?.email) {
          await notifyTaskAssigned(userRow.rows[0].email, {
            taskType,
            dueDate,
            caseName: caseName || null,
            assignedByName: req.session.name || req.session.email || null,
            flipUserId: assignedToUserId,
          }, query);
        }
      } catch (e) { console.error("[notify] group task create:", e.message); }
    })();
  }

  res.status(201).json(result.rows[0]);
});

app.put("/api/tasks/:id/complete", async (req, res) => {
  const canCleanupWeeklyTasks = await loadWeeklyCleanupPermission(req.session.userId);
  const existing = await query(
    `SELECT id, case_id, defendant_id, group_id, task_type, assigned_to_user_id, due_date, status,
            source_litigation_action_id, task_role
     FROM tasks
     WHERE id = $1
       AND (
         assigned_to_user_id = $2
         OR assigned_to_user_id IS NULL
         OR $3::boolean = TRUE
       )`,
    [req.params.id, req.session.userId, canCleanupWeeklyTasks]
  );

  if (!existing.rows.length) {
    return res.status(404).json({ error: "Task not found." });
  }

  const result = await query(
    `UPDATE tasks
     SET status = 'Complete', completed_at = NOW()
     WHERE id = $1
       AND (
         assigned_to_user_id = $2
         OR assigned_to_user_id IS NULL
         OR $3::boolean = TRUE
       )
     RETURNING id`,
    [req.params.id, req.session.userId, canCleanupWeeklyTasks]
  );

  const currentTask = existing.rows[0];
  const isDocketTask =
    !currentTask.defendant_id &&
    !currentTask.group_id &&
    String(currentTask.task_type || "").startsWith("Docket:");

  if (isDocketTask) {
    if (currentTask.task_role === "collaborator" && currentTask.source_litigation_action_id) {
      const collaboratorUpdate = await query(
        `UPDATE litigation_action_collaborators
         SET is_in_progress = FALSE,
             is_complete = TRUE,
             completed_at = NOW(),
             completed_by = $3
         WHERE action_id = $1
           AND user_id = $2
         RETURNING action_id`,
        [
          currentTask.source_litigation_action_id,
          currentTask.assigned_to_user_id,
          req.session?.name || req.session?.email || null,
        ]
      );
      currentTask.syncedDocketAction = Boolean(collaboratorUpdate.rows.length);
    } else if (currentTask.source_litigation_action_id) {
      const syncedAction = await query(
        `UPDATE litigation_actions
         SET is_in_progress = FALSE,
             is_completed = TRUE,
             completed_at = NOW(),
             completed_by = $2,
             updated_at = NOW(),
             updated_by = $2
         WHERE id = $1
           AND COALESCE(is_hidden, FALSE) = FALSE
         RETURNING id`,
        [
          currentTask.source_litigation_action_id,
          req.session?.name || req.session?.email || null,
        ]
      );
      currentTask.syncedDocketAction = Boolean(syncedAction.rows.length);
      if (currentTask.syncedDocketAction) {
        await query(
          `UPDATE tasks
           SET status = 'Complete', completed_at = NOW()
           WHERE source_litigation_action_id = $1
             AND id <> $2
             AND status <> 'Complete'`,
          [currentTask.source_litigation_action_id, currentTask.id]
        );
        await query(
          `UPDATE litigation_action_collaborators
           SET is_complete = TRUE,
               is_in_progress = FALSE,
               completed_at = NOW(),
               completed_by = $2
           WHERE action_id = $1
             AND is_complete = FALSE`,
          [
            currentTask.source_litigation_action_id,
            req.session?.name || req.session?.email || null,
          ]
        );
      }
    } else {
      currentTask.syncedDocketAction = false;
    }
  }

  await writeAuditLog(req, {
    action: "tasks.complete",
    entityType: "task",
    entityId: req.params.id,
    before: { status: currentTask.status || "Open" },
    after: {
      status: "Complete",
      syncedDocketAction: Boolean(currentTask.syncedDocketAction),
    },
  });

  res.json({ ok: true });
});

app.put("/api/tasks/:id/state", async (req, res) => {
  const nextStatusRaw = String(req.body?.status || "").trim();
  const nextStatus = nextStatusRaw === "In Progress" ? "In Progress" : "Open";
  const existing = await query(
    `SELECT id, case_id, defendant_id, group_id, task_type, assigned_to_user_id, due_date, status,
            source_litigation_action_id, task_role
     FROM tasks
     WHERE id = $1
       AND status <> 'Complete'
       AND (assigned_to_user_id = $2 OR assigned_to_user_id IS NULL)`,
    [req.params.id, req.session.userId]
  );

  if (!existing.rows.length) {
    return res.status(404).json({ error: "Task not found." });
  }

  const currentTask = existing.rows[0];
  const result = await query(
    `UPDATE tasks
     SET status = $2
     WHERE id = $1
       AND status <> 'Complete'
       AND (assigned_to_user_id = $3 OR assigned_to_user_id IS NULL)
     RETURNING id, status`,
    [req.params.id, nextStatus, req.session.userId]
  );

  const isDocketTask =
    !currentTask.defendant_id &&
    !currentTask.group_id &&
    String(currentTask.task_type || "").startsWith("Docket:");
  const actor = req.session?.name || req.session?.email || null;

  if (isDocketTask && currentTask.source_litigation_action_id) {
    if (currentTask.task_role === "collaborator") {
      await query(
        `UPDATE litigation_action_collaborators
         SET is_in_progress = CASE WHEN is_complete THEN FALSE ELSE $3 END
         WHERE action_id = $1
           AND user_id = $2`,
        [
          currentTask.source_litigation_action_id,
          currentTask.assigned_to_user_id,
          nextStatus === "In Progress",
        ]
      );
    } else {
      await query(
        `UPDATE litigation_actions
         SET is_in_progress = CASE WHEN is_completed THEN FALSE ELSE $2 END,
             updated_at = NOW(),
             updated_by = $3
         WHERE id = $1
           AND COALESCE(is_hidden, FALSE) = FALSE`,
        [currentTask.source_litigation_action_id, nextStatus === "In Progress", actor]
      );
    }

    const caseRows = await query(
      `SELECT la.id, la.action, la.internal_due_date, la.final_due_date, la.notes,
              la.assigned_to_user_id, la.assigned_to_label, la.is_in_progress, la.is_completed, la.is_hidden,
              COALESCE(collabs.collaborators, '[]'::json) AS collaborators
       FROM litigation_actions la
       LEFT JOIN LATERAL (
         SELECT json_agg(
           json_build_object(
             'userId', lac.user_id,
             'name', u.name,
             'email', u.email,
             'isInProgress', lac.is_in_progress,
             'isComplete', lac.is_complete,
             'completedAt', lac.completed_at,
             'completedBy', lac.completed_by
           )
         ) AS collaborators
         FROM litigation_action_collaborators lac
         LEFT JOIN users u ON u.id = lac.user_id
         WHERE lac.action_id = la.id
       ) collabs ON TRUE
       WHERE la.case_id = $1`,
      [currentTask.case_id]
    );
    await syncLitigationTasks(
      currentTask.case_id,
      caseRows.rows.map((row) => ({
        id: row.id,
        action: row.action || "",
        internalDueDate: row.internal_due_date,
        finalDueDate: row.final_due_date,
        notes: row.notes || "",
        assignedToUserId: row.assigned_to_user_id,
        assignedToLabel: row.assigned_to_label || "",
        isInProgress: row.is_in_progress,
        collaborators: Array.isArray(row.collaborators) ? row.collaborators : [],
        isCompleted: row.is_completed,
        isHidden: row.is_hidden,
      })),
      req.session
    );
  }

  await writeAuditLog(req, {
    action: "tasks.state",
    entityType: "task",
    entityId: req.params.id,
    before: { status: currentTask.status },
    after: { status: result.rows[0].status },
  });

  res.json({ ok: true, id: result.rows[0].id, status: result.rows[0].status });
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
  docketStatus: row.docket_status || "",
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
    `SELECT c.*, state.docket_status
     FROM cases c
     LEFT JOIN litigation_case_state state ON state.case_id = c.id
     WHERE COALESCE(c.is_docket_only, FALSE) = FALSE
     ORDER BY c.created_at DESC`
  );
  res.json(result.rows.map(mapCase));
});

app.get("/api/cases/:id", async (req, res) => {
  const result = await query(
    `SELECT c.*, state.docket_status
     FROM cases c
     LEFT JOIN litigation_case_state state ON state.case_id = c.id
     WHERE c.id = $1`,
    [req.params.id]
  );
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
    filedDate,
    judge,
    status,
    updatedBy,
    notes,
    isDocketOnly,
    docketDefendantCount,
  } = req.body;

  if (!caseName || !clientName) {
    return res.status(400).json({ error: "caseName and clientName are required" });
  }
  if (jurisdiction && !LITIGATION_TABS.includes(String(jurisdiction).toUpperCase())) {
    return res.status(400).json({ error: "Invalid jurisdiction." });
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
  if (Boolean(isDocketOnly) && Number.isFinite(Number(docketDefendantCount))) {
    await query(
      `INSERT INTO litigation_case_state (case_id, archived, docket_defendant_count)
       VALUES ($1, FALSE, $2)
       ON CONFLICT (case_id)
       DO UPDATE SET docket_defendant_count = EXCLUDED.docket_defendant_count`,
      [result.rows[0].id, Number(docketDefendantCount)]
    );
  }
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
    filedDate,
    judge,
    status,
    docketStatus,
    updatedBy,
    notes,
    docketDefendantCount,
  } = req.body;
  const actor = req.session?.name || req.session?.email || updatedBy || null;

  if (
    docketStatus !== undefined &&
    String(docketStatus || "").trim() &&
    !DOCKET_STATUS_OPTIONS.includes(String(docketStatus).trim())
  ) {
    return res.status(400).json({ error: "Invalid docket status." });
  }

  const existing = await query(
    `SELECT c.*, state.docket_status
     FROM cases c
     LEFT JOIN litigation_case_state state ON state.case_id = c.id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!existing.rows.length) {
    return res.status(404).json({ error: "Case not found" });
  }

  const e = existing.rows[0];
  const resolve = (val, col) => (val !== undefined ? (val || null) : col);
  const result = await query(
    `UPDATE cases SET
      case_name = $1,
      client_name = $2,
      plaintiff = $3,
      brand_name = $4,
      ip_claims_summary = $5,
      plaintiff_profit_per_unit = $6,
      jurisdiction = $7,
      case_number = $8,
      filed_date = $9,
      judge = $10,
      status = $11,
      updated_by = $12,
      updated_at = NOW(),
      court = $7,
      notes = $13
     WHERE id = $14
     RETURNING *`,
    [
      caseName !== undefined ? caseName || e.case_name : e.case_name,
      clientName !== undefined ? clientName || e.client_name : e.client_name,
      resolve(plaintiff, e.plaintiff),
      resolve(brandName, e.brand_name),
      resolve(ipClaimsSummary, e.ip_claims_summary),
      plaintiffProfitPerUnit !== undefined ? plaintiffProfitPerUnit : e.plaintiff_profit_per_unit,
      resolve(jurisdiction, e.jurisdiction),
      resolve(caseNumber, e.case_number),
      resolve(filedDate, e.filed_date),
      resolve(judge, e.judge),
      status !== undefined ? status || e.status : e.status,
      actor || e.updated_by,
      resolve(notes, e.notes),
      req.params.id,
    ]
  );

  if (docketDefendantCount !== undefined && docketDefendantCount !== null) {
    const numericDocketDefendantCount = Number(docketDefendantCount);
    if (Number.isFinite(numericDocketDefendantCount) && numericDocketDefendantCount >= 0) {
      await query(
        `INSERT INTO litigation_case_state (case_id, archived, docket_defendant_count)
         VALUES ($1, FALSE, $2)
         ON CONFLICT (case_id)
         DO UPDATE SET docket_defendant_count = EXCLUDED.docket_defendant_count`,
        [req.params.id, numericDocketDefendantCount]
      );
    }
  }

  if (docketStatus !== undefined) {
    await query(
      `INSERT INTO litigation_case_state
        (case_id, archived, docket_status)
       VALUES ($1, FALSE, $2)
       ON CONFLICT (case_id)
       DO UPDATE SET docket_status = EXCLUDED.docket_status`,
      [req.params.id, String(docketStatus || "").trim() || null]
    );
  }

  const refreshed = await query(
    `SELECT c.*, state.docket_status
     FROM cases c
     LEFT JOIN litigation_case_state state ON state.case_id = c.id
     WHERE c.id = $1`,
    [req.params.id]
  );
  const refreshedCase = refreshed.rows[0];

  await writeAuditLog(req, {
    action: "cases.update",
    entityType: "case",
    entityId: req.params.id,
    before: mapCase(existing.rows[0]),
    after: mapCase(refreshedCase),
  });

  res.json(mapCase(refreshedCase));
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
      "SELECT doe_number, platform, name FROM defendants WHERE case_id = $1",
      [req.params.id]
    );
    const maxDoe = existing.rows.reduce((max, row) => {
      const match = String(row.doe_number || "").match(/\d+/);
      const num = match ? Number(match[0]) : 0;
      return Math.max(max, num);
    }, 0);
    const existingKeys = new Set(
      existing.rows.map((row) => {
        const platform = String(row.platform || "").trim().toLowerCase();
        const seller = String(row.name || "").trim().toLowerCase();
        return `${platform}|${seller}`;
      })
    );

    const values = [];
    const placeholders = [];
    let index = 1;
    let doeCounter = maxDoe;
    let skippedDuplicates = 0;

    const filtered = records.filter((row) => valueFromRow(row, "seller") !== "");
    const uniqueRows = [];
    filtered.forEach((row) => {
      const platform = valueFromRow(row, "platform");
      const seller = valueFromRow(row, "seller");
      const duplicateKey = `${platform.trim().toLowerCase()}|${seller
        .trim()
        .toLowerCase()}`;
      if (existingKeys.has(duplicateKey)) {
        skippedDuplicates += 1;
        return;
      }
      existingKeys.add(duplicateKey);
      uniqueRows.push(row);
    });

    uniqueRows.forEach((row) => {
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
      return res.status(400).json({
        error:
          skippedDuplicates > 0
            ? "No new defendants imported. All mapped rows already exist for this case."
            : "No valid seller rows found.",
      });
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
        imported: uniqueRows.length,
        skippedDuplicates,
        startingDoe: maxDoe + 1,
        mapping: mappedHeaders,
      },
    });

    res.json({
      imported: uniqueRows.length,
      skippedDuplicates,
      startingDoe: maxDoe + 1,
    });
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

app.get("/api/weekly-reports", requireWeeklyReportAccess, async (req, res) => {
  const { rows } = await query(
    `SELECT id, week_start, week_end, generated_at, generated_by
     FROM weekly_reports
     ORDER BY week_start DESC`
  );
  res.json(rows);
});

app.get("/api/weekly-reports/:id/download", requireWeeklyReportAccess, async (req, res) => {
  const { rows } = await query(
    'SELECT week_start, week_end, csv_data FROM weekly_reports WHERE id = $1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Report not found.' });
  const row = rows[0];
  const filename = `weekly-report-${String(row.week_start).slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(row.csv_data);
});

app.post("/api/weekly-reports/generate", requireSession, requireAdmin, async (req, res) => {
  const { weekStart: weekStartArg } = req.body || {};
  let weekStart, weekEnd;
  if (weekStartArg) {
    weekStart = new Date(weekStartArg + 'T00:00:00');
    weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 4);
    weekEnd.setHours(23, 59, 59, 999);
  } else {
    ({ weekStart, weekEnd } = getWeekBounds(new Date()));
  }
  const actor = req.session?.name || req.session?.email || 'admin';
  const result = await generateWeeklyReport(weekStart, weekEnd, actor);
  res.json({ ok: true, reportId: result?.id });
});

// ---------------------------------------------------------------------------
// Email integration — DB migrations
// ---------------------------------------------------------------------------
const ensureEmailTables = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS ms_connected_accounts (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      connected_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
      ms_user_id            TEXT,
      ms_email              TEXT NOT NULL UNIQUE,
      display_name          TEXT,
      is_shared             BOOLEAN NOT NULL DEFAULT FALSE,
      access_token          TEXT,
      refresh_token         TEXT,
      token_expires_at      TIMESTAMPTZ,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_at            TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS email_folder_mappings (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ms_account_id    UUID REFERENCES ms_connected_accounts(id) ON DELETE CASCADE,
      folder_id        TEXT NOT NULL,
      folder_name      TEXT NOT NULL,
      parent_folder_id TEXT,
      case_id          UUID REFERENCES cases(id) ON DELETE SET NULL,
      matter_label     TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ms_account_id, folder_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS email_triage_queue (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ms_account_id         UUID REFERENCES ms_connected_accounts(id) ON DELETE CASCADE,
      message_id            TEXT NOT NULL,
      subject               TEXT,
      sender_email          TEXT,
      sender_name           TEXT,
      received_at           TIMESTAMPTZ,
      suggested_folder_id   TEXT,
      suggested_folder_name TEXT,
      suggested_case_id     UUID REFERENCES cases(id) ON DELETE SET NULL,
      confidence            TEXT,
      claude_reasoning      TEXT,
      status                TEXT NOT NULL DEFAULT 'pending',
      reviewed_by           UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at           TIMESTAMPTZ,
      final_folder_id       TEXT,
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ms_account_id, message_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS email_thread_defendants (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ms_account_id   UUID REFERENCES ms_connected_accounts(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL,
      defendant_id    UUID REFERENCES defendants(id) ON DELETE CASCADE,
      case_id         UUID REFERENCES cases(id) ON DELETE CASCADE,
      is_primary      BOOLEAN NOT NULL DEFAULT TRUE,
      thread_label    TEXT,
      linked_by       UUID REFERENCES users(id) ON DELETE SET NULL,
      linked_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ms_account_id, conversation_id, defendant_id)
    )
  `);
};

// ---------------------------------------------------------------------------
// Register email routes + pull out Teams notification helpers
// ---------------------------------------------------------------------------
const emailModule = require("./routes/email");
emailModule(app, { requireSession, query, withTransaction, writeAuditLog });
const { notifyTaskAssigned, notifyOverdueSummary } = emailModule;

// ---------------------------------------------------------------------------
// Automations routes (Exhibit 2, etc.)
// ---------------------------------------------------------------------------
const automationsRouter = require("./routes/automations");
app.use("/api/automations", requireSession, automationsRouter);

// Catch-all and error handler must stay after all route registrations
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
  await ensureUserPermissionsColumns();
  await ensureTaskCompletedAt();
  await ensureWeeklyReportTable();
  await ensureCaseUpdatedAtTimestamp();
  await ensureCaseDocketOnlyColumn();
  await ensureLitigationTables();
  await ensureEmailTables();
  await ensureAdminUser();

  // ---------------------------------------------------------------------------
  // Friday 9 AM — overdue task reminder via Teams DM
  // Runs at 9:00 AM Eastern (14:00 UTC) every Friday
  // ---------------------------------------------------------------------------
  try {
    const cron = require("node-cron");
    cron.schedule("0 14 * * 5", async () => {
      console.log("[cron] Running Friday overdue task reminders...");
      try {
        const { rows } = await query(`
          SELECT
            u.id,
            u.email,
            u.name,
            json_agg(
              json_build_object(
                'taskType', t.task_type,
                'dueDate',  t.due_date,
                'caseName', c.name
              ) ORDER BY t.due_date ASC
            ) AS tasks
          FROM tasks t
          JOIN users u ON u.id = t.assigned_to_user_id
          LEFT JOIN cases c ON c.id = t.case_id
          WHERE t.status <> 'Complete'
            AND t.due_date < CURRENT_DATE
          GROUP BY u.id, u.email, u.name
        `);
        for (const row of rows) {
          await notifyOverdueSummary(row.email, row.tasks, query);
        }
        console.log(`[cron] Overdue reminders sent to ${rows.length} user(s).`);
      } catch (err) {
        console.error("[cron] Friday reminder error:", err.message);
      }
    });
    console.log("[cron] Friday overdue reminder scheduled (Fridays 14:00 UTC)");
  } catch (e) {
    console.warn("[cron] Skipping Friday reminders:", e.message);
  }

  setInterval(async () => { // weekly report scheduler
    try {
      const now = new Date();
      if (now.getDay() !== 6) return; // not Saturday
      if (now.getHours() !== 12) return; // not noon (server local time)
      if (now.getMinutes() > 2) return; // outside 12:00–12:02 window
      const { weekStart, weekEnd } = getWeekBounds(now);
      const weekStartStr = toDateString(weekStart);
      const existing = await query(
        'SELECT id FROM weekly_reports WHERE week_start = $1',
        [weekStartStr]
      );
      if (existing.rows.length) return;
      await generateWeeklyReport(weekStart, weekEnd, 'scheduler');
    } catch (err) {
      console.error('[weekly-report] Scheduler error:', err);
    }
  }, 60_000);
  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
  });
};

start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
