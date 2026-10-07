// Trademark Docket API — all routes under /api/trademark.
// Registered from server.js after app.use("/api", requireSession), so every
// route here requires a session. Mutations are audit-logged as
// trademark.<entity>.<verb>; multi-step writes use withTransaction.
const tm = require("../lib/trademark");

const MAX_TEXT = 10000;

const actorOf = (req) => req.session?.name || req.session?.email || null;

// Express 4 doesn't catch async errors; map common Postgres errors to 4xx and
// hand everything else to the app's JSON error handler.
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err && err.code === "23505") return res.status(409).json({ error: "That record already exists." });
    if (err && err.code === "22P02") return res.status(400).json({ error: "Invalid id or value." });
    if (err && err.code === "23514") return res.status(400).json({ error: "Value not allowed." });
    if (err && err.code === "23503") return res.status(409).json({ error: "Record is still referenced elsewhere." });
    return next(err);
  });

class ValidationError extends Error {}

const textField = (value, label) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") throw new ValidationError(`${label} must be text.`);
  const text = String(value).trim();
  if (text.length > MAX_TEXT) throw new ValidationError(`${label} is too long.`);
  return text || null;
};
const dateField = (value, label) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (!tm.isValidISODate(value)) throw new ValidationError(`${label} must be a date (YYYY-MM-DD).`);
  return value;
};
const boolField = (value, label) => {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ValidationError(`${label} must be true or false.`);
  return value;
};
const enumField = (value, allowed, label, { nullable = false } = {}) => {
  if (value === undefined) return undefined;
  if ((value === null || value === "") && nullable) return null;
  if (!allowed.includes(value)) throw new ValidationError(`Invalid ${label}.`);
  return value;
};
const uuidField = (value, label) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new ValidationError(`Invalid ${label}.`);
  return value;
};

// field name -> [column, parser]
const ITEM_FIELDS = {
  stage: ["stage", (v) => enumField(v, tm.STAGE_KEYS, "stage")],
  actionType: ["action_type", (v) => enumField(v, tm.ACTION_TYPE_KEYS, "action type")],
  actionLabel: ["action_label", (v) => textField(v, "Action")],
  brand: ["brand", (v) => textField(v, "Brand")],
  triggerDate: ["trigger_date", (v) => dateField(v, "Trigger date")],
  internalDueDate: ["internal_due_date", (v) => dateField(v, "Internal deadline")],
  internalDueText: ["internal_due_text", (v) => textField(v, "Internal deadline note")],
  responseDueDate: ["response_due_date", (v) => dateField(v, "Response deadline")],
  responseDueText: ["response_due_text", (v) => textField(v, "Response deadline note")],
  clientDueDate: ["client_due_date", (v) => dateField(v, "Client due date")],
  clientDueText: ["client_due_text", (v) => textField(v, "Client due date note")],
  receivedDate: ["received_date", (v) => dateField(v, "Received date")],
  workState: ["work_state", (v) => enumField(v, tm.WORK_STATE_KEYS, "work state")],
  comment: ["comment", (v) => textField(v, "Comment")],
  clientComment: ["client_comment", (v) => textField(v, "Client comment")],
  meetingNotes: ["meeting_notes", (v) => textField(v, "Meeting notes")],
  costEstimate: ["cost_estimate", (v) => textField(v, "Cost estimate")],
  assignedToUserId: ["assigned_to_user_id", (v) => uuidField(v, "assignee")],
};

const MATTER_FIELDS = {
  clientId: ["client_id", (v) => uuidField(v, "client")],
  clientRef: ["client_ref", (v) => textField(v, "Client ref")],
  jurisdiction: ["jurisdiction", (v) => textField(v, "Jurisdiction") || "US"],
  markText: ["mark_text", (v) => textField(v, "Mark")],
  title: ["title", (v) => textField(v, "Title")],
  applicationStatus: ["application_status", (v) => enumField(v, tm.APPLICATION_STATUSES, "application status", { nullable: true })],
  serialNo: ["serial_no", (v) => textField(v, "Serial no.")],
  registrationNo: ["registration_no", (v) => textField(v, "Registration no.")],
  proceedingNo: ["proceeding_no", (v) => textField(v, "Proceeding no.")],
  filingDate: ["filing_date", (v) => dateField(v, "Filing date")],
  registrationDate: ["registration_date", (v) => dateField(v, "Registration date")],
  noaDate: ["noa_date", (v) => dateField(v, "NOA date")],
  notes: ["notes", (v) => textField(v, "Notes")],
  niceClasses: [
    "nice_classes",
    (v) => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v) || v.some((n) => !Number.isInteger(n) || n < 1 || n > 45)) {
        throw new ValidationError("Classes must be numbers 1–45.");
      }
      return [...new Set(v)].sort((a, b) => a - b);
    },
  ],
};

const CLIENT_FIELDS = {
  kind: ["kind", (v) => enumField(v, tm.CLIENT_KINDS, "client kind")],
  hasPortfolioView: ["has_portfolio_view", (v) => boolField(v, "Portfolio view")],
  isUnresponsive: ["is_unresponsive", (v) => boolField(v, "Unresponsive")],
  paymentRisk: ["payment_risk", (v) => boolField(v, "Payment risk")],
  contactNote: ["contact_note", (v) => textField(v, "Contact note")],
  notes: ["notes", (v) => textField(v, "Notes")],
  isArchived: ["is_archived", (v) => boolField(v, "Archived")],
};

const TODO_FIELDS = {
  kind: ["kind", (v) => enumField(v, ["todo", "note"], "kind")],
  dueDate: ["due_date", (v) => dateField(v, "Due date")],
  dueText: ["due_text", (v) => textField(v, "Due note")],
  receivedDate: ["received_date", (v) => dateField(v, "Received date")],
  actionItem: ["action_item", (v) => textField(v, "Action item")],
  emailSubject: ["email_subject", (v) => textField(v, "Email subject")],
  status: ["status", (v) => enumField(v, tm.TODO_STATUSES, "status")],
  statusNote: ["status_note", (v) => textField(v, "Status note")],
  assigneeInitials: ["assignee_initials", (v) => textField(v, "Initials")],
  assignedToUserId: ["assigned_to_user_id", (v) => uuidField(v, "assignee")],
  matterId: ["matter_id", (v) => uuidField(v, "matter")],
  isHidden: ["is_hidden", (v) => boolField(v, "Hidden")],
};

const BQ_FIELDS = {
  matterId: ["matter_id", (v) => uuidField(v, "matter")],
  scope: ["scope", (v) => enumField(v, ["matter", "all"], "scope")],
  question: ["question", (v) => textField(v, "Question")],
  answer: ["answer", (v) => textField(v, "Answer")],
  isResolved: ["is_resolved", (v) => boolField(v, "Resolved")],
};

// Returns { column: value } for the fields present in body. Throws ValidationError.
const pickFields = (body, spec) => {
  const out = {};
  Object.entries(spec).forEach(([key, [column, parse]]) => {
    if (!body || !(key in body)) return;
    const value = parse(body[key]);
    if (value !== undefined) out[column] = value;
  });
  return out;
};

const validateItemFields = (body, { create = false } = {}) => {
  const fields = pickFields(body, ITEM_FIELDS);
  if (create) {
    if (!fields.stage) throw new ValidationError("Stage is required.");
    if (!fields.action_type) fields.action_type = tm.actionTypeForStage(fields.stage, {});
  }
  return fields;
};

const buildUpdate = (table, id, fields, actor) => {
  const cols = Object.keys(fields);
  const sets = cols.map((c, i) => `${c} = $${i + 2}`);
  sets.push(`updated_at = NOW()`, `updated_by = $${cols.length + 2}`);
  return {
    text: `UPDATE ${table} SET ${sets.join(", ")} WHERE id = $1 RETURNING id`,
    values: [id, ...cols.map((c) => fields[c]), actor],
  };
};

const buildInsert = (table, fields, actor) => {
  const all = { ...fields, updated_by: actor };
  const cols = Object.keys(all);
  return {
    text: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    values: cols.map((c) => all[c]),
  };
};

const d = (col) => `to_char(${col}, 'YYYY-MM-DD')`;

const ITEM_SELECT = `
  SELECT i.id, i.matter_id, i.stage, i.action_type, i.action_label, i.brand,
         ${d("i.trigger_date")} AS trigger_date,
         ${d("i.internal_due_date")} AS internal_due_date, i.internal_due_text,
         ${d("i.response_due_date")} AS response_due_date, i.response_due_text,
         ${d("i.client_due_date")} AS client_due_date, i.client_due_text,
         ${d("i.received_date")} AS received_date,
         i.work_state, i.comment, i.client_comment, i.meeting_notes,
         i.reported, i.ready_to_bill, i.services_entered, i.expenses_entered, i.invoiced, i.invoiced_at,
         i.cost_estimate, i.is_closed, i.closed_at, i.closed_by, i.is_hidden, i.assigned_to_user_id,
         i.needs_review, i.review_reasons, i.source, i.source_tab, i.source_row, i.extra,
         i.created_at, i.updated_at, i.updated_by,
         m.matter_no, m.matter_family, m.jurisdiction, m.mark_text, m.application_status,
         m.title AS matter_title, m.proceeding_no, m.client_ref, m.archived AS matter_archived,
         m.needs_review AS matter_needs_review, m.review_reasons AS matter_review_reasons,
         ${d("m.filing_date")} AS filing_date, ${d("m.registration_date")} AS registration_date,
         ${d("m.noa_date")} AS noa_date, m.serial_no, m.registration_no,
         c.id AS client_id, c.name AS client_name, c.is_unresponsive, c.payment_risk,
         u.name AS assigned_to_name,
         (SELECT COUNT(*)::int FROM trademark_item_deadlines td
           WHERE td.item_id = i.id AND NOT td.is_hidden AND NOT td.is_done) AS open_deadline_count
  FROM trademark_docket_items i
  JOIN trademark_matters m ON m.id = i.matter_id
  LEFT JOIN trademark_clients c ON c.id = m.client_id
  LEFT JOIN users u ON u.id = i.assigned_to_user_id`;

const mapItem = (r) => ({
  id: r.id,
  matterId: r.matter_id,
  stage: r.stage,
  actionType: r.action_type,
  actionLabel: r.action_label,
  brand: r.brand,
  triggerDate: r.trigger_date,
  internalDueDate: r.internal_due_date,
  internalDueText: r.internal_due_text,
  responseDueDate: r.response_due_date,
  responseDueText: r.response_due_text,
  clientDueDate: r.client_due_date,
  clientDueText: r.client_due_text,
  receivedDate: r.received_date,
  effectiveDueDate: r.internal_due_date || r.response_due_date || null,
  workState: r.work_state,
  comment: r.comment,
  clientComment: r.client_comment,
  meetingNotes: r.meeting_notes,
  reported: r.reported,
  readyToBill: r.ready_to_bill,
  servicesEntered: r.services_entered,
  expensesEntered: r.expenses_entered,
  invoiced: r.invoiced,
  invoicedAt: r.invoiced_at,
  costEstimate: r.cost_estimate,
  billingState: tm.billingState({
    invoiced: r.invoiced,
    readyToBill: r.ready_to_bill,
    servicesEntered: r.services_entered,
    expensesEntered: r.expenses_entered,
    reported: r.reported,
  }),
  isClosed: r.is_closed,
  closedAt: r.closed_at,
  closedBy: r.closed_by,
  isHidden: r.is_hidden,
  assignedToUserId: r.assigned_to_user_id,
  assignedToName: r.assigned_to_name,
  needsReview: r.needs_review,
  reviewReasons: r.review_reasons || [],
  source: r.source,
  sourceTab: r.source_tab,
  sourceRow: r.source_row,
  extra: r.extra || {},
  openDeadlineCount: r.open_deadline_count || 0,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
  matter: {
    id: r.matter_id,
    matterNo: r.matter_no,
    family: r.matter_family,
    jurisdiction: r.jurisdiction,
    markText: r.mark_text,
    applicationStatus: r.application_status,
    title: r.matter_title,
    proceedingNo: r.proceeding_no,
    clientRef: r.client_ref,
    archived: r.matter_archived,
    needsReview: r.matter_needs_review,
    reviewReasons: r.matter_review_reasons || [],
    filingDate: r.filing_date,
    registrationDate: r.registration_date,
    noaDate: r.noa_date,
    serialNo: r.serial_no,
    registrationNo: r.registration_no,
  },
  client: r.client_id
    ? { id: r.client_id, name: r.client_name, isUnresponsive: r.is_unresponsive, paymentRisk: r.payment_risk }
    : null,
});

const MATTER_SELECT = `
  SELECT m.id, m.matter_no, m.matter_no_norm, m.matter_family, m.parent_matter_no_norm, m.client_id, m.client_ref,
         m.jurisdiction, m.mark_text, m.nice_classes, m.title, m.application_status, m.serial_no, m.registration_no,
         m.proceeding_no, ${d("m.filing_date")} AS filing_date, ${d("m.registration_date")} AS registration_date,
         ${d("m.noa_date")} AS noa_date, m.notes, m.needs_review, m.review_reasons, m.archived, m.archived_at,
         m.archived_by, m.updated_at, m.updated_by, c.name AS client_name, c.is_unresponsive, c.payment_risk
  FROM trademark_matters m
  LEFT JOIN trademark_clients c ON c.id = m.client_id`;

const mapMatter = (r) => ({
  id: r.id,
  matterNo: r.matter_no,
  family: r.matter_family,
  parentMatterNo: r.parent_matter_no_norm,
  clientId: r.client_id,
  clientName: r.client_name,
  clientIsUnresponsive: r.is_unresponsive,
  clientPaymentRisk: r.payment_risk,
  clientRef: r.client_ref,
  jurisdiction: r.jurisdiction,
  markText: r.mark_text,
  niceClasses: r.nice_classes || [],
  title: r.title,
  applicationStatus: r.application_status,
  serialNo: r.serial_no,
  registrationNo: r.registration_no,
  proceedingNo: r.proceeding_no,
  filingDate: r.filing_date,
  registrationDate: r.registration_date,
  noaDate: r.noa_date,
  notes: r.notes,
  needsReview: r.needs_review,
  reviewReasons: r.review_reasons || [],
  archived: r.archived,
  archivedAt: r.archived_at,
  archivedBy: r.archived_by,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

const mapClient = (r) => ({
  id: r.id,
  name: r.name,
  aliases: r.aliases || [],
  kind: r.kind,
  hasPortfolioView: r.has_portfolio_view,
  isUnresponsive: r.is_unresponsive,
  paymentRisk: r.payment_risk,
  contactNote: r.contact_note,
  notes: r.notes,
  needsReview: r.needs_review,
  reviewReasons: r.review_reasons || [],
  isArchived: r.is_archived,
  openItemCount: r.open_item_count ?? undefined,
  matterCount: r.matter_count ?? undefined,
});

const mapTodo = (r) => ({
  id: r.id,
  kind: r.kind,
  dueDate: r.due_date,
  dueText: r.due_text,
  receivedDate: r.received_date,
  actionItem: r.action_item,
  emailSubject: r.email_subject,
  status: r.status,
  statusNote: r.status_note,
  assigneeInitials: r.assignee_initials,
  assignedToUserId: r.assigned_to_user_id,
  assignedToName: r.assigned_to_name,
  matterId: r.matter_id,
  matterNo: r.matter_no,
  isHidden: r.is_hidden,
  updatedAt: r.updated_at,
});

const mapQuestion = (r) => ({
  id: r.id,
  matterId: r.matter_id,
  matterNo: r.matter_no || r.matter_no_text,
  scope: r.scope,
  question: r.question,
  answer: r.answer,
  isResolved: r.is_resolved,
  updatedAt: r.updated_at,
});

const ITEM_VIEWS = ["due", "stage", "portfolio", "ready_to_bill", "unbilled_closed", "review", "closed"];

// Builds the WHERE clause for GET /items. Exported for tests.
const buildItemFilters = (q) => {
  const where = ["NOT i.is_hidden"];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  const view = ITEM_VIEWS.includes(q.view) ? q.view : "due";
  const includeClosed = q.includeClosed === "1" || q.includeClosed === "true";
  if (view === "closed") where.push("i.is_closed");
  else if (view === "unbilled_closed") {
    where.push("i.is_closed", "NOT i.invoiced", "(i.reported OR i.ready_to_bill OR i.services_entered OR i.expenses_entered)");
  } else {
    if (!includeClosed) where.push("NOT i.is_closed");
    where.push("NOT m.archived");
  }
  if (view === "ready_to_bill") where.push("i.ready_to_bill", "NOT i.invoiced");
  if (view === "review" || q.needsReview === "1") where.push("(i.needs_review OR m.needs_review)");
  if (q.stage) {
    if (!tm.STAGE_KEYS.includes(q.stage)) throw new ValidationError("Invalid stage.");
    add("i.stage = ?", q.stage);
  }
  if (q.clientId) add("m.client_id = ?", uuidField(q.clientId, "client"));
  if (q.state) {
    if (!tm.WORK_STATE_KEYS.includes(q.state)) throw new ValidationError("Invalid work state.");
    add("i.work_state = ?", q.state);
  }
  if (q.family) {
    if (!tm.MATTER_FAMILIES.includes(q.family)) throw new ValidationError("Invalid matter family.");
    add("m.matter_family = ?", q.family);
  }
  if (q.jurisdiction) add("m.jurisdiction ILIKE ?", q.jurisdiction);
  if (q.q) {
    const term = `%${String(q.q).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    add(
      `(m.matter_no ILIKE ? OR i.brand ILIKE $T OR m.mark_text ILIKE $T OR c.name ILIKE $T
        OR i.comment ILIKE $T OR i.action_label ILIKE $T OR m.client_ref ILIKE $T OR m.title ILIKE $T)`,
      term
    );
    where[where.length - 1] = where[where.length - 1].replace(/\$T/g, `$${params.length}`);
  }
  const order =
    view === "closed" || view === "unbilled_closed"
      ? "ORDER BY i.closed_at DESC NULLS LAST, COALESCE(i.internal_due_date, i.response_due_date) DESC NULLS LAST, m.matter_no"
      : "ORDER BY COALESCE(i.internal_due_date, i.response_due_date) ASC NULLS LAST, i.response_due_date ASC NULLS LAST, m.matter_no ASC";
  return { view, where, params, order };
};

const todayParam = (req) => (tm.isValidISODate(req.query.today) ? req.query.today : null);

function registerTrademarkRoutes(app, { query, withTransaction, writeAuditLog, requireAdmin }) {
  const base = "/api/trademark";

  const loadItem = async (id, db = { query }) => {
    const { rows } = await db.query(`${ITEM_SELECT} WHERE i.id = $1`, [id]);
    return rows[0] ? mapItem(rows[0]) : null;
  };
  const loadMatter = async (id, db = { query }) => {
    const { rows } = await db.query(`${MATTER_SELECT} WHERE m.id = $1`, [id]);
    return rows[0] ? mapMatter(rows[0]) : null;
  };
  const badRequest = (res, err) => res.status(400).json({ error: err.message });
  const handle = (fn) =>
    asyncRoute(async (req, res, next) => {
      try {
        return await fn(req, res, next);
      } catch (err) {
        if (err instanceof ValidationError) return badRequest(res, err);
        throw err;
      }
    });

  // ---- Metadata / stats -----------------------------------------------------
  app.get(`${base}/meta`, handle(async (req, res) => {
    const { rows } = await query(
      `SELECT id, name, is_unresponsive, payment_risk FROM trademark_clients
       WHERE has_portfolio_view AND NOT is_archived ORDER BY name`
    );
    res.json({
      stages: tm.STAGES,
      actionTypes: tm.ACTION_TYPES,
      applicationStatuses: tm.APPLICATION_STATUSES,
      workStates: tm.WORK_STATES,
      todoStatuses: tm.TODO_STATUSES,
      clientKinds: tm.CLIENT_KINDS,
      matterFamilies: tm.MATTER_FAMILIES,
      dueSoonDays: tm.DUE_SOON_DAYS,
      reviewReasons: tm.REVIEW_REASONS,
      suggestionRules: tm.SUGGESTION_RULES,
      portfolioClients: rows.map((r) => ({ id: r.id, name: r.name, isUnresponsive: r.is_unresponsive, paymentRisk: r.payment_risk })),
    });
  }));

  app.get(`${base}/stats`, handle(async (req, res) => {
    const today = todayParam(req);
    const { rows } = await query(
      `WITH open_items AS (
         SELECT i.*, m.client_id, COALESCE(i.internal_due_date, i.response_due_date) AS due
         FROM trademark_docket_items i JOIN trademark_matters m ON m.id = i.matter_id
         WHERE NOT i.is_hidden AND NOT i.is_closed AND NOT m.archived
       ), t AS (SELECT COALESCE($1::date, CURRENT_DATE) AS today)
       SELECT
         (SELECT COUNT(*) FROM open_items)::int AS open,
         (SELECT COUNT(*) FROM open_items, t WHERE due < t.today)::int AS overdue,
         (SELECT COUNT(*) FROM open_items, t WHERE due >= t.today AND due <= t.today + (CASE stage
            WHEN 'maintenance' THEN $2::int WHEN 'sou' THEN $3::int ELSE $4::int END))::int AS due_soon,
         (SELECT COUNT(*) FROM open_items WHERE ready_to_bill AND NOT invoiced)::int AS ready_to_bill,
         (SELECT COUNT(*) FROM trademark_docket_items WHERE NOT is_hidden AND is_closed AND NOT invoiced
            AND (reported OR ready_to_bill OR services_entered OR expenses_entered))::int AS unbilled_closed,
         (SELECT COUNT(*) FROM trademark_docket_items i JOIN trademark_matters m ON m.id = i.matter_id
            WHERE NOT i.is_hidden AND NOT i.is_closed AND (i.needs_review OR m.needs_review))::int AS review,
         (SELECT COUNT(*) FROM trademark_todos WHERE NOT is_hidden AND status <> 'done')::int AS open_todos,
         (SELECT COUNT(*) FROM trademark_billing_questions WHERE NOT is_resolved)::int AS open_questions,
         (SELECT COALESCE(json_object_agg(stage, n), '{}') FROM
            (SELECT stage, COUNT(*)::int AS n FROM open_items GROUP BY stage) s) AS by_stage,
         (SELECT COALESCE(json_object_agg(client_id, n), '{}') FROM
            (SELECT client_id, COUNT(*)::int AS n FROM open_items WHERE client_id IS NOT NULL GROUP BY client_id) c) AS by_client`,
      [today, tm.DUE_SOON_DAYS.maintenance, tm.DUE_SOON_DAYS.sou, tm.DUE_SOON_DAYS.default]
    );
    const r = rows[0];
    res.json({
      open: r.open,
      overdue: r.overdue,
      dueSoon: r.due_soon,
      readyToBill: r.ready_to_bill,
      unbilledClosed: r.unbilled_closed,
      review: r.review,
      openTodos: r.open_todos,
      openQuestions: r.open_questions,
      byStage: r.by_stage,
      byClient: r.by_client,
    });
  }));

  // ---- Items -----------------------------------------------------------------
  app.get(`${base}/items`, handle(async (req, res) => {
    const { view, where, params, order } = buildItemFilters(req.query);
    if (view === "stage" && !req.query.stage) throw new ValidationError("Stage is required for this view.");
    if (view === "portfolio" && !req.query.clientId) throw new ValidationError("Client is required for this view.");
    const max = view === "closed" || view === "unbilled_closed" ? 200 : 2000;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || max, 1), max);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { rows } = await query(
      `${ITEM_SELECT} WHERE ${where.join(" AND ")} ${order} LIMIT ${limit + 1} OFFSET ${offset}`,
      params
    );
    res.json({ items: rows.slice(0, limit).map(mapItem), hasMore: rows.length > limit, offset, limit });
  }));

  app.get(`${base}/items/hidden`, handle(async (req, res) => {
    const { rows } = await query(`${ITEM_SELECT} WHERE i.is_hidden ORDER BY i.updated_at DESC LIMIT 200`);
    res.json({ items: rows.map(mapItem) });
  }));

  app.get(`${base}/items/:id`, handle(async (req, res) => {
    const item = await loadItem(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found." });
    const [deadlines, history] = await Promise.all([
      query(
        `SELECT id, label, ${d("due_date")} AS due_date, source_text, is_done, needs_review
         FROM trademark_item_deadlines WHERE item_id = $1 AND NOT is_hidden ORDER BY due_date NULLS LAST, created_at`,
        [req.params.id]
      ),
      query(
        `SELECT a.action, a.user_email, a.created_at, u.name AS user_name
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.entity_type = 'trademark_item' AND a.entity_id = $1
         ORDER BY a.created_at DESC LIMIT 50`,
        [req.params.id]
      ),
    ]);
    res.json({
      item,
      deadlines: deadlines.rows.map((r) => ({
        id: r.id, label: r.label, dueDate: r.due_date, sourceText: r.source_text, isDone: r.is_done, needsReview: r.needs_review,
      })),
      suggestions: tm.suggestDeadlines(
        item.actionType,
        {
          triggerDate: item.triggerDate,
          noaDate: item.matter.noaDate,
          registrationDate: item.matter.registrationDate,
          responseDueDate: item.responseDueDate,
          internalDueDate: item.internalDueDate,
        },
        { todayIso: todayParam(req) }
      ),
      history: history.rows.map((h) => ({ action: h.action, by: h.user_name || h.user_email, at: h.created_at })),
    });
  }));

  // Create an item on an existing matter (matterId) or a new/existing matter by number.
  app.post(`${base}/items`, handle(async (req, res) => {
    const body = req.body || {};
    const fields = validateItemFields(body, { create: true });
    const matterId = uuidField(body.matterId, "matter");
    const matterInput = body.matter || {};
    if (!matterId && !textField(matterInput.matterNo, "Matter no.")) {
      throw new ValidationError("Choose a matter or enter a matter number.");
    }
    const actor = actorOf(req);
    const result = await withTransaction(async (db) => {
      let resolvedMatterId = matterId;
      let createdMatter = false;
      if (!resolvedMatterId) {
        const mn = tm.normalizeMatterNo(matterInput.matterNo);
        const existing = await db.query("SELECT id FROM trademark_matters WHERE matter_no_norm = $1", [mn.norm]);
        if (existing.rows.length) {
          resolvedMatterId = existing.rows[0].id;
        } else {
          let clientId = uuidField(matterInput.clientId, "client") || null;
          const clientName = textField(matterInput.clientName, "Client");
          if (!clientId && clientName) {
            const norm = tm.normalizeClientName(clientName);
            const found = await db.query("SELECT id FROM trademark_clients WHERE normalized_name = $1", [norm]);
            if (found.rows.length) {
              clientId = found.rows[0].id;
            } else {
              const insClient = buildInsert("trademark_clients", { name: clientName, normalized_name: norm }, actor);
              clientId = (await db.query(insClient.text, insClient.values)).rows[0].id;
            }
          }
          const ins = buildInsert(
            "trademark_matters",
            {
              matter_no: mn.norm,
              matter_no_norm: mn.norm,
              matter_family: mn.family,
              parent_matter_no_norm: mn.parentNorm,
              jurisdiction: textField(matterInput.jurisdiction, "Jurisdiction") || mn.jurisdiction || "US",
              client_id: clientId,
              mark_text: textField(matterInput.markText, "Mark") || fields.brand || null,
            },
            actor
          );
          resolvedMatterId = (await db.query(ins.text, ins.values)).rows[0].id;
          createdMatter = true;
        }
      }
      const ins = buildInsert("trademark_docket_items", { ...fields, matter_id: resolvedMatterId }, actor);
      const itemId = (await db.query(ins.text, ins.values)).rows[0].id;
      return { itemId, matterId: resolvedMatterId, createdMatter };
    });
    const item = await loadItem(result.itemId);
    if (result.createdMatter) {
      await writeAuditLog(req, { action: "trademark.matter.create", entityType: "trademark_matter", entityId: result.matterId, after: item.matter });
    }
    await writeAuditLog(req, { action: "trademark.item.create", entityType: "trademark_item", entityId: result.itemId, after: item });
    res.status(201).json({ item });
  }));

  app.put(`${base}/items/:id`, handle(async (req, res) => {
    const fields = validateItemFields(req.body || {});
    if (!Object.keys(fields).length) throw new ValidationError("Nothing to update.");
    const before = await loadItem(req.params.id);
    if (!before) return res.status(404).json({ error: "Item not found." });
    const upd = buildUpdate("trademark_docket_items", req.params.id, fields, actorOf(req));
    await query(upd.text, upd.values);
    const after = await loadItem(req.params.id);
    await writeAuditLog(req, { action: "trademark.item.update", entityType: "trademark_item", entityId: req.params.id, before, after });
    res.json({ item: after });
  }));

  app.put(`${base}/items/:id/state`, handle(async (req, res) => {
    const body = req.body || {};
    const workState = enumField(body.workState, tm.WORK_STATE_KEYS, "work state");
    const isClosed = boolField(body.isClosed, "Closed");
    const isHidden = boolField(body.isHidden, "Hidden");
    if (workState === undefined && isClosed === undefined && isHidden === undefined) {
      throw new ValidationError("Nothing to update.");
    }
    const before = await loadItem(req.params.id);
    if (!before) return res.status(404).json({ error: "Item not found." });
    if (isClosed === true && !before.isClosed && tm.hasUnbilledActivity(before) && body.confirmUnbilled !== true) {
      return res.status(409).json({
        error: "This item has billing activity but isn't invoiced yet. Close it anyway?",
        code: "UNBILLED",
      });
    }
    const actor = actorOf(req);
    const fields = {};
    if (workState !== undefined) fields.work_state = workState;
    if (isHidden !== undefined) fields.is_hidden = isHidden;
    if (isClosed !== undefined && isClosed !== before.isClosed) {
      fields.is_closed = isClosed;
      fields.closed_at = isClosed ? new Date() : null;
      fields.closed_by = isClosed ? actor : null;
    }
    if (Object.keys(fields).length) {
      const upd = buildUpdate("trademark_docket_items", req.params.id, fields, actor);
      await query(upd.text, upd.values);
    }
    const after = await loadItem(req.params.id);
    let action = "trademark.item.state";
    if (isHidden === true && !before.isHidden) action = "trademark.item.hide";
    else if (isHidden === false && before.isHidden) action = "trademark.item.unhide";
    else if (fields.is_closed === true) action = "trademark.item.close";
    else if (fields.is_closed === false) action = "trademark.item.reopen";
    await writeAuditLog(req, { action, entityType: "trademark_item", entityId: req.params.id, before, after });
    res.json({ item: after });
  }));

  app.put(`${base}/items/:id/billing`, handle(async (req, res) => {
    const body = req.body || {};
    const fields = {};
    [
      ["reported", "reported"],
      ["readyToBill", "ready_to_bill"],
      ["servicesEntered", "services_entered"],
      ["expensesEntered", "expenses_entered"],
      ["invoiced", "invoiced"],
    ].forEach(([key, col]) => {
      const v = boolField(body[key], key);
      if (v !== undefined) fields[col] = v;
    });
    const cost = textField(body.costEstimate, "Cost estimate");
    if (cost !== undefined) fields.cost_estimate = cost;
    if (!Object.keys(fields).length) throw new ValidationError("Nothing to update.");
    const before = await loadItem(req.params.id);
    if (!before) return res.status(404).json({ error: "Item not found." });
    if (fields.invoiced === true && !before.invoiced) fields.invoiced_at = new Date();
    if (fields.invoiced === false) fields.invoiced_at = null;
    const upd = buildUpdate("trademark_docket_items", req.params.id, fields, actorOf(req));
    await query(upd.text, upd.values);
    const after = await loadItem(req.params.id);
    await writeAuditLog(req, { action: "trademark.item.billing", entityType: "trademark_item", entityId: req.params.id, before, after });
    res.json({ item: after });
  }));

  app.put(`${base}/items/:id/review`, handle(async (req, res) => {
    const before = await loadItem(req.params.id);
    if (!before) return res.status(404).json({ error: "Item not found." });
    const actor = actorOf(req);
    const includeMatter = req.body?.includeMatter === true;
    await withTransaction(async (db) => {
      await db.query(
        `UPDATE trademark_docket_items SET needs_review = FALSE, review_reasons = '{}', updated_at = NOW(), updated_by = $2 WHERE id = $1`,
        [req.params.id, actor]
      );
      if (includeMatter) {
        await db.query(
          `UPDATE trademark_matters SET needs_review = FALSE, review_reasons = '{}', updated_at = NOW(), updated_by = $2 WHERE id = $1`,
          [before.matterId, actor]
        );
      }
    });
    const after = await loadItem(req.params.id);
    await writeAuditLog(req, { action: "trademark.item.review", entityType: "trademark_item", entityId: req.params.id, before, after });
    res.json({ item: after });
  }));

  // ---- Extra deadlines ---------------------------------------------------------
  const DEADLINE_FIELDS = {
    label: ["label", (v) => textField(v, "Label")],
    dueDate: ["due_date", (v) => dateField(v, "Due date")],
    sourceText: ["source_text", (v) => textField(v, "Note")],
    isDone: ["is_done", (v) => boolField(v, "Done")],
    isHidden: ["is_hidden", (v) => boolField(v, "Hidden")],
    needsReview: ["needs_review", (v) => boolField(v, "Needs review")],
  };

  app.post(`${base}/items/:id/deadlines`, handle(async (req, res) => {
    const fields = pickFields(req.body || {}, DEADLINE_FIELDS);
    if (!fields.label) throw new ValidationError("Label is required.");
    const item = await loadItem(req.params.id);
    if (!item) return res.status(404).json({ error: "Item not found." });
    const ins = buildInsert("trademark_item_deadlines", { ...fields, item_id: req.params.id }, actorOf(req));
    const id = (await query(ins.text, ins.values)).rows[0].id;
    await writeAuditLog(req, { action: "trademark.deadline.create", entityType: "trademark_item", entityId: req.params.id, after: { id, ...fields } });
    res.status(201).json({ id });
  }));

  app.put(`${base}/deadlines/:id`, handle(async (req, res) => {
    const fields = pickFields(req.body || {}, DEADLINE_FIELDS);
    if (!Object.keys(fields).length) throw new ValidationError("Nothing to update.");
    if ("label" in fields && !fields.label) throw new ValidationError("Label is required.");
    const before = (await query("SELECT * FROM trademark_item_deadlines WHERE id = $1", [req.params.id])).rows[0];
    if (!before) return res.status(404).json({ error: "Deadline not found." });
    const upd = buildUpdate("trademark_item_deadlines", req.params.id, fields, actorOf(req));
    await query(upd.text, upd.values);
    const after = (await query("SELECT * FROM trademark_item_deadlines WHERE id = $1", [req.params.id])).rows[0];
    await writeAuditLog(req, { action: "trademark.deadline.update", entityType: "trademark_item", entityId: before.item_id, before, after });
    res.json({ ok: true });
  }));

  // ---- Matters ---------------------------------------------------------------
  app.get(`${base}/matters`, handle(async (req, res) => {
    const params = [];
    let where = "";
    if (req.query.q) {
      params.push(`%${String(req.query.q).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where = `WHERE m.matter_no ILIKE $1 OR m.mark_text ILIKE $1 OR c.name ILIKE $1 OR m.title ILIKE $1`;
    }
    const { rows } = await query(`${MATTER_SELECT} ${where} ORDER BY m.matter_no NULLS LAST LIMIT 50`, params);
    res.json({ matters: rows.map(mapMatter) });
  }));

  app.get(`${base}/matters/:id`, handle(async (req, res) => {
    const matter = await loadMatter(req.params.id);
    if (!matter) return res.status(404).json({ error: "Matter not found." });
    const { rows } = await query(
      `${ITEM_SELECT} WHERE i.matter_id = $1 AND NOT i.is_hidden
       ORDER BY i.is_closed, COALESCE(i.internal_due_date, i.response_due_date) DESC NULLS LAST`,
      [req.params.id]
    );
    res.json({ matter, items: rows.map(mapItem) });
  }));

  const matterNoFields = (raw) => {
    const mn = tm.normalizeMatterNo(raw);
    if (!mn.norm) throw new ValidationError("Matter number is required.");
    return {
      matter_no: mn.norm,
      matter_no_norm: mn.norm,
      matter_family: mn.family,
      parent_matter_no_norm: mn.parentNorm,
    };
  };

  app.post(`${base}/matters`, handle(async (req, res) => {
    const body = req.body || {};
    const fields = { ...pickFields(body, MATTER_FIELDS), ...matterNoFields(body.matterNo) };
    const ins = buildInsert("trademark_matters", fields, actorOf(req));
    const id = (await query(ins.text, ins.values)).rows[0].id;
    const matter = await loadMatter(id);
    await writeAuditLog(req, { action: "trademark.matter.create", entityType: "trademark_matter", entityId: id, after: matter });
    res.status(201).json({ matter });
  }));

  app.put(`${base}/matters/:id`, handle(async (req, res) => {
    const body = req.body || {};
    const fields = pickFields(body, MATTER_FIELDS);
    if (body.matterNo !== undefined) Object.assign(fields, matterNoFields(body.matterNo));
    const needsReview = boolField(body.needsReview, "Needs review");
    if (needsReview === false) {
      fields.needs_review = false;
      fields.review_reasons = [];
    }
    if (!Object.keys(fields).length) throw new ValidationError("Nothing to update.");
    const before = await loadMatter(req.params.id);
    if (!before) return res.status(404).json({ error: "Matter not found." });
    const upd = buildUpdate("trademark_matters", req.params.id, fields, actorOf(req));
    await query(upd.text, upd.values);
    const after = await loadMatter(req.params.id);
    await writeAuditLog(req, { action: "trademark.matter.update", entityType: "trademark_matter", entityId: req.params.id, before, after });
    res.json({ matter: after });
  }));

  app.put(`${base}/matters/:id/archive`, handle(async (req, res) => {
    const archived = boolField(req.body?.archived, "Archived");
    if (archived === undefined) throw new ValidationError("archived is required.");
    const before = await loadMatter(req.params.id);
    if (!before) return res.status(404).json({ error: "Matter not found." });
    const actor = actorOf(req);
    await query(
      `UPDATE trademark_matters SET archived = $2, archived_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         archived_by = CASE WHEN $2 THEN $3 ELSE NULL END, updated_at = NOW(), updated_by = $3 WHERE id = $1`,
      [req.params.id, archived, actor]
    );
    const after = await loadMatter(req.params.id);
    await writeAuditLog(req, {
      action: archived ? "trademark.matter.archive" : "trademark.matter.reopen",
      entityType: "trademark_matter",
      entityId: req.params.id,
      before,
      after,
    });
    res.json({ matter: after });
  }));

  // ---- Clients ---------------------------------------------------------------
  app.get(`${base}/clients`, handle(async (req, res) => {
    const { rows } = await query(
      `SELECT c.*,
         (SELECT COUNT(*)::int FROM trademark_matters m WHERE m.client_id = c.id) AS matter_count,
         (SELECT COUNT(*)::int FROM trademark_docket_items i JOIN trademark_matters m ON m.id = i.matter_id
           WHERE m.client_id = c.id AND NOT i.is_closed AND NOT i.is_hidden) AS open_item_count
       FROM trademark_clients c
       WHERE ($1::boolean OR NOT c.is_archived)
       ORDER BY c.name`,
      [req.query.includeArchived === "1"]
    );
    res.json({ clients: rows.map(mapClient) });
  }));

  app.post(`${base}/clients`, handle(async (req, res) => {
    const body = req.body || {};
    const name = textField(body.name, "Name");
    if (!name) throw new ValidationError("Name is required.");
    const fields = { ...pickFields(body, CLIENT_FIELDS), name, normalized_name: tm.normalizeClientName(name) || name.toLowerCase() };
    const ins = buildInsert("trademark_clients", fields, actorOf(req));
    const id = (await query(ins.text, ins.values)).rows[0].id;
    const client = mapClient((await query("SELECT * FROM trademark_clients WHERE id = $1", [id])).rows[0]);
    await writeAuditLog(req, { action: "trademark.client.create", entityType: "trademark_client", entityId: id, after: client });
    res.status(201).json({ client });
  }));

  app.put(`${base}/clients/:id`, handle(async (req, res) => {
    const body = req.body || {};
    const fields = pickFields(body, CLIENT_FIELDS);
    const name = textField(body.name, "Name");
    if (body.name !== undefined) {
      if (!name) throw new ValidationError("Name is required.");
      fields.name = name;
    }
    if (boolField(body.needsReview, "Needs review") === false) {
      fields.needs_review = false;
      fields.review_reasons = [];
    }
    if (!Object.keys(fields).length) throw new ValidationError("Nothing to update.");
    const beforeRow = (await query("SELECT * FROM trademark_clients WHERE id = $1", [req.params.id])).rows[0];
    if (!beforeRow) return res.status(404).json({ error: "Client not found." });
    const upd = buildUpdate("trademark_clients", req.params.id, fields, actorOf(req));
    await query(upd.text, upd.values);
    const after = mapClient((await query("SELECT * FROM trademark_clients WHERE id = $1", [req.params.id])).rows[0]);
    await writeAuditLog(req, { action: "trademark.client.update", entityType: "trademark_client", entityId: req.params.id, before: mapClient(beforeRow), after });
    res.json({ client: after });
  }));

  // Admin: fold a duplicate client into another. The duplicate's names become
  // aliases of the target (the importer matches aliases too), then it's deleted.
  app.post(`${base}/clients/:id/merge`, requireAdmin, handle(async (req, res) => {
    const targetId = uuidField(req.body?.targetId, "target client");
    if (!targetId || targetId === req.params.id) throw new ValidationError("Choose a different client to merge into.");
    const result = await withTransaction(async (db) => {
      const source = (await db.query("SELECT * FROM trademark_clients WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      const target = (await db.query("SELECT * FROM trademark_clients WHERE id = $1 FOR UPDATE", [targetId])).rows[0];
      if (!source || !target) return null;
      const moved = await db.query("UPDATE trademark_matters SET client_id = $2, updated_at = NOW() WHERE client_id = $1", [source.id, target.id]);
      const aliases = [...new Set([...(target.aliases || []), source.name, ...(source.aliases || [])])].filter((a) => a !== target.name);
      await db.query(
        `UPDATE trademark_clients
         SET aliases = $2, is_unresponsive = is_unresponsive OR $3, payment_risk = payment_risk OR $4,
             has_portfolio_view = has_portfolio_view OR $5, updated_at = NOW(), updated_by = $6
         WHERE id = $1`,
        [target.id, aliases, source.is_unresponsive, source.payment_risk, source.has_portfolio_view, actorOf(req)]
      );
      await db.query("DELETE FROM trademark_clients WHERE id = $1", [source.id]);
      return { source, target, mattersMoved: moved.rowCount };
    });
    if (!result) return res.status(404).json({ error: "Client not found." });
    await writeAuditLog(req, {
      action: "trademark.client.merge",
      entityType: "trademark_client",
      entityId: targetId,
      before: { source: mapClient(result.source), target: mapClient(result.target) },
      metadata: { mattersMoved: result.mattersMoved },
    });
    res.json({ ok: true, mattersMoved: result.mattersMoved });
  }));

  // ---- To-dos ----------------------------------------------------------------
  const TODO_SELECT = `
    SELECT t.id, t.kind, ${d("t.due_date")} AS due_date, t.due_text, ${d("t.received_date")} AS received_date,
           t.action_item, t.email_subject, t.status, t.status_note, t.assignee_initials, t.assigned_to_user_id,
           u.name AS assigned_to_name, t.matter_id, m.matter_no, t.is_hidden, t.updated_at
    FROM trademark_todos t
    LEFT JOIN trademark_matters m ON m.id = t.matter_id
    LEFT JOIN users u ON u.id = t.assigned_to_user_id`;

  app.get(`${base}/todos`, handle(async (req, res) => {
    const includeDone = req.query.includeDone === "1";
    const { rows } = await query(
      `${TODO_SELECT} WHERE NOT t.is_hidden AND ($1::boolean OR t.status <> 'done')
       ORDER BY t.kind, (t.status = 'done'), t.due_date NULLS LAST, t.created_at`,
      [includeDone]
    );
    res.json({ todos: rows.map(mapTodo) });
  }));

  app.post(`${base}/todos`, handle(async (req, res) => {
    const fields = pickFields(req.body || {}, TODO_FIELDS);
    if (!fields.action_item && !fields.email_subject) throw new ValidationError("Enter an action item.");
    const ins = buildInsert("trademark_todos", fields, actorOf(req));
    const id = (await query(ins.text, ins.values)).rows[0].id;
    const todo = mapTodo((await query(`${TODO_SELECT} WHERE t.id = $1`, [id])).rows[0]);
    await writeAuditLog(req, { action: "trademark.todo.create", entityType: "trademark_todo", entityId: id, after: todo });
    res.status(201).json({ todo });
  }));

  app.put(`${base}/todos/:id`, handle(async (req, res) => {
    const fields = pickFields(req.body || {}, TODO_FIELDS);
    if (!Object.keys(fields).length) throw new ValidationError("Nothing to update.");
    const beforeRow = (await query(`${TODO_SELECT} WHERE t.id = $1`, [req.params.id])).rows[0];
    if (!beforeRow) return res.status(404).json({ error: "To-do not found." });
    const upd = buildUpdate("trademark_todos", req.params.id, fields, actorOf(req));
    await query(upd.text, upd.values);
    const after = mapTodo((await query(`${TODO_SELECT} WHERE t.id = $1`, [req.params.id])).rows[0]);
    await writeAuditLog(req, { action: "trademark.todo.update", entityType: "trademark_todo", entityId: req.params.id, before: mapTodo(beforeRow), after });
    res.json({ todo: after });
  }));

  // ---- Billing questions -----------------------------------------------------
  const BQ_SELECT = `
    SELECT q.*, m.matter_no FROM trademark_billing_questions q
    LEFT JOIN trademark_matters m ON m.id = q.matter_id`;

  app.get(`${base}/billing-questions`, handle(async (req, res) => {
    const includeResolved = req.query.includeResolved === "1";
    const { rows } = await query(
      `${BQ_SELECT} WHERE ($1::boolean OR NOT q.is_resolved) ORDER BY q.is_resolved, q.created_at DESC`,
      [includeResolved]
    );
    res.json({ questions: rows.map(mapQuestion) });
  }));

  app.post(`${base}/billing-questions`, handle(async (req, res) => {
    const fields = pickFields(req.body || {}, BQ_FIELDS);
    if (!fields.question) throw new ValidationError("Question is required.");
    const ins = buildInsert("trademark_billing_questions", fields, actorOf(req));
    const id = (await query(ins.text, ins.values)).rows[0].id;
    const question = mapQuestion((await query(`${BQ_SELECT} WHERE q.id = $1`, [id])).rows[0]);
    await writeAuditLog(req, { action: "trademark.billing_question.create", entityType: "trademark_billing_question", entityId: id, after: question });
    res.status(201).json({ question });
  }));

  app.put(`${base}/billing-questions/:id`, handle(async (req, res) => {
    const fields = pickFields(req.body || {}, BQ_FIELDS);
    if (!Object.keys(fields).length) throw new ValidationError("Nothing to update.");
    if ("question" in fields && !fields.question) throw new ValidationError("Question is required.");
    const beforeRow = (await query(`${BQ_SELECT} WHERE q.id = $1`, [req.params.id])).rows[0];
    if (!beforeRow) return res.status(404).json({ error: "Question not found." });
    const upd = buildUpdate("trademark_billing_questions", req.params.id, fields, actorOf(req));
    await query(upd.text, upd.values);
    const after = mapQuestion((await query(`${BQ_SELECT} WHERE q.id = $1`, [req.params.id])).rows[0]);
    await writeAuditLog(req, {
      action: "trademark.billing_question.update",
      entityType: "trademark_billing_question",
      entityId: req.params.id,
      before: mapQuestion(beforeRow),
      after,
    });
    res.json({ question: after });
  }));
}

module.exports = registerTrademarkRoutes;
module.exports.validateItemFields = validateItemFields;
module.exports.buildItemFilters = buildItemFilters;
module.exports.ValidationError = ValidationError;
