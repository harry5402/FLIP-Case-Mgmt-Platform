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
  users.forEach((user) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${user.name || "—"}</td>
      <td>${user.email}</td>
      <td>${user.role}</td>
      <td>${formatDate(user.created_at)}</td>
    `;
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
