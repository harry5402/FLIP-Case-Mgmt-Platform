const groupTitle = document.getElementById("group-title");
const groupMeta = document.getElementById("group-meta");
const backToCase = document.getElementById("back-to-case");
const groupCaseInfo = document.getElementById("group-case-info");
const groupInfoList = document.getElementById("group-info-list");
const groupTemplates = document.getElementById("group-templates");
const groupSnapshot = document.getElementById("group-snapshot");
const groupDefendantsTableBody = document.querySelector("#group-defendants-table tbody");
const groupListingsTableBody = document.querySelector("#group-listings-table tbody");

const renderCaseInfo = (info) => {
  const rows = [
    ["Case Name", info.caseName || "—"],
    ["Client Name", info.clientName || "—"],
    ["Brand Name", info.brandName || "—"],
    ["IP Claims", info.ipClaimsSummary || "—"],
    ["Plaintiff Profit per Unit", formatMoney(info.plaintiffProfitPerUnit)],
    ["Jurisdiction", info.jurisdiction || "—"],
    ["Case #", info.caseNumber || "—"],
    ["Judge", info.judge || "—"],
    ["Updated at", formatDate(info.updatedAt)],
    ["Updated by", info.updatedBy || "—"],
  ];
  groupCaseInfo.innerHTML = rows
    .map(([label, value]) => `<div class="info-row"><span>${label}</span><span>${value}</span></div>`)
    .join("");
};

const renderGroupInfo = (group, defendants) => {
  const rows = [
    ["Group Name", group.groupName || "—"],
    ["Plaintiff Rep Name", group.plaintiffRepName || "—"],
    ["Def. Rep Email", group.defendantRepEmail || "—"],
    ["Status", group.status || "—"],
    ["Defendant Count", String(defendants.length)],
  ];
  groupInfoList.innerHTML = rows
    .map(([label, value]) => `<div class="info-row"><span>${label}</span><span>${value}</span></div>`)
    .join("");
};

const renderTemplates = (templates) => {
  groupTemplates.innerHTML = "";
  if (!templates.length) {
    groupTemplates.innerHTML = `<div class="empty-state">No templates configured yet.</div>`;
    return;
  }
  templates.forEach((template) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="card-title">${template.displayName || "Template"}</div>
      <div class="card-meta">
        <a href="${template.templateFileUrl || template.fileUrl}" target="_blank" rel="noopener">Open Template</a>
        ${
          template.dataFileUrl
            ? `<a href="${template.dataFileUrl}" target="_blank" rel="noopener">Open Merge File</a>`
            : ""
        }
      </div>
    `;
    groupTemplates.appendChild(card);
  });
};

const renderSnapshot = (defendants, listings) => {
  const activeCount = defendants.filter((d) => (d.status || "").toLowerCase() === "active").length;
  const rows = [
    ["Defendants", String(defendants.length)],
    ["Listings", String(listings.length)],
    ["Active Status", String(activeCount)],
  ];
  groupSnapshot.innerHTML = rows
    .map(([label, value]) => `<div class="info-row"><span>${label}</span><span>${value}</span></div>`)
    .join("");
};

const renderDefendants = (defendants) => {
  groupDefendantsTableBody.innerHTML = "";
  defendants.forEach((def) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><a href="defendant.html?caseId=${encodeURIComponent(
        def.caseId
      )}&defendantId=${encodeURIComponent(def.id)}">${def.doeNumber || "—"}</a></td>
      <td>${def.platform || "—"}</td>
      <td>${def.merchantId || "—"}</td>
      <td><a href="defendant.html?caseId=${encodeURIComponent(
        def.caseId
      )}&defendantId=${encodeURIComponent(def.id)}">${def.name || "—"}</a></td>
      <td>${def.email || "—"}</td>
      <td>${def.status || "—"}</td>
      <td>${def.defendantRepEmail || "—"}</td>
      <td>${def.listingsCount ?? "—"}</td>
    `;
    groupDefendantsTableBody.appendChild(row);
  });
};

const renderListings = (listings) => {
  groupListingsTableBody.innerHTML = "";
  listings.forEach((listing) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${listing.defendantName || "—"}</td>
      <td>${listing.productId || "—"}</td>
      <td>${
        listing.url
          ? `<a href="${listing.url}" target="_blank" rel="noopener">Open</a>`
          : "—"
      }</td>
      <td>${listing.screenshots || "—"}</td>
      <td>${listing.notes || "—"}</td>
    `;
    groupListingsTableBody.appendChild(row);
  });
};

const init = async () => {
  const groupId = getParam("groupId");
  const group = await loadGroup(groupId);
  if (!group) {
    groupTitle.textContent = "Group not found";
    groupMeta.textContent = "No data available.";
    return;
  }

  const defendants = await loadGroupDefendants(group.id);
  const listings = await loadGroupListings(group.id);
  const templates = await loadCaseTemplates(group.caseId);

  groupTitle.textContent = group.groupName || "Group";
  groupMeta.textContent = `${group.id} • ${defendants.length} defendants`;
  backToCase.href = `case.html?caseId=${encodeURIComponent(group.caseId)}`;

  renderCaseInfo(group.caseInfo || {});
  renderGroupInfo(group, defendants);
  renderTemplates(templates);
  renderSnapshot(defendants, listings);
  renderDefendants(defendants);
  renderListings(listings);
};

init();
