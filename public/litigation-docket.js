const tabs = Array.from(document.querySelectorAll(".docket-tabs [data-tab]"));
const casesContainer = document.getElementById("litigation-cases");
const newCaseButton = document.getElementById("new-litigation-case");
const newCaseModal = document.getElementById("new-case-modal");
const closeNewCaseModal = document.getElementById("close-new-case-modal");
const newCaseForm = document.getElementById("new-case-form");
const newCaseError = document.getElementById("new-case-error");
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

let activeTab = "NDIL";
let openCollectionsCaseId = null;
let pendingArchiveAction = null;
let userOptions = [];
const focusCaseId = getParam("caseId");
const focusAction = getParam("action");

const yesNoOptions = `
  <option value=""></option>
  <option value="Yes">Yes</option>
  <option value="No">No</option>
`;

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
const saveEntries = (caseId, entries) =>
  fetchJson(`/api/litigation/cases/${caseId}/entries`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
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

const renderEntryRow = (entry = {}) => {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="lit-input" data-field="action" value="${entry.action || ""}" /></td>
    <td><select class="lit-input" data-field="assignedToUserId">${buildUserOptions(
      entry.assignedToUserId || ""
    )}</select></td>
    <td><input class="lit-input" data-field="internalDueDate" type="date" value="${toDateInputValue(
      entry.internalDueDate
    )}" /></td>
    <td><input class="lit-input" data-field="finalDueDate" type="date" value="${toDateInputValue(
      entry.finalDueDate
    )}" /></td>
    <td><input class="lit-input" data-field="notes" value="${entry.notes || ""}" /></td>
  `;
  const refreshDueHighlight = () => {
    const internalDue = row.querySelector('[data-field="internalDueDate"]').value;
    const finalDue = row.querySelector('[data-field="finalDueDate"]').value;
    row.classList.toggle("due-soon", isDueSoon(internalDue) || isDueSoon(finalDue));
  };
  row.querySelectorAll('input[type="date"]').forEach((input) => {
    input.addEventListener("change", refreshDueHighlight);
  });
  refreshDueHighlight();
  const actionValue = String(entry.action || "").trim().toLowerCase();
  if (focusAction && actionValue === String(focusAction).trim().toLowerCase()) {
    row.classList.add("focused-docket-row");
  }
  return row;
};

const readEntryRows = (tbody) =>
  Array.from(tbody.querySelectorAll("tr")).map((row) => ({
    action: row.querySelector('[data-field="action"]').value.trim(),
    assignedToUserId: row.querySelector('[data-field="assignedToUserId"]').value || null,
    internalDueDate:
      toDateInputValue(row.querySelector('[data-field="internalDueDate"]').value) || null,
    finalDueDate:
      toDateInputValue(row.querySelector('[data-field="finalDueDate"]').value) || null,
    notes: row.querySelector('[data-field="notes"]').value.trim(),
  }));

const renderCollectionRow = (entry = {}) => {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input class="lit-input" data-field="platform" value="${entry.platform || ""}" /></td>
    <td><input class="lit-input" data-field="sentToPlatform" type="date" value="${toDateInputValue(
      entry.sentToPlatform
    )}" /></td>
    <td><select class="lit-input" data-field="acknowledged">${yesNoOptions}</select></td>
    <td><select class="lit-input" data-field="breakdown">${yesNoOptions}</select></td>
    <td><select class="lit-input" data-field="allDefAccountedFor">${yesNoOptions}</select></td>
    <td><select class="lit-input" data-field="moneyReceived">${yesNoOptions}</select></td>
    <td><select class="lit-input" data-field="sentToPlaintiff">${yesNoOptions}</select></td>
    <td><input class="lit-input" data-field="notes" value="${entry.notes || ""}" /></td>
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

const renderCases = async (tab) => {
  casesContainer.innerHTML = `<div class="empty-state">Loading...</div>`;
  const cases = await fetchJson(`/api/litigation/cases?tab=${encodeURIComponent(tab)}`);
  casesContainer.innerHTML = "";

  if (!cases.length) {
    casesContainer.innerHTML = `<div class="empty-state">No cases in this tab.</div>`;
    return;
  }

  for (const item of cases) {
    const entries = await loadEntries(item.id);
    const card = document.createElement("div");
    card.className = "table-card litigation-case";
    if (focusCaseId && item.id === focusCaseId) {
      card.classList.add("focused-docket-case");
    }
    card.innerHTML = `
      <div class="litigation-case-header">
        <div class="litigation-case-title">${item.caseName || "Case"}</div>
        <div class="litigation-case-meta">${item.caseNumber || "—"} · ${
          item.jurisdiction || "—"
        } · Defendants: ${item.defendantCount || 0}</div>
        <div class="litigation-case-meta">Most recent edit: ${formatDateTime(
          item.mostRecentEditAt
        )} by ${item.mostRecentEditBy || "—"}</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Action</th>
              <th>Assigned To</th>
              <th>Internal Due Date</th>
              <th>Final Due Date</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="form-actions">
        <button class="ghost-button add-entry" type="button">Add Action</button>
        <div class="tab-switch">
          <div class="form-error row-error"></div>
          <button class="ghost-button open-collections" type="button">COLLECTIONS</button>
          <button class="ghost-button save-entries" type="button">Save</button>
          <button class="ghost-button archive-case" type="button">${
            tab === "ARCHIVED" ? "Reopen" : "Archive"
          }</button>
        </div>
      </div>
    `;
    const tbody = card.querySelector("tbody");
    if (!entries.length) {
      tbody.appendChild(renderEntryRow({}));
    } else {
      entries.forEach((entry) => tbody.appendChild(renderEntryRow(entry)));
    }

    card.querySelector(".add-entry").addEventListener("click", () => {
      tbody.appendChild(renderEntryRow({}));
    });
    const rowError = card.querySelector(".row-error");
    card.querySelector(".save-entries").addEventListener("click", async () => {
      rowError.textContent = "";
      const payload = readEntryRows(tbody);
      try {
        await saveEntries(item.id, payload);
        await renderCases(activeTab);
      } catch (error) {
        rowError.textContent = error.message || "Unable to save entries.";
      }
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

    casesContainer.appendChild(card);

    if (focusCaseId && item.id === focusCaseId) {
      setTimeout(() => {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }
};

const setTab = async (tab) => {
  activeTab = tab;
  tabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  await renderCases(tab);
};

const init = async () => {
  userOptions = await loadUserOptions();
  const requestedTab = getParam("tab");
  if (requestedTab) {
    activeTab = String(requestedTab).toUpperCase();
  }
  tabs.forEach((button) => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  closeCollectionsModal.addEventListener("click", closeCollections);
  collectionsModal.addEventListener("click", (event) => {
    if (event.target === collectionsModal) closeCollections();
  });
  addCollectionRowButton.addEventListener("click", () => {
    collectionsBody.appendChild(renderCollectionRow({}));
  });
  saveCollectionsButton.addEventListener("click", async () => {
    if (!openCollectionsCaseId) return;
    collectionsError.textContent = "";
    try {
      await saveCollections(openCollectionsCaseId, readCollectionRows());
      closeCollections();
      await renderCases(activeTab);
    } catch (error) {
      collectionsError.textContent = error.message || "Unable to save collections.";
    }
  });

  closeArchiveConfirmModal.addEventListener("click", () => {
    archiveConfirmModal.classList.add("hidden");
    pendingArchiveAction = null;
  });
  archiveConfirmModal.addEventListener("click", (event) => {
    if (event.target === archiveConfirmModal) {
      archiveConfirmModal.classList.add("hidden");
      pendingArchiveAction = null;
    }
  });
  confirmArchiveAction.addEventListener("click", async () => {
    if (!pendingArchiveAction) return;
    await setArchived(pendingArchiveAction.caseId, pendingArchiveAction.archived);
    archiveConfirmModal.classList.add("hidden");
    pendingArchiveAction = null;
    await renderCases(activeTab);
  });

  newCaseButton.addEventListener("click", () => {
    newCaseError.textContent = "";
    newCaseForm.reset();
    const jurisdictionField = newCaseForm.elements.jurisdiction;
    if (activeTab !== "ARCHIVED") {
      jurisdictionField.value = activeTab;
    }
    newCaseModal.classList.remove("hidden");
  });
  closeNewCaseModal.addEventListener("click", () => {
    newCaseModal.classList.add("hidden");
  });
  newCaseModal.addEventListener("click", (event) => {
    if (event.target === newCaseModal) newCaseModal.classList.add("hidden");
  });
  newCaseForm.addEventListener("submit", async (event) => {
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

  await setTab(activeTab);
};

init();
