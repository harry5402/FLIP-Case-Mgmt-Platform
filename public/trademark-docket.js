// Trademark Docket page. Data comes from /api/trademark/* (routes/trademark.js);
// enums and labels come from /api/trademark/meta so nothing is duplicated here.
requireAuth();

const els = {
  tabs: document.getElementById("tm-tabs"),
  title: document.getElementById("tm-view-title"),
  subtitle: document.getElementById("tm-view-subtitle"),
  filters: document.getElementById("tm-filters"),
  search: document.getElementById("tm-search"),
  filterClient: document.getElementById("tm-filter-client"),
  filterState: document.getElementById("tm-filter-state"),
  filterFamily: document.getElementById("tm-filter-family"),
  filterClosed: document.getElementById("tm-filter-closed"),
  filterReview: document.getElementById("tm-filter-review"),
  subtabs: document.getElementById("tm-subtabs"),
  error: document.getElementById("tm-error"),
  content: document.getElementById("tm-content"),
  newItem: document.getElementById("tm-new-item"),
  viewDeleted: document.getElementById("tm-view-deleted"),
  itemModal: document.getElementById("tm-item-modal"),
  itemModalTitle: document.getElementById("tm-item-modal-title"),
  itemForm: document.getElementById("tm-item-form"),
  itemError: document.getElementById("tm-item-error"),
  itemActions: document.getElementById("tm-item-actions"),
  deletedModal: document.getElementById("tm-deleted-modal"),
  deletedBody: document.getElementById("tm-deleted-body"),
  deletedError: document.getElementById("tm-deleted-error"),
};

const state = {
  meta: null,
  stats: null,
  view: "due",
  billingSub: "ready",
  filters: { q: "", clientId: "", state: "", family: "", includeClosed: false, needsReview: false },
  items: [],
  hasMore: false,
  offset: 0,
  sort: { key: "due", dir: 1 },
  renderId: 0,
  clients: [],
  editing: null,
};

const CROSS_STAGE_VIEWS = ["due", "review", "closed", "billing"];
const ITEM_VIEW_PREFIXES = ["due", "stage:", "portfolio:", "review", "closed", "billing"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, "0");
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
// Both sides are local-midnight dates (parseDateValue), so rounding absorbs DST.
const daysUntil = (iso) => {
  const target = parseDateValue(iso);
  const today = parseDateValue(todayIso());
  if (!target || !today) return null;
  return Math.round((target - today) / 86400000);
};
const fmt = (iso) => (iso ? formatDate(iso) : "");

const fetchJson = async (url, options) => {
  const response = await authFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload.error || "Request failed");
    err.status = response.status;
    err.code = payload.code;
    throw err;
  }
  return payload;
};
const api = (path, method = "GET", body) =>
  fetchJson(
    `/api/trademark${path}`,
    body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );

const showError = (message) => {
  els.error.textContent = message || "";
};

const labelFor = (list, key) => (list.find((x) => x.key === key) || { label: key || "" }).label;
const stageLabel = (key) => labelFor(state.meta.stages, key);
const actionLabelFor = (key) => labelFor(state.meta.actionTypes, key);
const dueSoonDays = (stage) => state.meta.dueSoonDays[stage] ?? state.meta.dueSoonDays.default;

const chip = (text, tone = "neutral", title = "") =>
  `<span class="status-chip status-chip-${tone}"${title ? ` title="${escapeHtml(title)}"` : ""}>${escapeHtml(text)}</span>`;

const options = (list, selected, { blank = null } = {}) =>
  (blank !== null ? `<option value="">${escapeHtml(blank)}</option>` : "") +
  list
    .map((o) => {
      const value = typeof o === "string" ? o : o.key;
      const label = typeof o === "string" ? o : o.label;
      return `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------
const readUrlState = () => {
  const p = new URLSearchParams(window.location.search);
  if (p.get("view")) state.view = p.get("view");
  if (p.get("sub")) state.billingSub = p.get("sub");
  state.filters.q = p.get("q") || "";
  state.filters.clientId = p.get("client") || "";
  state.filters.state = p.get("state") || "";
  state.filters.family = p.get("family") || "";
  state.filters.includeClosed = p.get("closed") === "1";
  state.filters.needsReview = p.get("review") === "1";
};
const writeUrlState = () => {
  const p = new URLSearchParams();
  if (state.view !== "due") p.set("view", state.view);
  if (state.view === "billing" && state.billingSub !== "ready") p.set("sub", state.billingSub);
  const f = state.filters;
  if (f.q) p.set("q", f.q);
  if (f.clientId) p.set("client", f.clientId);
  if (f.state) p.set("state", f.state);
  if (f.family) p.set("family", f.family);
  if (f.includeClosed) p.set("closed", "1");
  if (f.needsReview) p.set("review", "1");
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
};

// ---------------------------------------------------------------------------
// Sidebar tabs
// ---------------------------------------------------------------------------
const tabButton = (key, label, count, tone) => {
  const active = state.view === key ? " active" : "";
  const badge = count ? `<span class="tm-count${tone ? ` tm-count-${tone}` : ""}">${count}</span>` : "";
  return `<button class="ghost-button${active}" data-view="${escapeHtml(key)}" type="button"><span>${escapeHtml(label)}</span>${badge}</button>`;
};

const renderTabs = () => {
  const s = state.stats || { byStage: {}, byClient: {} };
  const work = [
    tabButton("due", "Due (all open)", s.overdue, s.overdue ? "danger" : ""),
    ...state.meta.stages.map((st) => tabButton(`stage:${st.key}`, st.label, s.byStage?.[st.key])),
  ];
  const portfolios = state.meta.portfolioClients.map((c) => tabButton(`portfolio:${c.id}`, c.name, s.byClient?.[c.id]));
  const admin = [
    tabButton("todo", "To Do & Sort", s.openTodos),
    tabButton("billing", "Billing", (s.readyToBill || 0) + (s.unbilledClosed || 0), s.unbilledClosed ? "amber" : ""),
    tabButton("clients", "Clients"),
    tabButton("review", "Needs Review", s.review, s.review ? "amber" : ""),
    tabButton("closed", "Closed"),
  ];
  els.tabs.innerHTML = `
    <div class="tm-tab-group-label">Work</div>${work.join("")}
    ${portfolios.length ? `<div class="tm-tab-group-label">Portfolios</div>${portfolios.join("")}` : ""}
    <div class="tm-tab-group-label">Admin</div>${admin.join("")}`;
};

const loadStats = async () => {
  try {
    state.stats = await api(`/stats?today=${todayIso()}`);
  } catch (err) {
    state.stats = null;
  }
  renderTabs();
};

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
const isItemView = () => ITEM_VIEW_PREFIXES.some((p) => state.view === p || state.view.startsWith(p)) &&
  !(state.view === "billing" && state.billingSub === "questions");
const viewStage = () => (state.view.startsWith("stage:") ? state.view.slice(6) : null);
const viewClientId = () => (state.view.startsWith("portfolio:") ? state.view.slice(10) : null);

const viewTitle = () => {
  if (state.view === "due") return ["Due", "All open items across stages"];
  if (viewStage()) return [stageLabel(viewStage()), "Open items in this stage"];
  if (viewClientId()) {
    const c = state.meta.portfolioClients.find((x) => x.id === viewClientId());
    return [c ? c.name : "Portfolio", "Client portfolio — every stage for this client"];
  }
  return {
    todo: ["To Do & Sort", "Inbox items not yet on the docket"],
    billing: ["Billing", "Ready to bill, closed-but-unbilled, and open billing questions"],
    clients: ["Clients", "Client flags (unresponsive / payment risk) and portfolio tabs"],
    review: ["Needs Review", "Rows the importer flagged — check and mark reviewed"],
    closed: ["Closed", "Closed items, most recently closed first"],
  }[state.view] || ["Trademark Docket", ""];
};

const itemQuery = () => {
  const p = new URLSearchParams();
  const f = state.filters;
  if (state.view === "due") p.set("view", "due");
  else if (viewStage()) {
    p.set("view", "stage");
    p.set("stage", viewStage());
  } else if (viewClientId()) {
    p.set("view", "portfolio");
    p.set("clientId", viewClientId());
  } else if (state.view === "billing") p.set("view", state.billingSub === "unbilled" ? "unbilled_closed" : "ready_to_bill");
  else p.set("view", state.view);
  if (f.q) p.set("q", f.q);
  if (f.clientId && !viewClientId()) p.set("clientId", f.clientId);
  if (f.state) p.set("state", f.state);
  if (f.family) p.set("family", f.family);
  if (f.includeClosed) p.set("includeClosed", "1");
  if (f.needsReview) p.set("needsReview", "1");
  if (state.view === "closed" && state.offset) p.set("offset", String(state.offset));
  return p.toString();
};

const renderSubtabs = () => {
  if (state.view !== "billing") {
    els.subtabs.classList.add("hidden");
    els.subtabs.innerHTML = "";
    return;
  }
  const s = state.stats || {};
  const sub = (key, label, count) =>
    `<button class="ghost-button${state.billingSub === key ? " active" : ""}" data-sub="${key}" type="button">${escapeHtml(label)}${count ? ` (${count})` : ""}</button>`;
  els.subtabs.innerHTML = [
    sub("ready", "Ready to bill", s.readyToBill),
    sub("unbilled", "Closed, not invoiced", s.unbilledClosed),
    sub("questions", "Billing questions", s.openQuestions),
  ].join("");
  els.subtabs.classList.remove("hidden");
};

const loadView = async ({ append = false } = {}) => {
  const renderId = ++state.renderId;
  showError("");
  const [title, subtitle] = viewTitle();
  els.title.textContent = title;
  els.subtitle.textContent = subtitle;
  renderSubtabs();
  els.filters.classList.toggle("hidden", !isItemView() && state.view !== "clients" && state.view !== "todo");
  ["tm-filter-client", "tm-filter-state", "tm-filter-family"].forEach((id) =>
    document.getElementById(id).classList.toggle("hidden", !isItemView() || (id === "tm-filter-client" && Boolean(viewClientId())))
  );
  els.filterReview.parentElement.classList.toggle("hidden", !isItemView() || state.view === "review");
  els.filterClosed.parentElement.classList.toggle(
    "hidden",
    !(isItemView() || state.view === "todo") || ["closed", "billing"].includes(state.view)
  );
  writeUrlState();
  if (!append) els.content.innerHTML = `<div class="muted tm-loading">Loading…</div>`;
  try {
    if (isItemView()) {
      if (!append) state.offset = 0;
      const data = await api(`/items?${itemQuery()}`);
      if (renderId !== state.renderId) return;
      state.items = append ? state.items.concat(data.items) : data.items;
      state.hasMore = data.hasMore;
      renderItems();
    } else if (state.view === "todo") {
      const data = await api(`/todos${state.filters.includeClosed ? "?includeDone=1" : ""}`);
      if (renderId !== state.renderId) return;
      renderTodos(data.todos);
    } else if (state.view === "billing" && state.billingSub === "questions") {
      const data = await api("/billing-questions?includeResolved=1");
      if (renderId !== state.renderId) return;
      renderQuestions(data.questions);
    } else if (state.view === "clients") {
      const data = await api("/clients");
      if (renderId !== state.renderId) return;
      state.clients = data.clients;
      renderClients();
    }
  } catch (err) {
    if (renderId !== state.renderId) return;
    els.content.innerHTML = "";
    showError(err.message);
  }
};

const refresh = async () => {
  await Promise.all([loadView(), loadStats()]);
};

// ---------------------------------------------------------------------------
// Items table
// ---------------------------------------------------------------------------
const SORTERS = {
  due: (i) => i.effectiveDueDate || "9999",
  response: (i) => i.responseDueDate || "9999",
  stage: (i) => i.stage,
  matter: (i) => i.matter.matterNo || "",
  client: (i) => (i.client ? i.client.name.toLowerCase() : "~"),
  brand: (i) => (i.brand || i.matter.markText || i.matter.title || "").toLowerCase(),
  action: (i) => actionLabelFor(i.actionType),
  state: (i) => i.workState,
  appStatus: (i) => i.matter.applicationStatus || "~",
  clientDue: (i) => i.clientDueDate || "9999",
};

const sortedItems = () => {
  const { key, dir } = state.sort;
  const get = SORTERS[key];
  if (!get) return state.items;
  return [...state.items].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return SORTERS.due(a) < SORTERS.due(b) ? -1 : SORTERS.due(a) > SORTERS.due(b) ? 1 : 0;
  });
};

const columnsForView = () => {
  const stage = viewStage();
  const portfolio = Boolean(viewClientId());
  const cols = ["due", "response"];
  if (!stage) cols.push("stage");
  cols.push("matter");
  if (!portfolio) cols.push("client");
  cols.push("brand", "action");
  if (stage === "application") cols.push("appStatus");
  if (portfolio) cols.push("clientRef", "clientDue", "clientComment");
  cols.push("state", "comment", "billing", "edit");
  return cols;
};

const COLUMN_HEADERS = {
  due: ["Internal Due", "due"],
  response: ["Response Due", "response"],
  stage: ["Stage", "stage"],
  matter: ["Matter", "matter"],
  client: ["Client", "client"],
  brand: ["Brand", "brand"],
  action: ["Action", "action"],
  appStatus: ["App Status", "appStatus"],
  clientRef: ["Client Ref", null],
  clientDue: ["Client Due", "clientDue"],
  clientComment: ["Client Comment", null],
  state: ["State", "state"],
  comment: ["Comment / Notes", null],
  billing: ["Billing", null],
  edit: ["", null],
};

const dueCell = (item) => {
  const parts = [];
  if (item.internalDueDate) parts.push(`<div>${escapeHtml(fmt(item.internalDueDate))}</div>`);
  else if (item.internalDueText) parts.push(`<div class="muted tm-small">${escapeHtml(item.internalDueText)}</div>`);
  else if (!item.responseDueDate) parts.push(`<div class="muted">—</div>`);
  const badges = [];
  if (item.isClosed) badges.push(chip("Closed"));
  else if (item.effectiveDueDate) {
    const days = daysUntil(item.effectiveDueDate);
    if (days !== null && days < 0) badges.push(chip(`Overdue ${-days}d`, "danger"));
    else if (days !== null && days <= dueSoonDays(item.stage)) badges.push(chip(days === 0 ? "Due today" : `Due in ${days}d`, "amber"));
  }
  if (item.extra && item.extra.grace) badges.push(chip("Grace period", "neutral"));
  if (item.openDeadlineCount) badges.push(chip(`+${item.openDeadlineCount} deadline${item.openDeadlineCount > 1 ? "s" : ""}`, "neutral"));
  return parts.join("") + (badges.length ? `<div class="tm-badges">${badges.join("")}</div>` : "");
};

const responseCell = (item) => {
  if (!item.responseDueDate) {
    return item.responseDueText ? `<div class="muted tm-small">${escapeHtml(item.responseDueText)}</div>` : `<span class="muted">—</span>`;
  }
  const days = daysUntil(item.responseDueDate);
  const badge =
    !item.isClosed && days !== null && days <= 7
      ? `<div class="tm-badges">${chip(days < 0 ? "Final passed" : "Final ≤ 7d", "danger")}</div>`
      : "";
  return `<div>${escapeHtml(fmt(item.responseDueDate))}</div>${badge}`;
};

const clientCell = (client) => {
  if (!client) return `<span class="muted">—</span>`;
  const flags = [];
  if (client.isUnresponsive) flags.push(chip("Unresponsive", "amber"));
  if (client.paymentRisk) flags.push(chip("Payment risk", "danger"));
  return `<div>${escapeHtml(client.name)}</div>${flags.length ? `<div class="tm-badges">${flags.join("")}</div>` : ""}`;
};

const BILLING_BOXES = [
  ["reported", "R", "Reported"],
  ["readyToBill", "RB", "Ready to bill"],
  ["servicesEntered", "S", "Services entered"],
  ["expensesEntered", "E", "Expenses entered"],
  ["invoiced", "I", "Invoiced"],
];

const billingCell = (item) => {
  const boxes = BILLING_BOXES.map(
    ([key, short, title]) =>
      `<label class="tm-bill-box" title="${title}"><input type="checkbox" data-action="billing" data-field="${key}" data-id="${item.id}"${item[key] ? " checked" : ""} /><span>${short}</span></label>`
  ).join("");
  const unbilled = item.isClosed && !item.invoiced && item.billingState !== "none" ? chip("Closed, not invoiced", "danger") : "";
  return `<div class="tm-bill">${boxes}</div>${unbilled ? `<div class="tm-badges">${unbilled}</div>` : ""}`;
};

const cellHtml = (col, item) => {
  const m = item.matter;
  switch (col) {
    case "due":
      return dueCell(item);
    case "response":
      return responseCell(item);
    case "stage":
      return escapeHtml(stageLabel(item.stage));
    case "matter": {
      const review = item.needsReview || m.needsReview ? `<div class="tm-badges">${chip("Review", "amber")}</div>` : "";
      const juris = m.jurisdiction && m.jurisdiction !== "US" ? ` <span class="muted tm-small">${escapeHtml(m.jurisdiction)}</span>` : "";
      return `<span class="mono">${escapeHtml(m.matterNo || "—")}</span>${juris}${review}`;
    }
    case "client":
      return clientCell(item.client);
    case "brand":
      if (item.stage === "contentious") {
        return `${escapeHtml(m.title || item.brand || m.markText || "—")}${m.proceedingNo ? `<div class="muted tm-small">No. ${escapeHtml(m.proceedingNo)}</div>` : ""}`;
      }
      return escapeHtml(item.brand || m.markText || "—");
    case "action": {
      const label = actionLabelFor(item.actionType);
      const raw = item.actionLabel && item.actionLabel !== label ? `<div class="muted tm-small tm-clamp">${escapeHtml(item.actionLabel)}</div>` : "";
      return `${escapeHtml(label)}${raw}`;
    }
    case "appStatus":
      return `<select class="tm-inline-select" data-action="app-status" data-matter-id="${m.id}" aria-label="Application status">${options(state.meta.applicationStatuses, m.applicationStatus || "", { blank: "—" })}</select>`;
    case "clientRef":
      return escapeHtml(m.clientRef || "");
    case "clientDue":
      return item.clientDueDate ? escapeHtml(fmt(item.clientDueDate)) : `<span class="muted tm-small">${escapeHtml(item.clientDueText || "")}</span>`;
    case "clientComment":
      return `<div class="tm-clamp" title="${escapeHtml(item.clientComment || "")}">${escapeHtml(item.clientComment || "")}</div>`;
    case "state":
      return `<select class="tm-inline-select" data-action="state" data-id="${item.id}" aria-label="Work state">${options(state.meta.workStates, item.workState)}</select>`;
    case "comment": {
      const notes = item.meetingNotes ? `<div class="muted tm-small tm-clamp" title="${escapeHtml(item.meetingNotes)}">Meeting: ${escapeHtml(item.meetingNotes)}</div>` : "";
      return `<div class="tm-clamp" title="${escapeHtml(item.comment || "")}">${escapeHtml(item.comment || "")}</div>${notes}`;
    }
    case "billing":
      return billingCell(item);
    case "edit":
      return `<button class="ghost-button" data-action="edit" data-id="${item.id}" type="button">${item.isClosed ? "Open" : "Edit"}</button>`;
    default:
      return "";
  }
};

const renderItems = () => {
  const cols = columnsForView();
  const items = sortedItems();
  if (!items.length) {
    els.content.innerHTML = `<div class="muted tm-empty">Nothing here${state.filters.q ? " for that search" : ""}.</div>`;
    return;
  }
  const head = cols
    .map((c) => {
      const [label, sortKey] = COLUMN_HEADERS[c];
      if (!sortKey) return `<th class="tm-col-${c}">${escapeHtml(label)}</th>`;
      const arrow = state.sort.key === sortKey ? (state.sort.dir === 1 ? " ▲" : " ▼") : "";
      return `<th class="tm-col-${c}"><button class="tm-sort" data-sort="${sortKey}" type="button">${escapeHtml(label)}${arrow}</button></th>`;
    })
    .join("");
  const rows = items
    .map((item) => `<tr class="${item.isClosed ? "tm-row-closed" : ""}" data-item-id="${item.id}">${cols.map((c) => `<td class="tm-col-${c}">${cellHtml(c, item)}</td>`).join("")}</tr>`)
    .join("");
  const more = state.hasMore ? `<div class="tm-more"><button class="ghost-button" data-action="more" type="button">Load more</button></div>` : "";
  els.content.innerHTML = `
    <div class="muted tm-count-line">${items.length} item${items.length === 1 ? "" : "s"}${state.hasMore ? "+" : ""}</div>
    <div class="table-wrap tm-table-wrap"><table class="tm-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${more}`;
};

const replaceItem = (item) => {
  const idx = state.items.findIndex((i) => i.id === item.id);
  if (idx >= 0) state.items[idx] = item;
};

// Closing asks for confirmation if the server says billing isn't finished.
const setItemState = async (id, body) => {
  try {
    return (await api(`/items/${id}/state`, "PUT", body)).item;
  } catch (err) {
    if (err.code === "UNBILLED" && window.confirm(err.message)) {
      return (await api(`/items/${id}/state`, "PUT", { ...body, confirmUnbilled: true })).item;
    }
    throw err;
  }
};

// ---------------------------------------------------------------------------
// To-dos
// ---------------------------------------------------------------------------
const renderTodos = (todos) => {
  const q = state.filters.q.toLowerCase();
  const list = q ? todos.filter((t) => `${t.actionItem || ""} ${t.emailSubject || ""} ${t.matterNo || ""}`.toLowerCase().includes(q)) : todos;
  const row = (t) => `
    <tr data-todo-id="${t.id}" class="${t.status === "done" ? "tm-row-closed" : ""}">
      <td>${t.dueDate ? escapeHtml(fmt(t.dueDate)) : `<span class="muted tm-small">${escapeHtml(t.dueText || "")}</span>`}</td>
      <td>${escapeHtml(fmt(t.receivedDate))}</td>
      <td>${t.kind === "note" ? chip("Note") + " " : ""}${escapeHtml(t.actionItem || "")}</td>
      <td class="tm-clamp" title="${escapeHtml(t.emailSubject || "")}">${escapeHtml(t.emailSubject || "")}</td>
      <td class="mono">${escapeHtml(t.matterNo || "")}</td>
      <td>${escapeHtml(t.assignedToName || t.assigneeInitials || "")}</td>
      <td><select class="tm-inline-select" data-action="todo-status" data-id="${t.id}" aria-label="Status">${options(
        state.meta.todoStatuses.map((s) => ({ key: s, label: s.replace("_", " ") })),
        t.status
      )}</select></td>
      <td><input class="tm-inline-input" data-action="todo-note" data-id="${t.id}" value="${escapeHtml(t.statusNote || "")}" aria-label="Status note" /></td>
      <td><button class="ghost-button" data-action="todo-hide" data-id="${t.id}" type="button">Remove</button></td>
    </tr>`;
  els.content.innerHTML = `
    <form id="tm-todo-form" class="tm-inline-form">
      <input name="actionItem" placeholder="Action item" required />
      <input name="emailSubject" placeholder="Email subject" />
      <label class="tm-check">Due <input name="dueDate" type="date" /></label>
      <label class="tm-check">Received <input name="receivedDate" type="date" /></label>
      <button class="ghost-button" type="submit">Add to-do</button>
    </form>
    ${list.length ? `<div class="table-wrap tm-table-wrap"><table class="tm-table">
      <thead><tr><th>Due</th><th>Received</th><th>Action Item</th><th>Email Subject</th><th>Matter</th><th>Who</th><th>Status</th><th>Status Note</th><th></th></tr></thead>
      <tbody>${list.map(row).join("")}</tbody></table></div>` : `<div class="muted tm-empty">No open to-dos.</div>`}`;
};

// ---------------------------------------------------------------------------
// Billing questions
// ---------------------------------------------------------------------------
const renderQuestions = (questions) => {
  const row = (q) => `
    <tr data-question-id="${q.id}" class="${q.isResolved ? "tm-row-closed" : ""}">
      <td class="mono">${escapeHtml(q.scope === "all" ? "All matters" : q.matterNo || "—")}</td>
      <td>${escapeHtml(q.question)}</td>
      <td><textarea class="tm-inline-input" rows="2" data-action="question-answer" data-id="${q.id}" aria-label="Answer">${escapeHtml(q.answer || "")}</textarea></td>
      <td><label class="tm-check"><input type="checkbox" data-action="question-resolved" data-id="${q.id}"${q.isResolved ? " checked" : ""} /> Resolved</label></td>
    </tr>`;
  els.content.innerHTML = `
    <form id="tm-question-form" class="tm-inline-form">
      <input name="matterNo" placeholder="Matter no. (blank = all)" />
      <input name="question" placeholder="Question" required class="tm-grow" />
      <button class="ghost-button" type="submit">Add question</button>
    </form>
    ${questions.length ? `<div class="table-wrap tm-table-wrap"><table class="tm-table">
      <thead><tr><th>Matter</th><th>Question</th><th>Answer</th><th></th></tr></thead>
      <tbody>${questions.map(row).join("")}</tbody></table></div>` : `<div class="muted tm-empty">No billing questions.</div>`}`;
};

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
const renderClients = () => {
  const q = state.filters.q.toLowerCase();
  const list = q
    ? state.clients.filter((c) => `${c.name} ${(c.aliases || []).join(" ")}`.toLowerCase().includes(q))
    : state.clients;
  const admin = isAdmin();
  const mergeTargets = state.clients.map((c) => ({ key: c.id, label: c.name }));
  const row = (c) => `
    <tr data-client-id="${c.id}">
      <td><div>${escapeHtml(c.name)}</div>${c.aliases.length ? `<div class="muted tm-small">aka ${escapeHtml(c.aliases.join(", "))}</div>` : ""}
        ${c.needsReview ? `<div class="tm-badges">${chip("Review", "amber", (c.reviewReasons || []).map((r) => state.meta.reviewReasons[r] || r).join("; "))}
          <button class="ghost-button tm-tiny" data-action="client-reviewed" data-id="${c.id}" type="button">Mark reviewed</button></div>` : ""}</td>
      <td><select class="tm-inline-select" data-action="client-field" data-field="kind" data-id="${c.id}" aria-label="Kind">${options(
        state.meta.clientKinds.map((k) => ({ key: k, label: k === "agent_firm" ? "Agent / referring firm" : "Direct client" })),
        c.kind
      )}</select></td>
      <td><input type="checkbox" data-action="client-field" data-field="hasPortfolioView" data-id="${c.id}"${c.hasPortfolioView ? " checked" : ""} aria-label="Portfolio tab" /></td>
      <td><input type="checkbox" data-action="client-field" data-field="isUnresponsive" data-id="${c.id}"${c.isUnresponsive ? " checked" : ""} aria-label="Unresponsive" /></td>
      <td><input type="checkbox" data-action="client-field" data-field="paymentRisk" data-id="${c.id}"${c.paymentRisk ? " checked" : ""} aria-label="Payment risk" /></td>
      <td><input class="tm-inline-input" data-action="client-field" data-field="contactNote" data-id="${c.id}" value="${escapeHtml(c.contactNote || "")}" aria-label="Contact note" /></td>
      <td>${c.matterCount ?? ""}</td>
      <td><button class="tm-link" data-action="client-open" data-id="${c.id}" type="button">${c.openItemCount ?? 0}</button></td>
      ${admin ? `<td><div class="tm-merge"><select data-merge-target="${c.id}" aria-label="Merge into">${options(
        mergeTargets.filter((t) => t.key !== c.id),
        "",
        { blank: "Merge into…" }
      )}</select><button class="ghost-button tm-tiny" data-action="client-merge" data-id="${c.id}" type="button">Merge</button></div></td>` : ""}
    </tr>`;
  els.content.innerHTML = `
    <form id="tm-client-form" class="tm-inline-form">
      <input name="name" placeholder="New client name" required class="tm-grow" />
      <button class="ghost-button" type="submit">Add client</button>
    </form>
    <div class="muted tm-count-line">${list.length} client${list.length === 1 ? "" : "s"}</div>
    <div class="table-wrap tm-table-wrap"><table class="tm-table">
      <thead><tr><th>Client</th><th>Kind</th><th>Portfolio tab</th><th>Unresponsive</th><th>Payment risk</th><th>Contact note</th><th>Matters</th><th>Open items</th>${admin ? "<th>Merge</th>" : ""}</tr></thead>
      <tbody>${list.map(row).join("")}</tbody></table></div>`;
};

// ---------------------------------------------------------------------------
// Item modal (edit + create)
// ---------------------------------------------------------------------------
const field = (label, inner, cls = "") => `<label class="form-field ${cls}"><span>${escapeHtml(label)}</span>${inner}</label>`;
const input = (name, value, type = "text", extra = "") =>
  `<input name="${name}" type="${type}" value="${escapeHtml(value ?? "")}" ${extra} />`;
const textarea = (name, value, rows = 3) => `<textarea name="${name}" rows="${rows}">${escapeHtml(value ?? "")}</textarea>`;
const select = (name, list, value, blank = null) => `<select name="${name}">${options(list, value ?? "", { blank })}</select>`;

const openModal = (modal) => modal.classList.remove("hidden");
const closeModal = (modal) => modal.classList.add("hidden");

const SUGGESTION_LABELS = {
  responseDueDate: "Response deadline",
  internalDueDate: "Internal deadline",
  extendedDueDate: "With extension",
  finalDueDate: "Final possible",
  windowOpens: "Window opens",
  graceEnds: "Grace period ends",
};

const renderItemForm = (detail) => {
  const creating = !detail;
  const item = detail ? detail.item : { stage: viewStage() || "office_action", workState: "open", matter: {}, extra: {} };
  const m = item.matter || {};
  const meta = state.meta;
  const reasons = [...new Set([...(item.reviewReasons || []), ...(m.reviewReasons || [])])];

  const matterSection = creating
    ? `<div class="form-grid tm-form-grid">
        ${field("Matter no.", input("matterNo", "", "text", 'required placeholder="3T12345"'))}
        ${field("Client", input("clientName", viewClientId() ? meta.portfolioClients.find((c) => c.id === viewClientId())?.name : "", "text", 'list="tm-client-names"'))}
        ${field("Mark", input("markText", ""))}
        <datalist id="tm-client-names">${(state.clients.length ? state.clients : meta.portfolioClients).map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join("")}</datalist>
      </div>
      <div class="muted tm-small tm-pad">If the matter number already exists, the item is added to that matter.</div>`
    : `<div class="tm-matter-head"><span class="mono">${escapeHtml(m.matterNo || "—")}</span> · ${escapeHtml(item.client?.name || "No client")} · ${escapeHtml(m.markText || m.title || "")}</div>
      <div class="form-grid tm-form-grid">
        ${field("Application status", select("m_applicationStatus", meta.applicationStatuses, m.applicationStatus, "—"))}
        ${field("Jurisdiction", input("m_jurisdiction", m.jurisdiction))}
        ${field("Serial no.", input("m_serialNo", m.serialNo))}
        ${field("Registration no.", input("m_registrationNo", m.registrationNo))}
        ${field("Filing date", input("m_filingDate", m.filingDate, "date"))}
        ${field("Registration date", input("m_registrationDate", m.registrationDate, "date"))}
        ${field("NOA date", input("m_noaDate", m.noaDate, "date"))}
        ${item.stage === "contentious" ? field("Proceeding no.", input("m_proceedingNo", m.proceedingNo)) : ""}
      </div>`;

  const suggestions = (detail?.suggestions || [])
    .map((s) => {
      const target = ["responseDueDate", "internalDueDate"].includes(s.field) ? s.field : null;
      const apply = target ? `<button class="ghost-button tm-tiny" data-apply-field="${target}" data-apply-date="${s.date}" type="button">Apply</button>` : "";
      return `<li>${chip("Verify", "amber")} <strong>${escapeHtml(SUGGESTION_LABELS[s.field] || s.field)}:</strong> ${escapeHtml(fmt(s.date))} <span class="muted">— ${escapeHtml(s.rule)}</span> ${apply}</li>`;
    })
    .join("");

  const deadlines = detail
    ? `<div class="tm-section-title">Extra deadlines</div>
      <ul class="tm-deadlines">${detail.deadlines
        .map(
          (dl) => `<li>
            <label class="tm-check"><input type="checkbox" data-deadline-done="${dl.id}"${dl.isDone ? " checked" : ""} /> ${escapeHtml(dl.label)}</label>
            <span>${escapeHtml(fmt(dl.dueDate))}</span>
            ${dl.needsReview ? chip("Verify", "amber", dl.sourceText || "") : ""}
            <button class="ghost-button tm-tiny" data-deadline-remove="${dl.id}" type="button">Remove</button>
          </li>`
        )
        .join("") || `<li class="muted">None</li>`}</ul>
      <div class="tm-inline-form tm-pad">
        <input data-new-deadline="label" placeholder="Label (e.g. Discovery closes)" />
        <input data-new-deadline="date" type="date" />
        <button class="ghost-button" data-action="add-deadline" type="button">Add deadline</button>
      </div>`
    : "";

  const review = reasons.length
    ? `<div class="tm-review-box">
        <div><strong>Flagged for review</strong>${item.sourceTab ? ` <span class="muted tm-small">(from workbook tab "${escapeHtml(item.sourceTab)}", row ${escapeHtml(item.sourceRow)})</span>` : ""}</div>
        <ul>${reasons.map((r) => `<li>${escapeHtml(meta.reviewReasons[r] || r)}</li>`).join("")}</ul>
        <button class="ghost-button" data-action="mark-reviewed" type="button">Mark reviewed</button>
      </div>`
    : "";

  const extra = item.extra && Object.keys(item.extra).length
    ? `<div class="muted tm-small tm-pad">Workbook extras: ${escapeHtml(JSON.stringify(item.extra))}</div>`
    : "";

  const history = detail && detail.history.length
    ? `<div class="tm-section-title">History</div><ul class="tm-history">${detail.history
        .map((h) => `<li><span class="muted">${escapeHtml(new Date(h.at).toLocaleString())}</span> ${escapeHtml(h.action.replace("trademark.", ""))} — ${escapeHtml(h.by || "")}</li>`)
        .join("")}</ul>`
    : "";

  els.itemForm.innerHTML = `
    ${review}
    <div class="tm-section-title">Matter</div>
    ${matterSection}
    <div class="tm-section-title">Item</div>
    <div class="form-grid tm-form-grid">
      ${field("Stage", select("stage", meta.stages, item.stage))}
      ${field("Action type", select("actionType", meta.actionTypes, item.actionType || ""))}
      ${field("Action (free text)", input("actionLabel", item.actionLabel))}
      ${field("Brand", input("brand", item.brand))}
      ${field("Work state", select("workState", meta.workStates, item.workState))}
    </div>
    <div class="tm-section-title">Deadlines</div>
    <div class="form-grid tm-form-grid">
      ${field("Internal deadline", input("internalDueDate", item.internalDueDate, "date"))}
      ${field("Internal deadline note", input("internalDueText", item.internalDueText))}
      ${field("Response deadline", input("responseDueDate", item.responseDueDate, "date"))}
      ${field("Response deadline note", input("responseDueText", item.responseDueText))}
      ${field("Trigger date (OA issued)", input("triggerDate", item.triggerDate, "date"))}
      ${field("Client due date", input("clientDueDate", item.clientDueDate, "date"))}
      ${field("Client due note", input("clientDueText", item.clientDueText))}
      ${field("Email received", input("receivedDate", item.receivedDate, "date"))}
    </div>
    ${suggestions ? `<ul class="tm-suggestions">${suggestions}</ul>` : ""}
    ${deadlines}
    <div class="tm-section-title">Notes</div>
    <div class="form-grid tm-form-grid">
      ${field("Comment", textarea("comment", item.comment), "tm-span-2")}
      ${field("Client comment", textarea("clientComment", item.clientComment, 2))}
      ${field("Docket meeting notes", textarea("meetingNotes", item.meetingNotes, 2))}
    </div>
    <div class="tm-section-title">Billing</div>
    <div class="tm-bill tm-pad">${BILLING_BOXES.map(
      ([key, , title]) => `<label class="tm-check"><input type="checkbox" name="b_${key}"${item[key] ? " checked" : ""} /> ${title}</label>`
    ).join("")}
      <label class="tm-check">Cost estimate ${input("costEstimate", item.costEstimate)}</label>
    </div>
    ${extra}
    ${history}`;

  els.itemActions.innerHTML = creating
    ? `<button class="ghost-button" data-action="save-item" type="button">Create</button>`
    : `${item.isHidden ? "" : `<button class="ghost-button" data-action="delete-item" type="button">Delete</button>`}
       <button class="ghost-button" data-action="toggle-close" type="button">${item.isClosed ? "Reopen" : "Close item"}</button>
       <button class="ghost-button" data-action="save-item" type="button">Save</button>`;
};

const openItemModal = async (id) => {
  els.itemError.textContent = "";
  state.editing = null;
  if (!id) {
    els.itemModalTitle.textContent = "New Docket Item";
    renderItemForm(null);
    openModal(els.itemModal);
    return;
  }
  els.itemModalTitle.textContent = "Docket Item";
  els.itemForm.innerHTML = `<div class="muted tm-pad">Loading…</div>`;
  els.itemActions.innerHTML = "";
  openModal(els.itemModal);
  try {
    const detail = await api(`/items/${id}?today=${todayIso()}`);
    state.editing = detail;
    renderItemForm(detail);
  } catch (err) {
    els.itemError.textContent = err.message;
  }
};

const ITEM_TEXT_FIELDS = [
  "stage", "actionType", "actionLabel", "brand", "workState", "internalDueDate", "internalDueText", "responseDueDate",
  "responseDueText", "triggerDate", "clientDueDate", "clientDueText", "receivedDate", "comment", "clientComment",
  "meetingNotes", "costEstimate",
];
const MATTER_FORM_FIELDS = ["applicationStatus", "jurisdiction", "serialNo", "registrationNo", "filingDate", "registrationDate", "noaDate", "proceedingNo"];

const norm = (v) => (v === undefined || v === null ? "" : String(v));

const saveItemForm = async () => {
  const form = els.itemForm;
  const val = (name) => (form.elements[name] ? form.elements[name].value.trim() : undefined);
  const detail = state.editing;
  els.itemError.textContent = "";
  try {
    if (!detail) {
      const body = { matter: { matterNo: val("matterNo"), clientName: val("clientName"), markText: val("markText") } };
      ITEM_TEXT_FIELDS.forEach((f) => {
        const v = val(f);
        if (v) body[f] = v;
      });
      const { item } = await api("/items", "POST", body);
      const billing = {};
      BILLING_BOXES.forEach(([key]) => {
        if (form.elements[`b_${key}`].checked) billing[key] = true;
      });
      if (Object.keys(billing).length) await api(`/items/${item.id}/billing`, "PUT", billing);
      closeModal(els.itemModal);
      await refresh();
      return;
    }
    const item = detail.item;
    const changes = {};
    ITEM_TEXT_FIELDS.filter((f) => f !== "workState" && f !== "costEstimate").forEach((f) => {
      const v = val(f);
      if (v !== undefined && v !== norm(item[f])) changes[f] = v || null;
    });
    const matterChanges = {};
    MATTER_FORM_FIELDS.forEach((f) => {
      const v = val(`m_${f}`);
      if (v !== undefined && v !== norm(item.matter[f])) matterChanges[f] = v || null;
    });
    const billing = {};
    BILLING_BOXES.forEach(([key]) => {
      const checked = form.elements[`b_${key}`].checked;
      if (checked !== Boolean(item[key])) billing[key] = checked;
    });
    if (val("costEstimate") !== norm(item.costEstimate)) billing.costEstimate = val("costEstimate") || null;
    if (Object.keys(changes).length) await api(`/items/${item.id}`, "PUT", changes);
    if (Object.keys(matterChanges).length) await api(`/matters/${item.matterId}`, "PUT", matterChanges);
    if (Object.keys(billing).length) await api(`/items/${item.id}/billing`, "PUT", billing);
    if (val("workState") !== item.workState) await setItemState(item.id, { workState: val("workState") });
    closeModal(els.itemModal);
    await refresh();
  } catch (err) {
    els.itemError.textContent = err.message;
  }
};

// ---------------------------------------------------------------------------
// Deleted items
// ---------------------------------------------------------------------------
const openDeleted = async () => {
  els.deletedError.textContent = "";
  els.deletedBody.innerHTML = `<div class="muted tm-pad">Loading…</div>`;
  openModal(els.deletedModal);
  try {
    const { items } = await api("/items/hidden");
    els.deletedBody.innerHTML = items.length
      ? `<table class="tm-table"><thead><tr><th>Matter</th><th>Client</th><th>Brand</th><th>Stage</th><th>Due</th><th></th></tr></thead><tbody>${items
          .map(
            (i) => `<tr><td class="mono">${escapeHtml(i.matter.matterNo || "")}</td><td>${escapeHtml(i.client?.name || "")}</td>
              <td>${escapeHtml(i.brand || i.matter.markText || "")}</td><td>${escapeHtml(stageLabel(i.stage))}</td>
              <td>${escapeHtml(fmt(i.effectiveDueDate))}</td>
              <td><button class="ghost-button" data-restore="${i.id}" type="button">Restore</button></td></tr>`
          )
          .join("")}</tbody></table>`
      : `<div class="muted tm-pad">No deleted items.</div>`;
  } catch (err) {
    els.deletedError.textContent = err.message;
  }
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
els.tabs.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-view]");
  if (!btn) return;
  state.view = btn.dataset.view;
  state.sort = state.view === "closed" ? { key: null, dir: 1 } : { key: "due", dir: 1 };
  renderTabs();
  loadView();
});

els.subtabs.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-sub]");
  if (!btn) return;
  state.billingSub = btn.dataset.sub;
  loadView();
});

const rerenderLocal = () => {
  if (state.view === "clients") renderClients();
  else loadView();
};
els.search.addEventListener("input", debounce(() => {
  state.filters.q = els.search.value.trim();
  rerenderLocal();
}, 250));
[
  [els.filterClient, "clientId"],
  [els.filterState, "state"],
  [els.filterFamily, "family"],
].forEach(([el, key]) =>
  el.addEventListener("change", () => {
    state.filters[key] = el.value;
    loadView();
  })
);
els.filterClosed.addEventListener("change", () => {
  state.filters.includeClosed = els.filterClosed.checked;
  loadView();
});
els.filterReview.addEventListener("change", () => {
  state.filters.needsReview = els.filterReview.checked;
  loadView();
});

els.content.addEventListener("click", async (event) => {
  const sortBtn = event.target.closest("[data-sort]");
  if (sortBtn) {
    const key = sortBtn.dataset.sort;
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: 1 };
    renderItems();
    return;
  }
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const { action, id } = btn.dataset;
  showError("");
  try {
    if (action === "edit") await openItemModal(id);
    else if (action === "more") {
      state.offset += 200;
      await loadView({ append: true });
    } else if (action === "todo-hide") {
      await api(`/todos/${id}`, "PUT", { isHidden: true });
      await refresh();
    } else if (action === "client-reviewed") {
      await api(`/clients/${id}`, "PUT", { needsReview: false });
      await loadView();
    } else if (action === "client-open") {
      state.view = "due";
      state.filters.clientId = id;
      els.filterClient.value = id;
      renderTabs();
      await loadView();
    } else if (action === "client-merge") {
      const target = els.content.querySelector(`[data-merge-target="${id}"]`).value;
      if (!target) return showError("Choose the client to merge into.");
      const from = state.clients.find((c) => c.id === id);
      const to = state.clients.find((c) => c.id === target);
      if (!window.confirm(`Merge "${from.name}" into "${to.name}"? Its matters move to "${to.name}" and "${from.name}" becomes an alias.`)) return;
      await api(`/clients/${id}/merge`, "POST", { targetId: target });
      await refresh();
    }
  } catch (err) {
    showError(err.message);
  }
});

els.content.addEventListener("change", async (event) => {
  const el = event.target;
  const { action, id, field: fieldName } = el.dataset;
  if (!action) return;
  showError("");
  try {
    if (action === "state") {
      replaceItem(await setItemState(id, { workState: el.value }));
      loadStats();
    } else if (action === "billing") {
      const { item } = await api(`/items/${id}/billing`, "PUT", { [fieldName]: el.checked });
      replaceItem(item);
      renderItems();
      loadStats();
    } else if (action === "app-status") {
      await api(`/matters/${el.dataset.matterId}`, "PUT", { applicationStatus: el.value || null });
      state.items.filter((i) => i.matterId === el.dataset.matterId).forEach((i) => {
        i.matter.applicationStatus = el.value || null;
      });
    } else if (action === "todo-status") {
      await api(`/todos/${id}`, "PUT", { status: el.value });
      loadStats();
    } else if (action === "todo-note") {
      await api(`/todos/${id}`, "PUT", { statusNote: el.value });
    } else if (action === "question-answer") {
      await api(`/billing-questions/${id}`, "PUT", { answer: el.value });
    } else if (action === "question-resolved") {
      await api(`/billing-questions/${id}`, "PUT", { isResolved: el.checked });
      loadStats();
    } else if (action === "client-field") {
      const value = el.type === "checkbox" ? el.checked : el.value;
      const { client } = await api(`/clients/${id}`, "PUT", { [fieldName]: value });
      const idx = state.clients.findIndex((c) => c.id === id);
      if (idx >= 0) state.clients[idx] = { ...state.clients[idx], ...client };
      if (fieldName === "hasPortfolioView") {
        state.meta = await api("/meta");
        renderTabs();
      }
    }
  } catch (err) {
    showError(err.message);
    if (isItemView()) renderItems();
  }
});

els.content.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());
  showError("");
  try {
    if (form.id === "tm-todo-form") {
      await api("/todos", "POST", {
        actionItem: data.actionItem,
        emailSubject: data.emailSubject || null,
        dueDate: data.dueDate || null,
        receivedDate: data.receivedDate || null,
      });
    } else if (form.id === "tm-question-form") {
      await api("/billing-questions", "POST", {
        question: data.question,
        matterNo: data.matterNo || null,
        scope: data.matterNo ? "matter" : "all",
      });
    } else if (form.id === "tm-client-form") {
      await api("/clients", "POST", { name: data.name });
    }
    await refresh();
  } catch (err) {
    showError(err.message);
  }
});

els.itemModal.addEventListener("click", async (event) => {
  const apply = event.target.closest("[data-apply-field]");
  if (apply) {
    const target = els.itemForm.elements[apply.dataset.applyField];
    if (target && !target.value) target.value = apply.dataset.applyDate;
    else els.itemError.textContent = "That field already has a date — clear it first to apply the suggestion.";
    return;
  }
  const btn = event.target.closest("button[data-action], button[data-deadline-remove]");
  if (!btn) return;
  const detail = state.editing;
  els.itemError.textContent = "";
  try {
    if (btn.dataset.deadlineRemove) {
      await api(`/deadlines/${btn.dataset.deadlineRemove}`, "PUT", { isHidden: true });
      return openItemModal(detail.item.id);
    }
    const action = btn.dataset.action;
    if (action === "save-item") await saveItemForm();
    else if (action === "toggle-close") {
      await setItemState(detail.item.id, { isClosed: !detail.item.isClosed });
      closeModal(els.itemModal);
      await refresh();
    } else if (action === "delete-item") {
      if (!window.confirm("Delete this docket item? You can restore it from View Deleted.")) return;
      await setItemState(detail.item.id, { isHidden: true });
      closeModal(els.itemModal);
      await refresh();
    } else if (action === "mark-reviewed") {
      await api(`/items/${detail.item.id}/review`, "PUT", { includeMatter: true });
      await openItemModal(detail.item.id);
      loadStats();
      if (state.view === "review") loadView();
    } else if (action === "add-deadline") {
      const label = els.itemForm.querySelector('[data-new-deadline="label"]').value.trim();
      const dueDate = els.itemForm.querySelector('[data-new-deadline="date"]').value;
      if (!label) {
        els.itemError.textContent = "Enter a label for the deadline.";
        return;
      }
      await api(`/items/${detail.item.id}/deadlines`, "POST", { label, dueDate: dueDate || null });
      await openItemModal(detail.item.id);
    }
  } catch (err) {
    els.itemError.textContent = err.message;
  }
});

els.itemModal.addEventListener("change", async (event) => {
  const box = event.target.closest("[data-deadline-done]");
  if (!box) return;
  try {
    await api(`/deadlines/${box.dataset.deadlineDone}`, "PUT", { isDone: box.checked });
  } catch (err) {
    els.itemError.textContent = err.message;
  }
});

els.deletedModal.addEventListener("click", async (event) => {
  const btn = event.target.closest("[data-restore]");
  if (!btn) return;
  try {
    await setItemState(btn.dataset.restore, { isHidden: false });
    await openDeleted();
    await refresh();
  } catch (err) {
    els.deletedError.textContent = err.message;
  }
});

document.querySelectorAll("[data-close-modal]").forEach((btn) =>
  btn.addEventListener("click", () => closeModal(document.getElementById(btn.dataset.closeModal)))
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") [els.itemModal, els.deletedModal].forEach(closeModal);
});

els.newItem.addEventListener("click", async () => {
  if (!state.clients.length) {
    try {
      state.clients = (await api("/clients")).clients;
    } catch (err) {
      /* the datalist just falls back to portfolio clients */
    }
  }
  openItemModal(null);
});
els.viewDeleted.addEventListener("click", openDeleted);

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
const init = async () => {
  readUrlState();
  try {
    state.meta = await api("/meta");
  } catch (err) {
    showError(err.message);
    return;
  }
  els.filterState.innerHTML = options(state.meta.workStates, state.filters.state, { blank: "Any state" });
  els.filterFamily.innerHTML = options(state.meta.matterFamilies, state.filters.family, { blank: "Any family" });
  els.search.value = state.filters.q;
  els.filterClosed.checked = state.filters.includeClosed;
  els.filterReview.checked = state.filters.needsReview;
  try {
    state.clients = (await api("/clients")).clients;
    els.filterClient.innerHTML = options(
      state.clients.map((c) => ({ key: c.id, label: c.name })),
      state.filters.clientId,
      { blank: "All clients" }
    );
  } catch (err) {
    /* client filter stays empty */
  }
  renderTabs();
  await refresh();
};

init();
