const AUTH_KEY = "flipUser";

const getUser = () => {
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? JSON.parse(raw) : null;
};

const requireAuth = () => {
  const user = getUser();
  if (!user && !window.location.pathname.endsWith("login.html")) {
    window.location.href = "login.html";
  }
};

const signIn = (payload) => {
  localStorage.setItem(AUTH_KEY, JSON.stringify(payload));
};

const signOut = () => {
  localStorage.removeItem(AUTH_KEY);
  window.location.href = "login.html";
};
