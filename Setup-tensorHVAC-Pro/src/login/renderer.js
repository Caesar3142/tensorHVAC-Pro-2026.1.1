// renderer.js — license screen (index.html)

const emailInput = document.getElementById("email");
const keyInput = document.getElementById("productKey");
const submitBtn = document.getElementById("submit");
const msg = document.getElementById("msg");
const form = document.getElementById("licenseForm");

function setMsg(text, ok = false) {
  if (!text) {
    msg.classList.remove("show");
    return;
  }

  msg.classList.add("show");
  msg.textContent = "";
  
  // Clear existing content
  while (msg.firstChild) {
    msg.removeChild(msg.firstChild);
  }

  // Add icon
  const icon = document.createElement("span");
  icon.className = "msg-icon";
  icon.textContent = ok ? "✓" : "✕";
  msg.appendChild(icon);

  // Add text
  const textNode = document.createTextNode(text);
  msg.appendChild(textNode);

  msg.className = `msg show ${ok ? "success" : "error"}`;
}

function setLoading(loading) {
  if (loading) {
    submitBtn.classList.add("loading");
    submitBtn.disabled = true;
  } else {
    submitBtn.classList.remove("loading");
    submitBtn.disabled = false;
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  
  setMsg("Validating license…", false);
  setLoading(true);

  try {
    const email = (emailInput.value || "").trim();
    const productKey = (keyInput.value || "").trim();

    if (!email || !productKey) {
      setMsg("Please enter both email and product key.", false);
      setLoading(false);
      return;
    }

    if (!window.api) {
      setMsg("Internal API bridge unavailable. Please restart the application.", false);
      setLoading(false);
      return;
    }

    // Validate license
    const res = typeof window.api.validateLicense === "function"
      ? await window.api.validateLicense(email, productKey)
      : await window.api.invoke("license:validate", { email, productKey });

    if (res?.ok) {
      setMsg("License validated successfully! Redirecting…", true);
      
      // Small delay to show success message
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Navigate to home page after successful validation
      const proceed = await window.api.invoke("app:proceed");
      if (!proceed?.ok) {
        setMsg(proceed?.message || "Failed to open the application.", false);
        setLoading(false);
      }
      // No further action required; main will swap the page.
    } else {
      setMsg(res?.message || "License validation failed. Please check your credentials.", false);
      setLoading(false);
    }
  } catch (e) {
    console.error("[renderer] validation error:", e);
    setMsg(e?.message || "An unexpected error occurred. Please try again.", false);
    setLoading(false);
  }
}

form.addEventListener("submit", handleSubmit);
submitBtn.addEventListener("click", handleSubmit);

// Allow Enter key to submit
[emailInput, keyInput].forEach((el) => {
  el?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !submitBtn.disabled) {
      e.preventDefault();
      handleSubmit(e);
    }
  });

  // Clear error message when user starts typing
  el?.addEventListener("input", () => {
    if (msg.classList.contains("show")) {
      setMsg("");
    }
  });
});

// Theme Toggle Functionality
const themeToggle = document.getElementById("themeToggle");
const themeIcon = document.getElementById("themeIcon");
const themeText = document.getElementById("themeText");

function initTheme() {
  // Force light mode by default, ignore system preference
  const savedTheme = localStorage.getItem("theme");
  // Only use saved theme if it exists, otherwise default to light
  const theme = savedTheme || "light";
  applyTheme(theme);
  
  // Ensure body doesn't have dark-mode class on initial load if light mode
  if (theme === "light") {
    document.body.classList.remove("dark-mode");
    document.body.style.background = "#ffffff";
  }
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.body.classList.add("dark-mode");
    document.body.style.background = "#0f172a";
    themeIcon.textContent = "☀️";
    themeText.textContent = "Light";
  } else {
    document.body.classList.remove("dark-mode");
    document.body.style.background = "#ffffff";
    themeIcon.textContent = "🌙";
    themeText.textContent = "Dark";
  }
  localStorage.setItem("theme", theme);
}

themeToggle.addEventListener("click", () => {
  const isDark = document.body.classList.contains("dark-mode");
  applyTheme(isDark ? "light" : "dark");
});

// Force light mode immediately before DOM loads
document.body.style.background = "#ffffff";
document.body.classList.remove("dark-mode");

// Focus on email input when page loads
window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  emailInput.focus();
});
