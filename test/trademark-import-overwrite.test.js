// writePlan's --overwrite-app-edits behaviour, with a stubbed database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { writePlan, diffColumns, summarizeChanges } = require("../scripts/import-trademark-workbook");

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const MATTER_ID = "22222222-2222-4222-8222-222222222222";

const planItem = (overrides = {}) => ({
  importKey: "k1",
  importHash: "new-hash",
  matterKey: "no:3T10001",
  stage: "office_action",
  actionType: "office_action",
  actionLabel: "OA",
  brand: "ACME",
  internalDueDate: "2026-11-01",
  responseDueDate: "2026-12-01",
  workState: "open",
  comment: "From workbook",
  reported: false,
  readyToBill: false,
  servicesEntered: false,
  expensesEntered: false,
  invoiced: false,
  isClosed: false,
  reviews: [],
  extra: {},
  deadlines: [],
  ...overrides,
});

const plan = (items = [planItem()]) => ({
  clients: [],
  matters: [{ key: "no:3T10001", norm: "3T10001", matterNo: "3T10001", reviews: [] }],
  items,
  todos: [],
  billingQuestions: [],
});

// Item k1 exists, was last edited in the app, and is invoiced with a different comment.
const makeDb = ({ updatedBy = "tnelson@example.test", withTasks = false, matterUpdatedBy = "workbook-import" } = {}) => {
  const calls = [];
  const query = async (text, params = []) => {
    calls.push({ text, params });
    if (/FROM trademark_matters$/.test(text.trim()) || /SELECT id, matter_no_norm, synthetic_key, updated_by FROM trademark_matters/.test(text)) {
      return { rows: [{ id: MATTER_ID, matter_no_norm: "3T10001", updated_by: matterUpdatedBy }] };
    }
    if (/FROM trademark_matters WHERE id = \$1/.test(text)) return { rows: [{ matter_no: "3T10001", matter_no_norm: "3T10001" }] };
    if (/SELECT id, import_key, import_hash, updated_by FROM trademark_docket_items/.test(text)) {
      return { rows: [{ id: ITEM_ID, import_key: "k1", import_hash: "old-hash", updated_by: updatedBy }] };
    }
    if (/SELECT DISTINCT item_id FROM trademark_item_tasks/.test(text)) return { rows: withTasks ? [{ item_id: ITEM_ID }] : [] };
    if (/FROM trademark_docket_items WHERE id = \$1/.test(text)) {
      return {
        rows: [{
          matter_id: MATTER_ID, stage: "office_action", action_type: "office_action", action_label: "OA", brand: "ACME",
          internal_due_date: "2026-11-01", response_due_date: "2026-12-01", work_state: "open", comment: "Edited in FLIP",
          reported: true, ready_to_bill: true, services_entered: true, expenses_entered: true, invoiced: true,
          is_closed: false, needs_review: false, review_reasons: [], extra: {},
          invoiced_at: "2026-09-30T12:00:00.000Z", closed_at: null, closed_by: null,
        }],
      };
    }
    if (/AS created_in_app/.test(text)) {
      return { rows: [{ id: "x", import_key: null, matter_no: "3T20002", brand: "OTHER", stage: "sou", is_closed: false, created_in_app: true }] };
    }
    if (/SELECT is_hidden OR|AS inactive/.test(text)) return { rows: [{ inactive: false }] };
    return { rows: [], rowCount: 0 };
  };
  return { query, calls };
};

test("without the flag, items edited in the app are left alone", async () => {
  const db = makeDb();
  const details = { changes: [], notInWorkbook: [] };
  const counts = await writePlan(db, plan(), { overwriteAppEdits: false, details });
  assert.equal(counts.items.appEdited, 1);
  assert.equal(counts.items.overwritten, 0);
  assert.ok(!db.calls.some((c) => /UPDATE trademark_docket_items/.test(c.text)));
  assert.ok(!db.calls.some((c) => /trademark\.import\.overwrite/.test(c.text)));
});

test("with the flag, app edits are overwritten, audit-logged and reported (billing first-class)", async () => {
  const db = makeDb();
  const details = { changes: [], notInWorkbook: [] };
  const counts = await writePlan(db, plan(), { overwriteAppEdits: true, details });
  assert.equal(counts.items.overwritten, 1);
  const update = db.calls.find((c) => /UPDATE trademark_docket_items/.test(c.text));
  assert.equal(update.params[0], ITEM_ID);
  assert.ok(update.params.includes("workbook-import"));
  const audit = db.calls.find((c) => /trademark\.import\.overwrite/.test(c.text));
  assert.equal(audit.params[1], "trademark_item");
  assert.equal(JSON.parse(audit.params[3]).invoiced, true);
  assert.equal(JSON.parse(audit.params[4]).invoiced, false);

  const change = details.changes.find((c) => c.entity === "item");
  assert.equal(change.overwrote, true);
  assert.equal(change.label, "3T10001 – ACME – office_action");
  assert.deepEqual(Object.keys(change.fields).sort(), [
    "comment", "expenses_entered", "invoiced", "invoiced_at", "ready_to_bill", "reported", "services_entered",
  ]);
  // invoiced_at follows the flag, as the app's billing action does.
  const stamp = db.calls.find((c) => /SET invoiced_at = \$2/.test(c.text));
  assert.deepEqual(stamp.params, [ITEM_ID, null]);
  assert.equal(change.fields.invoiced_at.before, "2026-09-30T12:00:00.000Z");
  const s = summarizeChanges(details);
  assert.equal(s.billingChanged, 1);
  assert.equal(s.invoicedToNotInvoiced, 1);
  assert.equal(s.notInWorkbook, 1);
});

test("items missing from the workbook are listed, never updated", async () => {
  const db = makeDb();
  const details = { changes: [], notInWorkbook: [] };
  const counts = await writePlan(db, plan(), { overwriteAppEdits: true, details });
  assert.equal(details.notInWorkbook[0].matter_no, "3T20002");
  assert.equal(counts.items.appCreated, 1);
  const missingQuery = db.calls.find((c) => /AS created_in_app/.test(c.text));
  assert.match(missingQuery.text, /NOT i\.is_hidden/);
  assert.deepEqual(missingQuery.params[0], ["k1"]);
});

test("an app-edited item that already matches the workbook keeps its ownership", async () => {
  const db = makeDb();
  const same = planItem({ comment: "Edited in FLIP", reported: true, readyToBill: true, servicesEntered: true, expensesEntered: true, invoiced: true });
  const counts = await writePlan(db, plan([same]), { overwriteAppEdits: true, details: { changes: [], notInWorkbook: [] } });
  assert.equal(counts.items.overwritten, 0);
  assert.equal(counts.items.appEdited, 1);
  assert.ok(!db.calls.some((c) => /UPDATE trademark_docket_items/.test(c.text)));
});

test("overwritten items with tasks get their My Tasks copies rebuilt", async () => {
  const db = makeDb({ withTasks: true });
  await writePlan(db, plan(), { overwriteAppEdits: true, details: { changes: [], notInWorkbook: [] } });
  assert.ok(db.calls.some((c) => /DELETE FROM tasks/.test(c.text)));
});

test("diffColumns ignores bookkeeping columns and compares jsonb/arrays/blank by content", () => {
  const changes = diffColumns(
    { extra: { b: 2, a: 1 }, review_reasons: [], comment: null, import_hash: "x", brand: "A" },
    { extra: JSON.stringify({ a: 1, b: 2 }), review_reasons: [], comment: "", import_hash: "y", brand: "B" }
  );
  assert.deepEqual(changes, { brand: { before: "A", after: "B" } });
});

test("matters edited in the app are overwritten with the flag and audit-logged", async () => {
  const db = makeDb({ matterUpdatedBy: "mbina@example.test" });
  const counts = await writePlan(db, plan(), { overwriteAppEdits: true, details: { changes: [], notInWorkbook: [] } });
  assert.equal(counts.matters.overwritten, 1);
  const update = db.calls.find((c) => /UPDATE trademark_matters/.test(c.text));
  assert.match(update.text, /updated_by='workbook-import'/);
  assert.equal(update.params[0], MATTER_ID);
  assert.ok(db.calls.some((c) => /trademark\.import\.overwrite/.test(c.text) && c.params[1] === "trademark_matter"));

  const skipped = makeDb({ matterUpdatedBy: "mbina@example.test" });
  const without = await writePlan(skipped, plan(), { overwriteAppEdits: false });
  assert.equal(without.matters.appEdited, 1);
  assert.ok(!skipped.calls.some((c) => /UPDATE trademark_matters/.test(c.text)));
});

test("closing via the workbook stamps closed_at/closed_by; the missing-items count matches the list", async () => {
  const db = makeDb();
  const details = { changes: [], notInWorkbook: [] };
  const counts = await writePlan(db, plan([planItem({ isClosed: true })]), { overwriteAppEdits: true, details });
  const closed = db.calls.find((c) => /SET closed_at = \$2, closed_by = \$3/.test(c.text));
  assert.equal(closed.params[2], "workbook-import");
  assert.ok(closed.params[1] instanceof Date);
  assert.equal(counts.items.notInWorkbook + counts.items.appCreated, details.notInWorkbook.length);
});
