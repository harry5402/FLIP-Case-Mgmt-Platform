const caseTitle = document.getElementById("case-title");
const caseMeta = document.getElementById("case-meta");
const caseInfoList = document.getElementById("case-info-list");
const caseInfoSave = document.getElementById("case-info-save");
const toast = document.getElementById("toast");
const bulkUploadLink = document.getElementById("bulk-upload-link");
const listingUploadLink = document.getElementById("listing-upload-link");
const docketList = document.getElementById("docket-list");
const caseNotes = document.getElementById("case-notes");
const caseSave = document.getElementById("case-save");
const claimsTableBody = document.querySelector("#claims-table tbody");
const defendantsTableBody = document.querySelector("#defendants-table tbody");
const groupsTableBody = document.querySelector("#groups-table tbody");
const defendantsTable = document.getElementById("defendants-table");
const groupsTable = document.getElementById("groups-table");
const defendantsView = document.getElementById("defendants-view");
const groupsView = document.getElementById("groups-view");
const addGroupButton = document.getElementById("add-group");
const groupModal = document.getElementById("group-modal");
const closeGroupModal = document.getElementById("close-group-modal");
const groupForm = document.getElementById("group-form");
const groupDefendants = document.getElementById("group-defendants");
const groupError = document.getElementById("group-error");
const templateUploadButton = document.getElementById("template-upload-button");
const templateModal = document.getElementById("template-modal");
const closeTemplateModal = document.getElementById("close-template-modal");
const templateForm = document.getElementById("template-form");
const templateError = document.getElementById("template-error");
const evidenceButton = document.getElementById("evidence-button");
const dataDownloadButton = document.getElementById("data-download-button");

let notesDirty = false;

const renderCaseInfo = (currentCase) => {
  const rows = [
    ["Client Name", "clientName", currentCase.clientName || ""],
    ["Brand Name", "brandName", currentCase.brandName || ""],
    ["IP Claims", "ipClaimsSummary", currentCase.ipClaimsSummary || ""],
    [
      "Plaintiff Profit per Unit",
      "plaintiffProfitPerUnit",
      currentCase.plaintiffProfitPerUnit ?? "",
      "number",
    ],
    ["Jurisdiction", "jurisdiction", currentCase.jurisdiction || currentCase.court || ""],
    ["Case #", "caseNumber", currentCase.caseNumber || ""],
    ["Judge", "judge", currentCase.judge || ""],
    ["Updated at", "updatedAt", currentCase.updatedAt || "", "date"],
    ["Updated by", "updatedBy", currentCase.updatedBy || ""],
  ];
  caseInfoList.innerHTML = rows
    .map(([label, name, value, type]) => {
      const inputType = type || "text";
      return `
        <div class="info-row">
          <span>${label}</span>
          <span><input name="${name}" type="${inputType}" value="${value}" /></span>
        </div>
      `;
    })
    .join("");
};

const renderDocket = (currentCase) => {
  docketList.innerHTML = "";
  if (!currentCase.docketEntries || currentCase.docketEntries.length === 0) {
    docketList.innerHTML = `<div class="empty-state">No docket entries yet.</div>`;
    return;
  }
  currentCase.docketEntries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "info-row";
    row.innerHTML = `
      <span>${formatDate(entry.date)}</span>
      <span>${entry.entry}</span>
    `;
    docketList.appendChild(row);
  });
};

const renderClaimsTable = (currentCase) => {
  claimsTableBody.innerHTML = "";
  (currentCase.ipClaims || []).forEach((claim) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${claim.id ?? "—"}</td>
      <td>${claim.brandName || "—"}</td>
      <td>${claim.type || "—"}</td>
      <td>${claim.subType || "—"}</td>
      <td>${formatDate(claim.applicationDate)}</td>
      <td>${formatDate(claim.registrationDate)}</td>
      <td>${claim.serialNumber || "—"}</td>
      <td>${claim.registrationNumber || "—"}</td>
      <td>${claim.specimenFolder || "—"}</td>
      <td>${claim.listingsCount ?? "—"}</td>
      <td>${claim.defendantCount ?? "—"}</td>
    `;
    claimsTableBody.appendChild(row);
  });
};

const renderDefendantsTable = (currentCase) => {
  defendantsTableBody.innerHTML = "";
  currentCase.defendants.forEach((def) => {
    const row = document.createElement("tr");
    const doeLink = def.doeNumber
      ? `<a href="defendant.html?caseId=${encodeURIComponent(
          currentCase.id
        )}&defendantId=${encodeURIComponent(def.id)}">${def.doeNumber}</a>`
      : "—";
    row.innerHTML = `
      <td>${doeLink}</td>
      <td>${def.groupName || "—"}</td>
      <td>${def.platform || "—"}</td>
      <td>${def.merchantId || "—"}</td>
      <td><a href="defendant.html?caseId=${encodeURIComponent(
        currentCase.id
      )}&defendantId=${encodeURIComponent(def.id)}">${def.name || "—"}</a></td>
      <td>${def.email || "—"}</td>
      <td>${def.status || "—"}</td>
      <td>${def.defendantRepEmail || "—"}</td>
      <td>${def.listingsCount ?? def.listings?.length ?? "—"}</td>
    `;
    defendantsTableBody.appendChild(row);
  });
};

const renderGroupsTable = (defendants) => {
  const grouped = new Map();
  defendants.forEach((def) => {
    const name = (def.groupName || "").trim();
    if (!name) return;
    if (!grouped.has(name)) {
      grouped.set(name, {
        groupName: name,
        count: 0,
        plaintiffRepName: def.plaintiffRepName || "—",
        defRepEmail: def.defendantRepEmail || "—",
        status: def.status || "—",
      });
    }
    const entry = grouped.get(name);
    entry.count += 1;
  });

  groupsTableBody.innerHTML = "";
  Array.from(grouped.values()).forEach((group) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${group.groupName}</td>
      <td>${group.count}</td>
      <td>${group.plaintiffRepName}</td>
      <td>${group.defRepEmail}</td>
      <td>${group.status}</td>
    `;
    groupsTableBody.appendChild(row);
  });
};

const renderGroupsFromApi = (groups) => {
  groupsTableBody.innerHTML = "";
  groups.forEach((group) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${group.groupName || "—"}</td>
      <td>${group.defendantCount ?? 0}</td>
      <td>${group.plaintiffRepName || "—"}</td>
      <td>${group.defendantRepEmail || "—"}</td>
      <td>${group.status || "—"}</td>
    `;
    groupsTableBody.appendChild(row);
  });
};

const openGroupModal = (defendants) => {
  groupError.textContent = "";
  groupForm.reset();
  groupDefendants.innerHTML = "";
  defendants.forEach((def) => {
    const item = document.createElement("label");
    item.className = "checkbox-item";
    item.innerHTML = `
      <input type="checkbox" value="${def.id}" />
      <span>${def.doeNumber || "Doe"} • ${def.name || "Unnamed"} ${
        def.groupName ? `(Group: ${def.groupName})` : ""
      }</span>
    `;
    groupDefendants.appendChild(item);
  });
  groupModal.classList.remove("hidden");
};

const closeModal = () => {
  groupModal.classList.add("hidden");
};

const wireGroupModal = (caseId, refresh) => {
  addGroupButton.addEventListener("click", async () => {
    const latest = await loadDefendants(caseId);
    openGroupModal(latest);
  });
  closeGroupModal.addEventListener("click", closeModal);
  groupModal.addEventListener("click", (event) => {
    if (event.target === groupModal) closeModal();
  });

  groupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(groupForm);
    const groupName = formData.get("groupName").trim();
    const plaintiffRepName = formData.get("plaintiffRepName").trim();
    const defendantRepEmail = formData.get("defendantRepEmail").trim();
    const selected = Array.from(
      groupDefendants.querySelectorAll("input[type='checkbox']:checked")
    ).map((input) => input.value);

    if (!groupName || selected.length === 0) {
      groupError.textContent = "Group name and at least one defendant are required.";
      return;
    }

    await createGroup(caseId, {
      groupName,
      plaintiffRepName,
      defendantRepEmail,
      defendantIds: selected,
    });

    closeModal();
    await refresh();
  });
};

const wireViewToggle = () => {
  const showDefendants = () => {
    defendantsTable.classList.remove("hidden");
    groupsTable.classList.add("hidden");
    defendantsView.classList.add("active");
    groupsView.classList.remove("active");
  };
  const showGroups = () => {
    groupsTable.classList.remove("hidden");
    defendantsTable.classList.add("hidden");
    groupsView.classList.add("active");
    defendantsView.classList.remove("active");
  };
  defendantsView.addEventListener("click", showDefendants);
  groupsView.addEventListener("click", showGroups);
  showDefendants();
};

const openTemplateModal = () => {
  templateError.textContent = "";
  templateModal.classList.remove("hidden");
};

const closeTemplate = () => {
  templateModal.classList.add("hidden");
};

const init = async () => {
  const cases = await loadCases();
  const caseId = getParam("caseId");
  const currentCase = cases.find((item) => item.id === caseId) || cases[0];

  if (!currentCase) {
    caseTitle.textContent = "Case not found";
    caseMeta.textContent = "No data available.";
    return;
  }

  caseTitle.textContent = currentCase.caseName || currentCase.title;
  const defendants = await loadDefendants(currentCase.id);
  caseMeta.textContent = `${currentCase.id} • Filed ${formatDate(
    currentCase.filedDate
  )} • ${defendants.length} defendants`;
  renderCaseInfo(currentCase);
  renderDocket(currentCase);
  caseNotes.value = currentCase.notes ?? "";
  caseNotes.addEventListener("input", () => {
    notesDirty = true;
    caseSave.classList.remove("hidden");
  });
  caseSave.addEventListener("click", async () => {
    await updateCase(currentCase.id, { notes: caseNotes.value });
    notesDirty = false;
    caseSave.textContent = "Saved";
    setTimeout(() => {
      caseSave.textContent = "Save";
      if (!notesDirty) {
        caseSave.classList.add("hidden");
      }
    }, 900);
  });
  renderClaimsTable(currentCase);
  const refresh = async () => {
    const nextDefendants = await loadDefendants(currentCase.id);
    renderDefendantsTable({ ...currentCase, defendants: nextDefendants });
    if (USE_API) {
      const groups = await loadGroups(currentCase.id);
      renderGroupsFromApi(groups);
    } else {
      renderGroupsTable(nextDefendants);
    }
  };

  renderDefendantsTable({ ...currentCase, defendants });
  if (USE_API) {
    const groups = await loadGroups(currentCase.id);
    renderGroupsFromApi(groups);
  } else {
    renderGroupsTable(defendants);
  }
  wireViewToggle();
  wireGroupModal(currentCase.id, refresh);
  evidenceButton.addEventListener("click", () => {
    toast.textContent = "Evidence action not configured yet.";
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 1200);
  });
  dataDownloadButton.addEventListener("click", () => {
    toast.textContent = "Data download action not configured yet.";
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 1200);
  });
  templateUploadButton.addEventListener("click", openTemplateModal);
  closeTemplateModal.addEventListener("click", closeTemplate);
  templateModal.addEventListener("click", (event) => {
    if (event.target === templateModal) closeTemplate();
  });
  templateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    templateError.textContent = "";
    const formData = new FormData(templateForm);
    const templateFile = formData.get("templateFile");
    const dataFile = formData.get("dataFile");
    const displayName = formData.get("displayName");
    if (!templateFile || !templateFile.name || !dataFile || !dataFile.name) {
      templateError.textContent = "Please select both template files.";
      return;
    }
    const result = await uploadCaseTemplate(
      currentCase.id,
      templateFile,
      dataFile,
      displayName
    );
    if (result?.error) {
      templateError.textContent = result.error;
      return;
    }
    templateForm.reset();
    closeTemplate();
    toast.textContent = "Template uploaded ✓";
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 1200);
  });
  bulkUploadLink.href = `bulk-upload.html?caseId=${encodeURIComponent(
    currentCase.id
  )}`;
  listingUploadLink.href = `listings-upload.html?caseId=${encodeURIComponent(
    currentCase.id
  )}`;

  caseInfoSave.addEventListener("click", async () => {
    const fields = {};
    caseInfoList.querySelectorAll("input").forEach((input) => {
      if (input.type === "number") {
        fields[input.name] = input.value === "" ? null : Number(input.value);
        return;
      }
      fields[input.name] = input.value.trim();
    });

    if (!fields.updatedAt) {
      fields.updatedAt = new Date().toISOString().slice(0, 10);
    }

    await updateCase(currentCase.id, fields);
    caseInfoSave.textContent = "Saved";
    toast.textContent = "Saved ✓";
    toast.classList.remove("hidden");
    setTimeout(() => {
      caseInfoSave.textContent = "Save";
      toast.classList.add("hidden");
    }, 1200);
  });
};

init();
