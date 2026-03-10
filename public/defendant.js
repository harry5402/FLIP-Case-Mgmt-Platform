const defendantTitle = document.getElementById("defendant-title");
const defendantMeta = document.getElementById("defendant-meta");
const defendantCaseInfo = document.getElementById("defendant-case-info");
const defendantInfoList = document.getElementById("defendant-info-list");
const defendantNotes = document.getElementById("defendant-notes");
const representationList = document.getElementById("representation-list");
const claimsTableBody = document.querySelector("#defendant-claims-table tbody");
const negotiationList = document.getElementById("negotiation-list");
const collectionList = document.getElementById("collection-list");
const bookkeepingList = document.getElementById("bookkeeping-list");
const listingsTableBody = document.querySelector("#listings-table tbody");
const templatesList = document.getElementById("templates-list");
const backToCase = document.getElementById("back-to-case");
const defendantSave = document.getElementById("defendant-save");
const negotiationSave = document.getElementById("negotiation-save");
const collectionSave = document.getElementById("collection-save");
const bookkeepingSave = document.getElementById("bookkeeping-save");
const defendantSaveAll = document.getElementById("defendant-save-all");
const defendantInfoSave = document.getElementById("defendant-info-save");
const assignTaskButton = document.getElementById("assign-task-button");
const taskModal = document.getElementById("task-modal");
const closeTaskModal = document.getElementById("close-task-modal");
const taskForm = document.getElementById("task-form");
const taskUserSelect = document.getElementById("task-user-select");
const taskError = document.getElementById("task-error");

const renderCaseInfo = (currentCase) => {
  const rows = [
    ["Case Name", currentCase.caseName || currentCase.title || "—"],
    ["Client Name", currentCase.clientName || "—"],
    ["Brand Name", currentCase.brandName || "—"],
    ["IP Claims", currentCase.ipClaimsSummary || "—"],
    [
      "Plaintiff Profit per Unit",
      formatMoney(currentCase.plaintiffProfitPerUnit),
    ],
    ["Jurisdiction", currentCase.jurisdiction || currentCase.court || "—"],
    ["Case #", currentCase.caseNumber || currentCase.id || "—"],
    ["Judge", currentCase.judge || "—"],
    ["Updated at", formatDate(currentCase.updatedAt)],
    ["Updated by", currentCase.updatedBy || "—"],
  ];
  defendantCaseInfo.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="info-row"><span>${label}</span><span>${value}</span></div>`
    )
    .join("");
};

const renderDefendantInfo = (defendant) => {
  const agreementLink = defendant.settlementAgreementLink
    ? `<a href="${defendant.settlementAgreementLink}">View</a>`
    : "Pending";
  const rows = [
    ["Doe #", "doeNumber", defendant.doeNumber || ""],
    ["Name", "name", defendant.name || ""],
    ["Merchant ID", "merchantId", defendant.merchantId || ""],
    ["Backend ID", "backendId", defendant.backendId || ""],
    ["Email", "email", defendant.email || ""],
    ["Marketplace", "platform", defendant.platform || ""],
    ["Settlement Agreement", "settlementAgreementLink", agreementLink, "readonly"],
    ["Updated at", "updatedAt", defendant.updatedAt || "", "date"],
    ["Updated by", "updatedBy", defendant.updatedBy || ""],
  ];
  defendantInfoList.innerHTML = rows
    .map(([label, name, value, type]) => {
      if (type === "readonly") {
        return `<div class="info-row"><span>${label}</span><span>${value}</span></div>`;
      }
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

const renderRepresentation = (defendant) => {
  const rep = defendant.representation || {};
  const rows = [
    ["Plaintiff Rep Name", rep.plaintiffRepName || "—"],
    ["Def. Rep Name", rep.defendantRepName || "—"],
    ["Def. Rep Email", rep.defendantRepEmail || "—"],
    ["Group Name", rep.groupName || "—"],
  ];
  representationList.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="info-row"><span>${label}</span><span>${value}</span></div>`
    )
    .join("");
};

const renderClaimsTable = (defendant) => {
  claimsTableBody.innerHTML = "";
  (defendant.ipClaims || []).forEach((claim) => {
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
    `;
    claimsTableBody.appendChild(row);
  });
};

const renderNegotiation = (negotiation = {}) => {
  negotiationList.innerHTML = `
    <div class="info-row">
      <span>Legal Status</span>
      <span>
        <select name="legalStatus">
          ${["Active", "No Response", "Drafting", "Closed"].map(
            (option) =>
              `<option ${
                option === negotiation.legalStatus ? "selected" : ""
              }>${option}</option>`
          )}
        </select>
      </span>
    </div>
    <div class="info-row">
      <span>Pl. Last Offer</span>
      <span><input name="plaintiffLastOffer" type="number" value="${negotiation.plaintiffLastOffer ?? 0}" /></span>
    </div>
    <div class="info-row">
      <span>Def Last Offer</span>
      <span><input name="defendantLastOffer" type="number" value="${negotiation.defendantLastOffer ?? 0}" /></span>
    </div>
    <div class="info-row">
      <span>Settlement Date</span>
      <span><input name="settlementDate" type="date" value="${negotiation.settlementDate || ""}" /></span>
    </div>
    <div class="info-row">
      <span>Settlement Amount</span>
      <span><input name="settlementAmount" type="number" value="${negotiation.settlementAmount ?? 0}" /></span>
    </div>
    <div class="info-row">
      <span>Agreement Uploaded</span>
      <span>
        <select name="agreementUploaded">
          ${["No", "Yes"].map(
            (option) =>
              `<option ${
                option === negotiation.agreementUploaded ? "selected" : ""
              }>${option}</option>`
          )}
        </select>
      </span>
    </div>
  `;
};

const renderCollection = (collection = {}) => {
  collectionList.innerHTML = `
    <div class="info-row">
      <span>Settlement Collected Date</span>
      <span><input name="settlementCollectedDate" type="date" value="${collection.settlementCollectedDate || ""}" /></span>
    </div>
    <div class="info-row">
      <span>Collected Amount</span>
      <span><input name="collectedAmount" type="number" value="${collection.collectedAmount ?? 0}" /></span>
    </div>
    <div class="info-row">
      <span>Settlement Payment ID</span>
      <span><input name="settlementPaymentId" type="text" value="${collection.settlementPaymentId || ""}" /></span>
    </div>
    <div class="info-row">
      <span>Restrained Funds Collected Amount</span>
      <span><input name="restrainedFundsCollectedAmount" type="number" value="${collection.restrainedFundsCollectedAmount ?? 0}" /></span>
    </div>
    <div class="info-row">
      <span>Total Collected Amount</span>
      <span><input name="totalCollectedAmount" type="number" value="${collection.totalCollectedAmount ?? 0}" /></span>
    </div>
  `;
};

const renderBookkeeping = (bookkeeping = {}) => {
  bookkeepingList.innerHTML = `
    <div class="info-row">
      <span>Status</span>
      <span>
        <select name="status">
          ${["Open", "Pending", "Closed"].map(
            (option) =>
              `<option ${
                option === bookkeeping.status ? "selected" : ""
              }>${option}</option>`
          )}
        </select>
      </span>
    </div>
    <div class="info-row">
      <span>Agreement Processed</span>
      <span>
        <select name="agreementProcessed">
          ${["No", "Yes"].map(
            (option) =>
              `<option ${
                option === bookkeeping.agreementProcessed ? "selected" : ""
              }>${option}</option>`
          )}
        </select>
      </span>
    </div>
  `;
};

const wireEditableSections = (defendantId, state) => {
  const dirty = {
    notes: false,
    negotiation: false,
    collection: false,
    bookkeeping: false,
  };

  const toggle = (button, show) => {
    button.classList.toggle("hidden", !show);
  };

  const updateBulk = () => {
    const anyDirty = Object.values(dirty).some(Boolean);
    toggle(defendantSaveAll, anyDirty);
  };

  const markDirty = (key, button) => {
    dirty[key] = true;
    toggle(button, true);
    updateBulk();
  };

  const syncSection = (container, sectionKey, button) => {
    container.querySelectorAll("input, select").forEach((el) => {
      el.addEventListener("input", () => {
        const value =
          el.type === "number" ? Number(el.value || 0) : el.value;
        state[sectionKey][el.name] = value;
        markDirty(sectionKey, button);
      });
    });
  };

  syncSection(negotiationList, "negotiation", negotiationSave);
  syncSection(collectionList, "collection", collectionSave);
  syncSection(bookkeepingList, "bookkeeping", bookkeepingSave);

  defendantNotes.addEventListener("input", (event) => {
    state.notes = event.target.value;
    markDirty("notes", defendantSave);
  });

  const showSaved = (button) => {
    button.textContent = "Saved";
    setTimeout(() => {
      button.textContent = button === defendantSaveAll ? "Save All" : "Save";
    }, 900);
  };

  const persist = async (key) => {
    if (key === "notes") {
      await updateDefendant(defendantId, { notes: state.notes });
      return;
    }
    if (key === "negotiation") {
      await saveNegotiation(defendantId, state.negotiation);
      return;
    }
    if (key === "collection") {
      await saveCollection(defendantId, state.collection);
      return;
    }
    if (key === "bookkeeping") {
      await saveBookkeeping(defendantId, state.bookkeeping);
    }
  };

  const wireSaveButton = (button, key) => {
    button.addEventListener("click", async () => {
      await persist(key);
      dirty[key] = false;
      showSaved(button);
      setTimeout(() => {
        if (!dirty[key]) {
          toggle(button, false);
        }
      }, 900);
      updateBulk();
    });
  };

  wireSaveButton(defendantSave, "notes");
  wireSaveButton(negotiationSave, "negotiation");
  wireSaveButton(collectionSave, "collection");
  wireSaveButton(bookkeepingSave, "bookkeeping");

  defendantSaveAll.addEventListener("click", async () => {
    const keys = Object.keys(dirty).filter((key) => dirty[key]);
    for (const key of keys) {
      await persist(key);
    }
    Object.keys(dirty).forEach((key) => {
      dirty[key] = false;
    });
    [defendantSave, negotiationSave, collectionSave, bookkeepingSave].forEach(
      (button) => toggle(button, false)
    );
    toggle(defendantSaveAll, false);
    showSaved(defendantSaveAll);
  });
};

const renderListings = (listings) => {
  listingsTableBody.innerHTML = "";
  (listings || []).forEach((listing) => {
    const row = document.createElement("tr");
    const url = listing.url
      ? `<a href="${listing.url}" target="_blank" rel="noopener">Open</a>`
      : "—";
    const copyright = listing.listingCopyrightLinks
      ? `<a href="${listing.listingCopyrightLinks}" target="_blank" rel="noopener">View</a>`
      : "—";
    row.innerHTML = `
      <td>${listing.productId || "—"}</td>
      <td>${listing.marketplaceId || "—"}</td>
      <td>${url}</td>
      <td>${listing.sales ?? "—"}</td>
      <td>${formatDate(listing.screenshotDate)}</td>
      <td>${listing.screenshots || "—"}</td>
      <td>${listing.testPurchase || "—"}</td>
      <td>${listing.testPurchaseStatus || "—"}</td>
      <td>${listing.notes || "—"}</td>
      <td>${copyright}</td>
    `;
    listingsTableBody.appendChild(row);
  });
};

const renderTemplates = (templates) => {
  templatesList.innerHTML = "";
  if (!templates.length) {
    templatesList.innerHTML = `<div class="empty-state">No templates configured yet.</div>`;
    return;
  }
  templates.forEach((template) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-title">${template.displayName || "Template"}</div>
      <div class="card-meta">
        <span>Uploaded ${formatDate(template.createdAt)}</span>
      </div>
      <div class="card-meta">
        <a href="${template.templateFileUrl || template.fileUrl}" target="_blank" rel="noopener">Open Template</a>
        ${
          template.dataFileUrl
            ? `<a href="${template.dataFileUrl}" target="_blank" rel="noopener">Open Merge File</a>`
            : ""
        }
      </div>
    `;
    templatesList.appendChild(card);
  });
};

const openTaskModal = () => {
  taskError.textContent = "";
  taskModal.classList.remove("hidden");
};

const closeTask = () => {
  taskModal.classList.add("hidden");
};

const loadTaskUsers = async () => {
  const users = await loadUserOptions();
  taskUserSelect.innerHTML = "";
  users.forEach((user) => {
    const option = document.createElement("option");
    option.value = user.id;
    option.textContent = user.name
      ? `${user.name} (${user.email})`
      : user.email;
    taskUserSelect.appendChild(option);
  });
};

const init = async () => {
  const caseId = getParam("caseId");
  const defendantId = getParam("defendantId");
  const currentCase = await loadCase(caseId);
  const defendants = await loadDefendants(caseId);
  const defendant = defendants.find((item) => item.id === defendantId);

  if (!currentCase || !defendant) {
    defendantTitle.textContent = "Defendant not found";
    defendantMeta.textContent = "No data available.";
    return;
  }

  backToCase.href = `case.html?caseId=${encodeURIComponent(currentCase.id)}`;
  defendantTitle.textContent = defendant.name;
  defendantMeta.textContent = `${defendant.id} • ${defendant.platform}`;
  const negotiationData = (await loadNegotiation(defendant.id)) || {};
  const collectionData = (await loadCollection(defendant.id)) || {};
  const bookkeepingData = (await loadBookkeeping(defendant.id)) || {};
  const state = {
    notes: defendant.notes ?? "",
    negotiation: { ...(defendant.negotiation || {}), ...negotiationData },
    collection: { ...(defendant.collection || {}), ...collectionData },
    bookkeeping: { ...(defendant.bookkeeping || {}), ...bookkeepingData },
  };

  renderCaseInfo(currentCase);
  renderDefendantInfo(defendant);
  defendantNotes.value = state.notes;
  renderRepresentation(defendant);
  renderClaimsTable(defendant);
  renderNegotiation(state.negotiation);
  renderCollection(state.collection);
  renderBookkeeping(state.bookkeeping);
  const listings = await loadListings(defendant.id);
  renderListings(listings);
  const templates = await loadCaseTemplates(currentCase.id);
  renderTemplates(templates);
  wireEditableSections(defendant.id, state);
  await loadTaskUsers();

  assignTaskButton.addEventListener("click", openTaskModal);
  closeTaskModal.addEventListener("click", closeTask);
  taskModal.addEventListener("click", (event) => {
    if (event.target === taskModal) closeTask();
  });
  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    taskError.textContent = "";
    const formData = new FormData(taskForm);
    const payload = {
      caseId: currentCase.id,
      defendantId: defendant.id,
      taskType: formData.get("taskType"),
      assignedToUserId: formData.get("assignedToUserId"),
      dueDate: formData.get("dueDate"),
    };
    const response = await createTask(payload);
    if (response?.error) {
      taskError.textContent = response.error;
      return;
    }
    taskForm.reset();
    closeTask();
  });

  defendantInfoSave.addEventListener("click", async () => {
    const fields = {};
    defendantInfoList.querySelectorAll("input").forEach((input) => {
      if (input.type === "number") {
        fields[input.name] = input.value === "" ? null : Number(input.value);
        return;
      }
      fields[input.name] = input.value.trim();
    });

    if (!fields.updatedAt) {
      fields.updatedAt = new Date().toISOString().slice(0, 10);
    }

    await updateDefendant(defendant.id, fields);
    defendantInfoSave.textContent = "Saved";
    setTimeout(() => {
      defendantInfoSave.textContent = "Save";
    }, 900);
  });
};

init();
