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
const collectionsSaveState = document.getElementById("collections-save-state");
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
let collectionsDirty = false;
const collapsedCaseIdsByTab = new Map();
const focusCaseId = getParam("caseId");
const focusActionId = getParam("actionId");
const focusAction = getParam("action");

const yesNoOptions = `
  <option value=""></option>
  <option value="Yes">Yes</option>
  <option value="No">No</option>
`;

const docketStatusOptions = [
  "",
  "Case Filed",
  "Default Entered",
  "Default Judgement Requested",
  "Default Judgement Granted",
  "TRO Requested",
  "Negotiating",
  "TRO Signed",
  "Case Closed",
];

const docketCaseTabs = ["NDIL", "GAND", "NDIN", "MDFL", "WDPA", "EDWI", "EDMO", "UNFILED"];
const LEAD_COUNSEL_ASSIGNEE = "__lead_counsel__";

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
const updateDocketBirdLink = (caseId, docketbirdCaseId) =>
  fetchJson(`/api/litigation/cases/${caseId}/docketbird-link`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docketbirdCaseId }),
  });
const suggestDocketBirdCase = (caseId) =>
  fetchJson(`/api/litigation/cases/${caseId}/docketbird-suggest`);
const syncDocketBirdCase = (caseId) =>
  fetchJson(`/api/litigation/cases/${caseId}/docketbird-sync`, {
    method: "POST",
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
const updateMbfdItem = (itemId, payload) =>
  fetchJson(`/api/litigation/mbfd-items/${itemId}`, {
    method: "PUT",
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

const getAssignedToSelectValue = (entry = {}) => {
  if (entry.assignedToUserId) return entry.assignedToUserId;
  return entry.assignedToLabel === "Lead Counsel" ? LEAD_COUNSEL_ASSIGNEE : "";
};

const buildUserOptions = (selectedValue) => {
  const options = [
    `<option value="" ${selectedValue === "" ? "selected" : ""}>Unassigned</option>`,
    `<option value="${LEAD_COUNSEL_ASSIGNEE}" ${
      selectedValue === LEAD_COUNSEL_ASSIGNEE ? "selected" : ""
    }>Lead Counsel</option>`,
  ];
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

const buildUserMultiOptions = (selectedValues = []) => {
  const selectedSet = new Set((selectedValues || []).map((value) => String(value || "")));
  const options = [];
  userOptions.forEach((user) => {
    const label = user.name ? `${user.name} (${user.email})` : user.email;
    options.push(
      `<option value="${escapeHtml(user.id)}" ${
        selectedSet.has(String(user.id)) ? "selected" : ""
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

const setSaveStateIndicator = (element, state, message = "") => {
  if (!element) return;
  element.dataset.state = state;
  element.textContent = message;
};

const markCollectionsDirty = () => {
  collectionsDirty = true;
  setSaveStateIndicator(collectionsSaveState, "dirty", "Unsaved changes");
};

const clearCollectionsSaveState = () => {
  collectionsDirty = false;
  setSaveStateIndicator(collectionsSaveState, "idle", "");
};

const markCollectionsSaved = () => {
  collectionsDirty = false;
  setSaveStateIndicator(collectionsSaveState, "saved", "Saved");
};

const markEntriesDirty = (card) => {
  setSaveStateIndicator(
    card?.querySelector(".entries-save-state"),
    "dirty",
    "Unsaved changes"
  );
};

const markEntriesSaved = (card) => {
  setSaveStateIndicator(card?.querySelector(".entries-save-state"), "saved", "Saved");
};

const clearEntriesSaveState = (card) => {
  setSaveStateIndicator(card?.querySelector(".entries-save-state"), "idle", "");
};

const getCollapsedCaseIds = (tab) => {
  if (!collapsedCaseIdsByTab.has(tab)) {
    collapsedCaseIdsByTab.set(tab, new Set());
  }
  return collapsedCaseIdsByTab.get(tab);
};

const setCaseCollapsedState = (card, isCollapsed) => {
  card.classList.toggle("is-collapsed", Boolean(isCollapsed));
  const toggle = card.querySelector(".case-collapse-toggle");
  if (toggle) {
    toggle.textContent = isCollapsed ? "Expand" : "Collapse";
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
  }
};

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

const setEntryRowCompletionState = (row, isCompleted) => {
  row.classList.toggle("is-completed", Boolean(isCompleted));
  const completeButton = row.querySelector(".complete-action");
  if (completeButton) {
    completeButton.textContent = isCompleted ? "Incomplete" : "Complete";
  }
};

const refreshEntryRowDueHighlight = (row) => {
  const internalDue = row.querySelector('[data-field="internalDueDate"]')?.value;
  const finalDue = row.querySelector('[data-field="finalDueDate"]')?.value;
  row.classList.toggle(
    "due-soon",
    !row.classList.contains("is-completed") && (isDueSoon(internalDue) || isDueSoon(finalDue))
  );
};

const renderEntryRow = (entry = {}) => {
  const row = document.createElement("tr");
  const collaboratorIds = (entry.collaborators || []).map((collaborator) => collaborator.userId);
  const collaboratorMetaByUserId = new Map(
    (entry.collaborators || []).map((collaborator) => [String(collaborator.userId || ""), collaborator])
  );
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
    <td>
      <div class="assignment-stack">
        <select class="lit-input" data-field="assignedToUserId">${buildUserOptions(
          getAssignedToSelectValue(entry)
        )}</select>
        <button class="ghost-button collaborator-toggle" type="button">${
          collaboratorIds.length ? `Edit Collaborators (${collaboratorIds.length})` : "Add Collaborators"
        }</button>
        <select class="lit-input collaborator-select hidden" data-field="collaboratorUserIds" multiple size="3">${buildUserMultiOptions(
          collaboratorIds
        )}</select>
        <div class="collaborator-status" data-field="collaboratorStatus"></div>
      </div>
    </td>
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
        }>${entry.isCompleted ? "Incomplete" : "Complete"}</button>
        <button class="ghost-button complete-hide-action" type="button" ${
          entry.id ? "" : "disabled"
        }>Complete / Hide</button>
      </div>
    </td>
  `;
  row.querySelectorAll('input[type="date"]').forEach((input) => {
    input.addEventListener("change", () => refreshEntryRowDueHighlight(row));
  });
  setEntryRowCompletionState(row, Boolean(entry.isCompleted));
  refreshEntryRowDueHighlight(row);
  const actionValue = String(entry.action || "").trim().toLowerCase();
  const matchesFocusedAction =
    (focusActionId && String(entry.id || "") === String(focusActionId)) ||
    (focusAction && actionValue === String(focusAction).trim().toLowerCase());
  if (matchesFocusedAction) {
    row.classList.add("focused-docket-row");
  }
  const collaboratorToggle = row.querySelector(".collaborator-toggle");
  const collaboratorSelect = row.querySelector(".collaborator-select");
  const collaboratorStatus = row.querySelector('[data-field="collaboratorStatus"]');
  const renderCollaboratorChips = () => {
    const selectedIds = Array.from(collaboratorSelect?.selectedOptions || []).map((option) =>
      String(option.value || "")
    );
    if (!selectedIds.length) {
      collaboratorStatus.innerHTML = `<div class="muted">No collaborators</div>`;
      return;
    }
    collaboratorStatus.innerHTML = "";
    selectedIds.forEach((userId) => {
      const meta = collaboratorMetaByUserId.get(userId) || {};
      const user = userOptions.find((option) => String(option.id) === userId) || {};
      const label = meta.name || user.name || meta.email || user.email || userId || "Collaborator";
      const pill = document.createElement("span");
      pill.className = `collaborator-pill${meta.isComplete ? " is-complete" : ""}`;
      const labelSpan = document.createElement("span");
      labelSpan.textContent = `${label}${meta.isComplete ? " ✓" : ""}`;
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "collaborator-remove";
      removeButton.textContent = "x";
      removeButton.setAttribute("aria-label", `Remove ${label}`);
      removeButton.addEventListener("click", () => {
        Array.from(collaboratorSelect.options).forEach((option) => {
          if (String(option.value) === userId) {
            option.selected = false;
          }
        });
        collaboratorSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
      pill.append(labelSpan, removeButton);
      collaboratorStatus.appendChild(pill);
    });
  };
  const updateCollaboratorToggleLabel = () => {
    const selectedCount = collaboratorSelect?.selectedOptions?.length || 0;
    collaboratorToggle.textContent = collaboratorSelect.classList.contains("hidden")
      ? selectedCount
        ? `Edit Collaborators (${selectedCount})`
        : "Add Collaborators"
      : "Hide Collaborators";
  };
  collaboratorToggle?.addEventListener("click", () => {
    collaboratorSelect.classList.toggle("hidden");
    updateCollaboratorToggleLabel();
  });
  collaboratorSelect?.addEventListener("change", () => {
    updateCollaboratorToggleLabel();
    renderCollaboratorChips();
  });
  renderCollaboratorChips();
  updateCollaboratorToggleLabel();
  attachEntryDragBehavior(row);
  return row;
};

const readEntryRows = (tbody) =>
  Array.from(tbody.querySelectorAll("tr")).map((row) => ({
    id: row.dataset.actionId || null,
    action: row.querySelector('[data-field="action"]').value.trim(),
    assignedToUserId:
      row.querySelector('[data-field="assignedToUserId"]').value === LEAD_COUNSEL_ASSIGNEE
        ? null
        : row.querySelector('[data-field="assignedToUserId"]').value || null,
    assignedToLabel:
      row.querySelector('[data-field="assignedToUserId"]').value === LEAD_COUNSEL_ASSIGNEE
        ? "Lead Counsel"
        : null,
    collaboratorUserIds: Array.from(
      row.querySelector('[data-field="collaboratorUserIds"]').selectedOptions || []
    ).map((option) => option.value),
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
  clearCollectionsSaveState();
  const rows = await loadCollections(caseId);
  if (!rows.length) {
    collectionsBody.appendChild(renderCollectionRow({}));
  } else {
    rows.forEach((row) => collectionsBody.appendChild(renderCollectionRow(row)));
  }
  collectionsModal.classList.remove("hidden");
};

const closeCollections = () => {
  if (collectionsDirty && !window.confirm("You have unsaved collection changes. Close anyway?")) {
    return;
  }
  collectionsModal.classList.add("hidden");
  openCollectionsCaseId = null;
  clearCollectionsSaveState();
};

const renderHiddenActionRow = (entry = {}) => {
  const row = document.createElement("tr");
  const assignedUser = userOptions.find((user) => user.id === entry.assignedToUserId);
  const assignedLabel = assignedUser
    ? assignedUser.name
      ? `${assignedUser.name} (${assignedUser.email})`
      : assignedUser.email
    : entry.assignedToLabel || "—";
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
  editTitleForm.elements.jurisdiction.value = docketCaseTabs.includes(item.jurisdiction)
    ? item.jurisdiction
    : "NDIL";
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
      hiddenMbfdError.textContent =
        error.message || "Unable to restore Money Back to Doe item.";
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
      '<td colspan="6" class="empty-state">No hidden Money Back to Doe items.</td>';
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
    casesContainer.innerHTML = `<div class="empty-state">Unable to load Money Back to Doe items: ${escapeHtml(
      error.message || "Request failed"
    )}</div>`;
    return;
  }

  if (renderId !== latestTabRenderId) return;
  casesContainer.innerHTML = "";
  if (!items.length) {
    casesContainer.innerHTML = '<div class="empty-state">No Money Back to Doe items.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "table-card litigation-case";
    card.dataset.mbfdId = item.id;
    card.innerHTML = `
      <div class="litigation-case-header">
        <div class="form-grid mbfd-form-grid">
          <label class="form-field">
            <span>Case Name</span>
            <input class="lit-input mbfd-case-name" type="text" value="${escapeHtml(
              item.caseName || ""
            )}" />
          </label>
          <label class="form-field">
            <span>Doe #</span>
            <input class="lit-input mbfd-doe-number" type="text" value="${escapeHtml(
              item.doeNumber || ""
            )}" />
          </label>
          <label class="form-field">
            <span>Amount</span>
            <input class="lit-input mbfd-amount" type="number" min="0" step="0.01" value="${escapeHtml(
              item.amount ?? ""
            )}" />
          </label>
          <label class="form-field">
            <span>Attorney Email</span>
            <input class="lit-input mbfd-attorney-email" type="email" value="${escapeHtml(
              item.attorneyEmail || ""
            )}" />
          </label>
          <label class="form-field form-field-full">
            <span>Notes</span>
            <textarea class="lit-input lit-textarea mbfd-notes" rows="8">${escapeHtml(
              item.notes || ""
            )}</textarea>
          </label>
        </div>
      </div>
      <div class="form-actions">
        <div class="form-error row-error"></div>
        <div class="tab-switch">
          <button class="ghost-button mbfd-save" type="button">Save</button>
          <button class="ghost-button mbfd-complete" type="button">Complete</button>
          <button class="ghost-button mbfd-complete-hide" type="button">Complete / Hide</button>
        </div>
      </div>
    `;

    const rowError = card.querySelector(".row-error");
    card.querySelector(".mbfd-save").addEventListener("click", async () => {
      rowError.textContent = "";
      try {
        const updated = await updateMbfdItem(item.id, {
          caseName: card.querySelector(".mbfd-case-name").value.trim(),
          doeNumber: card.querySelector(".mbfd-doe-number").value.trim(),
          amount: card.querySelector(".mbfd-amount").value.trim(),
          attorneyEmail: card.querySelector(".mbfd-attorney-email").value.trim(),
          notes: card.querySelector(".mbfd-notes").value.trim(),
        });
        card.querySelector(".mbfd-case-name").value = updated.caseName || "";
        card.querySelector(".mbfd-doe-number").value = updated.doeNumber || "";
        card.querySelector(".mbfd-amount").value = updated.amount ?? "";
        card.querySelector(".mbfd-attorney-email").value = updated.attorneyEmail || "";
        card.querySelector(".mbfd-notes").value = updated.notes || "";
      } catch (error) {
        rowError.textContent = error.message || "Unable to save Money Back to Doe item.";
      }
    });
    card.querySelector(".mbfd-complete").addEventListener("click", async () => {
      rowError.textContent = "";
      try {
        await updateMbfdItemState(item.id, { isCompleted: true, isHidden: false });
        card.classList.add("mbfd-completed");
      } catch (error) {
        rowError.textContent = error.message || "Unable to complete Money Back to Doe item.";
      }
    });
    card.querySelector(".mbfd-complete-hide").addEventListener("click", async () => {
      rowError.textContent = "";
      try {
        await updateMbfdItemState(item.id, { isCompleted: true, isHidden: true });
        card.remove();
        if (!casesContainer.querySelector(".litigation-case")) {
          casesContainer.innerHTML = '<div class="empty-state">No Money Back to Doe items.</div>';
        }
      } catch (error) {
        rowError.textContent = error.message || "Unable to hide Money Back to Doe item.";
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
    const caseTitleHtml = item.isDocketOnly
      ? escapeHtml(item.caseName || "Case")
      : `<a href="case.html?caseId=${encodeURIComponent(item.id)}">${escapeHtml(
          item.caseName || "Case"
        )}</a>`;
    const collapsedCaseIds = getCollapsedCaseIds(tab);
    const shouldStartCollapsed =
      focusCaseId && item.id === focusCaseId ? false : collapsedCaseIds.has(item.id) || !focusCaseId;
    card.innerHTML = `
      <div class="litigation-case-header">
        <div class="litigation-case-topline">
          <div class="litigation-case-title">${caseTitleHtml}</div>
          <button class="ghost-button case-collapse-toggle" type="button" aria-expanded="true">
            Collapse
          </button>
        </div>
        <div class="litigation-case-meta">${escapeHtml(item.caseNumber || "—")} · ${escapeHtml(
          item.jurisdiction || "—"
        )} · Defendants: ${escapeHtml(item.defendantCount || 0)}</div>
        <div class="litigation-case-meta">Judge: ${escapeHtml(item.judge || "—")}</div>
        <div class="litigation-case-meta">Most recent edit: ${formatDateTime(
          item.mostRecentEditAt
        )} by ${escapeHtml(item.mostRecentEditBy || "—")}</div>
        <div class="litigation-case-meta">DocketBird Last Synced: ${formatDateTime(
          item.docketbirdLastSyncedAt
        )}</div>
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
        <div class="litigation-case-status-row">
          <label class="inline-select-field docketbird-link-row">
            <span>DocketBird Case ID</span>
            <input
              class="lit-input docketbird-case-id-input"
              type="text"
              value="${escapeHtml(item.docketbirdCaseId || "")}"
            />
          </label>
          <button class="ghost-button find-docketbird-link" type="button">Find Case</button>
          <button class="ghost-button save-docketbird-link" type="button">Save Link</button>
          <button class="ghost-button sync-docketbird" type="button">Sync DocketBird</button>
          <span class="case-status-feedback docketbird-feedback"></span>
        </div>
        ${entryLoadError ? `<div class="form-error">${escapeHtml(entryLoadError)}</div>` : ""}
      </div>
      <div class="litigation-case-body">
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
            <span class="save-state-indicator entries-save-state" data-state="idle"></span>
            <div class="form-error row-error"></div>
            <button class="ghost-button view-hidden-actions" type="button">View Hidden</button>
            <button class="ghost-button open-collections" type="button">COLLECTIONS</button>
            <button class="ghost-button save-entries" type="button">Save</button>
            <button class="ghost-button archive-case" type="button">${
              tab === "ARCHIVED" ? "Reopen" : "Archive"
            }</button>
          </div>
        </div>
      </div>
    `;
    setCaseCollapsedState(card, shouldStartCollapsed);
    const tbody = card.querySelector("tbody");
    attachEntriesTbodyDragBehavior(tbody);
    populateEntriesTable(tbody, entries);
    clearEntriesSaveState(card);
    const collapseToggle = card.querySelector(".case-collapse-toggle");
    collapseToggle?.addEventListener("click", () => {
      const isCollapsed = !card.classList.contains("is-collapsed");
      setCaseCollapsedState(card, isCollapsed);
      const nextCollapsedCaseIds = getCollapsedCaseIds(tab);
      if (isCollapsed) {
        nextCollapsedCaseIds.add(item.id);
      } else {
        nextCollapsedCaseIds.delete(item.id);
      }
    });

    card.querySelector(".add-entry").addEventListener("click", () => {
      setCaseCollapsedState(card, false);
      getCollapsedCaseIds(tab).delete(item.id);
      tbody.appendChild(renderEntryRow({}));
      markEntriesDirty(card);
    });
    const rowError = card.querySelector(".row-error");
    tbody.addEventListener("input", () => {
      markEntriesDirty(card);
    });
    tbody.addEventListener("change", () => {
      markEntriesDirty(card);
    });
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
        const isCompleteButton = button.classList.contains("complete-action");
        const isCurrentlyCompleted = row.classList.contains("is-completed");
        const result = await updateActionState(actionId, {
          isCompleted: isCompleteButton ? !isCurrentlyCompleted : true,
          isHidden: button.classList.contains("complete-hide-action"),
        });
        if (result?.action?.isHidden) {
          row.remove();
          if (!tbody.querySelector("tr")) {
            tbody.appendChild(renderEntryRow({}));
          }
        } else {
          setEntryRowCompletionState(row, Boolean(result?.action?.isCompleted));
          refreshEntryRowDueHighlight(row);
        }
        markEntriesSaved(card);
      } catch (error) {
        rowError.textContent = button.classList.contains("complete-hide-action")
          ? error.message || "Unable to hide action."
          : row.classList.contains("is-completed")
            ? error.message || "Unable to mark action incomplete."
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
        markEntriesSaved(card);
      } catch (error) {
        rowError.textContent = error.message || "Unable to save entries.";
      }
    });
    card.querySelector(".view-hidden-actions").addEventListener("click", () => {
      openHiddenActions(item.id).catch((error) => {
        rowError.textContent = error.message || "Unable to load hidden actions.";
      });
    });
    const docketbirdCaseIdInput = card.querySelector(".docketbird-case-id-input");
    const docketbirdFeedback = card.querySelector(".docketbird-feedback");
    card.querySelector(".find-docketbird-link").addEventListener("click", async () => {
      docketbirdFeedback.textContent = "";
      try {
        const result = await suggestDocketBirdCase(item.id);
        docketbirdCaseIdInput.value = result.docketbirdCaseId || "";
        docketbirdFeedback.textContent = result.docketbirdCaseId
          ? `Found ${result.docketbirdCaseId}`
          : "No match found";
      } catch (error) {
        docketbirdFeedback.textContent = error.message || "Unable to find DocketBird case.";
      }
    });
    card.querySelector(".save-docketbird-link").addEventListener("click", async () => {
      docketbirdFeedback.textContent = "";
      try {
        await updateDocketBirdLink(item.id, docketbirdCaseIdInput.value.trim());
        docketbirdFeedback.textContent = "Link saved";
      } catch (error) {
        docketbirdFeedback.textContent = error.message || "Unable to save link.";
      }
    });
    card.querySelector(".sync-docketbird").addEventListener("click", async () => {
      docketbirdFeedback.textContent = "";
      try {
        if (docketbirdCaseIdInput.value.trim() !== String(item.docketbirdCaseId || "").trim()) {
          await updateDocketBirdLink(item.id, docketbirdCaseIdInput.value.trim());
        }
        const result = await syncDocketBirdCase(item.id);
        const refreshedEntries = await loadEntries(item.id);
        populateEntriesTable(tbody, refreshedEntries);
        docketbirdFeedback.textContent = `Synced ${result.syncedCount || 0} entries`;
      } catch (error) {
        docketbirdFeedback.textContent = error.message || "Unable to sync DocketBird.";
      }
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

  }
  if (renderId !== latestTabRenderId) return;
  casesContainer.appendChild(fragment);
  if (focusCaseId) {
    setTimeout(() => {
      const focusedCaseCard = casesContainer.querySelector(
        `.litigation-case[data-case-id="${CSS.escape(String(focusCaseId))}"]`
      );
      if (!focusedCaseCard) return;
      const focusedRow = focusedCaseCard.querySelector(".focused-docket-row");
      if (focusedRow) {
        focusedRow.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        focusedCaseCard.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  }
};

const setTab = async (tab) => {
  const renderId = ++latestTabRenderId;
  activeTab = tab;
  tabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  const isMbfdTab = tab === "MBFD";
  newCaseButton.textContent = isMbfdTab ? "New Money Back to Doe Item" : "New Case";
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
      markCollectionsDirty();
    });
    collectionsBody?.addEventListener("input", markCollectionsDirty);
    collectionsBody?.addEventListener("change", markCollectionsDirty);
    saveCollectionsButton?.addEventListener("click", async () => {
      if (!openCollectionsCaseId) return;
      collectionsError.textContent = "";
      try {
        await saveCollections(openCollectionsCaseId, readCollectionRows());
        markCollectionsSaved();
        const currentCaseId = openCollectionsCaseId;
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
        casesContainer.innerHTML = `<div class="empty-state">Unable to load hidden Money Back to Doe items: ${escapeHtml(
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
          notes: String(formData.get("notes") || "").trim(),
        });
        closeNewMbfd();
        await renderMbfdItems();
      } catch (error) {
        newMbfdError.textContent = error.message || "Unable to create Money Back to Doe item.";
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
        const nextJurisdiction =
          String(formData.get("jurisdiction") || "").trim() || editingCase.jurisdiction || "NDIL";
        await updateDocketCase(editingCase.id, {
          caseName,
          caseNumber: String(formData.get("caseNumber") || "").trim() || null,
          judge: String(formData.get("judge") || "").trim() || null,
          jurisdiction: nextJurisdiction,
          docketDefendantCount: editingCase.isDocketOnly ? defendantCount : undefined,
          updatedBy: getUser()?.name || getUser()?.email || null,
        });
        const currentCaseId = editingCase.id;
        closeEditTitle();
        if (activeTab !== nextJurisdiction) {
          await setTab(nextJurisdiction);
        } else {
          await rerenderCasesPreservingScroll(currentCaseId);
        }
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
