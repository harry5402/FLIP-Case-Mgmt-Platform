// Pure mapping from workbook sheets to a Trademark Docket import plan. No DB
// or file access: scripts/import-trademark-workbook.js reads the .xlsx into the
// plain "sheet" shape below and writes the resulting plan to Postgres.
//
// sheet = { name, state, rows: [{ number, hidden, values: [primitive, ...] }],
//           hiddenColumns: Set<colIndex>, merges: ["F17:F18", ...] }
// rows[0] is the header row except on the status list tab.
const crypto = require("crypto");
const tm = require("./trademark");

const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
const tabNorm = (name) =>
  String(name || "").toLowerCase().replace(/ /g, " ").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();

const STAGE_TABS = {
  applications: "application",
  "office action response": "office_action",
  "post-registration oa": "post_reg_oa",
  sou: "sou",
  "maintenance filing": "maintenance",
  "clearance & strategy": "clearance",
  "contentious matters": "contentious",
  assignments: "assignment",
};
const SPECIAL_TABS = {
  "to do & sort": "todo",
  "misc.": "misc",
  misc: "misc",
  "ready to bill": "ready_to_bill",
  "outstanding billing questions": "billing_questions",
  "unresponsive clients": "unresponsive",
  "application status list": "status_list",
};
// Applications first so application status/brand are seen before later stages.
const TAB_ORDER = ["application", "office_action", "post_reg_oa", "sou", "maintenance", "clearance", "contentious", "assignment"];

const colLetter = (index) => {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && !tm.cleanText(v));
const isPhantomRow = (values) => values.every((v) => isBlank(v) || typeof v === "boolean");

// Header lookup by trimmed, case-insensitive name (never by position).
const headerIndex = (sheet) => {
  const headerRow = sheet.rows[0] ? sheet.rows[0].values : [];
  const headers = headerRow.map((h) => (tm.cleanText(h) || "").toLowerCase());
  const hiddenCols = sheet.hiddenColumns || new Set();
  const all = (pred) => headers.map((h, i) => (h && pred(h) ? i : -1)).filter((i) => i >= 0);
  // Duplicate headers (Maintenance has two "Internal Deadline"): visible column first.
  const ordered = (idxs) => [...idxs.filter((i) => !hiddenCols.has(i)), ...idxs.filter((i) => hiddenCols.has(i))];
  const find = (...names) => ordered(all((h) => names.includes(h)));
  return {
    headers,
    find,
    findBy: (pred) => ordered(all(pred)),
    unlabeled: headers.map((h, i) => (!h ? i : -1)).filter((i) => i >= 0),
  };
};

const firstValue = (values, idxs) => {
  for (const i of idxs) {
    if (!isBlank(values[i]) && typeof values[i] !== "boolean") return values[i];
  }
  for (const i of idxs) {
    if (!isBlank(values[i])) return values[i];
  }
  return null;
};

const parseMerges = (merges = []) =>
  merges
    .map((ref) => {
      const m = String(ref).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      return m ? { top: Number(m[2]), bottom: Number(m[4]) } : null;
    })
    .filter(Boolean);

const readFlag = (value) => {
  if (value === true) return { value: true, text: null };
  if (value === false || isBlank(value)) return { value: false, text: null };
  const text = tm.cleanText(value);
  if (/^(true|yes|y|x|✓|✔)$/i.test(text)) return { value: true, text: null };
  if (/^(false|no|n)$/i.test(text)) return { value: false, text: null };
  return { value: false, text };
};

const levenshtein = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
};

const MATTER_IN_TEXT = /\b(3T\d{5}(?:\.\d+)?|FT-\d{2,3}(?:\.\d+)?|CS-\d{4})\b/i;
const PROCEEDING_IN_TEXT = /\b(?:opposition|cancellation|proceeding)\s*(?:no\.?|number|#)\s*:?\s*(\d{8})\b/i;
const DATE_IN_TEXT = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

const buildImportPlan = (sheets, { aliases = {} } = {}) => {
  const aliasMap = new Map(
    Object.entries(aliases).map(([variant, canonical]) => [tm.normalizeClientName(variant), canonical])
  );
  const clients = new Map();
  const matters = new Map();
  const items = [];
  const todos = [];
  const billingQuestions = [];
  const readyToBill = [];
  const warnings = [];
  const perTab = {};
  const reviewCounts = {};
  const keyCounts = new Map();

  const countReview = (reason) => {
    reviewCounts[reason] = (reviewCounts[reason] || 0) + 1;
  };
  const occurrenceKey = (base) => {
    const n = keyCounts.get(base) || 0;
    keyCounts.set(base, n + 1);
    return `wb:${sha1(`${base}|${n}`).slice(0, 32)}`;
  };

  const upsertClient = (rawName, { portfolio = false } = {}) => {
    const name = tm.cleanText(rawName);
    if (!name) return null;
    const canonical = aliasMap.get(tm.normalizeClientName(name)) || name;
    const norm = tm.normalizeClientName(canonical) || name.toLowerCase();
    let client = clients.get(norm);
    if (!client) {
      client = {
        norm,
        name: tm.cleanText(canonical),
        aliases: new Set(),
        hasPortfolioView: false,
        isUnresponsive: false,
        paymentRisk: false,
        contactNote: null,
        reviews: new Set(),
      };
      if (tm.isSuspiciousClientName(canonical)) {
        client.reviews.add("client_name_suspicious");
      }
      clients.set(norm, client);
    }
    if (name !== client.name) client.aliases.add(name);
    if (portfolio) client.hasPortfolioView = true;
    return client;
  };

  const upsertMatter = ({ rawMatterNo, client, brand, fromPortfolio }) => {
    const mn = tm.normalizeMatterNo(rawMatterNo);
    const brandNorm = tm.normalizeKeyText(brand);
    const key = mn.norm ? `no:${mn.norm}` : `na:${client ? client.norm : ""}:${brandNorm}`;
    let matter = matters.get(key);
    if (!matter) {
      matter = {
        key,
        matterNo: mn.norm || mn.display || null,
        norm: mn.norm,
        syntheticKey: mn.norm ? null : key,
        family: mn.family,
        parentNorm: mn.parentNorm,
        jurisdiction: mn.jurisdiction || (mn.family === "FT" ? "Foreign" : "US"),
        clientNorm: client ? client.norm : null,
        clientFromPortfolio: Boolean(fromPortfolio && client),
        clientRef: null,
        markText: tm.cleanText(brand),
        niceClasses: new Set(tm.parseNiceClasses(brand)),
        title: null,
        applicationStatus: null,
        applicationStatusFromOpenRow: false,
        proceedingNo: null,
        reviews: new Set(),
        openStages: new Set(),
      };
      if (mn.missing) matter.reviews.add("no_matter_no");
      else if (!mn.valid) matter.reviews.add("malformed_matter_no");
      matters.set(key, matter);
    } else {
      if (mn.jurisdiction && matter.jurisdiction === "US") matter.jurisdiction = mn.jurisdiction;
      if (client) {
        // Portfolio tabs name the billing client; they win over stage-tab client text.
        if (!matter.clientNorm || (fromPortfolio && !matter.clientFromPortfolio)) {
          matter.clientNorm = client.norm;
          matter.clientFromPortfolio = Boolean(fromPortfolio);
        }
      }
      if (!matter.markText && brand) matter.markText = tm.cleanText(brand);
      else if (brandNorm && tm.normalizeKeyText(matter.markText) !== brandNorm) matter.reviews.add("brand_conflict");
      tm.parseNiceClasses(brand).forEach((c) => matter.niceClasses.add(c));
    }
    return matter;
  };

  const pushItem = (item, keyBase) => {
    item.importKey = item.importKey || occurrenceKey(keyBase);
    item.reviews.forEach(countReview);
    item.deadlines.forEach((d, i) => {
      d.importKey = `${item.importKey}:d${i}`;
    });
    items.push(item);
  };

  const sortedSheets = [...sheets].sort((a, b) => {
    const rank = (s) => {
      const stage = STAGE_TABS[tabNorm(s.name)];
      if (stage) return TAB_ORDER.indexOf(stage);
      if (SPECIAL_TABS[tabNorm(s.name)]) return 100;
      return 50; // portfolios after stage tabs
    };
    return rank(a) - rank(b);
  });

  for (const sheet of sortedSheets) {
    const name = tm.cleanText(sheet.name) || sheet.name;
    const norm = tabNorm(sheet.name);
    const stats = { read: 0, phantom: 0, imported: 0, closed: 0, review: 0 };
    perTab[name] = stats;
    const stageForTab = STAGE_TABS[norm];
    const special = SPECIAL_TABS[norm];
    const h = headerIndex(sheet);
    const isPortfolio = !stageForTab && !special && h.find("action:").length > 0;

    if (!stageForTab && !special && !isPortfolio) {
      warnings.push(`Skipped unrecognised tab "${name}"`);
      continue;
    }

    if (special === "status_list") {
      const values = sheet.rows.map((r) => tm.cleanText(r.values[0])).filter(Boolean);
      stats.read = values.length;
      const known = new Set(tm.WORKBOOK_STATUS_LIST);
      values.filter((v) => !known.has(v)).forEach((v) => warnings.push(`Status list has a new value not in the app: "${v}"`));
      tm.WORKBOOK_STATUS_LIST.filter((v) => !values.includes(v)).forEach((v) =>
        warnings.push(`Status list no longer contains "${v}"`)
      );
      continue;
    }

    const dataRows = sheet.rows.slice(1);
    const merged = parseMerges(sheet.merges);

    if (special === "unresponsive") {
      const colUnresp = h.findBy((x) => x.startsWith("unresponsive"));
      const colPay = h.findBy((x) => x.includes("owes") || x.includes("paying"));
      dataRows.forEach((row) => {
        if (isPhantomRow(row.values)) return;
        stats.read += 1;
        [
          [colUnresp, "isUnresponsive"],
          [colPay, "paymentRisk"],
        ].forEach(([cols, flag]) => {
          const raw = tm.cleanText(firstValue(row.values, cols));
          if (!raw) return;
          const paren = raw.match(/^(.*?)\s*\((.*)\)\s*$/);
          const client = upsertClient(paren ? paren[1] : raw);
          if (!client) return;
          client[flag] = true;
          if (paren && !client.contactNote) client.contactNote = paren[2];
          stats.imported += 1;
        });
      });
      continue;
    }

    if (special === "ready_to_bill") {
      const cRef = h.find("ref. no.", "matter no.", "ref no.");
      const cEst = h.find("cost estimate");
      const cBill = h.find("bill");
      dataRows.forEach((row) => {
        if (isPhantomRow(row.values)) return;
        stats.read += 1;
        const mn = tm.normalizeMatterNo(firstValue(row.values, cRef));
        const bill = tm.cleanText(firstValue(row.values, cBill));
        readyToBill.push({
          matterNorm: mn.norm,
          matterText: mn.display,
          costEstimate: tm.cleanText(firstValue(row.values, cEst)),
          bill: bill ? !/^no$/i.test(bill) : true,
          row: row.number,
        });
      });
      continue;
    }

    if (special === "billing_questions") {
      const cMatter = h.findBy((x) => x.startsWith("matter"));
      const cQ = h.find("question");
      const cA = h.find("answer");
      dataRows.forEach((row) => {
        if (isPhantomRow(row.values)) return;
        stats.read += 1;
        const question = tm.cleanText(firstValue(row.values, cQ));
        if (!question) return;
        const matterText = tm.cleanText(firstValue(row.values, cMatter));
        const scope = /^all\b/i.test(matterText || "") ? "all" : "matter";
        const mn = tm.normalizeMatterNo(matterText);
        billingQuestions.push({
          importKey: `wb:${sha1(`bq|${mn.norm || matterText}|${tm.normalizeKeyText(question)}`).slice(0, 32)}`,
          matterNorm: scope === "matter" ? mn.norm : null,
          matterText,
          scope,
          question,
          answer: tm.cleanText(firstValue(row.values, cA)),
        });
        stats.imported += 1;
      });
      continue;
    }

    if (special === "todo" || special === "misc") {
      const cDue = h.find("internal due date", "due date");
      const cRecv = h.find("date received");
      const cAction = special === "misc" ? [0] : h.find("action item");
      const cSubject = h.find("email subject");
      const cStatus = special === "misc" ? h.find("check off") : h.find("status");
      dataRows.forEach((row) => {
        if (isPhantomRow(row.values)) return;
        stats.read += 1;
        const actionItem = tm.cleanText(firstValue(row.values, cAction));
        const subject = tm.cleanText(firstValue(row.values, cSubject));
        if (!actionItem && !subject) return;
        const due = tm.parseLooseDate(firstValue(row.values, cDue));
        const statusNote = tm.cleanText(firstValue(row.values, cStatus));
        let status = "open";
        if (/^(done|complete|completed)$/i.test(statusNote || "") || (special === "misc" && row.hidden)) status = "done";
        else if (/drafting|reviewing|completed,? but/i.test(statusNote || "")) status = "in_progress";
        const initials = due.text && /^[A-Z]{2,3}$/.test(due.text) ? due.text : null;
        const matterMatch = `${subject || ""} ${actionItem || ""}`.match(MATTER_IN_TEXT);
        todos.push({
          importKey: occurrenceKey(`todo|${special}|${tm.normalizeKeyText(actionItem)}|${tm.normalizeKeyText(subject)}`),
          kind: special === "misc" ? "note" : "todo",
          dueDate: due.date,
          dueText: initials ? null : due.text,
          receivedDate: tm.parseLooseDate(firstValue(row.values, cRecv)).date,
          actionItem,
          emailSubject: subject,
          status,
          statusNote: special === "misc" ? null : statusNote,
          assigneeInitials: initials,
          matterNorm: matterMatch ? tm.normalizeMatterNo(matterMatch[1]).norm : null,
        });
        stats.imported += 1;
      });
      continue;
    }

    // ---- Docket item tabs (stage tabs + client portfolio tabs) ----
    const col = {
      internal: h.find("internal deadline", "internal due date"),
      response: h.find("response deadline", "opposition/trial schedule deadlines"),
      matter: h.find("matter no.", "flip ref:", "ref. no.", "matter number"),
      client: h.find("client"),
      brand: h.find("brand", "mark/matter:", "mark"),
      title: h.find("litigious title"),
      comment: h.find("comment", "comments", ...(isPortfolio ? ["status:"] : [])),
      status: isPortfolio ? [] : h.find("status"),
      meeting: h.find("docket meeting notes"),
      action: h.find("action:"),
      clientRef: h.findBy((x) => x === "client ref. #" || (x.endsWith("ref:") && x !== "flip ref:")),
      clientDue: h.findBy((x) => x.endsWith("due date:")),
      received: h.find("email received:", "date received"),
      clientComment: h.findBy((x) => x.endsWith(" comment") && x !== "comment"),
      reported: h.find("reported"),
      readyToBill: h.find("ready to bill"),
      services: h.find("services"),
      expenses: h.find("expenses"),
      invoiced: h.find("invoiced"),
    };
    const portfolioClient = isPortfolio ? upsertClient(name, { portfolio: true }) : null;

    // Client refs are the row key on portfolio tabs when they are unique within the tab.
    const refCounts = new Map();
    if (isPortfolio) {
      dataRows.forEach((row) => {
        const ref = tm.normalizeKeyText(firstValue(row.values, col.clientRef));
        if (ref) refCounts.set(ref, (refCounts.get(ref) || 0) + 1);
      });
    }

    for (const row of dataRows) {
      const v = row.values;
      if (isPhantomRow(v)) {
        stats.phantom += 1;
        continue;
      }
      stats.read += 1;
      const reviews = new Set();
      const extra = {};

      const brand = tm.cleanText(firstValue(v, col.brand));
      const title = tm.cleanText(firstValue(v, col.title));
      let comment = tm.cleanText(firstValue(v, col.comment));
      const meetingNotes = tm.cleanText(firstValue(v, col.meeting));
      const actionLabel = tm.cleanText(firstValue(v, col.action));
      const rawMatter = firstValue(v, col.matter);
      const client = portfolioClient || upsertClient(firstValue(v, col.client));
      if (!portfolioClient && col.client.length && !tm.cleanText(firstValue(v, col.client)) && !isBlank(firstValue(v, col.client))) {
        reviews.add("client_name_suspicious");
      }

      const flags = {};
      [
        ["reported", col.reported],
        ["readyToBill", col.readyToBill],
        ["servicesEntered", col.services],
        ["expensesEntered", col.expenses],
        ["invoiced", col.invoiced],
      ].forEach(([key, idxs]) => {
        const f = readFlag(firstValue(v, idxs));
        flags[key] = f.value;
        if (f.text) {
          comment = comment ? `${comment}\n${f.text}` : f.text;
          reviews.add("column_shift");
        }
      });

      const matter = upsertMatter({ rawMatterNo: rawMatter, client, brand: brand || title, fromPortfolio: isPortfolio });
      if (title && !matter.title) matter.title = title;
      if (isPortfolio) {
        const ref = tm.cleanText(firstValue(v, col.clientRef));
        if (ref && !matter.clientRef) matter.clientRef = ref;
      }

      // Dates: first pass without a reference year, then use any real date's year for "MM/DD-MM/DD" ranges.
      const rawInternal = firstValue(v, col.internal);
      const rawResponse = firstValue(v, col.response);
      const rawClientDue = firstValue(v, col.clientDue);
      const rawReceived = firstValue(v, col.received);
      const first = [rawInternal, rawResponse, rawReceived, rawClientDue].map((x) => tm.parseLooseDate(x));
      const refDate = first.find((p) => p.date);
      const refYear = refDate ? Number(refDate.date.slice(0, 4)) : undefined;
      const [internal, response, received, clientDue] = [rawInternal, rawResponse, rawReceived, rawClientDue].map((x) =>
        tm.parseLooseDate(x, { refYear })
      );
      [internal, response, clientDue].forEach((p) => {
        if (p.review === "implausible_date") reviews.add("implausible_date");
        else if (p.review === "unparsed_date_text" && p.text && !/^n\/?a$/i.test(p.text)) reviews.add("unparsed_date_text");
      });
      if (internal.grace || response.grace) extra.grace = true;

      // Stage + action type
      let stage = stageForTab;
      let actionType;
      let workState = tm.deriveWorkState(comment, { hidden: row.hidden });
      const deadlines = [];
      if (isPortfolio) {
        if (/^(abandoned|expired|lapsed)\b/i.test(actionLabel || "")) {
          stage = "other";
          actionType = "status_check";
          workState = "abandoned";
          if (!matter.applicationStatus) {
            matter.applicationStatus = /^abandoned/i.test(actionLabel) ? "Abandoned" : "Expired/Lapsed";
          }
        } else {
          const c = tm.classifyAction(actionLabel, { family: matter.family });
          stage = c.stage;
          actionType = c.actionType;
          if (!c.known) reviews.add("unknown_action");
        }
        tm.extractTextDeadlines(actionLabel).forEach((d) => deadlines.push({ ...d, needsReview: true }));
        if (deadlines.length) reviews.add("deadlines_from_text");
      } else {
        actionType = tm.actionTypeForStage(stage, { comment, brand, title, family: matter.family });
      }

      if (stage === "application" && col.status.length) {
        const status = tm.cleanText(firstValue(v, col.status));
        if (status === tm.BILLING_STATUS_VALUE) {
          flags.reported = true;
          flags.invoiced = true;
          reviews.add("reported_and_billed_status");
        } else if (status && tm.APPLICATION_STATUSES.includes(status)) {
          // Open rows win over closed history rows for the matter's current status.
          if (!row.hidden || !matter.applicationStatusFromOpenRow) {
            matter.applicationStatus = status;
            matter.applicationStatusFromOpenRow = !row.hidden;
          }
        } else if (status) {
          extra.unknownStatus = status;
          reviews.add("unknown_action");
        }
      }

      if (stage === "contentious") {
        const text = `${comment || ""} ${meetingNotes || ""}`;
        const proc = text.match(PROCEEDING_IN_TEXT);
        if (proc && !matter.proceedingNo) matter.proceedingNo = proc[1];
        if ((text.match(DATE_IN_TEXT) || []).length >= 2) reviews.add("ttab_schedule_unparsed");
      }

      if (merged.some((m) => row.number >= m.top && row.number <= m.bottom)) reviews.add("merged_cell");

      h.unlabeled.forEach((i) => {
        const val = v[i];
        if (!isBlank(val) && typeof val !== "boolean") {
          extra.unlabeled = extra.unlabeled || {};
          extra.unlabeled[colLetter(i)] = val instanceof Date ? tm.isoFromExcelDate(val) : tm.cleanText(val);
        }
      });
      if (internal.note) extra.internalNote = internal.note;

      if (!row.hidden) matter.openStages.add(stage);
      if (row.hidden) stats.closed += 1;

      const clientCommentVal = tm.cleanText(firstValue(v, col.clientComment));
      const item = {
        matterKey: matter.key,
        stage,
        actionType,
        actionLabel: actionLabel || null,
        brand: brand || null,
        internalDueDate: internal.date,
        internalDueText: internal.text,
        responseDueDate: response.date,
        responseDueText: response.text,
        clientDueDate: clientDue.date,
        clientDueText: clientDue.text,
        receivedDate: received.date,
        workState,
        comment: comment || null,
        clientComment: clientCommentVal || null,
        meetingNotes: meetingNotes || null,
        ...flags,
        isClosed: Boolean(row.hidden),
        sourceTab: name,
        sourceRow: row.number,
        extra,
        reviews,
        deadlines,
      };

      const ref = isPortfolio ? tm.normalizeKeyText(firstValue(v, col.clientRef)) : "";
      if (ref && refCounts.get(ref) === 1) item.importKey = `wb:${sha1(`ref|${norm}|${ref}`).slice(0, 32)}`;
      pushItem(item, `${norm}|${matter.key}|${tm.normalizeKeyText(brand || title)}|${actionType}`);
      stats.imported += 1;
      if (reviews.size) stats.review += 1;
    }
  }

  // "Ready to bill" rows flag the newest open item on that matter.
  readyToBill.forEach((r) => {
    if (!r.bill) return;
    const candidates = items
      .filter((i) => r.matterNorm && i.matterKey === `no:${r.matterNorm}`)
      .sort((a, b) => Number(a.isClosed) - Number(b.isClosed) || String(tm.effectiveDueDate(b)).localeCompare(String(tm.effectiveDueDate(a))));
    const target = candidates[0];
    if (target) {
      target.readyToBill = true;
      if (r.costEstimate) target.costEstimate = r.costEstimate;
    } else {
      billingQuestions.push({
        importKey: `wb:${sha1(`rtb|${r.matterNorm || r.matterText}`).slice(0, 32)}`,
        matterNorm: r.matterNorm,
        matterText: r.matterText,
        scope: "matter",
        question: `Listed on "Ready to bill" but no docket item matched${r.costEstimate ? ` (cost estimate: ${r.costEstimate})` : ""}`,
        answer: null,
      });
      countReview("ready_to_bill_unmatched");
    }
  });

  // Status sanity: "Not yet filed" but there is open later-stage work.
  matters.forEach((m) => {
    if (m.applicationStatus === "Not yet filed" && ["office_action", "sou", "maintenance", "post_reg_oa"].some((s) => m.openStages.has(s))) {
      m.reviews.add("status_conflict");
    }
    m.reviews.forEach(countReview);
  });
  clients.forEach((c) => c.reviews.forEach(countReview));

  const clientNorms = [...clients.keys()];
  const nearDuplicateClients = [];
  for (let i = 0; i < clientNorms.length; i += 1) {
    for (let j = i + 1; j < clientNorms.length; j += 1) {
      const [a, b] = [clientNorms[i], clientNorms[j]];
      if (a.length > 4 && b.length > 4 && levenshtein(a, b) <= 2) nearDuplicateClients.push([clients.get(a).name, clients.get(b).name]);
    }
  }

  return {
    clients: [...clients.values()].map((c) => ({ ...c, aliases: [...c.aliases], reviews: [...c.reviews] })),
    matters: [...matters.values()].map((m) => {
      const { openStages, applicationStatusFromOpenRow, clientFromPortfolio, ...rest } = m;
      return { ...rest, niceClasses: [...m.niceClasses].sort((a, b) => a - b), reviews: [...m.reviews] };
    }),
    // Content hash (excluding row position) lets re-imports detect workbook edits.
    items: items.map((i) => {
      const out = { ...i, reviews: [...i.reviews].sort() };
      const { importKey, sourceRow, ...hashed } = out;
      out.importHash = sha1(JSON.stringify(hashed));
      return out;
    }),
    todos,
    billingQuestions,
    summary: { perTab, reviewCounts, warnings, nearDuplicateClientCount: nearDuplicateClients.length },
    nearDuplicateClients,
  };
};

module.exports = { buildImportPlan, tabNorm, isPhantomRow, headerIndex, readFlag };
