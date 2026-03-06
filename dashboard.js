const caseGroups = document.getElementById("case-groups");
const usersLink = document.getElementById("users-link");
const logoutButton = document.getElementById("logout-button");
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
    const row = document.createElement("a");
    row.className = "card row";
    row.href = `defendant.html?caseId=${encodeURIComponent(
      task.caseId
    )}&defendantId=${encodeURIComponent(task.defendantId)}`;
    row.innerHTML = `
      <div class="row-left">
        <div class="card-title">${task.taskType}</div>
        <div class="card-meta">
          <span>${task.caseName || "Case"}</span>
          <span>${task.defendantName || "Defendant"}</span>
        </div>
      </div>
      <div class="row-right">Due ${formatDate(task.dueDate)}</div>
    `;
    tasksList.appendChild(row);
  });
};

const init = async () => {
  if (isAdmin()) {
    usersLink.classList.remove("hidden");
  }
  logoutButton.addEventListener("click", signOut);
  const tasks = await loadMyTasks();
  renderTasks(tasks);
  const cases = await loadCases();
  renderGroups(cases);
};

init();
