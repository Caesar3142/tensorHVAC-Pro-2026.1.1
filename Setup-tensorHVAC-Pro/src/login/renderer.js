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

  msg.textContent = text;
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

// Focus on email input when page loads
window.addEventListener("DOMContentLoaded", () => {
  emailInput.focus();
});
