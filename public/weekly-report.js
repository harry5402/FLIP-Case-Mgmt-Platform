const reportsError = document.getElementById("reports-error");
const reportsList = document.getElementById("reports-list");
const reportsEmpty = document.getElementById("reports-empty");
const adminActions = document.getElementById("admin-actions");
const generateButton = document.getElementById("generate-button");
const logoutButton = document.getElementById("logout-button");

const formatDate = (value) => {
  if (!value) return "—";
  // Parse as local date to avoid UTC offset shift
  const parts = String(value).slice(0, 10).split("-");
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

const formatDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
};

const downloadReport = async (reportId, weekStart) => {
  const response = await authFetch(`/api/weekly-reports/${encodeURIComponent(reportId)}/download`);
  if (!response.ok) {
    reportsError.textContent = "Unable to download report.";
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `weekly-report-${String(weekStart).slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const renderReports = (reports) => {
  reportsList.innerHTML = "";
  if (!reports.length) {
    reportsEmpty.classList.remove("hidden");
    return;
  }
  reportsEmpty.classList.add("hidden");
  reports.forEach((report) => {
    const row = document.createElement("div");
    row.className = "card row";
    row.innerHTML = `
      <div class="row-left">
        <div class="card-title">Week of ${escapeHtml(formatDate(report.week_start))}</div>
        <div class="card-meta">
          <span>${escapeHtml(formatDate(report.week_start))} – ${escapeHtml(formatDate(report.week_end))}</span>
          <span>Generated ${escapeHtml(formatDateTime(report.generated_at))}</span>
          ${report.generated_by ? `<span>by ${escapeHtml(report.generated_by)}</span>` : ""}
        </div>
      </div>
      <div class="row-right">
        <button class="ghost-button download-btn" type="button" data-id="${escapeHtml(report.id)}" data-week="${escapeHtml(String(report.week_start))}">Download CSV</button>
      </div>
    `;
    row.querySelector(".download-btn").addEventListener("click", () => {
      downloadReport(report.id, report.week_start);
    });
    reportsList.appendChild(row);
  });
};

const loadReports = async () => {
  reportsError.textContent = "";
  const response = await authFetch("/api/weekly-reports").catch(() => null);
  if (!response || !response.ok) {
    if (response?.status === 403) {
      reportsError.textContent = "You do not have access to weekly reports.";
    } else {
      reportsError.textContent = "Unable to load reports.";
    }
    return;
  }
  const reports = await response.json();
  renderReports(reports);
};

if (isAdmin()) {
  adminActions.classList.remove("hidden");
}

generateButton.addEventListener("click", async () => {
  reportsError.textContent = "";
  generateButton.disabled = true;
  generateButton.textContent = "Generating...";
  const response = await authFetch("/api/weekly-reports/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  generateButton.disabled = false;
  generateButton.textContent = "Generate Now";
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    reportsError.textContent = payload?.error || "Unable to generate report.";
    return;
  }
  await loadReports();
});

logoutButton.addEventListener("click", signOut);

loadReports();
