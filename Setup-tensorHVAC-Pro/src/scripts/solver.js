// /src/scripts/solver.js
// Solver settings editor with “always-editable” hardening inspired by your working page.

const $ = (id) => document.getElementById(id);
const caseRoot = localStorage.getItem("activeCase");

const CONTROL_PATH   = "system/controlDict";
const DECOMPOSE_PATH = "system/decomposeParDict";

/* ---------------- minimal toast ---------------- */
let __toastTimer = null;
function __getToastEl() {
  let el = document.getElementById('thvac-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'thvac-toast';
    el.style.position = 'fixed';
    el.style.left = '50%';
    el.style.bottom = '24px';
    el.style.transform = 'translateX(-50%)';
    el.style.background = '#111';
    el.style.color = '#fff';
    el.style.padding = '10px 14px';
    el.style.borderRadius = '10px';
    el.style.boxShadow = '0 6px 20px rgba(0,0,0,.25)';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.style.transition = 'opacity .18s ease';
    el.style.zIndex = '9999';
    el.style.fontSize = '14px';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}
function showToast(msg, ms = 1600) {
  const el = __getToastEl();
  el.textContent = msg;
  el.style.opacity = '1';
  if (__toastTimer) clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => { el.style.opacity = '0'; }, ms);
}

/* ---------------- guards ---------------- */
function ensureCase() {
  if (!caseRoot) {
    alert("No active case. Go to Home and create/open a case first.");
    window.location.href = "home.html";
    return false;
  }
  return true;
}

/* ---------------- file I/O ---------------- */
const readControl    = () => window.api.readCaseFile(caseRoot, CONTROL_PATH);
const writeControl   = (text) => window.api.writeCaseFile(caseRoot, CONTROL_PATH, text);
const readDecompose  = () => window.api.readCaseFile(caseRoot, DECOMPOSE_PATH);
const writeDecompose = (text) => window.api.writeCaseFile(caseRoot, DECOMPOSE_PATH, text);

/* ---------------- text utils ---------------- */
function getVal(text, key) {
  const rx = new RegExp(String.raw`^\s*${key}\s+([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*;`, "m");
  const m = text.match(rx);
  return m ? m[1] : "";
}
function setVal(text, key, value) {
  if (value === "" || value == null) return text;
  const rx = new RegExp(String.raw`(^\s*${key}\s+)([^\s;]+)(\s*;)`, "m");
  if (rx.test(text)) return text.replace(rx, `$1${value}$3`);
  const insertBefore = text.search(/^\s*functions\s*\{/m);
  const line = `${key.padEnd(16)} ${value};\n\n`;
  if (insertBefore >= 0) return text.slice(0, insertBefore) + line + text.slice(insertBefore);
  return text + (text.endsWith("\n") ? "" : "\n") + line;
}
function setNTuple(text, a, b, c) {
  const tupleLine = `n           (${a} ${b} ${c});`;
  if (/^\s*n\s*\(\s*\d+\s+\d+\s+\d+\s*\)\s*;/m.test(text))
    return text.replace(/^\s*n\s*\(\s*\d+\s+\d+\s+\d+\s*\)\s*;/m, tupleLine);
  if (/coeffs\s*\{[\s\S]*?\}/m.test(text))
    return text.replace(/coeffs\s*\{([\s\S]*?)\}/m, `coeffs\n{\n    ${tupleLine}\n}`);
  return text + `\ncoeffs\n{\n    ${tupleLine}\n}\n`;
}

/* ---------------- factor N to near-cubic triple ---------------- */
function factorTriple(N) {
  N = Math.max(1, Math.floor(Number(N) || 1));
  const fs = [];
  let n = N;
  while (n % 2 === 0) { fs.push(2); n /= 2; }
  for (let p = 3; p * p <= n; p += 2) {
    while (n % p === 0) { fs.push(p); n /= p; }
  }
  if (n > 1) fs.push(n);
  const dims = [1, 1, 1];
  fs.sort((a, b) => b - a).forEach(f => {
    dims.sort((x, y) => x - y);
    dims[0] *= f;
  });
  return dims;
}

/* ---------------- detect missing binary/path ---------------- */
function isMissingBinary(errOrRes, binPath) {
  const msg = [
    errOrRes?.stderr,
    errOrRes?.stdout,
    errOrRes?.message,
    String(errOrRes ?? '')
  ].join(' ');
  return (
    !binPath ||
    errOrRes?.code === 127 ||
    /ENOENT|not found|No such file|cannot find/i.test(msg)
  );
}

/* ---------------- editability hardening ---------------- */
function ensureEditableInputs() {
  try {
    const content = document.querySelector('.content');
    if (content && content.style) {
      content.style.pointerEvents = 'auto';
      content.style.position = content.style.position || 'relative';
      content.style.zIndex = '9999';
      // fix ancestors with pointer-events:none
      let p = content.parentElement;
      while (p) {
        if (getComputedStyle(p).pointerEvents === 'none') p.style.pointerEvents = 'auto';
        p = p.parentElement;
      }
    }

    const ids = ["startTime", "endTime", "deltaT", "writeInterval", "nSub"];
    ids.forEach(id => {
      const el = $(id);
      if (!el) return;
      try { el.removeAttribute('disabled'); } catch {}
      try { el.removeAttribute('readonly'); } catch {}
      try { el.removeAttribute('aria-disabled'); } catch {}
      el.disabled = false;
      el.readOnly = false;
      el.tabIndex = 0;
      if (el.style) {
        el.style.pointerEvents = 'auto';
        el.style.position = el.style.position || 'relative';
        el.style.zIndex = '1';
      }
    });

    // Buttons on this page
    ["saveAll","startRun","stopRun","clearLog","clearResults","backGeneral"].forEach(id=>{
      const btn = $(id);
      if (!btn) return;
      try { btn.removeAttribute('disabled'); } catch {}
      try { btn.removeAttribute('aria-disabled'); } catch {}
      if (id !== "stopRun") btn.disabled = false;   // stopRun is toggled by run logic
      if (btn.style) btn.style.pointerEvents = 'auto';
    });
  } catch (e) {
    console.warn("ensureEditableInputs:", e?.message || e);
  }
}

// capture-phase shield: let inputs keep keystrokes
function installKeyShield() {
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (!t) return;
    const tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || t.isContentEditable || tag === "SELECT") {
      e.stopPropagation();
    }
  }, true);
}

/* ---------------- load ---------------- */
async function loadPage() {
  if (!ensureCase()) return;

  ensureEditableInputs(); // before async loads

  try {
    const t = await readControl();
    const vals = {
      startTime: getVal(t, "startTime"),
      endTime:   getVal(t, "endTime"),
      deltaT:    getVal(t, "deltaT"),
      writeInterval: getVal(t, "writeInterval"),
    };
    if (vals.startTime) $("startTime").value = vals.startTime;
    if (vals.endTime) $("endTime").value = vals.endTime;
    if (vals.deltaT) $("deltaT").value = vals.deltaT;
    if (vals.writeInterval) $("writeInterval").value = vals.writeInterval;
  } catch (e) {
    console.warn("Could not read system/controlDict:", e.message);
  }

  try {
    const d = await readDecompose();
    const nSub = getVal(d, "numberOfSubdomains");
    if (nSub) $("nSub").value = nSub;
  } catch (e) {
    console.warn("Could not read system/decomposeParDict:", e.message);
  }

  // After loads, reassert editability
  ensureEditableInputs();
}

/* ---------------- save both files ---------------- */
async function saveAll() {
  if (!ensureCase()) return;

  const startTime = $("startTime").value.trim();
  const endTime   = $("endTime").value.trim();
  const deltaT    = $("deltaT").value.trim();
  const writeInterval = $("writeInterval").value.trim();
  const N = Math.max(1, Math.floor(Number($("nSub").value || 1)));
  const [nx, ny, nz] = factorTriple(N);

  try {
    // controlDict
    let cText = "";
    try { cText = await readControl(); } catch {}
    cText = setVal(cText, "startTime", startTime);
    cText = setVal(cText, "endTime", endTime);
    cText = setVal(cText, "deltaT", deltaT);
    cText = setVal(cText, "writeInterval", writeInterval);
    await writeControl(cText);

    // decomposeParDict
    let dText = "";
    try { dText = await readDecompose(); } catch {
      dText = "/* decomposeParDict autogenerated */\n";
    }
    dText = setVal(dText, "numberOfSubdomains", String(N));
    dText = setVal(dText, "method", "hierarchical");
    dText = setNTuple(dText, nx, ny, nz);
    await writeDecompose(dText);

    showToast("Solver settings saved");
  } catch (e) {
    console.error(e);
    showToast("Failed to save settings: " + (e.message || e), 2200);
  } finally {
    // keep editing smooth
    ensureEditableInputs();
    try { $("saveAll")?.blur(); } catch {}
    try { document.activeElement?.blur?.(); } catch {}
    const first = $("startTime") || $("endTime") || $("deltaT") || $("writeInterval") || $("nSub");
    if (first) { try { first.focus(); first.select && first.select(); } catch {} }
  }
}

/* ---------------- wire up ---------------- */
window.addEventListener("DOMContentLoaded", () => {
  try {
    if (!ensureCase()) return;

    // Wire buttons
  $("saveAll")   ?.addEventListener("click", saveAll);
  $("backGeneral")  ?.addEventListener("click", ()=> window.location.href="general.html");
  $("openResult")?.addEventListener("click", async () => {
    if (!ensureCase()) return;
    try {
      // Derive a friendly project name from the case root folder name
      const casePath = caseRoot;
      const parts = casePath.replace(/\\/g, '/').split('/').filter(Boolean);
      const proj = parts[parts.length - 1] || 'case';
      const foamName = `${proj}.foam`;

      // write a minimal marker .foam file in the case root so ParaView can open it directly
      const foamContents = `/* tensorHVAC-Pro foam marker */\nfoamFile: ${foamName}\n`;
      try {
        await window.api.writeCaseFile(caseRoot, foamName, foamContents);
      } catch (werr) {
        console.warn('Failed to write foam marker:', werr);
        showToast('Failed to write .foam marker', 2200);
        alert('Could not create foam marker file: ' + (werr?.message || werr));
        return;
      }

      // Launch ParaView with the .foam file path (default Windows path here)
      const paraviewExe = "C:\\tensorCFD\\tools\\ParaView-mod-tensorCFD-2026.1.1\\bin\\paraview.exe";
      const foamPath = (casePath.endsWith('\\') || casePath.endsWith('/')) ? `${casePath}${foamName}` : `${casePath}\\${foamName}`;
      const cmd = `"${paraviewExe}" "${foamPath}"`;

      showToast('Launching ParaView...');
      const res = await window.exec.run(cmd, { timeout: 30_000 });

      if (!res || !res.ok) {
        // Only alert if the path/executable appears wrong. Otherwise, suppress popup.
        if (isMissingBinary(res, paraviewExe)) {
          alert('ParaView path looks invalid. Use Tools → Set ParaView Path… to configure it.');
        } else {
          console.warn('ParaView launch returned non-ok (suppressing popup):', res);
          showToast('Tried to launch ParaView', 2000);
        }
        return;
      }

      showToast('ParaView launched');
    } catch (e) {
      // Only show an alert if it’s a missing-binary-style error; otherwise keep quiet
      if (isMissingBinary(e, 'paraview')) {
        alert('Failed to launch ParaView: invalid path.');
      } else {
        console.warn('openResult error (suppressing popup):', e);
        showToast('Error opening result', 2200);
      }
    }
  });

  // Defensive hardening
  installKeyShield();
  ensureEditableInputs();

  // MutationObserver: if something toggles disabled/readonly/style, re-enable quickly
  try {
    const content = document.querySelector('.content');
    if (content) {
      const obs = new MutationObserver(() => {
        // debounce a little to avoid thrash
        clearTimeout(obs.__t);
        obs.__t = setTimeout(ensureEditableInputs, 25);
      });
      obs.observe(content, { attributes:true, subtree:true, attributeFilter:['disabled','readonly','style','class'] });
      // Keep observer active - don't disconnect after 30s
      // Also add periodic check every 5 seconds as backup
      setInterval(ensureEditableInputs, 5000);
    }
  } catch (e) { console.warn('[solver] observer install failed', e && e.message); }

    // Load values
    loadPage();
  } catch (e) {
    console.error('[solver] Initialization error:', e);
    // Ensure inputs are still editable even if initialization fails
    setTimeout(() => {
      try { ensureEditableInputs(); } catch {}
    }, 100);
  }
});
