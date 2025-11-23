(() => {
  const byId = (id) => document.getElementById(id);
  const caseRoot = localStorage.getItem("activeCase");

  const DEFAULTS = { inletU: "(0 0 0)", inletT: "290", objectT: "308", wallT: "300" };
  const SNAPPY_PATH = "system/snappyHexMeshDict";

  const EXTRA_FILES = ["alphat", "epsilon", "omega", "k", "nut", "p", "p_rgh"];
  const EXTRA_RULES = {
    alphat: { inlet: ["type            calculated;","value           $internalField;"],
              object: ["type            compressible::alphatWallFunction;","Prt             0.85;","value           $internalField;"] },
    epsilon:{ inlet: ["type            fixedValue;","value           $internalField;"],
              object:["type            epsilonWallFunction;","Cmu             0.09;","kappa           0.41;","E               9.8;","value           $internalField;"] },
    omega: { inlet:  ["type            fixedValue;","value           $internalField;"],
             object: ["type            omegaWallFunction;","value           $internalField;"]},
    k:      { inlet: ["type            fixedValue;","value           $internalField;"],
              object:["type            kqRWallFunction;","value           $internalField;"] },
    nut:    { inlet: ["type            calculated;","value           $internalField;"],
              object:["type            nutkWallFunction;","Cmu             0.09;","kappa           0.41;","E               9.8;","value           $internalField;"] },
    p:      { inlet: ["type            calculated;","value           $internalField;"],
              object:["type            calculated;","value           $internalField;"] },
    p_rgh:  { inlet: ["type            fixedFluxPressure;","gradient        uniform 0;","value           $internalField;"],
              object:["type            fixedFluxPressure;","gradient        uniform 0;","value           $internalField;"] },
  };

  /* ---------------- unit conversions ---------------- */
  function toK(value, unit) {
    if (value === "" || value == null) return null;
    const v = parseFloat(value);
    if (isNaN(v)) return null;
    if (unit === 'C') return v + 273.15;
    if (unit === 'F') return (v - 32) * 5/9 + 273.15;
    return v; // K
  }
  function fromK(k, unit) {
    if (k == null) return '';
    const v = Number(k);
    if (isNaN(v)) return '';
    if (unit === 'C') return (v - 273.15).toFixed(2);
    if (unit === 'F') return ((v - 273.15) * 9/5 + 32).toFixed(2);
    return v.toFixed(2);
  }
  function toMs(val, unit) {
    if (!val) return null;
    const n = parseFloat(String(val).replace(/[()]/g,'')); // robust
    if (isNaN(n)) return null;
    if (unit === 'ft/min') return n * 0.00508;
    if (unit === 'ft/s') return n * 0.3048;
    if (unit === 'km/h') return n / 3.6;
    if (unit === 'mph') return n * 0.44704;
    return n; // m/s
  }
  function fromMs(n, unit) {
    if (n == null || isNaN(Number(n))) return '';
    const v = Number(n);
    if (unit === 'ft/min') return (v / 0.00508).toFixed(2);
    if (unit === 'ft/s') return (v / 0.3048).toFixed(2);
    if (unit === 'km/h') return (v * 3.6).toFixed(2);
    if (unit === 'mph') return (v / 0.44704).toFixed(2);
    return v.toFixed(2);
  }
  function parseVector(str) {
    if (!str) return [0,0,0];
    const s = String(str).replace(/[()]/g,'').trim();
    const parts = s.split(/\s+/).map(p => parseFloat(p));
    return [parts[0]||0, parts[1]||0, parts[2]||0];
  }
  function formatVector(v) { return `(${v[0]} ${v[1]} ${v[2]})`; }

  /* ---------------- parsing helpers ---------------- */
  function findBlockBounds(text, keyWord) {
    const m = new RegExp(String.raw`${keyWord}\s*\{`, "m").exec(text);
    if (!m) return null;
    let i = text.indexOf("{", m.index), d = 0, j = i;
    for (; j < text.length; j++) { const c = text[j]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { j++; break; } } }
    return d === 0 ? { start: m.index, openBrace: i, end: j } : null;
  }
  function ensureBlock(text, name) {
    if (findBlockBounds(text, name)) return text;
    return text.replace(/\s*$/, `\n\n${name}\n{\n}\n`);
  }
  function getBlockInner(text, name) {
    const b = findBlockBounds(text, name); if (!b) return null;
    return { ...b, inner: text.slice(b.openBrace + 1, b.end - 1) };
  }
  function setBlockInner(text, name, newInner) {
    const b = findBlockBounds(text, name);
    if (!b) { text = ensureBlock(text, name); return setBlockInner(text, name, newInner); }
    const before = text.slice(0, b.openBrace + 1);
    const after  = text.slice(b.end - 1);
    const inner  = `\n${newInner.replace(/^\s+|\s+$/g,"")}\n`;
    return before + inner + after;
  }
  function findPatchBounds(text, patchName) {
    const m = new RegExp(String.raw`(^|\s)${patchName}\s*\{`, "m").exec(text);
    if (!m) return null;
    let i = text.indexOf("{", m.index), d = 0, j = i;
    for (; j < text.length; j++) { const c = text[j]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { j++; break; } } }
    return d === 0 ? { start: m.index, openBrace: i, end: j } : null;
  }
  function getPatchBlock(text, patchName) {
    const b = findPatchBounds(text, patchName); if (!b) return null;
    const inner = text.slice(b.openBrace + 1, b.end - 1);
    return { ...b, inner };
  }
  function removePatch(text, patchName) {
    const b = findPatchBounds(text, patchName); if (!b) return text;
    return text.slice(0, b.start).replace(/\s*$/, "\n") + text.slice(b.end);
  }
  function insertPatchAtBlockEnd(text, blockName, patchName, bodyLines) {
    const B = getBlockInner(text, blockName);
    const before = text.slice(0, B.end - 1);
    const after  = text.slice(B.end - 1);
    const body = [
      `    ${patchName}`, `    {`,
      ...bodyLines.map(l => `        ${l}`),
      `    }`, ``
    ].join("\n");
    return before + "\n" + body + after;
  }
  function upsertPatch(text, patchName, bodyLines) {
    return getPatchBlock(text, patchName) ? text : insertPatchAtBlockEnd(text, "boundaryField", patchName, bodyLines);
  }
  function setPatchBody(text, patchName, bodyLines) {
    const b = findPatchBounds(text, patchName);
    if (!b) return insertPatchAtBlockEnd(text, "boundaryField", patchName, bodyLines);
    const before = text.slice(0, b.openBrace + 1);
    const after  = text.slice(b.end - 1);
    const inner  = "\n" + bodyLines.map(l => `        ${l}`).join("\n") + "\n";
    return before + inner + after;
  }
  function renamePatch(text, oldName, newName) {
    const rx = new RegExp(String.raw`(^\s*)${oldName}(\s*\{)`, "m");
    return rx.test(text) ? text.replace(rx, `$1${newName}$2`) : text;
  }
  function extractValueUniform(inner) {
    const m = /^\s*value\s+uniform\s+([^;]+);/m.exec(inner);
    return m ? m[1].trim() : "";
  }
  function extractGradientUniform(inner) {
    const m = /^\s*gradient\s+uniform\s+([^;]+);/m.exec(inner);
    return m ? m[1].trim() : "";
  }
  function replaceValueUniformInPatch(text, patchName, newVal) {
    const b = getPatchBlock(text, patchName); if (!b) return text;
    let inner = b.inner;
    if (/^\s*value\s+uniform\s+[^;]+;/m.test(inner)) {
      inner = inner.replace(/^\s*value\s+uniform\s+[^;]+;/m, (line) => {
        const indent = (line.match(/^\s*/) || [""])[0];
        return `${indent}value           uniform ${newVal};`;
      });
    } else {
      const typeLine = inner.match(/^\s*type\s+[A-Za-z0-9_:]+;/m);
      const insertion = `\n        value           uniform ${newVal};\n`;
      inner = typeLine
        ? inner.slice(0, typeLine.index + typeLine[0].length) + insertion + inner.slice(typeLine.index + typeLine[0].length)
        : inner.replace(/\s*$/, insertion);
    }
    const before = text.slice(0, b.openBrace + 1);
    const after  = text.slice(b.end - 1);
    return before + inner + after;
  }

  /* -------- internalField in 0/T (kept here as utils; used by general.js) -------- */
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

  /* -------------- list & normalize for *_1 -------------- */
  function listIndexedPatches(text, prefix) {
    const rx = new RegExp(String.raw`\b${prefix}_(\d+)\s*\{`, "g");
    const set = new Set(); let m;
    while ((m = rx.exec(text)) !== null) set.add(parseInt(m[1], 10));
    return Array.from(set).sort((a,b)=>a-b);
  }
  function normalizeLegacyInText(text) {
    if (getPatchBlock(text, "inlet"))  text = getPatchBlock(text, "inlet_1")  ? removePatch(text, "inlet")  : renamePatch(text, "inlet",  "inlet_1");
    if (getPatchBlock(text, "object")) text = getPatchBlock(text, "object_1") ? removePatch(text, "object") : renamePatch(text, "object", "object_1");
    if (getPatchBlock(text, "wall"))   text = getPatchBlock(text, "wall_1")   ? removePatch(text, "wall")   : renamePatch(text, "wall",   "wall_1");
    return text;
  }
  async function normalizeUT(Utxt, Ttxt) {
    const newU = normalizeLegacyInText(Utxt);
    const newT = normalizeLegacyInText(Ttxt);
    if (newU !== Utxt) await window.api.writeCaseFile(caseRoot, "0/U", newU);
    if (newT !== Ttxt) await window.api.writeCaseFile(caseRoot, "0/T", newT);
    return { Utxt: newU, Ttxt: newT };
  }

  /* ---------------------- WIND SUPPORT ---------------------- */
  const WIND = { patch: "wind" };

  function readWindUi() {
    const enabled = !!(byId("windEnabled") && byId("windEnabled").checked);
    const ux = parseFloat(byId("windUx")?.value || "0") || 0;
    const uy = parseFloat(byId("windUy")?.value || "0") || 0;
    const uz = parseFloat(byId("windUz")?.value || "0") || 0;
    const tRaw = (byId("windT")?.value || "").trim();
    const tUnit = byId("windTUnit")?.value || "K";
    const TK = tRaw === "" ? null : toK(tRaw, tUnit);
    return { enabled, U: [ux,uy,uz], T: (TK ?? null) };
  }
  function loadWindIntoUi(Utxt, Ttxt) {
    try {
      const Ublk = getPatchBlock(Utxt, WIND.patch);
      if (Ublk) {
        const v = extractValueUniform(Ublk.inner);
        const vec = parseVector(v);
        if (byId("windUx")) byId("windUx").value = String(vec[0] ?? 0);
        if (byId("windUy")) byId("windUy").value = String(vec[1] ?? 0);
        if (byId("windUz")) byId("windUz").value = String(vec[2] ?? 0);
        if (byId("windEnabled")) byId("windEnabled").checked = true;
      } else {
        if (byId("windUx")) byId("windUx").value = "";
        if (byId("windUy")) byId("windUy").value = "";
        if (byId("windUz")) byId("windUz").value = "";
        if (byId("windEnabled")) byId("windEnabled").checked = false;
      }

      const Tblk = getPatchBlock(Ttxt, WIND.patch);
      if (Tblk) {
        const t = extractValueUniform(Tblk.inner);
        if (t) {
          if (byId("windT")) byId("windT").value = t;
          if (byId("windTUnit")) byId("windTUnit").value = "K";
        }
      } else {
        if (byId("windT")) byId("windT").value = "";
        if (byId("windTUnit")) byId("windTUnit").value = "K";
      }
    } catch (e) {
      console.warn("loadWindIntoUi failed:", e && e.message);
    }
  }
  function applyWindToFiles(Utxt, Ttxt, wind) {
    if (!wind || !wind.enabled) return { Utxt, Ttxt };
    const Ubody = [
      `type            inletOutlet;`,
      `inletValue      uniform (${wind.U[0]} ${wind.U[1]} ${wind.U[2]});`,
      `value           uniform (${wind.U[0]} ${wind.U[1]} ${wind.U[2]});`
    ];
    Utxt = setPatchBody(Utxt, WIND.patch, Ubody);

    if (wind.T != null && isFinite(Number(wind.T))) {
      const Tbody = [
        `type            fixedValue;`,
        `value           uniform ${wind.T};`
      ];
      Ttxt = setPatchBody(Ttxt, WIND.patch, Tbody);
    }
    return { Utxt, Ttxt };
  }

  /* ---------------- snappyHexMesh verify (noop) ---------------- */
  async function updateSnappyHexMesh(_inletCount, _objectCount, _wallCount) {
    try {
      await window.api.readCaseFile(caseRoot, SNAPPY_PATH);
      return true;
    } catch {
      return false;
    }
  }

  /* -------- extra files updater (templates) -------- */
  async function updateExtraFileWithTemplates(relPath, inletCount, objectCount, wallCount) {
    let text;
    try {
      text = await window.api.readCaseFile(caseRoot, relPath);
    } catch { return false; }

    const base = relPath.split("/").pop();
    const tpl = EXTRA_RULES[base]; if (!tpl) return false;

    text = ensureBlock(text, "boundaryField");
    text = normalizeLegacyInText(text);

    const existingInlets = listIndexedPatches(text, "inlet");
    const existingObjs   = listIndexedPatches(text, "object");
    const existingWalls  = listIndexedPatches(text, "wall");

    for (const k of existingInlets) if (k > inletCount) text = removePatch(text, `inlet_${k}`);
    for (const k of existingObjs)   if (k > objectCount) text = removePatch(text, `object_${k}`);
    for (const k of existingWalls)  if (k > wallCount)   text = removePatch(text, `wall_${k}`);

    for (let i = 1; i <= inletCount; i++)  text = setPatchBody(text, `inlet_${i}`,  tpl.inlet);
    for (let i = 1; i <= objectCount; i++) text = setPatchBody(text, `object_${i}`, tpl.object);
    for (let i = 1; i <= wallCount; i++)   text = setPatchBody(text, `wall_${i}`,   tpl.object);

    await window.api.writeCaseFile(caseRoot, relPath, text);
    return true;
  }

  /* ------- toast & editability helpers ------- */
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
  function ensureEditableInputs() {
    try {
      ["floorT","ceilingT","floorTUnit","ceilingTUnit","floorGrad","ceilingGrad","floorMode","ceilingMode","Clo","MtbRt","RH"].forEach(id => {
        const el = byId(id);
        if (!el) return;
        try { el.removeAttribute && el.removeAttribute('disabled'); } catch {}
        try { el.removeAttribute && el.removeAttribute('readonly'); } catch {}
        try { el.removeAttribute && el.removeAttribute('aria-disabled'); } catch {}
        el.disabled = false;
        el.readOnly = false;
        if (el.style) el.style.pointerEvents = 'auto';
        el.tabIndex = 0;
      });

      const dyn = Array.from(document.querySelectorAll('.inlet-input, .object-input, .wall-input, .temp-mode, .temp-grad, .temp-T, .object-t-unit, .wall-t-unit'));
      dyn.forEach(el => {
        try { el.removeAttribute && el.removeAttribute('disabled'); } catch {}
        try { el.removeAttribute && el.removeAttribute('readonly'); } catch {}
        try { el.removeAttribute && el.removeAttribute('aria-disabled'); } catch {}
        el.disabled = false;
        el.readOnly = false;
        if (el.style) el.style.pointerEvents = 'auto';
        el.tabIndex = 0;
        const p = el.closest && el.closest('.content');
        if (p && p.style) p.style.pointerEvents = 'auto';
      });

      Array.from(document.querySelectorAll('.inlet-vel-unit, .inlet-t-unit, .object-t-unit, .wall-t-unit')).forEach(el => {
        try { el.removeAttribute && el.removeAttribute('disabled'); } catch {}
        el.disabled = false; if (el.style) el.style.pointerEvents = 'auto'; el.tabIndex = 0;
      });

      ['addInlet','remInlet','addObject','remObject','addWall','remWall','savePreConfig','backHome','goGeneral'].forEach(id=>{
        const btn = byId(id);
        if (!btn) return;
        try { btn.removeAttribute && btn.removeAttribute('disabled'); } catch {}
        try { btn.removeAttribute && btn.removeAttribute('aria-disabled'); } catch {}
        btn.disabled = false;
        if (btn.style) btn.style.pointerEvents = 'auto';
      });
    } catch (err) {
      console.warn('ensureEditableInputs error', err && err.message);
    }
  }

  /* ------------ helpers: read/write mode bodies for T ------------- */
  function makeTypeBodyForMode(mode, { T=null, dTdn=null }) {
    if (mode === 'driven') {
      return [`type            zeroGradient;`];
    } else if (mode === 'fixed') {
      const val = (T==null || isNaN(+T)) ? DEFAULTS.wallT : T;
      return [`type            fixedValue;`,`value           uniform ${val};`];
    } else if (mode === 'flux') {
      const g = (dTdn==null || !isFinite(+dTdn)) ? 0 : dTdn;
      return [`type            fixedGradient;`,`gradient        uniform ${g};`];
    }
    return [];
  }
  function detectModeFromInner(inner) {
    const typeMatch = /^\s*type\s+([A-Za-z0-9_:]+)\s*;/m.exec(inner);
    const type = typeMatch ? typeMatch[1] : '';
    if (/zeroGradient/.test(type)) return { mode:'driven' };
    if (/fixedGradient/.test(type)) {
      const g = extractGradientUniform(inner);
      return { mode:'flux', dTdn: g ? parseFloat(g) : null };
    }
    if (/fixedValue/.test(type)) {
      const v = extractValueUniform(inner);
      return { mode:'fixed', T: v ? parseFloat(v) : null };
    }
    const v = extractValueUniform(inner);
    if (v) return { mode:'fixed', T: parseFloat(v) };
    return { mode:'driven' };
  }

  /* ---------------- core load/save orchestrators ---------------- */
  async function loadBCs() {
    try {
      if (!caseRoot) throw new Error("No active case");

      // Make BCGeneral aware of case + utils it needs
      window.BCGeneral?.init(caseRoot, {
        toK, replaceInternalFieldUniform, extractInternalFieldUniform,
      });

      let Utxt = await window.api.readCaseFile(caseRoot, "0/U");
      let Ttxt = await window.api.readCaseFile(caseRoot, "0/T");
      ({ Utxt, Ttxt } = await normalizeUT(Utxt, Ttxt));



      // Render dynamic modules
      await window.BC.modules.inlet.renderFromFiles(Utxt, Ttxt, DEFAULTS);
      await window.BC.modules.object.renderFromFiles(Utxt, Ttxt, DEFAULTS);
      await window.BC.modules.wall.renderFromFiles(Utxt, Ttxt, DEFAULTS);

      // Floor/Ceiling modes from T
      const floorBlk = getPatchBlock(Ttxt, "floor");
      const ceilBlk  = getPatchBlock(Ttxt, "ceiling");

      (function(){
        const modeSel = byId('floorMode');
        const tEl = byId('floorT'), tUnit = byId('floorTUnit');
        const gradEl = byId('floorGrad');
        let mode = 'fixed', T = '', dTdn = null;
        if (floorBlk) {
          const det = detectModeFromInner(floorBlk.inner);
          mode = det.mode;
          if (mode === 'fixed') T = det.T ?? '';
          if (mode === 'flux') { dTdn = det.dTdn ?? 0; gradEl.value = isFinite(dTdn) ? String(dTdn) : ''; }
        }
        modeSel.value = mode;
        tEl.value = T !== '' && T != null ? String(T) : '';
        tUnit.value = 'K';
        toggleFloorUi(mode);
      })();

      (function(){
        const modeSel = byId('ceilingMode');
        const tEl = byId('ceilingT'), tUnit = byId('ceilingTUnit');
        const gradEl = byId('ceilingGrad');
        let mode = 'fixed', T = '', dTdn = null;
        if (ceilBlk) {
          const det = detectModeFromInner(ceilBlk.inner);
          mode = det.mode;
          if (mode === 'fixed') T = det.T ?? '';
          if (mode === 'flux') { dTdn = det.dTdn ?? 0; gradEl.value = isFinite(dTdn) ? String(dTdn) : ''; }
        }
        modeSel.value = mode;
        tEl.value = T !== '' && T != null ? String(T) : '';
        tUnit.value = 'K';
        toggleCeilingUi(mode);
      })();



      // Wind UI preload
      loadWindIntoUi(Utxt, Ttxt);

      ensureEditableInputs();
    } catch (e) {
      console.error(e);
      alert("Load failed: " + e.message);
    }
  }

  async function saveBCs() {
    try {
      if (!caseRoot) throw new Error("No active case");

      const inletCol  = window.BC.modules.inlet.collect();
      const objectCol = window.BC.modules.object.collect();
      const wallCol   = window.BC.modules.wall.collect();

      let Utxt = await window.api.readCaseFile(caseRoot, "0/U");
      let Ttxt = await window.api.readCaseFile(caseRoot, "0/T");
      ({ Utxt, Ttxt } = await normalizeUT(Utxt, Ttxt));

      ({ Utxt, Ttxt } = window.BC.modules.inlet.applyToFiles(Utxt, Ttxt, inletCol.values, { toMs, toK }));
      ({ Utxt, Ttxt } = window.BC.modules.object.applyToFiles(Utxt, Ttxt, objectCol.values, { toK }));
      ({ Utxt, Ttxt } = window.BC.modules.wall.applyToFiles(Utxt, Ttxt, wallCol.values, { toK }));

      // Floor
      (function(){
        const mode = byId('floorMode').value;
        if (mode === 'fixed') {
          const Traw = byId('floorT').value.trim();
          const Tun  = byId('floorTUnit').value || 'K';
          const Tk   = toK(Traw, Tun);
          Ttxt = setPatchBody(Ttxt, "floor", makeTypeBodyForMode('fixed', { T: Tk }));
        } else if (mode === 'flux') {
          const dTdn = parseFloat(byId('floorGrad').value || '0') || 0;
          Ttxt = setPatchBody(Ttxt, "floor", makeTypeBodyForMode('flux', { dTdn }));
        } else {
          Ttxt = setPatchBody(Ttxt, "floor", makeTypeBodyForMode('driven', {}));
        }
      })();

      // Ceiling
      (function(){
        const mode = byId('ceilingMode').value;
        if (mode === 'fixed') {
          const Traw = byId('ceilingT').value.trim();
          const Tun  = byId('ceilingTUnit').value || 'K';
          const Tk   = toK(Traw, Tun);
          Ttxt = setPatchBody(Ttxt, "ceiling", makeTypeBodyForMode('fixed', { T: Tk }));
        } else if (mode === 'flux') {
          const dTdn = parseFloat(byId('ceilingGrad').value || '0') || 0;
          Ttxt = setPatchBody(Ttxt, "ceiling", makeTypeBodyForMode('flux', { dTdn }));
        } else {
          Ttxt = setPatchBody(Ttxt, "ceiling", makeTypeBodyForMode('driven', {}));
        }
      })();

      // Wind
      const wind = readWindUi();
      ({ Utxt, Ttxt } = applyWindToFiles(Utxt, Ttxt, wind));

      // Write U/T
      await window.api.writeCaseFile(caseRoot, "0/U", Utxt);
      await window.api.writeCaseFile(caseRoot, "0/T", Ttxt);

      // Extra template files
      await updateExtraFileWithTemplates(`0/alphat`, inletCol.count, objectCol.count, wallCol.count);
      await updateExtraFileWithTemplates(`0/epsilon`, inletCol.count, objectCol.count, wallCol.count);
      await updateExtraFileWithTemplates(`0/omega`,  inletCol.count, objectCol.count, wallCol.count);
      await updateExtraFileWithTemplates(`0/k`,      inletCol.count, objectCol.count, wallCol.count);
      await updateExtraFileWithTemplates(`0/nut`,    inletCol.count, objectCol.count, wallCol.count);
      await updateExtraFileWithTemplates(`0/p`,      inletCol.count, objectCol.count, wallCol.count);
      await updateExtraFileWithTemplates(`0/p_rgh`,  inletCol.count, objectCol.count, wallCol.count);


      ensureEditableInputs();
      showToast('Boundary settings updated');

      try { byId('savePreConfig')?.blur(); } catch {}
      try { document.activeElement && document.activeElement.blur && document.activeElement.blur(); } catch {}

      const firstDyn = document.querySelector('.inlet-input, .object-input, .wall-input');
      if (firstDyn) { try { firstDyn.focus(); firstDyn.select && firstDyn.select(); } catch {} }
    } catch (e) {
      console.error(e);
      alert("Save failed: " + (e.message || e));
    }
  }

  /* ---- small UI togglers for floor/ceiling ---- */
  function toggleFloorUi(mode) {
    const t = byId('floorT'), tu = byId('floorTUnit');
    const g = byId('floorGrad');
    const showT = mode === 'fixed';
    const showG = mode === 'flux';
    t.classList.toggle('hide', !showT);
    tu.classList.toggle('hide', !showT);
    g.classList.toggle('hide', !showG);
  }
  function toggleCeilingUi(mode) {
    const t = byId('ceilingT'), tu = byId('ceilingTUnit');
    const g = byId('ceilingGrad');
    const showT = mode === 'fixed';
    const showG = mode === 'flux';
    t.classList.toggle('hide', !showT);
    tu.classList.toggle('hide', !showT);
    g.classList.toggle('hide', !showG);
  }

  function wireUi() {
    byId("addInlet").addEventListener("click", () => window.BC.modules.inlet.addRow());
    byId("remInlet").addEventListener("click", () => window.BC.modules.inlet.removeRow());
    byId("addObject").addEventListener("click", () => window.BC.modules.object.addRow());
    byId("remObject").addEventListener("click", () => window.BC.modules.object.removeRow());
    byId("addWall").addEventListener("click", () => window.BC.modules.wall.addRow());
    byId("remWall").addEventListener("click", () => window.BC.modules.wall.removeRow());
    byId("savePreConfig").addEventListener("click", saveBCs);
    byId("backHome").addEventListener("click", () => (window.location.href = "meshing.html"));
    byId("goGeneral").addEventListener("click", () => (window.location.href = "general.html"));

    byId('floorMode').addEventListener('change', e => toggleFloorUi(e.target.value));
    byId('ceilingMode').addEventListener('change', e => toggleCeilingUi(e.target.value));

    try {
      const content = document.querySelector('.content');
      if (content) {
        const obs = new MutationObserver(muts => {
          let touched = false;
          for (const m of muts) {
            if (m.type === 'attributes' && (m.attributeName === 'disabled' || m.attributeName === 'readonly' || m.attributeName === 'style' || m.attributeName === 'class')) {
              touched = true; break;
            }
          }
          if (touched) setTimeout(() => { ensureEditableInputs(); }, 25);
        });
        obs.observe(content, { attributes: true, subtree: true, attributeFilter: ['disabled','readonly','style','class'] });
        setTimeout(() => { try { obs.disconnect(); } catch(e){} }, 30_000);
      }
    } catch (e) { console.warn('[core] observer install failed', e && e.message); }
  }

  // Public API for modules
  window.BC = {
    caseRoot,
    DEFAULTS,
    utils: {
      byId, toK, fromK, toMs, fromMs, parseVector, formatVector,
      ensureBlock, getBlockInner, setBlockInner,
      getPatchBlock, setPatchBody, removePatch, upsertPatch, replaceValueUniformInPatch,
      extractValueUniform, extractInternalFieldUniform, replaceInternalFieldUniform,
      listIndexedPatches, normalizeLegacyInText,
      makeTypeBodyForMode, extractGradientUniform
    },
    modules: {},
    register(name, mod) { this.modules[name] = mod; },
    loadBCs,
    ensureEditableInputs
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (!caseRoot) { alert("No active case. Open one on Home."); window.location.href = "home.html"; return; }
    if (!window.BCGeneral) { console.warn('[core] general.js not loaded before core.js'); }
    wireUi();
    loadBCs();
    ensureEditableInputs();
  });
})();
