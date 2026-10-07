const caseGroups = document.getElementById("case-groups");
const caseStatusTabs = document.getElementById("case-status-tabs");
const dashboardStats = document.getElementById("dashboard-stats");
const dashboardGreeting = document.getElementById("dashboard-greeting");
const jurisdictionList = document.getElementById("jurisdiction-list");

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

const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const isTaskOverdue = (task) => {
  if (!task.dueDate) return false;
  const due = parseDateValue(task.dueDate);
  if (!due) return false;
  return startOfDay(due) < startOfDay(new Date());
};

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

const CASE_STATUS_GROUPS = ["Undelivered", "Active", "Fully Finished"];
let groupedCasesByStatus = { Undelivered: [], Active: [], "Fully Finished": [] };
let activeStatusGroup = "Active";

const renderCaseList = () => {
  const items = groupedCasesByStatus[activeStatusGroup] || [];
  caseGroups.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No cases yet.";
    caseGroups.appendChild(empty);
    return;
  }
  items.forEach((item) => caseGroups.appendChild(buildCaseRow(item)));
};

const renderCaseStatusTabs = () => {
  caseStatusTabs.innerHTML = "";
  CASE_STATUS_GROUPS.forEach((label) => {
    const count = groupedCasesByStatus[label].length;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ghost-button${label === activeStatusGroup ? " active" : ""}`;
    button.textContent = `${label} (${count})`;
    button.addEventListener("click", () => {
      activeStatusGroup = label;
      renderCaseStatusTabs();
      renderCaseList();
    });
    caseStatusTabs.appendChild(button);
  });
};

const renderGroups = (cases) => {
  groupedCasesByStatus = { Undelivered: [], Active: [], "Fully Finished": [] };
  cases.forEach((item) => {
    groupedCasesByStatus[statusToGroup(item.status)].push(item);
  });
  renderCaseStatusTabs();
  renderCaseList();
};

const renderStatTiles = (stats) => {
  const overdueCount = stats.overdueTaskCount || 0;
  const avgDaysOpen = stats.avgDaysOpen === null || stats.avgDaysOpen === undefined
    ? "—"
    : `${stats.avgDaysOpen}d`;

  dashboardStats.innerHTML = `
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
  `;
};

const renderJurisdictionBars = (stats) => {
  const countsByLabel = new Map();
  (stats.byJurisdiction || []).forEach((row) => {
    const label = formatJurisdictionLabel(row.jurisdiction);
    countsByLabel.set(label, (countsByLabel.get(label) || 0) + row.caseCount);
  });

  const entries = Array.from(countsByLabel.entries()).sort((a, b) => b[1] - a[1]);
  const maxCount = entries.reduce((max, [, count]) => Math.max(max, count), 0) || 1;

  jurisdictionList.innerHTML = entries.length
    ? entries
        .map(
          ([label, count]) => `
        <div class="jurisdiction-row">
          <span class="jurisdiction-label">${label}</span>
          <div class="jurisdiction-bar-track">
            <div class="jurisdiction-bar-fill" style="width: ${Math.round((count / maxCount) * 100)}%"></div>
          </div>
          <span class="jurisdiction-count">${count}</span>
        </div>
      `
        )
        .join("")
    : '<div class="empty-state">No active cases yet.</div>';
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
    const isOverdue = isTaskOverdue(task);
    row.className = `card row${isOverdue ? " is-overdue" : isInProgress ? " is-in-progress" : ""}`;
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
        <span class="mono">Due ${formatDate(task.dueDate)}</span>
        ${
          isOverdue
            ? '<span class="status-chip status-chip-danger">Overdue</span>'
            : isInProgress
              ? '<span class="status-chip status-chip-amber">In Progress</span>'
              : ""
        }
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

// Personal intro line under the header, e.g.
//   "Good morning, Harry." / "You have 2 overdue tasks — they're at the top of My Tasks."
//   "Good afternoon, Sam." / "Nothing due today. 3 tasks are due in the next 7 days."
//   "Good evening, Alex." / "Your task list is clear. Nice work."
const timeOfDayGreeting = (date) => {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const taskSummaryLine = (tasks) => {
  const today = startOfDay(new Date());
  const weekOut = new Date(today);
  weekOut.setDate(weekOut.getDate() + 7);
  let overdue = 0;
  let dueToday = 0;
  let dueThisWeek = 0;
  tasks.forEach((task) => {
    const due = task.dueDate ? parseDateValue(task.dueDate) : null;
    if (!due) return;
    const day = startOfDay(due);
    if (day < today) overdue += 1;
    else if (day.getTime() === today.getTime()) dueToday += 1;
    else if (day <= weekOut) dueThisWeek += 1;
  });
  if (overdue) {
    const todayPart = dueToday ? `, plus ${dueToday} due today` : "";
    return `You have ${plural(overdue, "overdue task")}${todayPart} — ${overdue === 1 ? "it's" : "they're"} at the top of My Tasks.`;
  }
  if (dueToday) return `${plural(dueToday, "task")} ${dueToday === 1 ? "is" : "are"} due today.`;
  if (dueThisWeek) return `Nothing due today. ${plural(dueThisWeek, "task")} ${dueThisWeek === 1 ? "is" : "are"} due in the next 7 days.`;
  if (tasks.length) return `Nothing due this week — ${plural(tasks.length, "open task")} on your list.`;
  return "Your task list is clear. Nice work.";
};

const renderGreeting = (tasks, trademarkStats) => {
  if (!dashboardGreeting) return;
  const user = getUser();
  const firstName = String(user?.name || "").trim().split(/\s+/)[0] || user?.email || "there";
  const lines = [`<p class="dashboard-greeting-sub">${escapeHtml(taskSummaryLine(tasks))}</p>`];
  if (trademarkStats && (trademarkStats.overdue || trademarkStats.dueSoon)) {
    const parts = [];
    if (trademarkStats.overdue) parts.push(`${trademarkStats.overdue} overdue`);
    if (trademarkStats.dueSoon) parts.push(`${trademarkStats.dueSoon} due soon`);
    lines.push(
      `<p class="dashboard-greeting-sub">Trademark Docket: <a href="trademark-docket.html">${escapeHtml(parts.join(", "))}</a>.</p>`
    );
  }
  dashboardGreeting.innerHTML = `
    <h1 class="dashboard-greeting-title">${escapeHtml(timeOfDayGreeting(new Date()))}, ${escapeHtml(firstName)}.</h1>
    ${lines.join("")}`;
};

const loadTrademarkStatsForGreeting = async () => {
  const user = getUser();
  if (!isAdmin() && !user?.allowTrademarkDocket) return null;
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const response = await authFetch(`/api/trademark/stats?today=${today}`);
    return response.ok ? response.json() : null;
  } catch (err) {
    return null;
  }
};

const init = async () => {
  const tasks = await loadMyTasks();
  renderTasks(tasks);
  renderGreeting(tasks, null);
  loadTrademarkStatsForGreeting().then((stats) => {
    if (stats) renderGreeting(tasks, stats);
  });
  const cases = await loadCases();
  renderGroups(cases);
  const stats = await loadLitigationStats();
  renderStatTiles(stats);
  renderJurisdictionBars(stats);
};

init();
