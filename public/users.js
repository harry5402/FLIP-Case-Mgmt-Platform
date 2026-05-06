const userForm = document.getElementById("user-form");
const usersError = document.getElementById("users-error");
const usersTableBody = document.querySelector("#users-table tbody");
const logoutButton = document.getElementById("logout-button");

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
      <td>${formatDate(user.created_at)}</td>
      <td>
        <button class="ghost-button logout-all-user" type="button" data-user-id="${user.id}" ${
          disableSelf ? "disabled" : ""
        }>
          Log Out Sessions
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
    usersTableBody.appendChild(row);
  });
};

const loadUsers = async () => {
  const response = await authFetch("/api/users");
  if (!response.ok) {
    usersError.textContent = "Unable to load users.";
    return;
  }
  const users = await response.json();
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

logoutButton.addEventListener("click", signOut);

loadUsers();
