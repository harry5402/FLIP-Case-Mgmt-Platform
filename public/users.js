const userForm = document.getElementById("user-form");
const usersError = document.getElementById("users-error");
const usersTableBody = document.querySelector("#users-table tbody");
let allUsers = [];

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const renderUsers = (users) => {
  usersTableBody.innerHTML = "";
  const currentUser = getUser();
  users.forEach((user) => {
    const row = document.createElement("tr");
    const disableSelf = currentUser?.id === user.id;
    row.innerHTML = `
      <td>${escapeHtml(user.name || "—")}</td>
      <td>${escapeHtml(user.email)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>
        <button class="ghost-button weekly-cleanup-toggle" type="button" data-user-id="${user.id}">
          ${user.allow_weekly_task_cleanup ? "On" : "Off"}
        </button>
      </td>
      <td>
        <button class="ghost-button weekly-report-toggle" type="button" data-user-id="${user.id}">
          ${user.allow_weekly_report ? "On" : "Off"}
        </button>
      </td>
      <td>
        ${
          user.role === "admin"
            ? `<span class="muted">Always (admin)</span>`
            : `<button class="ghost-button trademark-access-toggle" type="button" data-user-id="${user.id}">
          ${user.allow_trademark_docket ? "On" : "Off"}
        </button>`
        }
      </td>
      <td>${formatDate(user.created_at)}</td>
      <td>
        <button class="ghost-button logout-all-user" type="button" data-user-id="${user.id}" ${
          disableSelf ? "disabled" : ""
        }>
          Log Out Sessions
        </button>
        <button class="ghost-button danger-button remove-user" type="button" data-user-id="${user.id}" ${
          disableSelf ? 'disabled title="You can\'t remove your own account"' : ""
        }>
          Remove
        </button>
      </td>
    `;
    const cleanupButton = row.querySelector(".weekly-cleanup-toggle");
    cleanupButton.addEventListener("click", async () => {
      usersError.textContent = "";
      const response = await authFetch(`/api/users/${user.id}/weekly-task-cleanup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowWeeklyTaskCleanup: !user.allow_weekly_task_cleanup,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        usersError.textContent = payload?.error || "Unable to update weekly cleanup setting.";
        return;
      }
      await loadUsers();
    });
    const reportButton = row.querySelector(".weekly-report-toggle");
    reportButton.addEventListener("click", async () => {
      usersError.textContent = "";
      const response = await authFetch(`/api/users/${user.id}/weekly-report-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowWeeklyReport: !user.allow_weekly_report }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        usersError.textContent = payload?.error || "Unable to update weekly report setting.";
        return;
      }
      await loadUsers();
    });
    const trademarkButton = row.querySelector(".trademark-access-toggle");
    trademarkButton?.addEventListener("click", async () => {
      usersError.textContent = "";
      const response = await authFetch(`/api/users/${user.id}/trademark-access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowTrademarkDocket: !user.allow_trademark_docket }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        usersError.textContent = payload?.error || "Unable to update Trademark Docket access.";
        return;
      }
      await loadUsers();
    });
    const logoutAllButton = row.querySelector(".logout-all-user");
    logoutAllButton.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `Log out all sessions for ${user.email}?`
      );
      if (!confirmed) return;
      const response = await authFetch(`/api/users/${user.id}/logout-all`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        usersError.textContent = payload?.error || "Unable to revoke sessions.";
        return;
      }
      usersError.textContent = `Logged out ${payload.sessionsInvalidated || 0} session(s) for ${user.email}.`;
    });
    row.querySelector(".remove-user").addEventListener("click", () => openRemoveUserModal(user));
    usersTableBody.appendChild(row);
  });
};

// ---------------------------------------------------------------------------
// Remove user (admin only — the server enforces it too)
// ---------------------------------------------------------------------------
const removeModal = document.createElement("div");
removeModal.className = "modal hidden";
removeModal.id = "remove-user-modal";
removeModal.innerHTML = `
  <div class="modal-card">
    <div class="info-card-header">
      <h3>Remove User</h3>
      <button class="ghost-button" type="button" data-remove-close>Close</button>
    </div>
    <div id="remove-user-body" class="remove-user-body"></div>
    <div class="form-actions">
      <div id="remove-user-error" class="form-error"></div>
      <button id="remove-user-confirm" class="ghost-button danger-button" type="button" disabled>Remove permanently</button>
    </div>
  </div>`;
document.body.appendChild(removeModal);
const removeBody = removeModal.querySelector("#remove-user-body");
const removeError = removeModal.querySelector("#remove-user-error");
const removeConfirm = removeModal.querySelector("#remove-user-confirm");
let removingUser = null;

const closeRemoveModal = () => {
  removeModal.classList.add("hidden");
  removingUser = null;
};
removeModal.querySelector("[data-remove-close]").addEventListener("click", closeRemoveModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !removeModal.classList.contains("hidden")) closeRemoveModal();
});

const pluralize = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const openRemoveUserModal = async (user) => {
  removingUser = user;
  removeError.textContent = "";
  removeConfirm.disabled = true;
  removeBody.innerHTML = `<div class="muted">Loading…</div>`;
  removeModal.classList.remove("hidden");
  const response = await authFetch(`/api/users/${user.id}/removal-summary`);
  const summary = await response.json().catch(() => ({}));
  if (!response.ok) {
    removeBody.innerHTML = "";
    removeError.textContent = summary?.error || "Unable to load this user.";
    return;
  }
  const openWork = [
    summary.openTasks ? pluralize(summary.openTasks, "open task") : null,
    summary.litigationActions ? pluralize(summary.litigationActions, "docket assignment") : null,
    summary.collaborations ? pluralize(summary.collaborations, "docket collaboration") : null,
    summary.trademarkItems ? pluralize(summary.trademarkItems, "trademark item") : null,
    summary.trademarkTodos ? pluralize(summary.trademarkTodos, "trademark to-do") : null,
  ].filter(Boolean);
  const others = allUsers.filter((u) => u.id !== user.id);
  removeBody.innerHTML = `
    <p><strong>${escapeHtml(user.name || user.email)}</strong> (${escapeHtml(user.email)}) will be removed from the platform permanently and signed out${
      summary.activeSessions ? ` of ${pluralize(summary.activeSessions, "active session")}` : ""
    }. This can't be undone.</p>
    <ul class="remove-user-list">
      <li>${openWork.length ? `Open work: ${escapeHtml(openWork.join(", "))}.` : "No open work assigned."}</li>
      <li>${summary.completedTasks ? `${pluralize(summary.completedTasks, "completed task")} will be kept, unassigned.` : "No completed tasks."}</li>
      <li>Their past audit-log entries keep their email address.</li>
    </ul>
    <label class="form-field">
      <span>Give their open work to</span>
      <select id="remove-user-reassign">
        <option value="">Nobody — leave it unassigned</option>
        ${others.map((u) => `<option value="${u.id}">${escapeHtml(u.name || u.email)}</option>`).join("")}
      </select>
    </label>
    <label class="form-field">
      <span>Type <strong>${escapeHtml(user.email)}</strong> to confirm</span>
      <input id="remove-user-confirm-email" autocomplete="off" />
    </label>`;
  const emailInput = removeBody.querySelector("#remove-user-confirm-email");
  emailInput.addEventListener("input", () => {
    removeConfirm.disabled = emailInput.value.trim().toLowerCase() !== user.email.toLowerCase();
  });
  emailInput.focus();
};

removeConfirm.addEventListener("click", async () => {
  if (!removingUser) return;
  removeError.textContent = "";
  removeConfirm.disabled = true;
  const response = await authFetch(`/api/users/${removingUser.id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reassignToUserId: removeBody.querySelector("#remove-user-reassign").value || null,
      confirmEmail: removeBody.querySelector("#remove-user-confirm-email").value,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    removeError.textContent = payload?.error || "Unable to remove this user.";
    removeConfirm.disabled = false;
    return;
  }
  const email = removingUser.email;
  closeRemoveModal();
  usersError.textContent = `Removed ${email}.`;
  await loadUsers();
});

const loadUsers = async () => {
  const response = await authFetch("/api/users");
  if (!response.ok) {
    usersError.textContent = "Unable to load users.";
    return;
  }
  const users = await response.json();
  allUsers = users;
  renderUsers(users);
};

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  usersError.textContent = "";
  const formData = new FormData(userForm);
  const payload = {
    name: formData.get("name").trim(),
    email: formData.get("email").trim(),
    password: formData.get("password"),
    allowWeeklyTaskCleanup: formData.get("allowWeeklyTaskCleanup") === "on",
  };

  const response = await authFetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    usersError.textContent = error.error || "Unable to create user.";
    return;
  }

  userForm.reset();
  await loadUsers();
});

loadUsers();
