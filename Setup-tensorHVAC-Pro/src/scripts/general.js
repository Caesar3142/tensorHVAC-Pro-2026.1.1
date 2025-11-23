/* general.js — Initial Temperature, Gravity, and Comfort (for general.html) */
(() => {
  // ---------- basics ----------
  const byId = (id) => document.getElementById(id);
  const caseRoot = localStorage.getItem("activeCase");

  // ---------- unit conversion ----------
  function toK(value, unit) {
    if (value === "" || value == null) return null;
    const v = parseFloat(value);
    if (isNaN(v)) return null;
    if (unit === 'C') return v + 273.15;
    if (unit === 'F') return (v - 32) * 5/9 + 273.15;
    return v; // already Kelvin
  }

  // ---------- OpenFOAM text helpers ----------
  function findBlockBounds(text, keyWord) {
    const m = new RegExp(String.raw`${keyWord}\s*\{`, "m").exec(text);
    if (!m) return null;
    let i = text.indexOf("{", m.index), d = 0, j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "{") d++;
      else if (c === "}") { d--; if (d === 0) { j++; break; } }
    }
    return d === 0 ? { start: m.index, openBrace: i, end: j } : null;
  }
  function getBlockInner(text, name) {
    const b = findBlockBounds(text, name); if (!b) return null;
    return { ...b, inner: text.slice(b.openBrace + 1, b.end - 1) };
  }

  // 0/T internalField (Initial Temperature)
  function extractInternalFieldUniform(text) {
    const m = /^\s*internalField\s+uniform\s+([^;]+);/m.exec(text);
    return m ? m[1].trim() : "";
  }
  function replaceInternalFieldUniform(text, newVal) {
    const rx = /^\s*internalField\s+uniform\s+[^;]+;/m;
    if (rx.test(text)) {
      return text.replace(rx, (line) => {
        const indent = (line.match(/^\s*/) || [""])[0];
        return `${indent}internalField   uniform ${newVal};`;
      });
    }
    const bf = /\bboundaryField\s*\{/m.exec(text);
    const ins = `\ninternalField   uniform ${newVal};\n\n`;
    return bf ? text.slice(0, bf.index) + ins + text.slice(bf.index) : text + ins;
  }

  // ---------- Comfort (system/FOcomfort) ----------
  const COMFORT_PATH = "system/FOcomfort";

  function getNumberIn(inner, key) {
    const m = new RegExp(String.raw`^\s*${key}\s+([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*;`, 'm').exec(inner);
    return m ? parseFloat(m[1]) : null;
  }
  function getBoolIn(inner, key) {
    const m = new RegExp(String.raw`^\s*${key}\s+(true|false)\s*;`, 'm').exec(inner);
    return m ? (m[1] === 'true') : null;
  }
  function getWordIn(inner, key) {
    const m = new RegExp(String.raw`^\s*${key}\s+([A-Za-z0-9_+-]+)\s*;`, 'm').exec(inner);
    return m ? m[1] : null;
  }

  function parseComfortDict(text) {
    const blk = getBlockInner(text || "", "comfort");
    if (!blk) return {};
    const t = blk.inner;
    return {
      clothing:        getNumberIn(t, 'clothing'),
      metabolicRate:   getNumberIn(t, 'metabolicRate'),
      relHumidity:     getNumberIn(t, 'relHumidity'),
      pSat:            getNumberIn(t, 'pSat'),
      extWork:         getNumberIn(t, 'extWork'),
      tolerance:       getNumberIn(t, 'tolerance'),
      maxClothIter:    getNumberIn(t, 'maxClothIter'),
      meanVelocity:    getBoolIn(t,   'meanVelocity'),
      region:          getWordIn(t,   'region'),
      enabled:         getBoolIn(t,   'enabled'),
      log:             getBoolIn(t,   'log'),
      timeStart:       getNumberIn(t, 'timeStart'),
      timeEnd:         getNumberIn(t, 'timeEnd'),
      executeControl:  getWordIn(t,   'executeControl'),
      executeInterval: getNumberIn(t, 'executeInterval'),
      writeControl:    getWordIn(t,   'writeControl'),
      writeInterval:   getNumberIn(t, 'writeInterval'),
    };
  }

  function buildComfortDict(values = {}) {
    const clothing      = Number.isFinite(+values.clothing)      ? +values.clothing      : 0.5;
    const metabolicRate = Number.isFinite(+values.metabolicRate) ? +values.metabolicRate : 1.2;
    const relHumidity   = Number.isFinite(+values.relHumidity)   ? +values.relHumidity   : 60.0;

    const pSat          = Number.isFinite(+values.pSat)          ? +values.pSat          : 100714;
    const extWork       = Number.isFinite(+values.extWork)       ? +values.extWork       : 0.0;
    const tolerance     = Number.isFinite(+values.tolerance)     ? +values.tolerance     : 1e-4;
    const maxClothIter  = Number.isFinite(+values.maxClothIter)  ? +values.maxClothIter  : 100;
    const meanVelocity  = typeof values.meanVelocity === 'boolean' ? values.meanVelocity : false;

    const region          = values.region          || 'region0';
    const enabled         = typeof values.enabled === 'boolean' ? values.enabled : true;
    const log             = typeof values.log     === 'boolean' ? values.log     : true;
    const timeStart       = Number.isFinite(+values.timeStart)       ? +values.timeStart       : 0;
    const timeEnd         = Number.isFinite(+values.timeEnd)         ? +values.timeEnd         : 10000;
    const executeControl  = values.executeControl  || 'writeTime';
    const executeInterval = Number.isFinite(+values.executeInterval) ? +values.executeInterval : -1;
    const writeControl    = values.writeControl    || 'writeTime';
    const writeInterval   = Number.isFinite(+values.writeInterval)   ? +values.writeInterval   : -1;

    return `/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:  v2406                                 |
|   \\\\  /    A nd           | Website:  www.openfoam.com                      |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/

comfort
{
    // Mandatory entries
    type            comfort;
    libs            (fieldFunctionObjects);

    // Optional entries
    clothing        ${clothing};
    metabolicRate   ${metabolicRate};
    extWork         ${extWork};
    // Trad            0.0;
    relHumidity     ${relHumidity};
    pSat            ${pSat};
    tolerance       ${tolerance};
    maxClothIter    ${maxClothIter};
    meanVelocity    ${meanVelocity ? 'true' : 'false'};

    // Inherited entries
    region          ${region};
    enabled         ${enabled ? 'true' : 'false'};
    log             ${log ? 'true' : 'false'};
    timeStart       ${timeStart};
    timeEnd         ${timeEnd};
    executeControl  ${executeControl};
    executeInterval ${executeInterval};
    writeControl    ${writeControl};
    writeInterval   ${writeInterval};
}


// ***************************************************************** //
// *********************** tensorHVAC-2025 ************************* //
// ************************ tensorhvac.com ************************* //
`;
  }

  // ---------- Gravity (constant/g) ----------
  const GRAVITY_PATH = "constant/g";

  async function loadGravityIntoUi() {
    try {
      const gtxt = await window.api.readCaseFile(caseRoot, GRAVITY_PATH);
      const m = /value\s+\(?\s*([-0-9.eE+\s]+)\s*\)?\s*;/.exec(gtxt) || /value\s+([-0-9.eE+\s]+);/.exec(gtxt);
      let vec = null;
      if (m) vec = m[1].trim().replace(/\s+/g, ' ');
      else {
        const m2 = /value\s+\(?\s*([-0-9.eE+\s]+)\s*\)?/m.exec(gtxt);
        if (m2) vec = m2[1].trim().replace(/\s+/g,' ');
      }
      if (!vec) return;

      const sel = byId('gravityDir');
      if (!sel) return;
      let matched = false;
      for (const opt of Array.from(sel.options)) {
        if (opt.value.replace(/\s+/g,' ') === vec) { sel.value = opt.value; matched = true; break; }
      }
      if (!matched) {
        const opt = document.createElement('option');
        opt.value = vec; opt.textContent = `Custom (${vec})`;
        sel.appendChild(opt);
        sel.value = vec;
      }
    } catch (_) {}
  }

  async function writeGravityFromUi() {
    try {
      const sel = byId('gravityDir');
      if (!sel) return;
      const gval = (sel.value || "").trim();
      const gtxt = `/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
| \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox           |
|  \\\\    /   O peration     | Version:                                       |
|   \\\\  /    A nd           |                                                 |
|    \\\\/     M anipulation  |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       uniformDimensionedVectorField;
    object      g;
}

dimensions      [0 1 -2 0 0 0 0];
value           (${gval});

`;
      await window.api.writeCaseFile(caseRoot, GRAVITY_PATH, gtxt);
    } catch (e) {
      console.warn('[general] Failed to write gravity file', e && e.message);
    }
  }

  // ---------- Initial Temperature ----------
  function loadInitialTIntoUi(Ttxt) {
    try {
      const v = extractInternalFieldUniform(Ttxt) || "";
      const el = byId("initialT");
      if (el) el.value = v;
      const u = byId("initialTUnit");
      if (u) u.value = "K";
    } catch {}
  }
  function getInitialTValueKFromUi() {
    const raw = (byId("initialT")?.value || "").trim();
    const unit = byId("initialTUnit")?.value || "K";
    if (!raw) return '';
    const k = toK(raw, unit);
    return k ?? '';
  }

  // ---------- Comfort UI ----------
  async function loadComfortIntoUi() {
    try {
      const txt = await window.api.readCaseFile(caseRoot, COMFORT_PATH);
      const vals = parseComfortDict(txt || "");
      if (byId("Clo"))   byId("Clo").value   = (vals.clothing ?? "").toString();
      if (byId("MtbRt")) byId("MtbRt").value = (vals.metabolicRate ?? "").toString();
      if (byId("RH"))    byId("RH").value    = (vals.relHumidity ?? "").toString();
    } catch (_) {
      if (byId("Clo") && !byId("Clo").value) byId("Clo").placeholder = "0.5";
      if (byId("MtbRt") && !byId("MtbRt").value) byId("MtbRt").placeholder = "1.2";
      if (byId("RH") && !byId("RH").value) byId("RH").placeholder = "60";
    }
  }
  function readComfortFromUi() {
    const clothing = parseFloat(byId("Clo")?.value ?? "");
    const metabolicRate = parseFloat(byId("MtbRt")?.value ?? "");
    const relHumidity = parseFloat(byId("RH")?.value ?? "");
    return {
      clothing: Number.isFinite(clothing) ? clothing : null,
      metabolicRate: Number.isFinite(metabolicRate) ? metabolicRate : null,
      relHumidity: Number.isFinite(relHumidity) ? relHumidity : null,
    };
  }
  async function saveComfortFromUi() {
    let existing = {};
    try {
      const txt = await window.api.readCaseFile(caseRoot, COMFORT_PATH);
      existing = parseComfortDict(txt || "");
    } catch (_) {}
    const uiVals = readComfortFromUi();
    const merged = { ...existing, ...uiVals };
    const text = buildComfortDict(merged);
    await window.api.writeCaseFile(caseRoot, COMFORT_PATH, text);
  }

  // ---------- toast ----------
  function showToast(msg, ms = 1400) {
    try {
      let toast = document.getElementById('thvac-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'thvac-toast';
        Object.assign(toast.style, {
          position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
          background: '#111', color: '#fff', padding: '10px 14px', borderRadius: '10px',
          boxShadow: '0 6px 20px rgba(0,0,0,.25)', opacity: '0', pointerEvents: 'none',
          transition: 'opacity .18s ease', zIndex: '9999', fontSize: '14px'
        });
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.opacity = '1';
      setTimeout(() => { toast.style.opacity = '0'; }, ms);
    } catch {}
  }

  // ---------- Orchestration ----------
  async function loadGeneral() {
    if (!caseRoot) { alert("No active case. Open one on Home."); window.location.href = "home.html"; return; }
    try {
      // 0/T
      const Ttxt = await window.api.readCaseFile(caseRoot, "0/T");
      loadInitialTIntoUi(Ttxt);

      // gravity & comfort
      await loadGravityIntoUi();
      await loadComfortIntoUi();
    } catch (e) {
      console.error(e);
      alert("Load failed: " + (e.message || e));
    }
  }

  async function saveGeneral() {
    if (!caseRoot) { alert("No active case. Open one on Home."); return; }
    try {
      // Save Initial T into 0/T
      let Ttxt = await window.api.readCaseFile(caseRoot, "0/T");
      const kInit = getInitialTValueKFromUi();
      if (kInit) {
        Ttxt = replaceInternalFieldUniform(Ttxt, kInit);
        await window.api.writeCaseFile(caseRoot, "0/T", Ttxt);
      }

      // Save gravity
      await writeGravityFromUi();

      // Save comfort
      await saveComfortFromUi();

      showToast('General settings saved');
    } catch (e) {
      console.error(e);
      alert("Save failed: " + (e.message || e));
    }
  }

  // ---------- Buttons wiring (don’t remove features) ----------
  function wireButtons() {
    const saveBtn = byId('saveGeneral');
    const backBtn = byId('backBoundaries');
    const goBtn   = byId('goSolver');

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => { await saveGeneral(); });
    }
    if (backBtn) {
      backBtn.addEventListener('click', async () => {
        try { await saveGeneral(); }
        finally { window.location.href = "boundaries.html"; }
      });
    }
    if (goBtn) {
      goBtn.addEventListener('click', async () => {
        try { await saveGeneral(); }
        finally { window.location.href = "solver.html"; }
      });
    }
  }

  // ---------- Expose API for other pages (e.g., boundaries.html) ----------
  window.BCGeneral = {
    // keep names used elsewhere:
    loadGravityIntoUi,       // NOTE: Ui (lowercase i)
    writeGravityFromUi,
    loadComfortIntoUi,
    saveComfortFromUi,
    load: loadGeneral,
    save: saveGeneral,
  };

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", async () => {
    if (!caseRoot) { alert("No active case. Open one on Home."); window.location.href = "home.html"; return; }
    wireButtons();
    await loadGeneral();
  });
})();
