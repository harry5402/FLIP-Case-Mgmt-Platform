const form = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const email = formData.get("email").trim();
  const password = formData.get("password");

  if (!email || !password) {
    loginError.textContent = "Email and password are required.";
    return;
  }

  loginError.textContent = "";
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    loginError.textContent = "Invalid email or password.";
    return;
  }

  const payload = await response.json();
  signIn(payload);
  window.location.href = "index.html";
});
