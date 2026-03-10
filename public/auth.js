const AUTH_KEY = "flipAuth";

const getAuth = () => {
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? JSON.parse(raw) : null;
};

const getUser = () => getAuth()?.user || null;
const getToken = () => getAuth()?.token || null;
const isAdmin = () => getUser()?.role === "admin";

const requireAuth = () => {
  const token = getToken();
  if (!token && !window.location.pathname.endsWith("login.html")) {
    window.location.href = "login.html";
  }
};

const requireAdmin = () => {
  requireAuth();
  if (!isAdmin()) {
    window.location.href = "index.html";
  }
};

const authFetch = async (url, options = {}) => {
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
};

const signOut = () => {
  localStorage.removeItem(AUTH_KEY);
  window.location.href = "login.html";
};
