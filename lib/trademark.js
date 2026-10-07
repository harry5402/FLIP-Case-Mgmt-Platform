// Trademark docket domain constants and pure helpers. No DB or Express here so
// everything can be unit tested (test/trademark.test.js) and shared by the
// API routes (routes/trademark.js) and the workbook importer.

const STAGES = [
  { key: "application", label: "Applications" },
  { key: "office_action", label: "Office Actions" },
  { key: "post_reg_oa", label: "Post-Reg OA" },
  { key: "sou", label: "SOU" },
  { key: "maintenance", label: "Maintenance" },
  { key: "clearance", label: "Clearance & Strategy" },
  { key: "contentious", label: "Contentious" },
  { key: "assignment", label: "Assignments" },
  { key: "other", label: "Other" },
];
const STAGE_KEYS = STAGES.map((s) => s.key);

const ACTION_TYPES = [
  { key: "application_filing", label: "Application", stage: "application" },
  { key: "office_action", label: "Office Action", stage: "office_action" },
  { key: "suspension_check", label: "Suspension Check", stage: "office_action" },
  { key: "post_reg_office_action", label: "Post-Reg Office Action", stage: "post_reg_oa" },
  { key: "statement_of_use", label: "Statement of Use", stage: "sou" },
  { key: "extension_of_time", label: "SOU Extension", stage: "sou" },
  { key: "section_8_15", label: "Declaration §8/§15", stage: "maintenance" },
  { key: "section_8_9_renewal", label: "Renewal §8/§9", stage: "maintenance" },
  { key: "foreign_renewal", label: "Foreign Renewal", stage: "maintenance" },
  { key: "registration_fee", label: "Registration Fee", stage: "maintenance" },
  { key: "clearance_strategy", label: "Clearance / Strategy", stage: "clearance" },
  { key: "search_compact_plus", label: "Compact Plus Search", stage: "clearance" },
  { key: "search_neo_lite", label: "Neo-Lite Search", stage: "clearance" },
  { key: "search_other", label: "Other Search", stage: "clearance" },
  { key: "legal_opinion", label: "Legal Opinion", stage: "clearance" },
  { key: "opposition", label: "Opposition", stage: "contentious" },
  { key: "cancellation", label: "Cancellation", stage: "contentious" },
  { key: "cease_and_desist", label: "Cease & Desist", stage: "contentious" },
  { key: "assignment", label: "Assignment", stage: "assignment" },
  { key: "change_of_name", label: "Change of Name", stage: "assignment" },
  { key: "status_check", label: "Status Check", stage: "other" },
  { key: "other", label: "Other", stage: "other" },
];
const ACTION_TYPE_KEYS = ACTION_TYPES.map((a) => a.key);

// Source of truth: the workbook's "application status list" tab, minus
// "Reported and billed" (a billing state, mapped to item billing flags), plus
// the statuses approved on 2026-10-07 (Filed/Pending … Opposed).
const WORKBOOK_STATUS_LIST = [
  "Abandoned",
  "Allowed",
  "Dead/Cancelled",
  "Not yet filed",
  "Office Action Pending",
  "Pending Renewal",
  "Published for Opposition",
  "Registered",
  "Renewed",
  "Reported and billed",
  "Statement of Use Accepted",
  "Statement of Use Pending",
  "Under Examination",
];
const BILLING_STATUS_VALUE = "Reported and billed";
const APPLICATION_STATUSES = [
  "Not yet filed",
  "Filed/Pending",
  "Under Examination",
  "Office Action Pending",
  "Suspended",
  "Published for Opposition",
  "Opposed",
  "Allowed",
  "Statement of Use Pending",
  "Statement of Use Accepted",
  "Registered",
  "Section 8 Accepted",
  "Pending Renewal",
  "Renewed",
  "Abandoned",
  "Dead/Cancelled",
  "Expired/Lapsed",
];

const WORK_STATES = [
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In Progress" },
  { key: "awaiting_client", label: "Awaiting Client" },
  { key: "awaiting_signature", label: "Awaiting Signature" },
  { key: "filed", label: "Filed" },
  { key: "reported", label: "Reported" },
  { key: "done", label: "Done" },
  { key: "abandoned", label: "Abandoned" },
];
const WORK_STATE_KEYS = WORK_STATES.map((s) => s.key);

const TODO_STATUSES = ["open", "in_progress", "done"];
const CLIENT_KINDS = ["direct", "agent_firm"];
const MATTER_FAMILIES = ["3T", "FT", "CS", "RCR", "ST", "OTHER"];
const BILLING_FLAGS = ["reported", "readyToBill", "servicesEntered", "expensesEntered", "invoiced"];

// Badge-only reminder windows (days before the effective due date).
const DUE_SOON_DAYS = { default: 14, maintenance: 60, sou: 30 };

const REVIEW_REASONS = {
  column_shift: "Text was typed into a checkbox column; moved into the comment",
  malformed_matter_no: "Matter number doesn't match a known format",
  no_matter_no: "No matter number (N/A or blank)",
  implausible_date: "Date outside 2000–2040 (likely a typo)",
  unparsed_date_text: "Deadline cell holds text that couldn't be read as a date",
  unknown_action: "Action text didn't match a known action type",
  reported_and_billed_status: "Status was 'Reported and billed' — moved to billing flags",
  ttab_schedule_unparsed: "TTAB/trial schedule is in the comment; enter the dates as extra deadlines",
  deadlines_from_text: "Extra deadlines were read out of free text — please verify",
  brand_conflict: "Rows for this matter list different brands",
  client_name_suspicious: "Client name looks wrong (blank or an email address)",
  merged_cell: "Value came from a merged cell shared with another row",
  ready_to_bill_unmatched: "Listed on 'Ready to bill' but no matching item was found",
  status_conflict: "Application status disagrees with an open later-stage item",
};

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
const cleanText = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return null;
  const text = String(value).replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
  return text ? text : null;
};

const normalizeKeyText = (value) =>
  (cleanText(value) || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const MATTER_NO_PATTERN =
  /^(3T\d{5}(\.\d+)?|FT-\d{2,3}(\.\d+)?(\/\d+)?|CS-\d{4}|RCR-\d+(\.\d+)?|ST\d{5}[A-Z]{2})$/;

// "3t12345.1 (UK)" -> { norm: "3T12345.1", jurisdiction: "UK", family: "3T", parentNorm: "3T12345" }
const normalizeMatterNo = (raw) => {
  const text = cleanText(raw);
  if (!text || /^n\/?a$/i.test(text) || text === "-") {
    return { display: text, norm: null, jurisdiction: null, family: "OTHER", parentNorm: null, valid: false, missing: true };
  }
  let body = text;
  let jurisdiction = null;
  const suffix = body.match(/\s*\(([^)]+)\)\s*$/);
  if (suffix) {
    jurisdiction = suffix[1].replace(/\s+/g, " ").trim();
    body = body.slice(0, suffix.index);
  }
  const norm = body.toUpperCase().replace(/\s+/g, "");
  const valid = MATTER_NO_PATTERN.test(norm);
  const familyMatch = norm.match(/^(3T|FT|CS|RCR|ST)/);
  const family = familyMatch ? familyMatch[1] : "OTHER";
  const parentMatch = norm.match(/^(3T\d{5})\.\d+$/);
  return {
    display: text,
    norm,
    jurisdiction,
    family,
    parentNorm: parentMatch ? parentMatch[1] : null,
    valid,
    missing: false,
  };
};

const CLIENT_SUFFIX = /\s+(llc|l l c|inc|ltd|limited|gmbh|corp|corporation|co|plc|pllc|llp|sa|srl|bv)$/;
const normalizeClientName = (name) => {
  let text = (cleanText(name) || "").toLowerCase().replace(/&/g, " and ");
  text = text.replace(/[^a-z0-9@]+/g, " ").replace(/\s+/g, " ").trim();
  let prev;
  do {
    prev = text;
    text = text.replace(CLIENT_SUFFIX, "").trim();
  } while (text !== prev && text);
  return text;
};

const isSuspiciousClientName = (name) => {
  const text = cleanText(name);
  return !text || /@/.test(text);
};

// ---------------------------------------------------------------------------
// Dates — always ISO "YYYY-MM-DD" strings; arithmetic is done in UTC on the
// calendar date so no local-timezone shifts are possible.
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");

const isValidISODate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const isoFromParts = (y, m, d) => {
  const iso = `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
  return isValidISODate(iso) ? iso : null;
};

// Excel dates arrive as JS Dates at UTC midnight of the calendar day.
const isoFromExcelDate = (date) =>
  isoFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());

const expandYear = (y) => {
  const n = Number(y);
  if (String(y).length <= 2) return 2000 + n;
  return n;
};

const addMonthsClamped = (iso, months) => {
  if (!isValidISODate(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return isoFromParts(ny, nm, Math.min(d, lastDay));
};

const addDays = (iso, days) => {
  if (!isValidISODate(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

const daysBetween = (fromIso, toIso) => {
  const [a, b] = [fromIso, toIso].map((iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86400000);
};

const MIN_YEAR = 2000;
const MAX_YEAR = 2040;

// Reads a spreadsheet deadline cell. Returns:
//   { date: ISO|null, text: raw text when the input wasn't a clean date,
//     note: trailing task text ("MM/DD/YY - follow up"), grace: bool, review: reason|null }
const parseLooseDate = (value, { refYear } = {}) => {
  const empty = { date: null, text: null, note: null, grace: false, review: null };
  if (value === null || value === undefined || typeof value === "boolean") return empty;
  const check = (iso, extra = {}) => {
    if (!iso) return { ...empty, ...extra, review: extra.text ? "unparsed_date_text" : null };
    const year = Number(iso.slice(0, 4));
    if (year < MIN_YEAR || year > MAX_YEAR) {
      return { ...empty, ...extra, date: null, text: extra.text || iso, review: "implausible_date" };
    }
    return { ...empty, ...extra, date: iso };
  };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return empty;
    return check(isoFromExcelDate(value));
  }
  if (typeof value === "number") {
    // Bare Excel serial number in a date column.
    if (value > 30000 && value < 60000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
      return check(isoFromExcelDate(dt));
    }
    return { ...empty, text: String(value), review: "unparsed_date_text" };
  }
  const text = cleanText(value);
  if (!text) return empty;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return check(isValidISODate(text) ? text : null, isValidISODate(text) ? {} : { text });

  // "MM/DD-MM/DD" (optionally with a trailing year) -> end of the range.
  const range = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*[-–]\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (range) {
    const [, sm, , sy, em, ed, ey] = range;
    let year = ey ? expandYear(ey) : sy ? expandYear(sy) : refYear || null;
    if (!year) return { ...empty, text, review: "unparsed_date_text" };
    if (!ey && !sy && Number(em) < Number(sm)) year += 1;
    return check(isoFromParts(year, Number(em), Number(ed)), { text });
  }

  const lead = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)\s*(.*)$/);
  if (lead) {
    const [, m, d, y, restRaw] = lead;
    const rest = restRaw.replace(/^[-–:,\s]+/, "").replace(/^\((.*)\)$/, "$1").trim();
    const grace = /grace/i.test(rest);
    const iso = isoFromParts(expandYear(y), Number(m), Number(d));
    const result = check(iso, { text: rest ? text : null, grace, note: rest && !grace ? rest : null });
    if (!iso) result.review = "unparsed_date_text";
    return result;
  }
  return { ...empty, text, review: "unparsed_date_text" };
};

const effectiveDueDate = (item) => item.internalDueDate || item.responseDueDate || null;

const dueSoonDays = (stage) => DUE_SOON_DAYS[stage] ?? DUE_SOON_DAYS.default;

// Badge for a due date relative to "today" (an ISO local date supplied by the caller).
const dueBadge = (dueIso, stage, todayIso) => {
  if (!dueIso || !todayIso) return null;
  const diff = daysBetween(todayIso, dueIso);
  if (diff < 0) return "overdue";
  if (diff <= dueSoonDays(stage)) return "due_soon";
  return null;
};

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
// Ordered: more specific patterns first.
const ACTION_RULES = [
  [/post[\s-]*reg/i, "post_reg_office_action"],
  [/suspension/i, "suspension_check"],
  [/office action|\bo\.?a\.?\b/i, "office_action"],
  [/statement of use|\bsou\b|notice of allowance/i, "statement_of_use"],
  [/extension/i, "extension_of_time"],
  [/merger|assignment/i, "assignment"],
  [/change of name|name change/i, "change_of_name"],
  [/renewal|sections?\s*8\s*&?\s*(and\s*)?9|10[\s-]*year|use vulnerability/i, "section_8_9_renewal"],
  [/declaration|affidavit|sections?\s*8\s*&?\s*(and\s*)?15|maintenance/i, "section_8_15"],
  [/registration fee/i, "registration_fee"],
  [/compact/i, "search_compact_plus"],
  [/neo[\s-]*lite/i, "search_neo_lite"],
  [/search|availability/i, "search_other"],
  [/opinion|inquiry/i, "legal_opinion"],
  [/opposition/i, "opposition"],
  [/cancell?ation/i, "cancellation"],
  [/cease|c\s*&\s*d|demand letter/i, "cease_and_desist"],
  [/status (check|update)/i, "status_check"],
];

const stageForAction = (actionType) =>
  (ACTION_TYPES.find((a) => a.key === actionType) || { stage: "other" }).stage;

// For portfolio tabs: the free-text "Action:" decides both action type and stage.
const classifyAction = (label, { family } = {}) => {
  const text = cleanText(label) || "";
  for (const [pattern, actionType] of ACTION_RULES) {
    if (pattern.test(text)) {
      let type = actionType;
      if (type === "section_8_9_renewal" && family === "FT") type = "foreign_renewal";
      return { actionType: type, stage: stageForAction(type), known: true };
    }
  }
  return { actionType: "other", stage: "other", known: false };
};

// For stage tabs: the tab fixes the stage; the comment/brand may refine the action type.
const actionTypeForStage = (stage, { comment, brand, title, family } = {}) => {
  const text = `${cleanText(comment) || ""} ${cleanText(brand) || ""}`;
  switch (stage) {
    case "application":
      return "application_filing";
    case "office_action":
      return /suspen/i.test(text) ? "suspension_check" : "office_action";
    case "post_reg_oa":
      return "post_reg_office_action";
    case "sou":
      return /extension/i.test(text) ? "extension_of_time" : "statement_of_use";
    case "maintenance":
      if (/registration fee/i.test(text)) return "registration_fee";
      if (family === "FT") return "foreign_renewal";
      if (/renewal|section\s*9|§\s*9|8\s*&\s*9|10[\s-]*year/i.test(text)) return "section_8_9_renewal";
      return "section_8_15";
    case "clearance": {
      const c = classifyAction(text);
      return c.stage === "clearance" ? c.actionType : "clearance_strategy";
    }
    case "contentious": {
      const t = `${cleanText(title) || ""} ${cleanText(comment) || ""}`;
      if (/opposition/i.test(t)) return "opposition";
      if (/cancell?ation/i.test(t)) return "cancellation";
      if (/cease|c\s*&\s*d|demand/i.test(t)) return "cease_and_desist";
      return "other";
    }
    case "assignment":
      return /change of name|name change/i.test(text) ? "change_of_name" : "assignment";
    default:
      return "other";
  }
};

// Infers a work state from the free-text comment the workbook used for status.
const deriveWorkState = (comment, { hidden = false } = {}) => {
  const c = (cleanText(comment) || "").toLowerCase();
  let state = "open";
  if (/abandon/.test(c)) state = "abandoned";
  else if (/awaiting (client )?instruction|awaiting (client|response from client|client response)|reported\s*[-–]\s*awaiting/.test(c)) state = "awaiting_client";
  else if (/signature/.test(c)) state = "awaiting_signature";
  else if (/filed\s*(&|and)\s*reported|\breported\b/.test(c)) state = "reported";
  else if (/\bfiled\b/.test(c)) state = "filed";
  else if (/\b(done|completed?)\b/.test(c)) state = "done";
  else if (/drafting|in progress|working on/.test(c)) state = "in_progress";
  if (hidden && ["open", "in_progress"].includes(state)) state = "done";
  return state;
};

const parseNiceClasses = (brand) => {
  const text = cleanText(brand) || "";
  const found = new Set();
  const dash = text.match(/\s[-–]\s*(\d{1,2}(?:\s*,\s*\d{1,2})*)\s*$/);
  const word = text.match(/\bclass(?:es)?\s+(\d{1,2}(?:\s*(?:,|and|&)\s*\d{1,2})*)/i);
  [dash, word].forEach((m) => {
    if (!m) return;
    m[1].split(/\s*(?:,|and|&)\s*/i).forEach((n) => {
      const num = Number(n);
      if (num >= 1 && num <= 45) found.add(num);
    });
  });
  return [...found].sort((a, b) => a - b);
};

// "Use vulnerability deadline 01/02/27; renewal deadline 03/04/28" -> [{label, date, sourceText}]
const extractTextDeadlines = (text) => {
  const src = cleanText(text);
  if (!src) return [];
  const results = [];
  const pattern = /([A-Za-z][A-Za-z &/\-]{2,60}?)\s+(?:deadline|due|opens|expires)\s*(?:on|by|:)?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/gi;
  let m;
  while ((m = pattern.exec(src))) {
    const parsed = parseLooseDate(m[2]);
    if (parsed.date) {
      results.push({ label: m[1].trim().replace(/^(and|;|,)\s+/i, ""), date: parsed.date, sourceText: m[0].trim() });
    }
  }
  return results;
};

// ---------------------------------------------------------------------------
// Deadline suggestions — hints only, labelled "verify"; never written by the server.
// ---------------------------------------------------------------------------
const SUGGESTION_RULES = [
  { actionType: "office_action", anchor: "triggerDate", text: "Response due 3 months from issue (extendable once by 3 months)" },
  { actionType: "statement_of_use", anchor: "noaDate", text: "SOU due 6 months from NOA; up to 5 × 6-month extensions (36 months max)" },
  { actionType: "extension_of_time", anchor: "noaDate", text: "SOU due 6 months from NOA; up to 5 × 6-month extensions (36 months max)" },
  { actionType: "section_8_15", anchor: "registrationDate", text: "§8 declaration due between years 5 and 6 after registration; 6-month grace" },
  { actionType: "section_8_9_renewal", anchor: "registrationDate", text: "§8/§9 renewal due in the year before each 10-year anniversary; 6-month grace" },
];

const suggestDeadlines = (actionType, anchors = {}, { todayIso } = {}) => {
  const out = [];
  const { triggerDate, noaDate, registrationDate, responseDueDate, internalDueDate } = anchors;
  if (actionType === "office_action" && isValidISODate(triggerDate)) {
    out.push({ field: "responseDueDate", date: addMonthsClamped(triggerDate, 3), rule: "Issue date + 3 months" });
    out.push({ field: "extendedDueDate", date: addMonthsClamped(triggerDate, 6), rule: "With 3-month extension" });
  }
  if (["statement_of_use", "extension_of_time"].includes(actionType) && isValidISODate(noaDate)) {
    out.push({ field: "responseDueDate", date: addMonthsClamped(noaDate, 6), rule: "NOA + 6 months" });
    out.push({ field: "finalDueDate", date: addMonthsClamped(noaDate, 36), rule: "Last possible SOU (NOA + 36 months)" });
  }
  if (actionType === "section_8_15" && isValidISODate(registrationDate)) {
    out.push({ field: "windowOpens", date: addMonthsClamped(registrationDate, 60), rule: "Window opens (reg + 5 years)" });
    out.push({ field: "responseDueDate", date: addMonthsClamped(registrationDate, 72), rule: "Due (reg + 6 years)" });
    out.push({ field: "graceEnds", date: addMonthsClamped(registrationDate, 78), rule: "Grace period ends (+6 months)" });
  }
  if (actionType === "section_8_9_renewal" && isValidISODate(registrationDate)) {
    const today = todayIso && isValidISODate(todayIso) ? todayIso : null;
    let years = 10;
    while (today && addMonthsClamped(registrationDate, years * 12 + 6) < today && years < 100) years += 10;
    out.push({ field: "windowOpens", date: addMonthsClamped(registrationDate, years * 12 - 12), rule: `Window opens (reg + ${years - 1} years)` });
    out.push({ field: "responseDueDate", date: addMonthsClamped(registrationDate, years * 12), rule: `Due (reg + ${years} years)` });
    out.push({ field: "graceEnds", date: addMonthsClamped(registrationDate, years * 12 + 6), rule: "Grace period ends (+6 months)" });
  }
  const response = responseDueDate || out.find((s) => s.field === "responseDueDate")?.date;
  if (!internalDueDate && isValidISODate(response)) {
    out.push({ field: "internalDueDate", date: addDays(response, -30), rule: "Response deadline − 30 days" });
  }
  return out;
};

const billingState = (item) => {
  if (item.invoiced) return "invoiced";
  if (item.readyToBill) return "ready_to_bill";
  if (item.servicesEntered || item.expensesEntered) return "entered";
  if (item.reported) return "reported";
  return "none";
};

// Closing an item with billing activity that hasn't been invoiced needs confirmation.
const hasUnbilledActivity = (item) =>
  !item.invoiced && Boolean(item.reported || item.readyToBill || item.servicesEntered || item.expensesEntered);

module.exports = {
  STAGES,
  STAGE_KEYS,
  ACTION_TYPES,
  ACTION_TYPE_KEYS,
  WORKBOOK_STATUS_LIST,
  BILLING_STATUS_VALUE,
  APPLICATION_STATUSES,
  WORK_STATES,
  WORK_STATE_KEYS,
  TODO_STATUSES,
  CLIENT_KINDS,
  MATTER_FAMILIES,
  BILLING_FLAGS,
  DUE_SOON_DAYS,
  REVIEW_REASONS,
  SUGGESTION_RULES,
  cleanText,
  normalizeKeyText,
  normalizeMatterNo,
  normalizeClientName,
  isSuspiciousClientName,
  isValidISODate,
  isoFromExcelDate,
  addMonthsClamped,
  addDays,
  daysBetween,
  parseLooseDate,
  effectiveDueDate,
  dueSoonDays,
  dueBadge,
  classifyAction,
  actionTypeForStage,
  stageForAction,
  deriveWorkState,
  parseNiceClasses,
  extractTextDeadlines,
  suggestDeadlines,
  billingState,
  hasUnbilledActivity,
};
