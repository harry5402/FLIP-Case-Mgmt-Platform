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
const addClaimButton = document.getElementById("add-claim");
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
const claimModal = document.getElementById("claim-modal");
const closeClaimModal = document.getElementById("close-claim-modal");
const claimForm = document.getElementById("claim-form");
const claimError = document.getElementById("claim-error");
const claimModalTitle = document.getElementById("claim-modal-title");

let notesDirty = false;
let currentCaseId = null;
let currentClaims = [];
let editingClaimId = null;

const formatDateTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

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
    [
      "Case Group",
      "status",
      currentCase.status || "Undelivered",
      "select",
      ["Undelivered", "Active", "Fully Finished"],
    ],
    ["Updated at", "updatedAtDisplay", formatDateTime(currentCase.updatedAt), "text", null, true],
    ["Updated by", "updatedByDisplay", currentCase.updatedBy || "", "text", null, true],
  ];
  caseInfoList.innerHTML = rows
    .map(([label, name, value, type, options, disabled]) => {
      if (type === "select") {
        const optionSet = Array.from(new Set([...(options || []), value])).filter(
          Boolean
        );
        const optionHtml = optionSet
          .map(
            (optionValue) =>
              `<option value="${optionValue}" ${
                optionValue === value ? "selected" : ""
              }>${optionValue}</option>`
          )
          .join("");
        return `
          <div class="info-row">
            <span>${label}</span>
            <span><select name="${name}">${optionHtml}</select></span>
          </div>
        `;
      }
      const inputType = type || "text";
      return `
        <div class="info-row">
          <span>${label}</span>
          <span><input name="${name}" type="${inputType}" value="${value}" ${
            disabled ? "disabled" : ""
          } /></span>
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

const renderClaimsTable = (claims) => {
  claimsTableBody.innerHTML = "";
  (claims || []).forEach((claim) => {
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
      <td><button class="ghost-button claim-edit" type="button" data-claim-id="${claim.id}">Edit</button></td>
    `;
    const editButton = row.querySelector(".claim-edit");
    editButton.addEventListener("click", () => {
      openClaimModal(claim);
    });
    claimsTableBody.appendChild(row);
  });
  if (!claims || claims.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="12" class="muted">No IP claims yet.</td>`;
    claimsTableBody.appendChild(row);
  }
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
      <td><a href="group.html?groupId=${encodeURIComponent(group.id)}">${group.groupName || "—"}</a></td>
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

const openClaimModal = (claim) => {
  claimError.textContent = "";
  claimForm.reset();
  editingClaimId = claim?.id || null;
  claimModalTitle.textContent = editingClaimId ? "Edit IP Claim" : "Add IP Claim";
  claimForm.elements.idDisplay.value = editingClaimId || "Auto";
  claimForm.elements.brandName.value = claim?.brandName || "";
  claimForm.elements.type.value = claim?.type || "";
  claimForm.elements.subType.value = claim?.subType || "";
  claimForm.elements.applicationDate.value = claim?.applicationDate || "";
  claimForm.elements.registrationDate.value = claim?.registrationDate || "";
  claimForm.elements.serialNumber.value = claim?.serialNumber || "";
  claimForm.elements.registrationNumber.value = claim?.registrationNumber || "";
  claimForm.elements.specimenFolder.value = claim?.specimenFolder || "";
  claimForm.elements.listingsCount.value = claim?.listingsCount ?? "";
  claimForm.elements.defendantCount.value = claim?.defendantCount ?? "";
  claimModal.classList.remove("hidden");
};

const closeClaim = () => {
  claimModal.classList.add("hidden");
};

const closeTemplate = () => {
  templateModal.classList.add("hidden");
};

const init = async () => {
  const cases = await loadCases();
  const caseId = getParam("caseId");
  let currentCase = cases.find((item) => item.id === caseId) || cases[0];

  if (!currentCase) {
    caseTitle.textContent = "Case not found";
    caseMeta.textContent = "No data available.";
    return;
  }

  caseTitle.textContent = currentCase.caseName || currentCase.title;
  currentCaseId = currentCase.id;
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
    const updatedCase = await updateCase(currentCase.id, { notes: caseNotes.value });
    if (updatedCase && !updatedCase.error) {
      currentCase = { ...currentCase, ...updatedCase };
      renderCaseInfo(currentCase);
    }
    notesDirty = false;
    caseSave.textContent = "Saved";
    setTimeout(() => {
      caseSave.textContent = "Save";
      if (!notesDirty) {
        caseSave.classList.add("hidden");
      }
    }, 900);
  });
  currentClaims = await loadIpClaims(currentCase.id);
  renderClaimsTable(currentClaims);
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
  addClaimButton.addEventListener("click", () => openClaimModal(null));
  closeClaimModal.addEventListener("click", closeClaim);
  claimModal.addEventListener("click", (event) => {
    if (event.target === claimModal) closeClaim();
  });
  claimForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    claimError.textContent = "";
    const formData = new FormData(claimForm);
    const payload = {
      brandName: (formData.get("brandName") || "").trim() || null,
      type: (formData.get("type") || "").trim() || null,
      subType: (formData.get("subType") || "").trim() || null,
      applicationDate: formData.get("applicationDate") || null,
      registrationDate: formData.get("registrationDate") || null,
      serialNumber: (formData.get("serialNumber") || "").trim() || null,
      registrationNumber: (formData.get("registrationNumber") || "").trim() || null,
      specimenFolder: (formData.get("specimenFolder") || "").trim() || null,
      listingsCount:
        formData.get("listingsCount") === "" ? null : Number(formData.get("listingsCount")),
      defendantCount:
        formData.get("defendantCount") === ""
          ? null
          : Number(formData.get("defendantCount")),
    };

    const result = editingClaimId
      ? await updateIpClaim(editingClaimId, payload)
      : await createIpClaim(currentCaseId, payload);

    if (result?.error) {
      claimError.textContent = result.error;
      return;
    }

    currentClaims = await loadIpClaims(currentCaseId);
    renderClaimsTable(currentClaims);
    closeClaim();
    toast.textContent = editingClaimId ? "Claim updated ✓" : "Claim added ✓";
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
    caseInfoList.querySelectorAll("input, select").forEach((field) => {
      if (field.disabled) return;
      if (field.tagName === "SELECT") {
        fields[field.name] = field.value;
        return;
      }
      if (field.type === "number") {
        fields[field.name] = field.value === "" ? null : Number(field.value);
        return;
      }
      fields[field.name] = field.value.trim();
    });

    if (!fields.updatedAt) {
      fields.updatedAt = new Date().toISOString().slice(0, 10);
    }

    const updatedCase = await updateCase(currentCase.id, fields);
    if (updatedCase && !updatedCase.error) {
      currentCase = { ...currentCase, ...updatedCase };
      renderCaseInfo(currentCase);
    }
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
