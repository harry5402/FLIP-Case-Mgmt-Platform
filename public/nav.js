// Shared left sidebar — injected into <div id="app-nav"> on every authenticated
// page. Load after auth.js, before the page's own script. See REDESIGN.md §3.

const NAV_ICONS = {
  dashboard:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
  docket:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
  tasklist:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1.2 1.2L7.5 4.8M4 12l1.2 1.2 2.3-2.4M4 18l1.2 1.2 2.3-2.4"/></svg>',
  email:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 7 8.5-7"/></svg>',
  automations:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h9M17 6h3M4 12h3M9 12h11M4 18h13"/><circle cx="15" cy="6" r="2"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6"/></svg>',
  reports:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>',
};

const NAV_LINKS = [
  { key: "dashboard", href: "index.html", label: "Dashboard", icon: "dashboard" },
  { key: "docket", href: "litigation-docket.html", label: "Litigation Docket", icon: "docket" },
  { key: "tasklist", href: "weekly-tasklist.html", label: "Weekly Tasklist", icon: "tasklist" },
  { key: "email", href: "email.html", label: "Email Portal", icon: "email" },
  { key: "automations", href: "automations.html", label: "Tools & Automations", icon: "automations" },
  { key: "users", href: "users.html", label: "Users", icon: "users", id: "users-link", requires: "admin" },
  { key: "reports", href: "weekly-report.html", label: "Reports", icon: "reports", id: "weekly-report-link", requires: "reports" },
];

const renderSidebar = (mount) => {
  const activeKey = document.body.dataset.nav || "";
  const user = getUser();

  const linksHtml = NAV_LINKS.map((link) => {
    const classes = ["app-sidebar-link"];
    if (link.key === activeKey) classes.push("active");
    if (link.requires) classes.push("hidden");
    const idAttr = link.id ? ` id="${link.id}"` : "";
    return `<a class="${classes.join(" ")}"${idAttr} href="${link.href}">${NAV_ICONS[link.icon]}<span>${link.label}</span></a>`;
  }).join("");

  mount.innerHTML = `
    <aside class="app-sidebar">
      <a class="app-sidebar-logo" href="index.html"><img src="logo.png" alt="FLIP" /></a>
      <nav class="app-sidebar-nav">${linksHtml}</nav>
      <div class="app-sidebar-footer">
        <div class="app-sidebar-user">${escapeHtml(user?.name || user?.email || "")}</div>
        <button class="app-sidebar-action hidden" id="change-password-button" type="button">Change Password</button>
        <button class="app-sidebar-action" id="logout-all-button" type="button">Log Out All Sessions</button>
        <button class="app-sidebar-action app-sidebar-action-primary" id="logout-button" type="button">Logout</button>
      </div>
    </aside>
  `;

  document.body.classList.add("has-sidebar");

  // Preserves the existing (pre-redesign) rule: admins manage their password
  // via another admin rather than self-service, so only non-admins see this.
  if (isAdmin()) {
    document.getElementById("users-link")?.classList.remove("hidden");
  } else {
    document.getElementById("change-password-button")?.classList.remove("hidden");
  }
  if (isAdmin() || user?.allowWeeklyReport) {
    document.getElementById("weekly-report-link")?.classList.remove("hidden");
  }
};

const renderPasswordModal = () => {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div id="password-modal" class="modal hidden">
      <div class="modal-card">
        <div class="panel-header-row">
          <div>
            <h2>Change Password</h2>
            <div class="muted">Update your account password</div>
          </div>
          <button class="ghost-button" id="close-password-modal" type="button">Close</button>
        </div>
        <form id="password-form" class="form-grid">
          <label class="form-field">
            Current Password
            <input id="old-password" type="password" autocomplete="current-password" required />
          </label>
          <label class="form-field">
            New Password
            <input id="new-password" type="password" autocomplete="new-password" minlength="8" required />
          </label>
          <label class="form-field">
            Confirm New Password
            <input id="confirm-password" type="password" autocomplete="new-password" minlength="8" required />
          </label>
        </form>
        <div class="form-actions">
          <div id="password-error" class="form-error"></div>
          <button class="ghost-button" type="submit" form="password-form">Save</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild);

  const passwordModal = document.getElementById("password-modal");
  const closePasswordModal = document.getElementById("close-password-modal");
  const passwordForm = document.getElementById("password-form");
  const oldPasswordInput = document.getElementById("old-password");
  const newPasswordInput = document.getElementById("new-password");
  const confirmPasswordInput = document.getElementById("confirm-password");
  const passwordError = document.getElementById("password-error");

  const openPasswordModal = () => {
    passwordError.textContent = "";
    passwordForm.reset();
    passwordModal.classList.remove("hidden");
    oldPasswordInput.focus();
  };
  const closePasswordModalHandler = () => {
    passwordModal.classList.add("hidden");
  };
  const onPasswordSubmit = async (event) => {
    event.preventDefault();
    passwordError.textContent = "";

    const oldPassword = oldPasswordInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (newPassword !== confirmPassword) {
      passwordError.textContent = "New password confirmation does not match.";
      return;
    }
    if (newPassword.length < 8) {
      passwordError.textContent = "New password must be at least 8 characters.";
      return;
    }

    const response = await authFetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const payload = await response.json();
    if (!response.ok) {
      passwordError.textContent = payload?.error || "Unable to update password. Please try again.";
      return;
    }

    closePasswordModalHandler();
    alert("Password updated.");
  };

  document.getElementById("change-password-button")?.addEventListener("click", openPasswordModal);
  closePasswordModal.addEventListener("click", closePasswordModalHandler);
  passwordForm.addEventListener("submit", onPasswordSubmit);
};

const wireSidebarActions = () => {
  document.getElementById("logout-button")?.addEventListener("click", async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      // signOut() below still clears the local session even if this fails.
    }
    signOut();
  });

  document.getElementById("logout-all-button")?.addEventListener("click", async () => {
    const confirmed = window.confirm("Log out all active sessions for this account?");
    if (!confirmed) return;
    const response = await authFetch("/api/auth/logout-all", { method: "POST" });
    const result = await response.json();
    if (result?.ok) {
      alert("All sessions logged out. Please sign in again.");
      signOut();
    }
  });
};

const initNav = () => {
  const mount = document.getElementById("app-nav");
  if (!mount) return;
  renderSidebar(mount);
  renderPasswordModal();
  wireSidebarActions();
};

initNav();
