// Importer mapping tests. All rows are synthetic — never commit real workbook data.
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildImportPlan, isPhantomRow } = require("../lib/trademark-import");

const d = (y, m, day) => new Date(Date.UTC(y, m - 1, day));
const sheet = (name, header, rows, extra = {}) => ({
  name,
  state: "visible",
  hiddenColumns: new Set(),
  merges: [],
  rows: [{ number: 1, hidden: false, values: header }, ...rows.map((r, i) => ({ number: i + 2, hidden: false, ...r }))],
  ...extra,
});

const STAGE_HEADER = [
  "Internal Deadline", "Response Deadline", null, "Matter No.", "Client", "Brand", "Comment",
  "Reported", "Ready to Bill", "Services", "Expenses", "Invoiced", "Docket Meeting notes",
];

test("phantom rows (only checkboxes) are skipped", () => {
  assert.equal(isPhantomRow([null, false, false, " ", true]), true);
  assert.equal(isPhantomRow([null, "x", false]), false);
});

test("stage tab rows become items; hidden rows are closed; flags and dates mapped", () => {
  const plan = buildImportPlan([
    sheet("Office Action Response", STAGE_HEADER, [
      { values: [d(2026, 11, 1), d(2026, 12, 1), null, "3T10001", "Client One LLC", "ALPHA", "Reported- awaiting instructions", true, false, false, false, false, "note"] },
      { hidden: true, values: [d(2025, 1, 1), d(2025, 2, 1), null, "3T10002", "Client One", "BETA", "", true, true, true, true, true, null] },
      { values: [null, null, null, null, null, null, null, false, false, false, false, false, null] },
    ]),
  ]);
  assert.equal(plan.items.length, 2);
  const [open, closed] = plan.items;
  assert.equal(open.stage, "office_action");
  assert.equal(open.actionType, "office_action");
  assert.equal(open.internalDueDate, "2026-11-01");
  assert.equal(open.responseDueDate, "2026-12-01");
  assert.equal(open.workState, "awaiting_client");
  assert.equal(open.reported, true);
  assert.equal(open.isClosed, false);
  assert.equal(closed.isClosed, true);
  assert.equal(closed.workState, "done");
  assert.equal(closed.invoiced, true);
  // "Client One LLC" and "Client One" fold into one client
  assert.equal(plan.clients.length, 1);
  assert.equal(plan.summary.perTab["Office Action Response"].phantom, 1);
});

test("import keys are stable across runs and ignore comment edits", () => {
  const rows = (comment) => [
    { values: [d(2026, 11, 1), d(2026, 12, 1), null, "3T10001", "Client", "ALPHA", comment, false, false, false, false, false, null] },
  ];
  const a = buildImportPlan([sheet("SOU", STAGE_HEADER, rows("first"))]);
  const b = buildImportPlan([sheet("SOU", STAGE_HEADER, rows("edited"))]);
  assert.equal(a.items[0].importKey, b.items[0].importKey);
  assert.notEqual(a.items[0].importHash, b.items[0].importHash);
  const again = buildImportPlan([sheet("SOU", STAGE_HEADER, rows("first"))]);
  assert.equal(a.items[0].importHash, again.items[0].importHash);
});

test("duplicate rows for the same matter get distinct keys", () => {
  const row = { values: [d(2026, 1, 1), null, null, "3T10001", "Client", "ALPHA", "", false, false, false, false, false, null] };
  const plan = buildImportPlan([sheet("SOU", STAGE_HEADER, [row, row])]);
  assert.equal(plan.items.length, 2);
  assert.notEqual(plan.items[0].importKey, plan.items[1].importKey);
  assert.equal(plan.matters.length, 1);
});

test("text typed into a checkbox column moves to the comment and is flagged", () => {
  const plan = buildImportPlan([
    sheet("Post -Registration OA", STAGE_HEADER, [
      { values: [d(2026, 1, 1), d(2026, 2, 1), null, "3T10001", "Client", "ALPHA", "orig", false, "call client first", false, false, false, null] },
    ]),
  ]);
  const item = plan.items[0];
  assert.equal(item.stage, "post_reg_oa");
  assert.equal(item.readyToBill, false);
  assert.match(item.comment, /call client first/);
  assert.ok(item.reviews.includes("column_shift"));
});

test("Applications status goes on the matter; 'Reported and billed' becomes billing flags", () => {
  const header = ["Internal Deadline", null, "Matter No.", "Client", "Brand", "Comment", "Status", "Reported", "Ready to Bill", "Services", "Expenses", "Invoiced", "Docket Meeting notes"];
  const plan = buildImportPlan([
    sheet("Applications", header, [
      { values: [d(2026, 1, 1), null, "3T10001", "Client", "ALPHA", "", "Office Action Pending", false, false, false, false, false, null] },
      { values: [d(2026, 1, 1), null, "3T10002", "Client", "BETA", "", "Reported and billed", false, false, false, false, false, null] },
    ]),
  ]);
  const m1 = plan.matters.find((m) => m.norm === "3T10001");
  const m2 = plan.matters.find((m) => m.norm === "3T10002");
  assert.equal(m1.applicationStatus, "Office Action Pending");
  assert.equal(m2.applicationStatus, null);
  const billed = plan.items.find((i) => i.matterKey === "no:3T10002");
  assert.equal(billed.reported, true);
  assert.equal(billed.invoiced, true);
  assert.ok(billed.reviews.includes("reported_and_billed_status"));
});

test("portfolio tabs are detected by header, use the tab name as client and classify Action:", () => {
  const header = ["Internal Deadline", "Response Deadline", "Matter No.", "Client Ref. #", "Brand", "Action:", "Comment",
    "Reported", "Ready to Bill", "Services", "Expenses", "Invoiced", "Docket Meeting notes"];
  const plan = buildImportPlan([
    sheet("Some Agent Firm ", header, [
      { values: [null, d(2027, 3, 4), "FT-123 (UK)", "R-1", "GAMMA", "10-year Renewal", "", false, false, false, false, false, null] },
      { values: [null, null, "3T10003", "R-2", "DELTA", "Use vulnerability deadline 01/02/27; renewal deadline 03/04/28", "", false, false, false, false, false, null] },
      { values: [null, null, "3T10004", "R-3", "EPS", "Abandoned", "", false, false, false, false, false, null] },
    ]),
  ]);
  assert.equal(plan.clients[0].name, "Some Agent Firm");
  assert.equal(plan.clients[0].hasPortfolioView, true);
  const [renewal, textDeadlines, abandoned] = plan.items;
  assert.equal(renewal.actionType, "foreign_renewal");
  assert.equal(renewal.stage, "maintenance");
  assert.equal(plan.matters.find((m) => m.norm === "FT-123").jurisdiction, "UK");
  assert.equal(textDeadlines.deadlines.length, 2);
  assert.ok(textDeadlines.reviews.includes("deadlines_from_text"));
  assert.equal(abandoned.workState, "abandoned");
  assert.equal(plan.matters.find((m) => m.norm === "3T10004").applicationStatus, "Abandoned");
  assert.match(renewal.importKey, /^wb:/);
});

test("N/A matter numbers become synthetic matters flagged for review", () => {
  const header = ["Internal Deadline", null, "Matter No.", "Client", "Brand", "Comment", "Ready to Bill", "Services", "Expenses", "Invoiced", "Docket Meeting notes"];
  const plan = buildImportPlan([
    sheet("Clearance & Strategy", header, [
      { values: [d(2026, 1, 1), null, "N/A", "Client", "ZETA", "Run Neo-Lite search", false, false, false, false, null] },
    ]),
  ]);
  const m = plan.matters[0];
  assert.equal(m.norm, null);
  assert.match(m.syntheticKey, /^na:/);
  assert.ok(m.reviews.includes("no_matter_no"));
  assert.equal(plan.items[0].actionType, "search_neo_lite");
});

test("Ready to bill, billing questions, unresponsive clients, to-dos and status list", () => {
  const plan = buildImportPlan([
    sheet("SOU", STAGE_HEADER, [
      { values: [d(2026, 1, 1), null, null, "3T10001", "Client A", "ALPHA", "", false, false, false, false, false, null] },
    ]),
    sheet("Ready to bill", ["Ref. No.", "Cost Estimate", "Bill"], [
      { values: ["3T10001", "$500", "yes"] },
      { values: ["3T99999", "$100", "yes"] },
    ], { state: "hidden" }),
    sheet("OUTSTANDING BILLING Questions", ["Matter number", "QUESTION", "ANSWER"], [{ values: ["All", "Bill hourly?", null] }]),
    sheet("Unresponsive Clients", ["Unresponsive", "Owes a lot/not paying timely"], [{ values: ["Client A (contact Pat)", "Client B"] }]),
    sheet("To do & Sort", ["Internal Due Date", "Date Received", "Action Item", "Email Subject", "Status"], [
      { values: [d(2026, 2, 1), d(2026, 1, 1), "Draft response", "RE: 3T10001 office action", "Needs to be completed"] },
      { values: ["AB", null, "Check file", "Misc", "Finishing Drafting"] },
    ]),
    { name: "application status list", state: "visible", hiddenColumns: new Set(), merges: [], rows: [
      { number: 1, hidden: false, values: ["Abandoned"] },
      { number: 2, hidden: false, values: ["Brand New Status"] },
    ] },
  ]);
  const item = plan.items[0];
  assert.equal(item.readyToBill, true);
  assert.equal(item.costEstimate, "$500");
  assert.equal(plan.billingQuestions.length, 2);
  assert.equal(plan.billingQuestions.find((q) => q.scope === "all").question, "Bill hourly?");
  assert.equal(plan.summary.reviewCounts.ready_to_bill_unmatched, 1);
  const a = plan.clients.find((c) => c.name === "Client A");
  assert.equal(a.isUnresponsive, true);
  assert.equal(a.contactNote, "contact Pat");
  assert.equal(plan.clients.find((c) => c.name === "Client B").paymentRisk, true);
  assert.equal(plan.todos.length, 2);
  assert.equal(plan.todos[0].matterNorm, "3T10001");
  assert.equal(plan.todos[1].assigneeInitials, "AB");
  assert.equal(plan.todos[1].status, "in_progress");
  assert.ok(plan.summary.warnings.some((w) => w.includes("Brand New Status")));
});
