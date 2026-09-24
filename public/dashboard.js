const caseGroups = document.getElementById("case-groups");
const statisticsBody = document.getElementById("statistics-body");

const jurisdictionDisplayLabels = {
  NDIL: "ILND",
  GAND: "GAND",
  NDIN: "INND",
  WDPA: "PAWD",
  EDWI: "WIED",
  WDTX: "TXWD",
  EDTX: "TXED",
  UNFILED: "UNFILED",
};

const formatJurisdictionLabel = (value) =>
  jurisdictionDisplayLabels[String(value || "").toUpperCase()] || String(value || "Unspecified");

const tasksList = document.getElementById("tasks-list");

const statusToGroup = (status) => {
  if (!status) return "Undelivered";
  if (status === "Pre-Filing" || status === "Undelivered") return "Undelivered";
  if (status === "Active") return "Active";
  return "Fully Finished";
};

const buildCaseRow = (item) => {
  const row = document.createElement("a");
  row.className = "card row";
  row.href = `case.html?caseId=${encodeURIComponent(item.id)}`;
  const statusText = item.recentStatus || item.status || "Status pending";
  const title = item.caseName || item.title || "Untitled Case";
  row.innerHTML = `
    <div class="row-left">
      <div class="card-title">${title}</div>
      <div class="card-meta">
        <span>${item.caseNumber || item.id}</span>
        <span>(${item.plaintiff || "Plaintiff"})</span>
      </div>
    </div>
    <div class="row-right">${statusText}</div>
  `;
  return row;
};

const renderGroups = (cases) => {
  const grouped = {
    Undelivered: [],
    Active: [],
    "Fully Finished": [],
  };

  cases.forEach((item) => {
    grouped[statusToGroup(item.status)].push(item);
  });

  caseGroups.innerHTML = "";
  Object.entries(grouped).forEach(([label, items]) => {
    const details = document.createElement("details");
    details.className = "group";
    details.open = label === "Active";
    const summary = document.createElement("summary");
    summary.className = "group-title";
    summary.textContent = `${label} (${items.length})`;
    details.appendChild(summary);

    const list = document.createElement("div");
    list.className = "list";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No cases yet.";
      list.appendChild(empty);
    } else {
      items.forEach((item) => list.appendChild(buildCaseRow(item)));
    }
    details.appendChild(list);
    caseGroups.appendChild(details);
  });
};

const renderStatistics = (stats) => {
  const overdueCount = stats.overdueTaskCount || 0;
  const avgDaysOpen = stats.avgDaysOpen === null || stats.avgDaysOpen === undefined
    ? "—"
    : `${stats.avgDaysOpen}d`;

  const countsByLabel = new Map();
  (stats.byJurisdiction || []).forEach((row) => {
    const label = formatJurisdictionLabel(row.jurisdiction);
    countsByLabel.set(label, (countsByLabel.get(label) || 0) + row.caseCount);
  });

  const jurisdictionRows = Array.from(countsByLabel.entries())
    .sort((a, b) => b[1] - a[1])
    .map(
      ([label, count]) => `
        <div class="info-row">
          <span>${label}</span>
          <span>${count}</span>
        </div>
      `
    )
    .join("");

  statisticsBody.innerHTML = `
    <div class="stats-grid">
      <div class="stat-tile">
        <div class="stat-value">${stats.totalActiveCases || 0}</div>
        <div class="stat-label">Active Cases</div>
      </div>
      <div class="stat-tile">
        <div class="stat-value">${avgDaysOpen}</div>
        <div class="stat-label">Avg. Time Open</div>
      </div>
      <div class="stat-tile${overdueCount > 0 ? " stat-tile-warning" : ""}">
        <div class="stat-value">${overdueCount}</div>
        <div class="stat-label">Overdue Tasks</div>
      </div>
    </div>
    <div class="info-card">
      <h3>Cases by Jurisdiction</h3>
      <div class="info-list">
        ${jurisdictionRows || '<div class="empty-state">No active cases yet.</div>'}
      </div>
    </div>
  `;
};

const renderTasks = (tasks) => {
  tasksList.innerHTML = "";
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No tasks assigned.";
    tasksList.appendChild(empty);
    return;
  }

  tasks.forEach((task) => {
    const row = document.createElement("div");
    const isInProgress = task.status === "In Progress" || task.isInProgress;
    row.className = `card row${isInProgress ? " is-in-progress" : ""}`;
    const targetUrl =
      task.targetType === "general"
        ? null
        : task.targetType === "group"
          ? `group.html?groupId=${encodeURIComponent(task.groupId)}`
          : task.targetType === "docket"
            ? `litigation-docket.html?tab=${encodeURIComponent(
                task.jurisdiction || "NDIL"
              )}&caseId=${encodeURIComponent(task.caseId)}${
                task.sourceLitigationActionId
                  ? `&actionId=${encodeURIComponent(task.sourceLitigationActionId)}`
                  : `&action=${encodeURIComponent(String(task.taskType || "").replace(/^Docket:\s*/, ""))}`
              }`
            : task.targetType === "case"
              ? `case.html?caseId=${encodeURIComponent(task.caseId)}`
              : `defendant.html?caseId=${encodeURIComponent(
                  task.caseId
                )}&defendantId=${encodeURIComponent(task.defendantId)}`;
    const titleHtml = targetUrl
      ? `<a class="card-title task-link" href="${targetUrl}">${escapeHtml(task.taskType)}</a>`
      : `<span class="card-title">${escapeHtml(task.taskType)}</span>`;
    row.innerHTML = `
      <div class="row-left">
        ${titleHtml}
        <div class="card-meta">
          ${task.targetType !== "general" ? `<span>${escapeHtml(task.caseName || "Case")}</span>` : ""}
          <span>${
            task.targetType === "general"
              ? "General Task"
              : task.targetType === "group"
                ? escapeHtml(task.groupName || "Group")
                : task.targetType === "docket"
                  ? "Docket Entry"
                  : task.targetType === "case"
                    ? "Case Reminder"
                    : escapeHtml(task.defendantName || "Defendant")
          }</span>
          ${
            task.taskRole === "collaborator"
              ? `<span>Support Task</span>`
              : ""
          }
          ${task.targetType === "general" && task.notes ? `<span class="task-notes">${escapeHtml(task.notes)}</span>` : ""}
        </div>
      </div>
      <div class="row-right task-actions">
        <span>Due ${formatDate(task.dueDate)}</span>
        <button class="ghost-button progress-task" type="button">${
          isInProgress ? "Clear Progress" : "In Progress"
        }</button>
        <button class="ghost-button complete-task" type="button">${
          task.taskRole === "collaborator" ? "Mark My Part Complete" : "Task Complete"
        }</button>
      </div>
    `;
    row.querySelector(".progress-task").addEventListener("click", async () => {
      const result = await updateTaskState(task.id, isInProgress ? "Open" : "In Progress");
      if (!result?.error) {
        const tasks = await loadMyTasks();
        renderTasks(tasks);
      }
    });
    const button = row.querySelector(".complete-task");
    button.addEventListener("click", async () => {
      const result = await completeTask(task.id);
      if (!result?.error) {
        row.remove();
        if (!tasksList.children.length) {
          renderTasks([]);
        }
      }
    });
    tasksList.appendChild(row);
  });
};

const init = async () => {
  const tasks = await loadMyTasks();
  renderTasks(tasks);
  const cases = await loadCases();
  renderGroups(cases);
  const stats = await loadLitigationStats();
  renderStatistics(stats);
};

init();
