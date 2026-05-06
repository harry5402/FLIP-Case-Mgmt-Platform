const AUTH_KEY = "flipAuth";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const DEFAULT_IDLE_TIMEOUT_MINUTES = 60;
const WARNING_BUFFER_MS = 2 * 60 * 1000;
let lastClientActivityAt = Date.now();
let idleWarningShown = false;
let idleMonitorStarted = false;
let idleMonitorInterval = null;

const ensureHeaderLogo = () => {
  document.querySelectorAll(".app-header").forEach((header) => {
    if (header.querySelector(".header-logo")) return;
    const logo = document.createElement("img");
    logo.src = "logo.png";
    logo.alt = "FLIP";
    logo.className = "header-logo";
    header.prepend(logo);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", ensureHeaderLogo);
} else {
  ensureHeaderLogo();
}

const getAuth = () => {
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? JSON.parse(raw) : null;
};

const getUser = () => getAuth()?.user || null;
const getToken = () => getAuth()?.token || null;
const isAdmin = () => getUser()?.role === "admin";
const getIdleTimeoutMinutes = () =>
  Number(getAuth()?.session?.idleTimeoutMinutes) || DEFAULT_IDLE_TIMEOUT_MINUTES;
const getIdleTimeoutMs = () => getIdleTimeoutMinutes() * 60 * 1000;

const trackClientActivity = () => {
  lastClientActivityAt = Date.now();
  idleWarningShown = false;
};

const checkIdleSession = () => {
  const token = getToken();
  if (!token) return;

  const idleTimeoutMs = getIdleTimeoutMs();
  const idleMs = Date.now() - lastClientActivityAt;

  if (idleMs >= idleTimeoutMs) {
    alert("Session expired due to inactivity.");
    signOut();
    return;
  }

  if (!idleWarningShown && idleMs >= idleTimeoutMs - WARNING_BUFFER_MS) {
    idleWarningShown = true;
    const staySignedIn = window.confirm(
      "You will be logged out in about 2 minutes due to inactivity. Stay signed in?"
    );
    if (staySignedIn) {
      trackClientActivity();
      authFetch("/api/auth/me").catch(() => {});
    } else {
      signOut();
    }
  }
};

const startIdleMonitor = () => {
  if (idleMonitorStarted || window.location.pathname.endsWith("login.html")) return;
  if (!getToken()) return;

  idleMonitorStarted = true;
  trackClientActivity();
  ["click", "keydown", "mousemove", "touchstart", "scroll"].forEach((eventName) => {
    window.addEventListener(eventName, trackClientActivity, { passive: true });
  });
  idleMonitorInterval = window.setInterval(checkIdleSession, 15000);
};

const requireAuth = () => {
  const token = getToken();
  if (!token && !window.location.pathname.endsWith("login.html")) {
    window.location.href = "login.html";
    return;
  }
  startIdleMonitor();
};

const requireAdmin = () => {
  requireAuth();
  if (!isAdmin()) {
    window.location.href = "index.html";
  }
};

const authFetch = async (url, options = {}) => {
  trackClientActivity();
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    signOut();
    throw new Error("Unauthorized");
  }
  return response;
};

const signIn = (payload) => {
  localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
  trackClientActivity();
};

const signOut = () => {
  localStorage.removeItem(AUTH_KEY);
  if (idleMonitorInterval) {
    clearInterval(idleMonitorInterval);
    idleMonitorInterval = null;
  }
  idleMonitorStarted = false;
  window.location.href = "login.html";
};
