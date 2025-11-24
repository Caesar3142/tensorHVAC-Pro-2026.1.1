/* boundaries.object.js — object UI & logic with direct gradient (dT/dn) for flux mode */
(() => {
  const BC = window.BC;
  const {
    byId, toK, getPatchBlock, upsertPatch, setPatchBody,
    listIndexedPatches, removePatch,
    extractValueUniform, extractGradientUniform, makeTypeBodyForMode
  } = BC.utils;

  function makeObjectRow(i, data, defaults) {
    const row = document.createElement('div');
    row.className = 'list-row object-row';
    row.dataset.index = String(i);

    const labelWrap = document.createElement('div');
    labelWrap.innerHTML = `<b>object_${i}</b><br/><small>T only</small>`;

    // Controls
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
    tInput.placeholder = defaults.objectT;
    tInput.value = data.T ?? '';

    const tUnit = document.createElement('select');
    tUnit.className = 'mini object-t-unit';
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

  let objectCount = 0;

  async function renderFromFiles(Utxt, Ttxt, DEFAULTS) {
    const objIdxU = listIndexedPatches(Utxt, "object");
    const objIdxT = listIndexedPatches(Ttxt, "object");
    objectCount = Math.max(objIdxU.at(-1) || 0, objIdxT.at(-1) || 0, 0);

    const { fromK } = BC.utils;
    const objectList = byId("objectList");
    objectList.innerHTML = "";
    for (let i = 1; i <= objectCount; i++) {
      const t = getPatchBlock(Ttxt, `object_${i}`);
      let data = { mode: 'driven', T: DEFAULTS.objectT, grad: '' };
      if (t) {
        const inner = t.inner;
        const m = /^\s*type\s+([A-Za-z0-9_:]+)\s*;/m.exec(inner)?.[1] || '';
        if (/zeroGradient/.test(m)) {
          data = { mode: 'driven' };
        } else if (/fixedGradient/.test(m)) {
          const g = extractGradientUniform(inner);
          data = { mode: 'flux', grad: g || '' };
        } else {
          const v = extractValueUniform(inner);
          // Temperature from file is always in Kelvin, convert to Celsius for display
          const vK = v || DEFAULTS.objectT;
          const vC = fromK(parseFloat(vK) || DEFAULTS.objectT, 'C');
          data = { mode: 'fixed', T: vC, grad: '' };
        }
      }
      objectList.appendChild(makeObjectRow(i, data, DEFAULTS));
    }
    byId("objectCount").textContent = String(objectCount);
    BC.ensureEditableInputs();
  }

  function collect() {
    const rows = Array.from(document.querySelectorAll(".object-row"));
    rows.sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
    const values = rows.map(row => {
      const mode = row.querySelector('.temp-mode')?.value || 'fixed';
      const T = row.querySelector('.temp-T')?.value?.trim() || '';
      const tUnit = row.querySelector('.object-t-unit')?.value || 'C';
      const grad = row.querySelector('.temp-grad')?.value?.trim() || '';
      return { mode, T, tUnit, grad };
    });
    return { values, count: rows.length };
  }

  function applyToFiles(Utxt, Ttxt, values, fns) {
    const N = Math.max(values.length, 0);

    for (const k of listIndexedPatches(Utxt, "object")) if (k > N) Utxt = removePatch(Utxt, `object_${k}`);
    for (const k of listIndexedPatches(Ttxt, "object")) if (k > N) Ttxt = removePatch(Ttxt, `object_${k}`);

    for (let i = 1; i <= N; i++) {
      const item = values[i - 1] || { mode: 'driven', T: BC.DEFAULTS.objectT, tUnit: 'C', grad: '' };

      // U = noSlip always
      Utxt = upsertPatch(Utxt, `object_${i}`, [`type            noSlip;`]);

      if (item.mode === 'driven') {
        Ttxt = setPatchBody(Ttxt, `object_${i}`, makeTypeBodyForMode('driven', {}));
      } else if (item.mode === 'fixed') {
        const Tk = fns.toK(item.T, item.tUnit);
        Ttxt = setPatchBody(Ttxt, `object_${i}`, makeTypeBodyForMode('fixed', { T: Tk ?? BC.DEFAULTS.objectT }));
      } else {
        const dTdn = parseFloat(item.grad || '0') || 0;
        Ttxt = setPatchBody(Ttxt, `object_${i}`, makeTypeBodyForMode('flux', { dTdn }));
      }
    }
    return { Utxt, Ttxt };
  }

  function addRow() {
    objectCount++;
    byId("objectList").appendChild(
      makeObjectRow(objectCount, { mode: 'driven', T: BC.DEFAULTS.objectT, grad: '' }, BC.DEFAULTS)
    );
    byId("objectCount").textContent = String(document.querySelectorAll(".object-row").length);
    BC.ensureEditableInputs();
  }

  function removeRow() {
    const rows = document.querySelectorAll(".object-row");
    if (rows.length <= 0) return;
    rows[rows.length - 1].remove();
    byId("objectCount").textContent = String(document.querySelectorAll(".object-row").length);
    objectCount = document.querySelectorAll(".object-row").length;
    BC.ensureEditableInputs();
  }

  BC.register('object', { renderFromFiles, collect, applyToFiles, addRow, removeRow });
})();
