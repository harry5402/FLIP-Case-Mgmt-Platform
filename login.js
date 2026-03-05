const form = document.getElementById("login-form");
const loginError = document.getElementById("login-error");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const name = formData.get("name").trim();
  const email = formData.get("email").trim();

  if (!name || !email) {
    loginError.textContent = "Name and email are required.";
    return;
  }

  signIn({ name, email });
  window.location.href = "index.html";
});
