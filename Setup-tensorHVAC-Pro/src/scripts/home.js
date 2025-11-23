// home.js
const $ = (id) => document.getElementById(id);

// Persist + broadcast active case to the titlebar (so main can show name + path)
function setActiveCase(absPath) {
  if (!absPath) return;
  localStorage.setItem("activeCase", absPath);
  // Notify main (preload exposes this)
  try { window.titlebar?.setActiveCase(absPath); } catch (_) {}
  // Update little status line on the page
  const el = $("activeCase");
  if (el) el.innerText = `Active case: ${absPath}`;
}

// Derive a nice project name from a path
function projectNameFromPath(p) {
  if (!p || typeof p !== "string") return "";
  const trimmed = p.replace(/[\\\/]$/, "");
  const parts = trimmed.split(/[\\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/* ---------- UI wiring ---------- */

$("browsePath")?.addEventListener("click", async () => {
  try {
    const p = await window.api.selectFolder();
    if (p) $("casePath").value = p;
  } catch (e) {
    alert("Failed to select folder: " + (e?.message || e));
  }
});

$("createCaseBtn")?.addEventListener("click", async () => {
  const name = $("caseName").value.trim();
  const base = $("casePath").value.trim();
  if (!name || !base) {
    alert("Please fill case name and path.");
    return;
  }
  try {
    const full = await window.api.createCase(name, base);
    setActiveCase(full);
    // Optional: show the derived name somewhere if you have a slot for it
    const n = projectNameFromPath(full);
    const nameSlot = $("projectName");
    if (nameSlot) nameSlot.textContent = n;

    window.location.href = "meshing.html";
  } catch (e) {
    alert("Failed to create: " + (e?.message || e));
  }
});

$("openCaseBtn")?.addEventListener("click", async () => {
  try {
    const dir = await window.api.openCase();
    if (!dir) return;
    setActiveCase(dir);

    const n = projectNameFromPath(dir);
    const nameSlot = $("projectName");
    if (nameSlot) nameSlot.textContent = n;

    window.location.href = "meshing.html";
  } catch (e) {
    alert("Failed to open: " + (e?.message || e));
  }
});

/* ---------- Menu → "Open Case…" integration ---------- */
try {
  // If user chooses File → Open Case… from the app menu while on Home
  window.api.onMenuOpenCase(async () => {
    const dir = await window.api.openCase();
    if (!dir) return;
    setActiveCase(dir);
    window.location.href = "meshing.html";
  });
} catch (_) { /* noop if not available */ }

/* ---------- Initial paint ---------- */
window.addEventListener("DOMContentLoaded", () => {
  try {
    const ac = localStorage.getItem("activeCase");
    if (ac) {
      setActiveCase(ac); // also informs titlebar on first load
      const n = projectNameFromPath(ac);
      const nameSlot = $("projectName");
      if (nameSlot) nameSlot.textContent = n;
    }
  } catch (e) {
    console.error('[home] Initialization error:', e);
  }
});
