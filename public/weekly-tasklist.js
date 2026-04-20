const weeklyTaskGroups = document.getElementById("weekly-task-groups");
const weeklyTasklistSubtitle = document.getElementById("weekly-tasklist-subtitle");

const weekdayLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const getTaskTargetUrl = (task) =>
  task.targetType === "group"
    ? `group.html?groupId=${encodeURIComponent(task.groupId)}`
    : task.targetType === "docket"
      ? `litigation-docket.html?tab=${encodeURIComponent(
          task.jurisdiction || "NDIL"
        )}&caseId=${encodeURIComponent(task.caseId)}&action=${encodeURIComponent(
          String(task.taskType || "").replace(/^Docket:\s*/, "")
        )}`
      : task.targetType === "case"
        ? `case.html?caseId=${encodeURIComponent(task.caseId)}`
        : `defendant.html?caseId=${encodeURIComponent(
            task.caseId
          )}&defendantId=${encodeURIComponent(task.defendantId)}`;

const getTaskContextLabel = (task) =>
  task.targetType === "group"
    ? task.groupName || "Group"
    : task.targetType === "docket"
      ? "Docket Entry"
      : task.targetType === "case"
        ? "Case Reminder"
        : task.defendantName || "Defendant";

const startOfDay = (date) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
};

const formatRangeDate = (date) =>
  date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

const getCurrentWorkWeek = () => {
  const today = startOfDay(new Date());
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = startOfDay(new Date(today));
  monday.setDate(today.getDate() + mondayOffset);
  const friday = startOfDay(new Date(monday));
  friday.setDate(monday.getDate() + 4);
  return { today, monday, friday };
};

const getTaskBucket = (task, week) => {
  if (!task.dueDate) return null;
  const due = startOfDay(new Date(task.dueDate));
  if (Number.isNaN(due.getTime())) return null;
  if (due < week.today) return "OVERDUE";
  if (due < week.monday || due > week.friday) return null;
  const day = due.getDay();
  if (day === 0 || day === 6) return null;
  return weekdayLabels[day - 1];
};

const createTaskCard = (task) => {
  const currentUser = getUser();
  const isAssignedToCurrentUser =
    Boolean(currentUser?.id) && currentUser.id === task.assignedToUserId;
  const assigneeLabel = task.assignedToName
    ? `${task.assignedToName}${task.assignedToEmail ? ` (${task.assignedToEmail})` : ""}`
    : task.assignedToEmail || "Unassigned";
  const row = document.createElement("div");
  row.className = "card row";
  row.innerHTML = `
    <div class="row-left">
      <a class="card-title task-link" href="${getTaskTargetUrl(task)}">${task.taskType}</a>
      <div class="card-meta">
        <span>${task.caseName || "Case"}</span>
        <span>${getTaskContextLabel(task)}</span>
        <span>Assigned to ${assigneeLabel}</span>
        <span>Due ${formatDate(task.dueDate)}</span>
      </div>
    </div>
    <div class="row-right task-actions">
      <button class="ghost-button complete-task" type="button" ${
        isAssignedToCurrentUser ? "" : "disabled"
      }>${isAssignedToCurrentUser ? "Task Complete" : "Assigned Elsewhere"}</button>
    </div>
  `;
  row.querySelector(".complete-task").addEventListener("click", async () => {
    if (!isAssignedToCurrentUser) return;
    const result = await completeTask(task.id);
    if (!result?.error) {
      row.remove();
      if (!weeklyTaskGroups.querySelector(".card.row")) {
        renderWeeklyTasks([]);
      }
    }
  });
  return row;
};

const createBucketSection = (label, tasks) => {
  const section = document.createElement("section");
  section.className = "table-card weekly-task-section";
  section.innerHTML = `
    <div class="info-card-header">
      <h3>${label}</h3>
      <div class="muted">${tasks.length} task${tasks.length === 1 ? "" : "s"}</div>
    </div>
  `;
  const list = document.createElement("div");
  list.className = "list compact-list";
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No tasks.";
    list.appendChild(empty);
  } else {
    tasks.forEach((task) => list.appendChild(createTaskCard(task)));
  }
  section.appendChild(list);
  return section;
};

const renderWeeklyTasks = (tasks) => {
  const week = getCurrentWorkWeek();
  weeklyTasklistSubtitle.textContent = `${formatRangeDate(week.monday)} – ${formatRangeDate(
    week.friday
  )}`;

  const buckets = {
    OVERDUE: [],
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
  };

  tasks.forEach((task) => {
    const bucket = getTaskBucket(task, week);
    if (bucket) {
      buckets[bucket].push(task);
    }
  });

  weeklyTaskGroups.innerHTML = "";
  ["OVERDUE", ...weekdayLabels].forEach((label) => {
    weeklyTaskGroups.appendChild(createBucketSection(label, buckets[label]));
  });
};

const init = async () => {
  const tasks = await loadAllTasks();
  renderWeeklyTasks(tasks);
};

init();
