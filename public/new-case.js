const form = document.getElementById("new-case-form");
const formError = document.getElementById("form-error");

const buildId = () => `CASE-${Date.now()}`;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const now = new Date().toISOString().slice(0, 10);
  const caseName = formData.get("caseName").trim();
  const clientName = formData.get("clientName").trim();

  if (!caseName || !clientName) {
    formError.textContent = "Case Name and Client Name are required.";
    return;
  }
  formError.textContent = "";

  const newCase = {
    id: buildId(),
    caseName,
    title: caseName,
    clientName,
    plaintiff: formData.get("plaintiff").trim(),
    brandName: formData.get("brandName").trim(),
    ipClaimsSummary: formData.get("ipClaimsSummary").trim(),
    plaintiffProfitPerUnit: Number(formData.get("plaintiffProfitPerUnit") || 0),
    jurisdiction: formData.get("jurisdiction").trim(),
    caseNumber: formData.get("caseNumber").trim(),
    judge: formData.get("judge").trim(),
    status: formData.get("status"),
    recentStatus: "New Case · Today",
    filedDate: now,
    updatedAt: now,
    updatedBy: formData.get("updatedBy").trim(),
    court: formData.get("jurisdiction").trim(),
    defendants: [],
    docketEntries: [],
    notes: "",
    ipClaims: [],
  };

  saveCase(newCase).then((saved) => {
    window.location.href = `case.html?caseId=${encodeURIComponent(saved.id)}`;
  });
});
