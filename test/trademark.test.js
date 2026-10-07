const test = require("node:test");
const assert = require("node:assert/strict");
const tm = require("../lib/trademark");

test("normalizeMatterNo handles suffixes, sub-matters and N/A", () => {
  const a = tm.normalizeMatterNo(" 3t12345.1 (UK) ");
  assert.equal(a.norm, "3T12345.1");
  assert.equal(a.jurisdiction, "UK");
  assert.equal(a.family, "3T");
  assert.equal(a.parentNorm, "3T12345");
  assert.equal(a.valid, true);

  assert.equal(tm.normalizeMatterNo("FT-123/4").valid, true);
  assert.equal(tm.normalizeMatterNo("CS-0042").family, "CS");
  assert.equal(tm.normalizeMatterNo("ST12345NV").valid, true);

  const malformed = tm.normalizeMatterNo("3T123456");
  assert.equal(malformed.valid, false);
  assert.equal(malformed.norm, "3T123456");

  assert.equal(tm.normalizeMatterNo("N/A").missing, true);
  assert.equal(tm.normalizeMatterNo("   ").missing, true);
  assert.equal(tm.normalizeMatterNo(null).norm, null);
});

test("normalizeClientName folds punctuation, ampersands and company suffixes", () => {
  assert.equal(tm.normalizeClientName("Acme  Widgets, LLC"), "acme widgets");
  assert.equal(tm.normalizeClientName("acme widgets llc."), "acme widgets");
  assert.equal(tm.normalizeClientName("Smith & Jones Inc"), "smith and jones");
  assert.equal(tm.isSuspiciousClientName("someone@example.com"), true);
  assert.equal(tm.isSuspiciousClientName("  "), true);
  assert.equal(tm.isSuspiciousClientName("Acme"), false);
});

test("parseLooseDate reads Excel dates as calendar dates without timezone shift", () => {
  assert.equal(tm.parseLooseDate(new Date(Date.UTC(2026, 0, 31))).date, "2026-01-31");
  assert.equal(tm.parseLooseDate(46000).date, "2025-12-09");
});

test("parseLooseDate handles text deadlines", () => {
  const withTask = tm.parseLooseDate("03/04/26 - Follow up with client");
  assert.equal(withTask.date, "2026-03-04");
  assert.equal(withTask.note, "Follow up with client");
  assert.equal(withTask.review, null);

  const grace = tm.parseLooseDate("7/15/2027 (grace period deadline)");
  assert.equal(grace.date, "2027-07-15");
  assert.equal(grace.grace, true);
  assert.equal(grace.note, null);

  const range = tm.parseLooseDate("11/20-12/05", { refYear: 2026 });
  assert.equal(range.date, "2026-12-05");
  assert.equal(range.text, "11/20-12/05");

  const wrap = tm.parseLooseDate("12/20-01/05", { refYear: 2026 });
  assert.equal(wrap.date, "2027-01-05");

  const noYear = tm.parseLooseDate("11/20-12/05");
  assert.equal(noYear.date, null);
  assert.equal(noYear.review, "unparsed_date_text");

  const na = tm.parseLooseDate("Depends on Publication");
  assert.equal(na.date, null);
  assert.equal(na.text, "Depends on Publication");

  const typo = tm.parseLooseDate(new Date(Date.UTC(1930, 4, 1)));
  assert.equal(typo.date, null);
  assert.equal(typo.review, "implausible_date");

  assert.equal(tm.parseLooseDate("02/30/2026").date, null);
  assert.deepEqual(tm.parseLooseDate(true).date, null);
  assert.equal(tm.parseLooseDate(" ").text, null);
});

test("date arithmetic clamps month ends", () => {
  assert.equal(tm.addMonthsClamped("2026-01-31", 1), "2026-02-28");
  assert.equal(tm.addMonthsClamped("2024-01-31", 1), "2024-02-29");
  assert.equal(tm.addMonthsClamped("2026-11-30", 3), "2027-02-28");
  assert.equal(tm.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(tm.daysBetween("2026-10-07", "2026-10-21"), 14);
});

test("effective due prefers internal over response and drives badges", () => {
  assert.equal(tm.effectiveDueDate({ internalDueDate: "2026-10-01", responseDueDate: "2026-11-01" }), "2026-10-01");
  assert.equal(tm.effectiveDueDate({ internalDueDate: null, responseDueDate: "2026-11-01" }), "2026-11-01");
  assert.equal(tm.dueBadge("2026-10-06", "office_action", "2026-10-07"), "overdue");
  assert.equal(tm.dueBadge("2026-10-21", "office_action", "2026-10-07"), "due_soon");
  assert.equal(tm.dueBadge("2026-10-22", "office_action", "2026-10-07"), null);
  assert.equal(tm.dueBadge("2026-12-01", "maintenance", "2026-10-07"), "due_soon");
});

test("classifyAction maps portfolio action text", () => {
  const cases = {
    Declaration: "section_8_15",
    "Affidavit of Continued Use (Sections8&15)": "section_8_15",
    "10-year Renewal": "section_8_9_renewal",
    "Post-Reg. Office Action": "post_reg_office_action",
    "Office Action (NonFinal)": "office_action",
    "Suspension Check": "suspension_check",
    "Compact Plus Search": "search_compact_plus",
    "Neo-lite Search": "search_neo_lite",
    "Availability Search": "search_other",
    "Notice of Allowance": "statement_of_use",
    "Merger & Declaration": "assignment",
    "Change of Name": "change_of_name",
    "Legal Opinion": "legal_opinion",
    "Status Check": "status_check",
  };
  for (const [label, expected] of Object.entries(cases)) {
    assert.equal(tm.classifyAction(label).actionType, expected, label);
  }
  assert.equal(tm.classifyAction("Renewal", { family: "FT" }).actionType, "foreign_renewal");
  assert.equal(tm.classifyAction("Declaration").stage, "maintenance");
  assert.deepEqual(tm.classifyAction("Something new"), { actionType: "other", stage: "other", known: false });
});

test("actionTypeForStage refines by comment", () => {
  assert.equal(tm.actionTypeForStage("sou", { comment: "1st extension filed" }), "extension_of_time");
  assert.equal(tm.actionTypeForStage("maintenance", { comment: "10-year renewal" }), "section_8_9_renewal");
  assert.equal(tm.actionTypeForStage("maintenance", { family: "FT" }), "foreign_renewal");
  assert.equal(tm.actionTypeForStage("contentious", { title: "X v. Y Opposition" }), "opposition");
  assert.equal(tm.actionTypeForStage("clearance", { comment: "Run Neo-Lite search" }), "search_neo_lite");
  assert.equal(tm.actionTypeForStage("clearance", { comment: "Strategy call" }), "clearance_strategy");
});

test("deriveWorkState reads workbook comment conventions", () => {
  assert.equal(tm.deriveWorkState("Filed & reported"), "reported");
  assert.equal(tm.deriveWorkState("Reported- awaiting instructions"), "awaiting_client");
  assert.equal(tm.deriveWorkState("Sent for signature"), "awaiting_signature");
  assert.equal(tm.deriveWorkState("Client instructed to abandon"), "abandoned");
  assert.equal(tm.deriveWorkState(""), "open");
  assert.equal(tm.deriveWorkState("", { hidden: true }), "done");
  assert.equal(tm.deriveWorkState("Filed & reported", { hidden: true }), "reported");
});

test("parseNiceClasses and extractTextDeadlines", () => {
  assert.deepEqual(tm.parseNiceClasses("MARK - 09, 42"), [9, 42]);
  assert.deepEqual(tm.parseNiceClasses("MARK in Class 7"), [7]);
  assert.deepEqual(tm.parseNiceClasses("MARK"), []);
  const found = tm.extractTextDeadlines("Use Vulnerability deadline 01/02/27; renewal deadline 03/04/2028");
  assert.deepEqual(found.map((d) => d.date), ["2027-01-02", "2028-03-04"]);
  assert.equal(found[0].label, "Use Vulnerability");
});

test("suggestDeadlines follows USPTO periods and never invents without anchors", () => {
  const oa = tm.suggestDeadlines("office_action", { triggerDate: "2026-01-31" });
  assert.equal(oa.find((s) => s.field === "responseDueDate").date, "2026-04-30");
  assert.equal(oa.find((s) => s.field === "internalDueDate").date, "2026-03-31");

  const sou = tm.suggestDeadlines("statement_of_use", { noaDate: "2026-02-10" });
  assert.equal(sou.find((s) => s.field === "responseDueDate").date, "2026-08-10");
  assert.equal(sou.find((s) => s.field === "finalDueDate").date, "2029-02-10");

  const s8 = tm.suggestDeadlines("section_8_15", { registrationDate: "2021-05-04" });
  assert.equal(s8.find((s) => s.field === "responseDueDate").date, "2027-05-04");

  const renewal = tm.suggestDeadlines("section_8_9_renewal", { registrationDate: "2008-05-04" }, { todayIso: "2026-10-07" });
  assert.equal(renewal.find((s) => s.field === "responseDueDate").date, "2028-05-04");

  assert.deepEqual(tm.suggestDeadlines("office_action", {}), []);
  const withInternal = tm.suggestDeadlines("office_action", { triggerDate: "2026-01-31", internalDueDate: "2026-03-01" });
  assert.equal(withInternal.some((s) => s.field === "internalDueDate"), false);
});

test("billing helpers", () => {
  assert.equal(tm.billingState({ invoiced: true, readyToBill: true }), "invoiced");
  assert.equal(tm.billingState({ readyToBill: true }), "ready_to_bill");
  assert.equal(tm.billingState({}), "none");
  assert.equal(tm.hasUnbilledActivity({ reported: true }), true);
  assert.equal(tm.hasUnbilledActivity({ reported: true, invoiced: true }), false);
  assert.equal(tm.hasUnbilledActivity({}), false);
});

test("application statuses keep the workbook list minus the billing value", () => {
  for (const status of tm.WORKBOOK_STATUS_LIST) {
    if (status === tm.BILLING_STATUS_VALUE) continue;
    assert.ok(tm.APPLICATION_STATUSES.includes(status), status);
  }
  assert.ok(!tm.APPLICATION_STATUSES.includes(tm.BILLING_STATUS_VALUE));
  for (const added of ["Filed/Pending", "Suspended", "Section 8 Accepted", "Expired/Lapsed", "Opposed"]) {
    assert.ok(tm.APPLICATION_STATUSES.includes(added), added);
  }
});
