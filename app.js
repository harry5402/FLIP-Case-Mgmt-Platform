const caseList = document.getElementById("case-list");
const caseMeta = document.getElementById("case-meta");
const defendantList = document.getElementById("defendant-list");
const defendantMeta = document.getElementById("defendant-meta");
const defendantDetails = document.getElementById("defendant-details");

let cases = [];
let activeCaseId = null;
let activeDefendantId = null;

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatMoney = (value) => {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
};

const renderCases = () => {
  caseList.innerHTML = "";
  cases.forEach((item) => {
    const card = document.createElement("button");
    card.className = "card" + (item.id === activeCaseId ? " active" : "");
    card.type = "button";
    card.innerHTML = `
      <div class="card-title">${item.title}</div>
      <div class="card-meta">
        <span>${item.id}</span>
        <span>${item.status}</span>
        <span>${item.court}</span>
      </div>
    `;
    card.addEventListener("click", () => selectCase(item.id));
    caseList.appendChild(card);
  });
};

const renderDefendants = () => {
  defendantList.innerHTML = "";
  const currentCase = cases.find((item) => item.id === activeCaseId);
  if (!currentCase) {
    caseMeta.textContent = "No case selected";
    return;
  }

  caseMeta.textContent = `${currentCase.id} • Filed ${formatDate(
    currentCase.filedDate
  )} • ${currentCase.defendants.length} defendants`;

  currentCase.defendants.forEach((def) => {
    const card = document.createElement("button");
    card.className = "card" + (def.id === activeDefendantId ? " active" : "");
    card.type = "button";
    card.innerHTML = `
      <div class="card-title">${def.name}</div>
      <div class="card-meta">
        <span>${def.platform}</span>
        <span>${def.status}</span>
        <span>Last contact ${formatDate(def.lastContact)}</span>
      </div>
    `;
    card.addEventListener("click", () => selectDefendant(def.id));
    defendantList.appendChild(card);
  });
};

const renderDefendantDetails = () => {
  const currentCase = cases.find((item) => item.id === activeCaseId);
  const defendant = currentCase?.defendants.find(
    (item) => item.id === activeDefendantId
  );

  if (!defendant) {
    defendantMeta.textContent = "No defendant selected";
    defendantDetails.innerHTML = "";
    return;
  }

  defendantMeta.textContent = `${defendant.id} • ${defendant.platform}`;
  defendantDetails.innerHTML = `
    <div class="detail-row"><span>Status</span><span>${defendant.status}</span></div>
    <div class="detail-row"><span>Last Contact</span><span>${formatDate(
      defendant.lastContact
    )}</span></div>
    <div class="detail-row"><span>Settlement Target</span><span>${formatMoney(
      defendant.settlementTarget
    )}</span></div>
    <div class="detail-row"><span>Notes</span><span>${defendant.notes || "—"}</span></div>
  `;
};

const selectCase = (caseId) => {
  activeCaseId = caseId;
  activeDefendantId = null;
  renderCases();
  renderDefendants();
  renderDefendantDetails();
};

const selectDefendant = (defendantId) => {
  activeDefendantId = defendantId;
  renderDefendants();
  renderDefendantDetails();
};

const init = async () => {
  const response = await fetch("data/cases.json");
  const data = await response.json();
  cases = data.cases;
  if (cases.length) {
    activeCaseId = cases[0].id;
  }
  renderCases();
  renderDefendants();
  renderDefendantDetails();
};

init();
