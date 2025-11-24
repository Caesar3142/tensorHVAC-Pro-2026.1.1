/* boundaries.wall.js — wall UI & logic with direct gradient (dT/dn) for flux mode */
(() => {
  const BC = window.BC;
  const {
    byId, getPatchBlock, upsertPatch, setPatchBody,
    listIndexedPatches, removePatch,
    extractValueUniform, extractGradientUniform, makeTypeBodyForMode, toK
  } = BC.utils;

  function makeWallRow(i, data, defaults) {
    const row = document.createElement('div');
    row.className = 'list-row wall-row';
    row.dataset.index = String(i);

    const labelWrap = document.createElement('div');
    labelWrap.innerHTML = `<b>wall_${i}</b><br/><small>T only (U=noSlip)</small>`;

    const controls = document.createElement('div');
    controls.className = 'controls';
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';

    const mode = document.createElement('select');
    mode.className = 'mini temp-mode';
    mode.innerHTML = `<option value="driven">driven</option>
                      <option value="fixed">fixed temperature</option>
                      <option value="flux">temperature gradient</option>`;
    mode.value = data.mode || 'driven';

    const tInput = document.createElement('input');
    tInput.type = 'text';
    tInput.className = 'temp-T';
    tInput.placeholder = defaults.wallT;
    tInput.value = data.T ?? '';

    const tUnit = document.createElement('select');
    tUnit.className = 'mini wall-t-unit';
    tUnit.innerHTML = `<option value="C" selected>C</option><option value="F">F</option><option value="K">K</option>`;
    tUnit.value = 'C';
    tUnit.dataset.prevUnit = 'C';
    
    // Add event listener to convert temperature when unit changes
    tUnit.addEventListener('change', () => {
      const oldUnit = tUnit.dataset.prevUnit || 'C';
      const newUnit = tUnit.value;
      const currentVal = tInput.value.trim();
      
      if (currentVal && !isNaN(parseFloat(currentVal))) {
        // Convert: oldUnit -> Kelvin -> newUnit
        const valK = toK(currentVal, oldUnit);
        if (valK != null) {
          const { fromK } = BC.utils;
          const newVal = fromK(valK, newUnit);
          tInput.value = newVal;
        }
      }
      tUnit.dataset.prevUnit = newUnit;
    });

    // NEW: direct gradient input for flux mode
    const gradInput = document.createElement('input');
    gradInput.type = 'text';
    gradInput.className = 'mini temp-grad';
    gradInput.placeholder = 'dT/dn [K/m]';
    gradInput.title = 'Temperature gradient (K/m)';
    gradInput.value = data.grad ?? '';

    function toggle() {
      const m = mode.value;
      const showT = m === 'fixed';
      const showG = m === 'flux';
      tInput.classList.toggle('hide', !showT);
      tUnit.classList.toggle('hide', !showT);
      gradInput.classList.toggle('hide', !showG);
    }
    mode.addEventListener('change', toggle);
    toggle();

    controls.appendChild(mode);
    controls.appendChild(tInput);
    controls.appendChild(tUnit);
    controls.appendChild(gradInput);

    row.appendChild(labelWrap);
    row.appendChild(controls);
    return row;
  }

  let wallCount = 0;

  async function renderFromFiles(Utxt, Ttxt, DEFAULTS) {
    const wallIdxU  = listIndexedPatches(Utxt, "wall");
    const wallIdxT  = listIndexedPatches(Ttxt, "wall");
    wallCount = Math.max(wallIdxU.at(-1) || 0, wallIdxT.at(-1) || 0, 0);

    const { fromK } = BC.utils;
    const wallList = byId("wallList");
    wallList.innerHTML = "";
    for (let i = 1; i <= wallCount; i++) {
      const tBlk = getPatchBlock(Ttxt, `wall_${i}`);
      let data = { mode: 'driven', T: DEFAULTS.wallT, grad: '' };
      if (tBlk) {
        const inner = tBlk.inner;
        const m = /^\s*type\s+([A-Za-z0-9_:]+)\s*;/m.exec(inner)?.[1] || '';
        if (/zeroGradient/.test(m)) {
          data = { mode: 'driven' };
        } else if (/fixedGradient/.test(m)) {
          const g = extractGradientUniform(inner);
          data = { mode: 'flux', grad: g || '' };
        } else {
          const v = extractValueUniform(inner);
          // Temperature from file is always in Kelvin, convert to Celsius for display
          const vK = v || DEFAULTS.wallT;
          const vC = fromK(parseFloat(vK) || DEFAULTS.wallT, 'C');
          data = { mode: 'fixed', T: vC, grad: '' };
        }
      }
      wallList.appendChild(makeWallRow(i, data, DEFAULTS));
    }
    byId("wallCount").textContent = String(wallCount);
    BC.ensureEditableInputs();
  }

  function collect() {
    const rows = Array.from(document.querySelectorAll(".wall-row"));
    rows.sort((a,b) => Number(a.dataset.index) - Number(b.dataset.index));
    const values = rows.map(row => {
      const mode = row.querySelector('.temp-mode')?.value || 'driven';
      const T = row.querySelector('.temp-T')?.value?.trim() || '';
      const tUnit = row.querySelector('.wall-t-unit')?.value || 'C';
      const grad = row.querySelector('.temp-grad')?.value?.trim() || '';
      return { mode, T, tUnit, grad };
    });
    return { values, count: rows.length };
  }

  function applyToFiles(Utxt, Ttxt, values, fns) {
    const N = Math.max(values.length, 0);

    for (const k of listIndexedPatches(Utxt, "wall")) if (k > N) Utxt = removePatch(Utxt, `wall_${k}`);
    for (const k of listIndexedPatches(Ttxt, "wall")) if (k > N) Ttxt = removePatch(Ttxt, `wall_${k}`);

    for (let i = 1; i <= N; i++) {
      const item = values[i-1] || { mode: 'driven', T: BC.DEFAULTS.wallT, tUnit: 'C', grad: '' };

      // U = noSlip always
      Utxt = upsertPatch(Utxt, `wall_${i}`, [`type            noSlip;`]);

      if (item.mode === 'driven') {
        Ttxt = setPatchBody(Ttxt, `wall_${i}`, makeTypeBodyForMode('driven', {}));
      } else if (item.mode === 'fixed') {
        const Tk = fns.toK(item.T, item.tUnit);
        Ttxt = setPatchBody(Ttxt, `wall_${i}`, makeTypeBodyForMode('fixed', { T: Tk ?? BC.DEFAULTS.wallT }));
      } else {
        const dTdn = parseFloat(item.grad || '0') || 0;
        Ttxt = setPatchBody(Ttxt, `wall_${i}`, makeTypeBodyForMode('flux', { dTdn }));
      }
    }
    return { Utxt, Ttxt };
  }

  function addRow() {
    wallCount++;
    byId("wallList").appendChild(
      makeWallRow(wallCount, { mode: 'driven', T: BC.DEFAULTS.wallT, grad: '' }, BC.DEFAULTS)
    );
    byId("wallCount").textContent = String(document.querySelectorAll(".wall-row").length);
    BC.ensureEditableInputs();
  }

  function removeRow() {
    const rows = document.querySelectorAll(".wall-row");
    if (rows.length <= 0) return;
    rows[rows.length - 1].remove();
    byId("wallCount").textContent = String(document.querySelectorAll(".wall-row").length);
    wallCount = document.querySelectorAll(".wall-row").length;
    BC.ensureEditableInputs();
  }

  BC.register('wall', { renderFromFiles, collect, applyToFiles, addRow, removeRow });
})();
