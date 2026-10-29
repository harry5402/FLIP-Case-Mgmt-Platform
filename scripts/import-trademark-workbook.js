#!/usr/bin/env node
// Imports the trademark docket workbook into the trademark_* tables.
//
//   node scripts/import-trademark-workbook.js <workbook.xlsx> [--commit] [--aliases aliases.json] [--report report.json]
//                                             [--overwrite-app-edits]
//
// Dry run by default: the whole import runs inside a transaction that is rolled
// back, so the counts are exact but nothing is saved. --commit saves it.
// Safe to re-run: rows are matched by import key. A re-run inserts new rows and
// refreshes rows that changed in the workbook, but never overwrites anything
// edited in the app (updated_by <> 'workbook-import').
// --overwrite-app-edits makes the workbook win over app edits too (requires
// --report): every overwritten record's before/after goes to the report and to
// audit_logs (trademark.import.overwrite). Hidden items and items missing from
// the workbook are never changed — the latter are listed in the report.
// Output contains counts only; client names are written only to the optional
// --report file, which should live outside the repo.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { buildImportPlan } = require("../lib/trademark-import");
const { normalizeClientName } = require("../lib/trademark");
const { syncItemTaskMirrors } = require("../lib/trademark-tasks");

const IMPORT_ACTOR = "workbook-import";

const parseArgs = (argv) => {
  const args = { file: null, commit: false, aliases: null, report: null, overwriteAppEdits: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--commit") args.commit = true;
    else if (a === "--overwrite-app-edits") args.overwriteAppEdits = true;
    else if (a === "--aliases") args.aliases = argv[(i += 1)];
    else if (a === "--report") args.report = argv[(i += 1)];
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!args.file) args.file = a;
  }
  return args;
};

const toPrimitive = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join("");
    if ("result" in value) return toPrimitive(value.result);
    if ("text" in value) return toPrimitive(value.text);
    if ("error" in value) return null;
    return null;
  }
  return value;
};

const readWorkbook = async (file) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets.map((ws) => {
    const colCount = ws.columnCount;
    const hiddenColumns = new Set();
    for (let c = 1; c <= colCount; c += 1) {
      if (ws.getColumn(c).hidden) hiddenColumns.add(c - 1);
    }
    const rows = [];
    for (let r = 1; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r);
      const values = [];
      for (let c = 1; c <= colCount; c += 1) values.push(toPrimitive(row.getCell(c).value));
      rows.push({ number: r, hidden: Boolean(row.hidden), values });
    }
    return { name: ws.name, state: ws.state, rows, hiddenColumns, merges: ws.model.merges || [] };
  });
};

const ITEM_COLUMNS = {
  matter_id: (i, ctx) => ctx.matterIds.get(i.matterKey),
  stage: (i) => i.stage,
  action_type: (i) => i.actionType,
  action_label: (i) => i.actionLabel,
  brand: (i) => i.brand,
  internal_due_date: (i) => i.internalDueDate,
  internal_due_text: (i) => i.internalDueText,
  response_due_date: (i) => i.responseDueDate,
  response_due_text: (i) => i.responseDueText,
  client_due_date: (i) => i.clientDueDate,
  client_due_text: (i) => i.clientDueText,
  received_date: (i) => i.receivedDate,
  work_state: (i) => i.workState,
  comment: (i) => i.comment,
  client_comment: (i) => i.clientComment,
  meeting_notes: (i) => i.meetingNotes,
  reported: (i) => Boolean(i.reported),
  ready_to_bill: (i) => Boolean(i.readyToBill),
  services_entered: (i) => Boolean(i.servicesEntered),
  expenses_entered: (i) => Boolean(i.expensesEntered),
  invoiced: (i) => Boolean(i.invoiced),
  cost_estimate: (i) => i.costEstimate || null,
  is_closed: (i) => Boolean(i.isClosed),
  needs_review: (i) => i.reviews.length > 0,
  review_reasons: (i) => i.reviews,
  source: () => "workbook",
  source_tab: (i) => i.sourceTab,
  source_row: (i) => i.sourceRow,
  import_key: (i) => i.importKey,
  import_hash: (i) => i.importHash,
  import_batch_id: (i, ctx) => ctx.batchId,
  extra: (i) => JSON.stringify(i.extra || {}),
  updated_by: () => IMPORT_ACTOR,
};

const insertSql = (table, cols) =>
  `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, n) => `$${n + 1}`).join(", ")}) RETURNING id`;
const updateSql = (table, cols) =>
  `UPDATE ${table} SET ${cols.map((c, n) => `${c} = $${n + 2}`).join(", ")}, updated_at = NOW() WHERE id = $1`;

class DryRunRollback extends Error {}

// Columns that only track where a row came from; never reported as changes.
const BOOKKEEPING_COLUMNS = new Set([
  "source", "source_tab", "source_row", "import_key", "import_hash", "import_batch_id", "updated_by",
]);
const DATE_COLUMNS = new Set(["internal_due_date", "response_due_date", "client_due_date", "received_date"]);
const BILLING_COLUMNS = ["reported", "ready_to_bill", "services_entered", "expenses_entered", "invoiced", "cost_estimate"];

// Order-independent string form so jsonb/array/date values compare by content.
const canonical = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && /^[[{]/.test(v.trim())) {
    try {
      return canonical(JSON.parse(v));
    } catch (err) {
      return v;
    }
  }
  if (Array.isArray(v)) return JSON.stringify(v.map(canonical));
  if (typeof v === "object") {
    return JSON.stringify(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  }
  return String(v);
};

// { column: { before, after } } for columns whose value would change.
const diffColumns = (before, after) => {
  const changes = {};
  Object.keys(after).forEach((col) => {
    if (BOOKKEEPING_COLUMNS.has(col)) return;
    if (canonical(before[col]) !== canonical(after[col])) changes[col] = { before: before[col] ?? null, after: after[col] ?? null };
  });
  return changes;
};

const itemBeforeSql = (cols) =>
  `SELECT ${cols.map((c) => (DATE_COLUMNS.has(c) ? `to_char(${c}, 'YYYY-MM-DD') AS ${c}` : c)).join(", ")}
   FROM trademark_docket_items WHERE id = $1`;

const auditOverwrite = (db, entityType, entityId, changes) => {
  const before = {};
  const after = {};
  Object.entries(changes).forEach(([col, v]) => {
    before[col] = v.before;
    after[col] = v.after;
  });
  return db.query(
    `INSERT INTO audit_logs (user_email, action, entity_type, entity_id, before_data, after_data)
     VALUES ($1, 'trademark.import.overwrite', $2, $3, $4::jsonb, $5::jsonb)`,
    [IMPORT_ACTOR, entityType, entityId, JSON.stringify(before), JSON.stringify(after)]
  );
};

// details (optional) collects record-level changes for the --report file:
// { changes: [{ entity, id, label, overwrote, fields }], notInWorkbook: [...] }.
const writePlan = async (db, plan, { batchId, overwriteAppEdits = false, details = null }) => {
  const record = (entry) => details && details.changes.push(entry);
  const counts = {
    clients: { inserted: 0, updated: 0, unchanged: 0, appEdited: 0, overwritten: 0 },
    matters: { inserted: 0, updated: 0, appEdited: 0, overwritten: 0 },
    items: { inserted: 0, updated: 0, unchanged: 0, appEdited: 0, overwritten: 0, notInWorkbook: 0, appCreated: 0 },
    deadlines: { inserted: 0, existing: 0 },
    todos: { inserted: 0, existing: 0 },
    billingQuestions: { inserted: 0, existing: 0 },
  };

  // ---- Clients ----
  // Match on aliases too, so clients merged in the app stay merged on re-import.
  const clientRows = (await db.query("SELECT id, normalized_name, updated_by, aliases FROM trademark_clients")).rows;
  const existingClients = new Map();
  clientRows.forEach((r) => (r.aliases || []).forEach((alias) => existingClients.set(normalizeClientName(alias), r)));
  clientRows.forEach((r) => existingClients.set(r.normalized_name, r));
  const clientIds = new Map();
  for (const c of plan.clients) {
    const found = existingClients.get(c.norm);
    if (!found) {
      const { rows } = await db.query(
        `INSERT INTO trademark_clients
           (name, normalized_name, aliases, has_portfolio_view, is_unresponsive, payment_risk, contact_note,
            needs_review, review_reasons, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [c.name, c.norm, c.aliases, c.hasPortfolioView, c.isUnresponsive, c.paymentRisk, c.contactNote,
          c.reviews.length > 0, c.reviews, IMPORT_ACTOR]
      );
      clientIds.set(c.norm, rows[0].id);
      counts.clients.inserted += 1;
    } else {
      clientIds.set(c.norm, found.id);
      const appEdited = found.updated_by !== IMPORT_ACTOR;
      if (appEdited && !overwriteAppEdits) {
        counts.clients.appEdited += 1;
        continue;
      }
      const before = (await db.query(
        "SELECT name, has_portfolio_view, is_unresponsive, payment_risk, contact_note FROM trademark_clients WHERE id = $1",
        [found.id]
      )).rows[0];
      const changes = diffColumns(before, {
        has_portfolio_view: before.has_portfolio_view || c.hasPortfolioView,
        is_unresponsive: c.isUnresponsive,
        payment_risk: c.paymentRisk,
        contact_note: before.contact_note ?? c.contactNote ?? null,
      });
      if (appEdited && !Object.keys(changes).length) {
        counts.clients.appEdited += 1;
        continue;
      }
      await db.query(
        `UPDATE trademark_clients
         SET aliases = (SELECT ARRAY(SELECT DISTINCT unnest(aliases || $2::text[]))),
             has_portfolio_view = has_portfolio_view OR $3,
             is_unresponsive = $4, payment_risk = $5,
             contact_note = COALESCE(contact_note, $6), updated_by = $7, updated_at = NOW()
         WHERE id = $1`,
        [found.id, c.aliases, c.hasPortfolioView, c.isUnresponsive, c.paymentRisk, c.contactNote, IMPORT_ACTOR]
      );
      if (appEdited) {
        counts.clients.overwritten += 1;
        await auditOverwrite(db, "trademark_client", found.id, changes);
      } else {
        counts.clients.updated += 1;
      }
      if (Object.keys(changes).length) {
        record({ entity: "client", id: found.id, label: before.name, overwrote: appEdited, fields: changes });
      }
    }
  }

  // ---- Matters ----
  const existingMatters = (await db.query(
    "SELECT id, matter_no_norm, synthetic_key, updated_by FROM trademark_matters"
  )).rows;
  const byNorm = new Map(existingMatters.filter((m) => m.matter_no_norm).map((m) => [m.matter_no_norm, m]));
  const bySynthetic = new Map(existingMatters.filter((m) => m.synthetic_key).map((m) => [m.synthetic_key, m]));
  const matterIds = new Map();
  for (const m of plan.matters) {
    const found = m.norm ? byNorm.get(m.norm) : bySynthetic.get(m.syntheticKey);
    const values = [
      m.matterNo, m.norm, m.syntheticKey, m.family, m.parentNorm,
      m.clientNorm ? clientIds.get(m.clientNorm) : null, m.clientRef, m.jurisdiction, m.markText,
      m.niceClasses, m.title, m.applicationStatus, m.proceedingNo, m.reviews.length > 0, m.reviews,
    ];
    if (!found) {
      const { rows } = await db.query(
        `INSERT INTO trademark_matters
           (matter_no, matter_no_norm, synthetic_key, matter_family, parent_matter_no_norm, client_id, client_ref,
            jurisdiction, mark_text, nice_classes, title, application_status, proceeding_no, needs_review,
            review_reasons, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'${IMPORT_ACTOR}') RETURNING id`,
        values
      );
      matterIds.set(m.key, rows[0].id);
      counts.matters.inserted += 1;
    } else {
      matterIds.set(m.key, found.id);
      const appEdited = found.updated_by !== IMPORT_ACTOR;
      if (appEdited && !overwriteAppEdits) {
        counts.matters.appEdited += 1;
        continue;
      }
      const matterCols = [
        "matter_no", "matter_no_norm", "synthetic_key", "matter_family", "parent_matter_no_norm", "client_id", "client_ref",
        "jurisdiction", "mark_text", "nice_classes", "title", "application_status", "proceeding_no", "needs_review",
        "review_reasons",
      ];
      const before = (await db.query(`SELECT ${matterCols.join(", ")} FROM trademark_matters WHERE id = $1`, [found.id])).rows[0];
      const changes = diffColumns(before, Object.fromEntries(matterCols.map((col, n) => [col, values[n]])));
      if (appEdited && !Object.keys(changes).length) {
        counts.matters.appEdited += 1;
        continue;
      }
      await db.query(
        `UPDATE trademark_matters
         SET matter_no=$2, matter_no_norm=$3, synthetic_key=$4, matter_family=$5, parent_matter_no_norm=$6,
             client_id=$7, client_ref=$8, jurisdiction=$9, mark_text=$10, nice_classes=$11, title=$12,
             application_status=$13, proceeding_no=$14, needs_review=$15, review_reasons=$16,
             updated_by='${IMPORT_ACTOR}', updated_at=NOW()
         WHERE id=$1`,
        [found.id, ...values]
      );
      if (appEdited) {
        counts.matters.overwritten += 1;
        await auditOverwrite(db, "trademark_matter", found.id, changes);
      } else {
        counts.matters.updated += 1;
      }
      if (Object.keys(changes).length) {
        record({ entity: "matter", id: found.id, label: before.matter_no, overwrote: appEdited, fields: changes });
      }
    }
  }

  // ---- Items ----
  const existingItems = new Map(
    (await db.query(
      "SELECT id, import_key, import_hash, updated_by FROM trademark_docket_items WHERE import_key IS NOT NULL"
    )).rows.map((r) => [r.import_key, r])
  );
  const ctx = { matterIds, batchId };
  const cols = Object.keys(ITEM_COLUMNS);
  const itemIds = new Map();
  const planKeys = new Set();
  // Items with assignable tasks get their My Tasks copies rebuilt if they change.
  const itemsWithTasks = new Set(
    (await db.query("SELECT DISTINCT item_id FROM trademark_item_tasks")).rows.map((r) => r.item_id)
  );
  for (const item of plan.items) {
    planKeys.add(item.importKey);
    const values = cols.map((c) => ITEM_COLUMNS[c](item, ctx));
    const found = existingItems.get(item.importKey);
    if (!found) {
      const { rows } = await db.query(insertSql("trademark_docket_items", cols), values);
      itemIds.set(item.importKey, rows[0].id);
      counts.items.inserted += 1;
    } else {
      itemIds.set(item.importKey, found.id);
      const appEdited = found.updated_by !== IMPORT_ACTOR;
      if (appEdited && !overwriteAppEdits) {
        counts.items.appEdited += 1;
        continue;
      }
      if (!appEdited && found.import_hash === item.importHash) {
        counts.items.unchanged += 1;
        continue;
      }
      const before = (await db.query(itemBeforeSql(cols), [found.id])).rows[0];
      const changes = diffColumns(before, Object.fromEntries(cols.map((col, n) => [col, values[n]])));
      if (appEdited && !Object.keys(changes).length) {
        counts.items.appEdited += 1;
        continue;
      }
      await db.query(updateSql("trademark_docket_items", cols), [found.id, ...values]);
      if (appEdited) {
        counts.items.overwritten += 1;
        await auditOverwrite(db, "trademark_item", found.id, changes);
      } else {
        counts.items.updated += 1;
      }
      if (Object.keys(changes).length) {
        record({ entity: "item", id: found.id, label: item.importKey, overwrote: appEdited, fields: changes });
      }
      if (itemsWithTasks.has(found.id)) await syncItemTaskMirrors(db, found.id);
    }
  }
  existingItems.forEach((_, key) => {
    if (!planKeys.has(key)) counts.items.notInWorkbook += 1;
  });
  // Items in FLIP that this workbook doesn't cover (never changed; listed for review).
  const missing = (await db.query(
    `SELECT i.id, i.import_key, m.matter_no, COALESCE(i.brand, m.mark_text, m.title) AS brand, i.stage,
            i.is_closed, (i.import_key IS NULL) AS created_in_app
     FROM trademark_docket_items i JOIN trademark_matters m ON m.id = i.matter_id
     WHERE NOT i.is_hidden AND (i.import_key IS NULL OR NOT (i.import_key = ANY($1::text[])))
     ORDER BY m.matter_no, i.stage`,
    [[...planKeys]]
  )).rows;
  counts.items.appCreated = missing.filter((r) => r.created_in_app).length;
  if (details) details.notInWorkbook = missing;

  // ---- Extra deadlines (insert-only) ----
  const existingDeadlineKeys = new Set(
    (await db.query("SELECT import_key FROM trademark_item_deadlines WHERE import_key IS NOT NULL")).rows.map((r) => r.import_key)
  );
  for (const item of plan.items) {
    for (const d of item.deadlines) {
      if (existingDeadlineKeys.has(d.importKey)) {
        counts.deadlines.existing += 1;
        continue;
      }
      await db.query(
        `INSERT INTO trademark_item_deadlines (item_id, label, due_date, source_text, needs_review, import_key, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [itemIds.get(item.importKey), d.label, d.date, d.sourceText, Boolean(d.needsReview), d.importKey, IMPORT_ACTOR]
      );
      counts.deadlines.inserted += 1;
    }
  }

  const matterIdForNorm = (norm) => (norm ? matterIds.get(`no:${norm}`) || byNorm.get(norm)?.id || null : null);

  // ---- To-dos and billing questions (insert-only; edited in the app afterwards) ----
  const existingTodoKeys = new Set(
    (await db.query("SELECT import_key FROM trademark_todos WHERE import_key IS NOT NULL")).rows.map((r) => r.import_key)
  );
  for (const t of plan.todos) {
    if (existingTodoKeys.has(t.importKey)) {
      counts.todos.existing += 1;
      continue;
    }
    await db.query(
      `INSERT INTO trademark_todos
         (kind, due_date, due_text, received_date, action_item, email_subject, status, status_note,
          assignee_initials, matter_id, import_key, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [t.kind, t.dueDate, t.dueText, t.receivedDate, t.actionItem, t.emailSubject, t.status, t.statusNote,
        t.assigneeInitials, matterIdForNorm(t.matterNorm), t.importKey, IMPORT_ACTOR]
    );
    counts.todos.inserted += 1;
  }
  const existingBqKeys = new Set(
    (await db.query("SELECT import_key FROM trademark_billing_questions WHERE import_key IS NOT NULL")).rows.map((r) => r.import_key)
  );
  for (const q of plan.billingQuestions) {
    if (existingBqKeys.has(q.importKey)) {
      counts.billingQuestions.existing += 1;
      continue;
    }
    await db.query(
      `INSERT INTO trademark_billing_questions (matter_id, matter_no_text, scope, question, answer, import_key, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [matterIdForNorm(q.matterNorm), q.matterText, q.scope, q.question, q.answer, q.importKey, IMPORT_ACTOR]
    );
    counts.billingQuestions.inserted += 1;
  }

  return counts;
};

// Counts only (no client data) — the record-level detail goes to --report.
const summarizeChanges = (details) => {
  const items = details.changes.filter((c) => c.entity === "item");
  const billing = items.filter((c) => BILLING_COLUMNS.some((col) => col in c.fields));
  return {
    itemsChanged: items.length,
    itemsOverwritten: items.filter((c) => c.overwrote).length,
    billingChanged: billing.length,
    invoicedToNotInvoiced: billing.filter((c) => c.fields.invoiced && c.fields.invoiced.before === true && !c.fields.invoiced.after).length,
    closedChanged: items.filter((c) => "is_closed" in c.fields).length,
    notInWorkbook: details.notInWorkbook.length,
  };
};

const printSummary = (plan, counts, { commit, overwriteAppEdits }, details) => {
  const { perTab, reviewCounts, warnings, nearDuplicateClientCount } = plan.summary;
  console.log(`\nTrademark workbook import — ${commit ? "COMMITTED" : "DRY RUN (nothing saved; re-run with --commit)"}${overwriteAppEdits ? " — OVERWRITING APP EDITS" : ""}`);
  if (details) {
    const s = summarizeChanges(details);
    console.log("\nChanges to existing items (details in --report):");
    console.log(`  items changed            ${s.itemsChanged} (${s.itemsOverwritten} were edited in the app)`);
    console.log(`  billing flags changed    ${s.billingChanged} (invoiced -> not invoiced: ${s.invoicedToNotInvoiced})`);
    console.log(`  closed/open changed      ${s.closedChanged}`);
    console.log(`  in FLIP, not in workbook ${s.notInWorkbook} (left as they are)`);
  }
  console.log("\nPer tab (rows read / phantom skipped / imported / closed / flagged):");
  Object.entries(perTab).forEach(([tab, s], n) => {
    console.log(`  tab ${String(n + 1).padStart(2)}: ${s.read} / ${s.phantom} / ${s.imported} / ${s.closed} / ${s.review}`);
  });
  console.log("\nDatabase changes:");
  Object.entries(counts).forEach(([k, v]) => console.log(`  ${k.padEnd(17)} ${JSON.stringify(v)}`));
  console.log("\nNeeds-review flags by reason:");
  Object.entries(reviewCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k.padEnd(28)} ${v}`));
  console.log(`\nNear-duplicate client name pairs: ${nearDuplicateClientCount}${nearDuplicateClientCount ? " (see --report)" : ""}`);
  if (warnings.length) {
    console.log("\nWarnings:");
    warnings.forEach((w) => console.log(`  - ${w.replace(/"[^"]*"/g, (m) => (/status/i.test(w) ? m : '"…"'))}`));
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.log("Usage: node scripts/import-trademark-workbook.js <workbook.xlsx> [--commit] [--aliases aliases.json] [--report report.json] [--overwrite-app-edits]");
    process.exit(args.help ? 0 : 1);
  }
  if (args.overwriteAppEdits && !args.report) {
    console.log("--overwrite-app-edits needs --report <file outside the repo> so every overwritten value is recorded.");
    process.exit(1);
  }
  const file = path.resolve(args.file);
  const aliases = args.aliases ? JSON.parse(fs.readFileSync(args.aliases, "utf8")) : {};
  const sheets = await readWorkbook(file);
  const plan = buildImportPlan(sheets, { aliases });

  // Loaded lazily so `--help` works without DATABASE_URL.
  const { query, withTransaction } = require("../db");
  const { ensureTrademarkTables } = require("../lib/trademark-schema");
  await ensureTrademarkTables(query);

  let counts;
  const details = args.report ? { changes: [], notInWorkbook: [] } : null;
  try {
    await withTransaction(async (db) => {
      let batchId = null;
      if (args.commit) {
        const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
        const { rows } = await db.query(
          `INSERT INTO trademark_import_batches (source_basename, source_sha256, actor) VALUES ($1,$2,$3) RETURNING id`,
          [path.basename(file), sha, process.env.USER || IMPORT_ACTOR]
        );
        batchId = rows[0].id;
      }
      counts = await writePlan(db, plan, { batchId, overwriteAppEdits: args.overwriteAppEdits, details });
      if (!args.commit) throw new DryRunRollback();
      const summary = {
        counts,
        overwriteAppEdits: args.overwriteAppEdits,
        reviewCounts: plan.summary.reviewCounts,
        perTab: Object.values(plan.summary.perTab),
      };
      await db.query(`UPDATE trademark_import_batches SET finished_at = NOW(), summary = $2 WHERE id = $1`, [batchId, JSON.stringify(summary)]);
      await db.query(
        `INSERT INTO audit_logs (user_email, action, entity_type, entity_id, after_data, metadata)
         VALUES ($1, 'trademark.import', 'trademark_import_batch', $2, $3::jsonb, $4::jsonb)`,
        [IMPORT_ACTOR, batchId, JSON.stringify(summary), JSON.stringify({ source: path.basename(file) })]
      );
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }

  printSummary(plan, counts, args, details);
  if (args.report) {
    fs.writeFileSync(
      args.report,
      JSON.stringify(
        {
          committed: args.commit,
          overwriteAppEdits: args.overwriteAppEdits,
          summary: plan.summary,
          counts,
          changeSummary: summarizeChanges(details),
          // Billing changes first so they're easy to review.
          changes: [...details.changes].sort(
            (a, b) =>
              Number(BILLING_COLUMNS.some((c) => c in b.fields)) - Number(BILLING_COLUMNS.some((c) => c in a.fields))
          ),
          notInWorkbook: details.notInWorkbook,
          nearDuplicateClients: plan.nearDuplicateClients,
        },
        null,
        2
      )
    );
    console.log(`\nReport written to ${args.report}`);
  }
  process.exit(0);
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Import failed:", err.message);
    process.exit(1);
  });
}

module.exports = { readWorkbook, writePlan, toPrimitive, diffColumns, summarizeChanges };
