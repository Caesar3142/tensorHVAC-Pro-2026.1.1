// renderer.js — license screen (index.html)

const emailInput = document.getElementById("email");
const keyInput   = document.getElementById("productKey");
const submitBtn  = document.getElementById("submit");
const msg        = document.getElementById("msg");

function setMsg(text, ok = false) {
  msg.textContent = text || "";
  msg.className = ok ? "msg success" : "msg error";
}

async function handleSubmit() {
  setMsg("Validating…", false);
  submitBtn.disabled = true;

  try {
    const email = (emailInput.value || "").trim();
    const productKey = (keyInput.value || "").trim();

    if (!email || !productKey) {
      setMsg("Please enter email and product key.", false);
      submitBtn.disabled = false;
      return;
    }

    if (!window.api) {
      setMsg("Internal API bridge unavailable.", false);
      submitBtn.disabled = false;
      return;
    }

    // Validate license
    const res = typeof window.api.validateLicense === "function"
      ? await window.api.validateLicense(email, productKey)
      : await window.api.invoke("license:validate", { email, productKey });

    setMsg(res?.message || (res?.ok ? "License valid." : "License invalid."), !!res?.ok);

    if (res?.ok) {
      // Navigate to home page after successful validation
      const proceed = await window.api.invoke("app:proceed");
      if (!proceed?.ok) {
        setMsg(proceed?.message || "Failed to open the app.", false);
      }
      // No further action required; main will swap the page.
    }
  } catch (e) {
    console.error("[renderer] validation error:", e);
    setMsg(e?.message || String(e), false);
  } finally {
    submitBtn.disabled = false;
  }
}

submitBtn.addEventListener("click", handleSubmit);

// Allow Enter key to submit
[emailInput, keyInput].forEach((el) => {
  el?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  });
});

