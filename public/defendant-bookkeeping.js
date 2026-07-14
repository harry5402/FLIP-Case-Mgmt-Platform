const defendantTitle = document.getElementById("defendant-title");
const defendantMeta = document.getElementById("defendant-meta");
const backToDefendant = document.getElementById("back-to-defendant");
const entriesList = document.getElementById("entries-list");
const addEntryBtn = document.getElementById("add-entry-btn");

const PLATFORMS = [
  "Alibaba", "AliExpress", "Amazon", "DHgate", "eBay",
  "Etsy", "Payoneer", "PayPal", "Shopify", "Temu", "TikTok", "Walmart",
];

let defendantId = null;

const platformOptions = (selected = "") =>
  PLATFORMS.map(
    (p) => `<option value="${p}" ${p === selected ? "selected" : ""}>${p}</option>`
  ).join("");

const renderEntry = (entry) => {
  const card = document.createElement("div");
  card.className = "info-card";
  card.dataset.entryId = entry.id;
  card.innerHTML = `
    <div class="info-card-header">
      <h3 class="entry-platform-label">${entry.platform}</h3>
      <button class="ghost-button entry-delete" type="button">Delete</button>
    </div>
    <div class="form-grid" style="margin-top: 0.75rem;">
      <label class="form-field">
        <span>Platform</span>
        <select class="entry-platform">
          ${platformOptions(entry.platform)}
        </select>
      </label>
      <label class="form-field">
        <span>Amount Restrained</span>
        <input class="entry-amount" type="number" min="0" step="0.01" value="${entry.amountRestrained ?? ""}" placeholder="0.00" />
      </label>
      <label class="form-field form-field-full">
        <span>Notes</span>
        <textarea class="entry-notes" rows="4" placeholder="Notes...">${entry.notes || ""}</textarea>
      </label>
    </div>
    <div class="form-actions">
      <div class="form-error entry-error"></div>
      <button class="ghost-button entry-save" type="button">Save</button>
    </div>
  `;

  const errorEl = card.querySelector(".entry-error");

  card.querySelector(".entry-save").addEventListener("click", async () => {
    errorEl.textContent = "";
    try {
      const updated = await authFetch(`/api/bookkeeping-entries/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: card.querySelector(".entry-platform").value,
          amountRestrained: card.querySelector(".entry-amount").value || null,
          notes: card.querySelector(".entry-notes").value.trim(),
        }),
      }).then((r) => r.json());
      card.querySelector(".entry-platform-label").textContent = updated.platform;
    } catch {
      errorEl.textContent = "Failed to save.";
    }
  });

  card.querySelector(".entry-delete").addEventListener("click", async () => {
    if (!confirm("Delete this entry?")) return;
    try {
      await authFetch(`/api/bookkeeping-entries/${entry.id}`, { method: "DELETE" });
      card.remove();
    } catch {
      errorEl.textContent = "Failed to delete.";
    }
  });

  return card;
};

const init = async () => {
  const caseId = getParam("caseId");
  defendantId = getParam("defendantId");

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

  const entries = await authFetch(`/api/defendants/${defendantId}/bookkeeping-entries`).then((r) => r.json());
  entries.forEach((entry) => entriesList.appendChild(renderEntry(entry)));

  addEntryBtn.addEventListener("click", async () => {
    try {
      const entry = await authFetch(`/api/defendants/${defendantId}/bookkeeping-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: PLATFORMS[0], amountRestrained: null, notes: "" }),
      }).then((r) => r.json());
      entriesList.appendChild(renderEntry(entry));
    } catch {
      // silent — unlikely to fail
    }
  });
};

init();
