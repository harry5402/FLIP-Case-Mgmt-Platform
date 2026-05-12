const weeklyTaskGroups = document.getElementById("weekly-task-groups");
const weeklyTasklistSubtitle = document.getElementById("weekly-tasklist-subtitle");

const weekdayLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const collapsedWeeklyBuckets = new Set();

const getTaskTargetUrl = (task) =>
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

const getTaskContextLabel = (task) =>
  task.targetType === "general"
    ? "General Task"
    : task.targetType === "group"
      ? escapeHtml(task.groupName || "Group")
      : task.targetType === "docket"
        ? "Docket Entry"
        : task.targetType === "case"
          ? "Case Reminder"
          : escapeHtml(task.defendantName || "Defendant");

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
  if (task.isHidden) return null;
  if (!task.dueDate) return null;
  const parsedDueDate = parseDateValue(task.dueDate);
  if (!parsedDueDate) return null;
  const due = startOfDay(parsedDueDate);
  if (Number.isNaN(due.getTime())) return null;
  if (due < week.monday) {
    return task.status === "Complete" ? null : "OVERDUE";
  }
  if (due > week.friday) return null;
  const day = due.getDay();
  if (day === 0 || day === 6) return null;
  return weekdayLabels[day - 1];
};

const createTaskCard = (task) => {
  const currentUser = getUser();
  const isAssignedToCurrentUser =
    Boolean(currentUser?.id) && currentUser.id === task.assignedToUserId;
  const canToggleProgress = !task.assignedToUserId || isAssignedToCurrentUser;
  const canComplete =
    typeof task.canComplete === "boolean"
      ? task.canComplete
      : !task.assignedToUserId || isAssignedToCurrentUser;
  const isComplete = task.status === "Complete";
  const isInProgress = task.status === "In Progress" || task.isInProgress;
  const assigneeLabel = task.assignedToName
    ? `${task.assignedToName}${task.assignedToEmail ? ` (${task.assignedToEmail})` : ""}`
    : task.assignedToEmail || task.assignedToLabel || "Unassigned";
  const row = document.createElement("div");
  row.className = `card row${isInProgress ? " is-in-progress" : ""}`;
  const targetUrl = getTaskTargetUrl(task);
  const titleHtml = targetUrl
    ? `<a class="card-title task-link" href="${targetUrl}">${escapeHtml(task.taskType)}</a>`
    : `<span class="card-title">${escapeHtml(task.taskType)}</span>`;
  row.innerHTML = `
    <div class="row-left">
      ${titleHtml}
      <div class="card-meta">
        ${task.targetType !== "general" ? `<span>${escapeHtml(task.caseName || "Case")}</span>` : ""}
        <span>${getTaskContextLabel(task)}</span>
        <span>Assigned to ${escapeHtml(assigneeLabel)}</span>
        ${task.taskRole === "collaborator" ? "<span>Support Task</span>" : ""}
        <span>Due ${formatDate(task.dueDate)}</span>
        ${isInProgress && !isComplete ? "<span>In Progress</span>" : ""}
        ${isComplete ? "<span>Completed</span>" : ""}
      </div>
    </div>
    <div class="row-right task-actions">
      <button class="ghost-button progress-task" type="button" ${
        canToggleProgress && !isComplete ? "" : "disabled"
      }>${
        isComplete
          ? "Completed"
          : isInProgress
            ? "Clear Progress"
            : canToggleProgress
              ? "In Progress"
              : "Assigned Elsewhere"
      }</button>
      <button class="ghost-button complete-task" type="button" ${
        canComplete && !isComplete ? "" : "disabled"
      }>${
        isComplete
          ? "Completed"
          : canComplete
          ? task.taskRole === "collaborator"
            ? "Mark My Part Complete"
            : "Task Complete"
          : "Assigned Elsewhere"
      }</button>
    </div>
  `;
  row.querySelector(".progress-task").addEventListener("click", async () => {
    if (!canToggleProgress || isComplete) return;
    const result = await updateTaskState(task.id, isInProgress ? "Open" : "In Progress");
    if (!result?.error) {
      const tasks = await loadAllTasks();
      renderWeeklyTasks(tasks);
    }
  });
  row.querySelector(".complete-task").addEventListener("click", async () => {
    if (!canComplete || isComplete) return;
    const result = await completeTask(task.id);
    if (!result?.error) {
      const tasks = await loadAllTasks();
      renderWeeklyTasks(tasks);
    }
  });
  return row;
};

const createBucketSection = (label, tasks) => {
  const section = document.createElement("section");
  section.className = "table-card weekly-task-section";
  const isCollapsed = collapsedWeeklyBuckets.has(label);
  section.innerHTML = `
    <div class="info-card-header weekly-task-section-header">
      <div class="weekly-task-section-title">
        <h3>${label}</h3>
        <div class="muted">${tasks.length} task${tasks.length === 1 ? "" : "s"}</div>
      </div>
      <button class="ghost-button weekly-bucket-toggle" type="button" aria-expanded="${String(
        !isCollapsed
      )}">
        ${isCollapsed ? "Expand" : "Collapse"}
      </button>
    </div>
  `;
  const list = document.createElement("div");
  list.className = "list compact-list";
  if (isCollapsed) {
    list.classList.add("hidden");
  }
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No tasks.";
    list.appendChild(empty);
  } else {
    tasks.forEach((task) => list.appendChild(createTaskCard(task)));
  }
  section.querySelector(".weekly-bucket-toggle").addEventListener("click", () => {
    const nextCollapsed = !list.classList.contains("hidden");
    list.classList.toggle("hidden", nextCollapsed);
    if (nextCollapsed) {
      collapsedWeeklyBuckets.add(label);
    } else {
      collapsedWeeklyBuckets.delete(label);
    }
    const toggle = section.querySelector(".weekly-bucket-toggle");
    toggle.textContent = nextCollapsed ? "Expand" : "Collapse";
    toggle.setAttribute("aria-expanded", String(!nextCollapsed));
  });
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

  const modal = document.getElementById("new-general-task-modal");
  const openBtn = document.getElementById("new-general-task-btn");
  const form = document.getElementById("new-general-task-form");
  const errorEl = document.getElementById("general-task-error");
  const assigneeSelect = document.getElementById("general-task-assignee");

  const openModal = () => {
    form.reset();
    errorEl.textContent = "";
    modal.classList.remove("hidden");
  };
  const closeModal = () => modal.classList.add("hidden");

  openBtn.addEventListener("click", openModal);
  modal.querySelectorAll(".modal-close").forEach((btn) => btn.addEventListener("click", closeModal));
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  try {
    const response = await authFetch("/api/users");
    const users = await response.json();
    users.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.id;
      opt.textContent = u.name || u.email;
      assigneeSelect.appendChild(opt);
    });
  } catch (_) {}

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";
    const data = new FormData(form);
    const payload = {
      taskType: String(data.get("taskType") || "").trim(),
      assignedToUserId: data.get("assignedToUserId") || null,
      dueDate: data.get("dueDate"),
    };
    if (!payload.taskType || !payload.dueDate) {
      errorEl.textContent = "Task name and due date are required.";
      return;
    }
    const result = await createTask(payload);
    if (result?.error) {
      errorEl.textContent = result.error;
      return;
    }
    closeModal();
    const refreshed = await loadAllTasks();
    renderWeeklyTasks(refreshed);
  });
};

init();
