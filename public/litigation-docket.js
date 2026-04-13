const tabs = Array.from(document.querySelectorAll(".docket-tabs [data-tab]"));
const casesContainer = document.getElementById("litigation-cases");
const newCaseButton = document.getElementById("new-litigation-case");
const viewHiddenMbfdButton = document.getElementById("view-hidden-mbfd");
const newCaseModal = document.getElementById("new-case-modal");
const closeNewCaseModal = document.getElementById("close-new-case-modal");
const newCaseForm = document.getElementById("new-case-form");
const newCaseError = document.getElementById("new-case-error");
const newMbfdModal = document.getElementById("new-mbfd-modal");
const closeNewMbfdModal = document.getElementById("close-new-mbfd-modal");
const newMbfdForm = document.getElementById("new-mbfd-form");
const newMbfdError = document.getElementById("new-mbfd-error");
const editTitleModal = document.getElementById("edit-title-modal");
const closeEditTitleModal = document.getElementById("close-edit-title-modal");
const editTitleForm = document.getElementById("edit-title-form");
const editTitleError = document.getElementById("edit-title-error");
const collectionsModal = document.getElementById("collections-modal");
const closeCollectionsModal = document.getElementById("close-collections-modal");
const collectionsBody = document.getElementById("collections-body");
const addCollectionRowButton = document.getElementById("add-collection-row");
const saveCollectionsButton = document.getElementById("save-collections");
const collectionsError = document.getElementById("collections-error");
const archiveConfirmModal = document.getElementById("archive-confirm-modal");
const archiveConfirmTitle = document.getElementById("archive-confirm-title");
const archiveConfirmText = document.getElementById("archive-confirm-text");
const closeArchiveConfirmModal = document.getElementById("close-archive-confirm-modal");
const confirmArchiveAction = document.getElementById("confirm-archive-action");
const hiddenActionsModal = document.getElementById("hidden-actions-modal");
const hiddenActionsBody = document.getElementById("hidden-actions-body");
const hiddenActionsError = document.getElementById("hidden-actions-error");
const closeHiddenActionsModal = document.getElementById("close-hidden-actions-modal");
const hiddenMbfdModal = document.getElementById("hidden-mbfd-modal");
const hiddenMbfdBody = document.getElementById("hidden-mbfd-body");
const hiddenMbfdError = document.getElementById("hidden-mbfd-error");
const closeHiddenMbfdModal = document.getElementById("close-hidden-mbfd-modal");

let activeTab = "NDIL";
let openCollectionsCaseId = null;
let pendingArchiveAction = null;
let openHiddenActionsCaseId = null;
let editingCase = null;
let userOptions = [];
let draggingEntryRow = null;
let latestTabRenderId = 0;
const focusCaseId = getParam("caseId");
const focusAction = getParam("action");

const yesNoOptions = `
  <option value=""></option>
  <option value="Yes">Yes</option>
  <option value="No">No</option>
`;

const docketStatusOptions = [
  "",
  "Case Filed",
  "Default Requested",
  "Default Granted",
  "TRO Requested",
  "Negotiating",
  "TRO Signed",
  "Case Closed",
];

const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatCurrency = (value) => {
  if (value === null || value === undefined || value === "") return "—";
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  return numberValue.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
};

const toDateInputValue = (value) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const isDueSoon = (dateValue) => {
  if (!dateValue) return false;
  const due = new Date(dateValue);
  if (Number.isNaN(due.getTime())) return false;
  const now = new Date();
  const diffDays = (due - now) / (1000 * 60 * 60 * 24);
  return diffDays <= 7;
};

const fetchJson = async (url, options) => {
  const response = await authFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
};

const loadEntries = (caseId) => fetchJson(`/api/litigation/cases/${caseId}/entries`);
const loadMbfdItems = () => fetchJson("/api/litigation/mbfd-items");
const loadHiddenMbfdItems = () => fetchJson("/api/litigation/mbfd-items/hidden");
const loadHiddenEntries = (caseId) => fetchJson(`/api/litigation/cases/${caseId}/hidden-entries`);
const saveEntries = (caseId, entries) =>
  fetchJson(`/api/litigation/cases/${caseId}/entries`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
const updateDocketStatus = (caseId, docketStatus) =>
  fetchJson(`/api/litigation/cases/${caseId}/docket-status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docketStatus }),
  });
const updateDocketCase = (caseId, payload) =>
  fetchJson(`/api/cases/${caseId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
const createMbfdItem = (payload) =>
  fetchJson("/api/litigation/mbfd-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
const updateActionState = (actionId, payload) =>
  fetchJson(`/api/litigation/actions/${actionId}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
const updateMbfdItemState = (itemId, payload) =>
  fetchJson(`/api/litigation/mbfd-items/${itemId}/state`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
const loadCollections = (caseId) => fetchJson(`/api/litigation/cases/${caseId}/collections`);
const saveCollections = (caseId, rows) =>
  fetchJson(`/api/litigation/cases/${caseId}/collections`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
const setArchived = (caseId, archived) =>
  fetchJson(`/api/litigation/cases/${caseId}/archive`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  });

const createLitigationCase = (payload) =>
  fetchJson("/api/cases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildUserOptions = (selectedValue) => {
  const options = [`<option value=""></option>`];
  userOptions.forEach((user) => {
    const label = user.name ? `${user.name} (${user.email})` : user.email;
    options.push(
      `<option value="${escapeHtml(user.id)}" ${
        user.id === selectedValue ? "selected" : ""
      }>${escapeHtml(label)}</option>`
    );
  });
  return options.join("");
};

const buildStatusOptions = (selectedValue) =>
  docketStatusOptions
    .map(
      (status) =>
        `<option value="${escapeHtml(status)}" ${
          status === (selectedValue || "") ? "selected" : ""
        }>${escapeHtml(status || "—")}</option>`
    )
    .join("");

const rerenderCasesPreservingScroll = async (caseId) => {
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  const currentCaseCard = caseId
    ? document.querySelector(`.litigation-case[data-case-id="${caseId}"]`)
    : null;
  const cardTopOffset = currentCaseCard ? currentCaseCard.getBoundingClientRect().top : null;
  const renderId = ++latestTabRenderId;
  await renderActiveTab(renderId);
  if (renderId !== latestTabRenderId) return;
  await new Promise((resolve) => window.requestAnimationFrame(resolve));

  if (caseId) {
    const nextCaseCard = document.querySelector(`.litigation-case[data-case-id="${caseId}"]`);
    if (nextCaseCard && cardTopOffset !== null) {
      const nextTopOffset = nextCaseCard.getBoundingClientRect().top;
      window.scrollBy({ left: 0, top: nextTopOffset - cardTopOffset, behavior: "auto" });
      return;
    }
  }

  window.scrollTo(scrollX, scrollY);
};

const renderActiveTab = async (renderId) => {
  if (activeTab === "MBFD") {
    await renderMbfdItems(renderId);
    return;
  }
  await renderCases(activeTab, renderId);
};

const clearEntryDragClasses = (tbody) => {
  tbody?.querySelectorAll("tr").forEach((row) => {
    row.classList.remove("drag-over-above", "drag-over-below");
  });
};

const attachEntryDragBehavior = (row) => {
  const handle = row.querySelector(".drag-handle");
  if (!handle) return;

  handle.addEventListener("dragstart", (event) => {
    draggingEntryRow = row;
    row.classList.add("dragging-row");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.actionId || "new-row");
  });

  handle.addEventListener("dragend", () => {
    row.classList.remove("dragging-row");
    clearEntryDragClasses(row.closest("tbody"));
    draggingEntryRow = null;
  });
};

const renderEntryRow = (entry = {}) => {
  const row = document.createElement("tr");
  if (entry.id) {
    row.dataset.actionId = entry.id;
  }
  row.innerHTML = `
    <td class="drag-cell">
      <span class="drag-handle" draggable="true" title="Drag to reorder">::</span>
    </td>
    <td><textarea class="lit-input lit-textarea action-textarea" data-field="action" rows="2">${escapeHtml(
      entry.action || ""
    )}</textarea></td>
    <td><select class="lit-input" data-field="assignedToUserId">${buildUserOptions(
      entry.assignedToUserId || ""
    )}</select></td>
    <td><input class="lit-input" data-field="internalDueDate" type="date" value="${toDateInputValue(
      entry.internalDueDate
    )}" /></td>
    <td><input class="lit-input" data-field="finalDueDate" type="date" value="${toDateInputValue(
      entry.finalDueDate
    )}" /></td>
    <td><textarea class="lit-input lit-textarea notes-textarea" data-field="notes" rows="3">${escapeHtml(
      entry.notes || ""
    )}</textarea></td>
    <td>
      <div class="row-action-buttons">
        <button class="ghost-button complete-action" type="button" ${
          entry.id ? "" : "disabled"
        }>Complete</button>
        <button class="ghost-button complete-hide-action" type="button" ${
          entry.id ? "" : "disabled"
        }>Complete / Hide</button>
      </div>
    </td>
  `;
  const refreshDueHighlight = () => {
    const internalDue = row.querySelector('[data-field="internalDueDate"]').value;
    const finalDue = row.querySelector('[data-field="finalDueDate"]').value;
    row.classList.toggle(
      "due-soon",
      !row.classList.contains("is-completed") &&
        (isDueSoon(internalDue) || isDueSoon(finalDue))
    );
  };
  row.querySelectorAll('input[type="date"]').forEach((input) => {
    input.addEventListener("change", refreshDueHighlight);
  });
  row.classList.toggle("is-completed", Boolean(entry.isCompleted));
  refreshDueHighlight();
  const actionValue = String(entry.action || "").trim().toLowerCase();
  if (focusAction && actionValue === String(focusAction).trim().toLowerCase()) {
    row.classList.add("focused-docket-row");
  }
  attachEntryDragBehavior(row);
  return row;
};

const readEntryRows = (tbody) =>
  Array.from(tbody.querySelectorAll("tr")).map((row) => ({
    id: row.dataset.actionId || null,
    action: row.querySelector('[data-field="action"]').value.trim(),
    assignedToUserId: row.querySelector('[data-field="assignedToUserId"]').value || null,
    internalDueDate:
      toDateInputValue(row.querySelector('[data-field="internalDueDate"]').value) || null,
    finalDueDate:
      toDateInputValue(row.querySelector('[data-field="finalDueDate"]').value) || null,
    notes: row.querySelector('[data-field="notes"]').value.trim(),
  }));

const populateEntriesTable = (tbody, entries) => {
  tbody.innerHTML = "";
  if (!entries.length) {
    tbody.appendChild(renderEntryRow({}));
    return;
  }
  try {
    entries.forEach((entry) => tbody.appendChild(renderEntryRow(entry)));
  } catch (error) {
    const fallbackRow = document.createElement("tr");
    fallbackRow.innerHTML =
      '<td colspan="6" class="empty-state">Unable to render one or more actions for this case.</td>';
    tbody.appendChild(fallbackRow);
  }
};

const attachEntriesTbodyDragBehavior = (tbody) => {
  if (tbody.dataset.dragBound === "true") return;
  tbody.dataset.dragBound = "true";

  tbody.addEventListener("dragover", (event) => {
    if (!draggingEntryRow) return;
    event.preventDefault();
    const targetRow = event.target.closest("tr");
    if (!targetRow || targetRow === draggingEntryRow || !tbody.contains(targetRow)) return;

    clearEntryDragClasses(tbody);
    const rect = targetRow.getBoundingClientRect();
    const placeAbove = event.clientY < rect.top + rect.height / 2;
    targetRow.classList.add(placeAbove ? "drag-over-above" : "drag-over-below");
  });

  tbody.addEventListener("drop", (event) => {
    if (!draggingEntryRow) return;
    event.preventDefault();
    const targetRow = event.target.closest("tr");
    clearEntryDragClasses(tbody);
    if (!targetRow || targetRow === draggingEntryRow || !tbody.contains(targetRow)) return;

    const rect = targetRow.getBoundingClientRect();
    const placeAbove = event.clientY < rect.top + rect.height / 2;
    if (placeAbove) {
      tbody.insertBefore(draggingEntryRow, targetRow);
    } else {
      tbody.insertBefore(draggingEntryRow, targetRow.nextSibling);
    }
  });

  tbody.addEventListener("dragleave", (event) => {
    if (!tbody.contains(event.relatedTarget)) {
      clearEntryDragClasses(tbody);
    }
  });
};

const renderCollectionRow = (entry = {}) => {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="lit-input" data-field="platform" value="${escapeHtml(
      entry.platform || ""
    )}" /></td>
    <td><input class="lit-input" data-field="sentToPlatform" type="date" value="${toDateInputValue(
      entry.sentToPlatform
    )}" /></td>
    <td><select class="lit-input" data-field="acknowledged">${yesNoOptions}</select></td>
    <td><select class="lit-input" data-field="breakdown">${yesNoOptions}</select></td>
    <td><select class="lit-input" data-field="allDefAccountedFor">${yesNoOptions}</select></td>
    <td><select class="lit-input" data-field="moneyReceived">${yesNoOptions}</select></td>
    <td><select class="lit-input" data-field="sentToPlaintiff">${yesNoOptions}</select></td>
    <td><textarea class="lit-input lit-textarea notes-textarea" data-field="notes" rows="3">${escapeHtml(
      entry.notes || ""
    )}</textarea></td>
  `;
  row.querySelector('[data-field="acknowledged"]').value = entry.acknowledged || "";
  row.querySelector('[data-field="breakdown"]').value = entry.breakdown || "";
  row.querySelector('[data-field="allDefAccountedFor"]').value =
    entry.allDefAccountedFor || "";
  row.querySelector('[data-field="moneyReceived"]').value = entry.moneyReceived || "";
  row.querySelector('[data-field="sentToPlaintiff"]').value = entry.sentToPlaintiff || "";
  return row;
};

const readCollectionRows = () =>
  Array.from(collectionsBody.querySelectorAll("tr")).map((row) => ({
    platform: row.querySelector('[data-field="platform"]').value.trim(),
    sentToPlatform:
      toDateInputValue(row.querySelector('[data-field="sentToPlatform"]').value) || null,
    acknowledged: row.querySelector('[data-field="acknowledged"]').value,
    breakdown: row.querySelector('[data-field="breakdown"]').value,
    allDefAccountedFor: row.querySelector('[data-field="allDefAccountedFor"]').value,
    moneyReceived: row.querySelector('[data-field="moneyReceived"]').value,
    sentToPlaintiff: row.querySelector('[data-field="sentToPlaintiff"]').value,
    notes: row.querySelector('[data-field="notes"]').value.trim(),
  }));

const openCollections = async (caseId) => {
  openCollectionsCaseId = caseId;
  collectionsError.textContent = "";
  collectionsBody.innerHTML = "";
  const rows = await loadCollections(caseId);
  if (!rows.length) {
    collectionsBody.appendChild(renderCollectionRow({}));
  } else {
    rows.forEach((row) => collectionsBody.appendChild(renderCollectionRow(row)));
  }
  collectionsModal.classList.remove("hidden");
};

const closeCollections = () => {
  collectionsModal.classList.add("hidden");
  openCollectionsCaseId = null;
};

const renderHiddenActionRow = (entry = {}) => {
  const row = document.createElement("tr");
  const assignedUser = userOptions.find((user) => user.id === entry.assignedToUserId);
  const assignedLabel = assignedUser
    ? assignedUser.name
      ? `${assignedUser.name} (${assignedUser.email})`
      : assignedUser.email
    : "—";
  const completedLabel = entry.isCompleted
    ? `${formatDateTime(entry.completedAt)}${entry.completedBy ? ` by ${entry.completedBy}` : ""}`
    : "No";
  row.innerHTML = `
    <td>${escapeHtml(entry.action || "—")}</td>
    <td>${escapeHtml(assignedLabel)}</td>
    <td>${escapeHtml(toDateInputValue(entry.internalDueDate) || "—")}</td>
    <td>${escapeHtml(toDateInputValue(entry.finalDueDate) || "—")}</td>
    <td>${escapeHtml(entry.notes || "—")}</td>
    <td>${escapeHtml(completedLabel)}</td>
    <td><button class="ghost-button restore-hidden-action" type="button">Restore</button></td>
  `;
  row.querySelector(".restore-hidden-action").addEventListener("click", async () => {
    hiddenActionsError.textContent = "";
    try {
      await updateActionState(entry.id, {
        isCompleted: Boolean(entry.isCompleted),
        isHidden: false,
      });
      if (openHiddenActionsCaseId) {
        await openHiddenActions(openHiddenActionsCaseId);
      }
      await renderCases(activeTab);
    } catch (error) {
      hiddenActionsError.textContent = error.message || "Unable to restore hidden action.";
    }
  });
  return row;
};

const openHiddenActions = async (caseId) => {
  openHiddenActionsCaseId = caseId;
  hiddenActionsError.textContent = "";
  hiddenActionsBody.innerHTML = "";
  const rows = await loadHiddenEntries(caseId);
  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="7" class="empty-state">No hidden actions for this case.</td>`;
    hiddenActionsBody.appendChild(emptyRow);
  } else {
    rows.forEach((row) => hiddenActionsBody.appendChild(renderHiddenActionRow(row)));
  }
  hiddenActionsModal.classList.remove("hidden");
};

const closeHiddenActions = () => {
  hiddenActionsModal.classList.add("hidden");
  openHiddenActionsCaseId = null;
};

const openEditTitle = (item) => {
  editingCase = item;
  editTitleError.textContent = "";
  editTitleForm.elements.caseName.value = item.caseName || "";
  editTitleForm.elements.caseNumber.value = item.caseNumber || "";
  editTitleForm.elements.judge.value = item.judge || "";
  editTitleForm.elements.defendantCount.value = item.defendantCount ?? 0;
  editTitleForm.elements.defendantCount.disabled = !item.isDocketOnly;
  editTitleModal.classList.remove("hidden");
};

const closeEditTitle = () => {
  editTitleModal.classList.add("hidden");
  editingCase = null;
};

const openNewMbfd = () => {
  newMbfdError.textContent = "";
  newMbfdForm.reset();
  newMbfdModal.classList.remove("hidden");
};

const closeNewMbfd = () => {
  newMbfdModal.classList.add("hidden");
};

const renderHiddenMbfdRow = (item = {}) => {
  const row = document.createElement("tr");
  const completedLabel = item.isCompleted
    ? `${formatDateTime(item.completedAt)}${item.completedBy ? ` by ${item.completedBy}` : ""}`
    : "No";
  row.innerHTML = `
    <td>${escapeHtml(item.caseName || "—")}</td>
    <td>${escapeHtml(item.doeNumber || "—")}</td>
    <td>${escapeHtml(formatCurrency(item.amount))}</td>
    <td>${escapeHtml(item.attorneyEmail || "—")}</td>
    <td>${escapeHtml(completedLabel)}</td>
    <td><button class="ghost-button restore-hidden-mbfd" type="button">Restore</button></td>
  `;
  row.querySelector(".restore-hidden-mbfd").addEventListener("click", async () => {
    hiddenMbfdError.textContent = "";
    try {
      await updateMbfdItemState(item.id, {
        isCompleted: Boolean(item.isCompleted),
        isHidden: false,
      });
      await openHiddenMbfd();
      await renderMbfdItems();
    } catch (error) {
      hiddenMbfdError.textContent = error.message || "Unable to restore MBFD item.";
    }
  });
  return row;
};

const openHiddenMbfd = async () => {
  hiddenMbfdError.textContent = "";
  hiddenMbfdBody.innerHTML = "";
  const rows = await loadHiddenMbfdItems();
  if (!rows.length) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML =
      '<td colspan="6" class="empty-state">No hidden MBFD items.</td>';
    hiddenMbfdBody.appendChild(emptyRow);
  } else {
    rows.forEach((row) => hiddenMbfdBody.appendChild(renderHiddenMbfdRow(row)));
  }
  hiddenMbfdModal.classList.remove("hidden");
};

const closeHiddenMbfd = () => {
  hiddenMbfdModal.classList.add("hidden");
};

const renderMbfdItems = async (renderId = latestTabRenderId) => {
  casesContainer.innerHTML = '<div class="empty-state">Loading...</div>';
  let items = [];
  try {
    items = await loadMbfdItems();
  } catch (error) {
    if (renderId !== latestTabRenderId) return;
    casesContainer.innerHTML = `<div class="empty-state">Unable to load MBFD items: ${escapeHtml(
      error.message || "Request failed"
    )}</div>`;
    return;
  }

  if (renderId !== latestTabRenderId) return;
  casesContainer.innerHTML = "";
  if (!items.length) {
    casesContainer.innerHTML = '<div class="empty-state">No MBFD items.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "table-card litigation-case";
    card.dataset.mbfdId = item.id;
    card.innerHTML = `
      <div class="litigation-case-header">
        <div class="litigation-case-title">${escapeHtml(item.caseName || "—")}</div>
        <div class="litigation-case-meta">Doe #: ${escapeHtml(item.doeNumber || "—")}</div>
        <div class="litigation-case-meta">Amount: ${escapeHtml(formatCurrency(item.amount))}</div>
        <div class="litigation-case-meta">Attorney Email: ${escapeHtml(
          item.attorneyEmail || "—"
        )}</div>
      </div>
      <div class="form-actions">
        <div class="form-error row-error"></div>
        <div class="tab-switch">
          <button class="ghost-button mbfd-complete" type="button">Complete</button>
          <button class="ghost-button mbfd-complete-hide" type="button">Complete / Hide</button>
        </div>
      </div>
    `;

    const rowError = card.querySelector(".row-error");
    card.querySelector(".mbfd-complete").addEventListener("click", async () => {
      rowError.textContent = "";
      try {
        await updateMbfdItemState(item.id, { isCompleted: true, isHidden: false });
        card.classList.add("mbfd-completed");
      } catch (error) {
        rowError.textContent = error.message || "Unable to complete MBFD item.";
      }
    });
    card.querySelector(".mbfd-complete-hide").addEventListener("click", async () => {
      rowError.textContent = "";
      try {
        await updateMbfdItemState(item.id, { isCompleted: true, isHidden: true });
        card.remove();
        if (!casesContainer.querySelector(".litigation-case")) {
          casesContainer.innerHTML = '<div class="empty-state">No MBFD items.</div>';
        }
      } catch (error) {
        rowError.textContent = error.message || "Unable to hide MBFD item.";
      }
    });

    if (item.isCompleted) {
      card.classList.add("mbfd-completed");
    }
    fragment.appendChild(card);
  });
  if (renderId !== latestTabRenderId) return;
  casesContainer.appendChild(fragment);
};

const renderCases = async (tab, renderId = latestTabRenderId) => {
  casesContainer.innerHTML = `<div class="empty-state">Loading...</div>`;
  let cases = [];
  try {
    cases = await fetchJson(`/api/litigation/cases?tab=${encodeURIComponent(tab)}`);
  } catch (error) {
    if (renderId !== latestTabRenderId) return;
    casesContainer.innerHTML = `<div class="empty-state">Unable to load docket cases: ${escapeHtml(
      error.message || "Request failed"
    )}</div>`;
    return;
  }
  if (renderId !== latestTabRenderId) return;
  casesContainer.innerHTML = "";

  if (!cases.length) {
    casesContainer.innerHTML = `<div class="empty-state">No cases in this tab.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of cases) {
    let entries = [];
    let entryLoadError = "";
    try {
      entries = await loadEntries(item.id);
    } catch (error) {
      entryLoadError = error.message || "Unable to load actions.";
    }
    if (renderId !== latestTabRenderId) return;
    const card = document.createElement("div");
    card.className = "table-card litigation-case";
    card.dataset.caseId = item.id;
    if (focusCaseId && item.id === focusCaseId) {
      card.classList.add("focused-docket-case");
    }
    card.innerHTML = `
      <div class="litigation-case-header">
        <div class="litigation-case-title">${escapeHtml(item.caseName || "Case")}</div>
        <div class="litigation-case-meta">${escapeHtml(item.caseNumber || "—")} · ${escapeHtml(
          item.jurisdiction || "—"
        )} · Defendants: ${escapeHtml(item.defendantCount || 0)}</div>
        <div class="litigation-case-meta">Judge: ${escapeHtml(item.judge || "—")}</div>
        <div class="litigation-case-meta">Most recent edit: ${formatDateTime(
          item.mostRecentEditAt
        )} by ${escapeHtml(item.mostRecentEditBy || "—")}</div>
        <div class="litigation-case-status-row">
          <label class="inline-select-field">
            <span>Status</span>
            <select class="lit-input case-status-select" data-case-id="${item.id}">
              ${buildStatusOptions(item.docketStatus || "")}
            </select>
          </label>
          <span class="case-status-feedback"></span>
          <button class="ghost-button edit-title-button" type="button">Edit Title</button>
        </div>
        ${entryLoadError ? `<div class="form-error">${escapeHtml(entryLoadError)}</div>` : ""}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Move</th>
              <th>Action</th>
              <th>Assigned To</th>
              <th>Internal Due Date</th>
              <th>Final Due Date</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="form-actions">
        <button class="ghost-button add-entry" type="button">Add Action</button>
        <div class="tab-switch">
          <div class="form-error row-error"></div>
          <button class="ghost-button view-hidden-actions" type="button">View Hidden</button>
          <button class="ghost-button open-collections" type="button">COLLECTIONS</button>
          <button class="ghost-button save-entries" type="button">Save</button>
          <button class="ghost-button archive-case" type="button">${
            tab === "ARCHIVED" ? "Reopen" : "Archive"
          }</button>
        </div>
      </div>
    `;
    const tbody = card.querySelector("tbody");
    attachEntriesTbodyDragBehavior(tbody);
    populateEntriesTable(tbody, entries);

    card.querySelector(".add-entry").addEventListener("click", () => {
      tbody.appendChild(renderEntryRow({}));
    });
    const rowError = card.querySelector(".row-error");
    tbody.addEventListener("click", async (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      if (
        !button.classList.contains("complete-action") &&
        !button.classList.contains("complete-hide-action")
      ) {
        return;
      }

      const row = button.closest("tr");
      const actionId = row?.dataset.actionId;
      rowError.textContent = "";
      if (!actionId) {
        rowError.textContent = button.classList.contains("complete-hide-action")
          ? "Save this row before hiding it."
          : "Save this row before marking it complete.";
        return;
      }

      try {
        const result = await updateActionState(actionId, {
          isCompleted: true,
          isHidden: button.classList.contains("complete-hide-action"),
        });
        if (result?.action?.isHidden) {
          row.remove();
          if (!tbody.querySelector("tr")) {
            tbody.appendChild(renderEntryRow({}));
          }
        } else {
          row.classList.add("is-completed");
          row.classList.remove("due-soon");
        }
      } catch (error) {
        rowError.textContent = button.classList.contains("complete-hide-action")
          ? error.message || "Unable to hide action."
          : error.message || "Unable to complete action.";
      }
    });
    card.querySelector(".save-entries").addEventListener("click", async () => {
      rowError.textContent = "";
      const payload = readEntryRows(tbody);
      try {
        await saveEntries(item.id, payload);
        const refreshedEntries = await loadEntries(item.id);
        populateEntriesTable(tbody, refreshedEntries);
      } catch (error) {
        rowError.textContent = error.message || "Unable to save entries.";
      }
    });
    card.querySelector(".view-hidden-actions").addEventListener("click", () => {
      openHiddenActions(item.id).catch((error) => {
        rowError.textContent = error.message || "Unable to load hidden actions.";
      });
    });
    const caseStatusSelect = card.querySelector(".case-status-select");
    const caseStatusFeedback = card.querySelector(".case-status-feedback");
    caseStatusSelect.addEventListener("change", async () => {
      caseStatusFeedback.textContent = "";
      caseStatusSelect.disabled = true;
      try {
        await updateDocketStatus(item.id, caseStatusSelect.value || "");
        caseStatusFeedback.textContent = "Saved";
        await rerenderCasesPreservingScroll(item.id);
      } catch (error) {
        caseStatusFeedback.textContent = error.message || "Unable to save status.";
      } finally {
        caseStatusSelect.disabled = false;
      }
    });
    card.querySelector(".edit-title-button").addEventListener("click", () => {
      openEditTitle(item);
    });
    card.querySelector(".open-collections").addEventListener("click", () => {
      openCollections(item.id);
    });
    card.querySelector(".archive-case").addEventListener("click", () => {
      pendingArchiveAction = {
        caseId: item.id,
        archived: tab !== "ARCHIVED",
      };
      archiveConfirmTitle.textContent =
        tab === "ARCHIVED" ? "Reopen Case" : "Archive Case";
      archiveConfirmText.textContent =
        tab === "ARCHIVED"
          ? "Reopen this case and move it out of ARCHIVED?"
          : "Archive this case? You can reopen it later from ARCHIVED.";
      archiveConfirmModal.classList.remove("hidden");
    });

    fragment.appendChild(card);

    if (focusCaseId && item.id === focusCaseId) {
      setTimeout(() => {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }
  if (renderId !== latestTabRenderId) return;
  casesContainer.appendChild(fragment);
};

const setTab = async (tab) => {
  const renderId = ++latestTabRenderId;
  activeTab = tab;
  tabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  const isMbfdTab = tab === "MBFD";
  newCaseButton.textContent = isMbfdTab ? "New MBFD Item" : "New Case";
  viewHiddenMbfdButton.classList.toggle("hidden", !isMbfdTab);
  await renderActiveTab(renderId);
};

const init = async () => {
  try {
    try {
      userOptions = await loadUserOptions();
      if (!Array.isArray(userOptions)) {
        userOptions = [];
      }
    } catch (error) {
      userOptions = [];
    }

    const requestedTab = getParam("tab");
    if (requestedTab) {
      activeTab = String(requestedTab).toUpperCase();
    }
    tabs.forEach((button) => {
      button.addEventListener("click", () => setTab(button.dataset.tab));
    });

    closeCollectionsModal?.addEventListener("click", closeCollections);
    collectionsModal?.addEventListener("click", (event) => {
      if (event.target === collectionsModal) closeCollections();
    });
    closeHiddenActionsModal?.addEventListener("click", closeHiddenActions);
    hiddenActionsModal?.addEventListener("click", (event) => {
      if (event.target === hiddenActionsModal) closeHiddenActions();
    });
    closeHiddenMbfdModal?.addEventListener("click", closeHiddenMbfd);
    hiddenMbfdModal?.addEventListener("click", (event) => {
      if (event.target === hiddenMbfdModal) closeHiddenMbfd();
    });
    closeEditTitleModal?.addEventListener("click", closeEditTitle);
    editTitleModal?.addEventListener("click", (event) => {
      if (event.target === editTitleModal) closeEditTitle();
    });
    closeNewMbfdModal?.addEventListener("click", closeNewMbfd);
    newMbfdModal?.addEventListener("click", (event) => {
      if (event.target === newMbfdModal) closeNewMbfd();
    });
    addCollectionRowButton?.addEventListener("click", () => {
      collectionsBody.appendChild(renderCollectionRow({}));
    });
    saveCollectionsButton?.addEventListener("click", async () => {
      if (!openCollectionsCaseId) return;
      collectionsError.textContent = "";
      try {
      await saveCollections(openCollectionsCaseId, readCollectionRows());
      const currentCaseId = openCollectionsCaseId;
      closeCollections();
      await rerenderCasesPreservingScroll(currentCaseId);
    } catch (error) {
      collectionsError.textContent = error.message || "Unable to save collections.";
    }
    });

    closeArchiveConfirmModal?.addEventListener("click", () => {
      archiveConfirmModal.classList.add("hidden");
      pendingArchiveAction = null;
    });
    archiveConfirmModal?.addEventListener("click", (event) => {
      if (event.target === archiveConfirmModal) {
        archiveConfirmModal.classList.add("hidden");
        pendingArchiveAction = null;
      }
    });
    confirmArchiveAction?.addEventListener("click", async () => {
    if (!pendingArchiveAction) return;
    const currentCaseId = pendingArchiveAction.caseId;
    await setArchived(pendingArchiveAction.caseId, pendingArchiveAction.archived);
    archiveConfirmModal.classList.add("hidden");
    pendingArchiveAction = null;
    await rerenderCasesPreservingScroll(currentCaseId);
  });

    newCaseButton?.addEventListener("click", () => {
      if (activeTab === "MBFD") {
        openNewMbfd();
        return;
      }
      newCaseError.textContent = "";
      newCaseForm.reset();
      const jurisdictionField = newCaseForm.elements.jurisdiction;
      if (activeTab !== "ARCHIVED") {
        jurisdictionField.value = activeTab;
      }
      newCaseModal.classList.remove("hidden");
    });
    closeNewCaseModal?.addEventListener("click", () => {
      newCaseModal.classList.add("hidden");
    });
    newCaseModal?.addEventListener("click", (event) => {
      if (event.target === newCaseModal) newCaseModal.classList.add("hidden");
    });
    viewHiddenMbfdButton?.addEventListener("click", () => {
      openHiddenMbfd().catch((error) => {
        casesContainer.innerHTML = `<div class="empty-state">Unable to load hidden MBFD items: ${escapeHtml(
          error.message || "Request failed"
        )}</div>`;
      });
    });
    newCaseForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      newCaseError.textContent = "";
      const formData = new FormData(newCaseForm);
      const payload = {
        caseName: String(formData.get("caseName") || "").trim(),
        clientName: String(formData.get("judge") || "").trim() || "Docket Case",
        caseNumber: String(formData.get("caseNumber") || "").trim() || null,
        jurisdiction: String(formData.get("jurisdiction") || "").trim(),
        judge: String(formData.get("judge") || "").trim() || null,
        plaintiff: null,
        status: "Active",
        updatedBy: getUser()?.name || getUser()?.email || null,
        isDocketOnly: true,
        docketDefendantCount: 0,
      };
      const requestedDefendantCountRaw = String(formData.get("defendantCount") || "").trim();
      const requestedDefendantCount =
        requestedDefendantCountRaw === "" ? 0 : Number(requestedDefendantCountRaw);
      if (
        !payload.caseName ||
        !payload.jurisdiction ||
        !Number.isFinite(requestedDefendantCount) ||
        requestedDefendantCount < 0
      ) {
        newCaseError.textContent =
          "Case name, jurisdiction, and a valid defendant count are required.";
        return;
      }
      payload.docketDefendantCount = requestedDefendantCount;
      try {
        await createLitigationCase(payload);
        newCaseModal.classList.add("hidden");
        if (activeTab !== payload.jurisdiction) {
          await setTab(payload.jurisdiction);
        } else {
          await renderCases(activeTab);
        }
      } catch (error) {
        newCaseError.textContent = error.message || "Unable to create case.";
      }
    });

    newMbfdForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      newMbfdError.textContent = "";
      const formData = new FormData(newMbfdForm);
      try {
        await createMbfdItem({
          caseName: String(formData.get("caseName") || "").trim(),
          doeNumber: String(formData.get("doeNumber") || "").trim(),
          amount: String(formData.get("amount") || "").trim(),
          attorneyEmail: String(formData.get("attorneyEmail") || "").trim(),
        });
        closeNewMbfd();
        await renderMbfdItems();
      } catch (error) {
        newMbfdError.textContent = error.message || "Unable to create MBFD item.";
      }
    });

    editTitleForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!editingCase) return;
      editTitleError.textContent = "";
      const formData = new FormData(editTitleForm);
      const caseName = String(formData.get("caseName") || "").trim();
      const defendantCountRaw = String(formData.get("defendantCount") || "").trim();
      const defendantCount = defendantCountRaw === "" ? 0 : Number(defendantCountRaw);
      if (!caseName || !Number.isFinite(defendantCount) || defendantCount < 0) {
        editTitleError.textContent = "Case name and a valid defendant count are required.";
        return;
      }

      try {
        await updateDocketCase(editingCase.id, {
          caseName,
          caseNumber: String(formData.get("caseNumber") || "").trim() || null,
          judge: String(formData.get("judge") || "").trim() || null,
          docketDefendantCount: editingCase.isDocketOnly ? defendantCount : undefined,
          updatedBy: getUser()?.name || getUser()?.email || null,
        });
        const currentCaseId = editingCase.id;
        closeEditTitle();
        await rerenderCasesPreservingScroll(currentCaseId);
      } catch (error) {
        editTitleError.textContent = error.message || "Unable to save docket title.";
      }
    });

    await setTab(activeTab);
  } catch (error) {
    casesContainer.innerHTML = `<div class="empty-state">Docket failed to initialize: ${escapeHtml(
      error.message || "Unknown error"
    )}</div>`;
  }
};

init();
