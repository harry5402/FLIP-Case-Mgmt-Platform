const defendantTitle = document.getElementById("defendant-title");
const defendantMeta = document.getElementById("defendant-meta");
const backToDefendant = document.getElementById("back-to-defendant");
const bookkeepingSave = document.getElementById("bookkeeping-save");

const init = async () => {
  const caseId = getParam("caseId");
  const defendantId = getParam("defendantId");
  const currentCase = await loadCase(caseId);
  const defendants = await loadDefendants(caseId);
  const defendant = defendants.find((d) => d.id === defendantId);

  if (!currentCase || !defendant) {
    defendantTitle.textContent = "Defendant not found";
    defendantMeta.textContent = "No data available.";
    return;
  }

  backToDefendant.href = `defendant.html?caseId=${encodeURIComponent(caseId)}&defendantId=${encodeURIComponent(defendantId)}`;
  defendantTitle.textContent = `${defendant.name} — Bookkeeping`;
  defendantMeta.textContent = `${currentCase.caseName || currentCase.title || ""} • ${defendant.doeNumber || ""} • ${defendant.platform || ""}`;
};

init();
