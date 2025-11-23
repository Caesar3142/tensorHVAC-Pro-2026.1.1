/* boundaries.inlet.js — inlet UI & logic */
(() => {
  const BC = window.BC;
  const { byId, toMs, toK, parseVector,
          getPatchBlock, upsertPatch, replaceValueUniformInPatch,
          listIndexedPatches, removePatch } = BC.utils;

  function makeInletRow(i, uVal, tVal, defaults) {
    const row = document.createElement('div');
    row.className = 'list-row inlet-row';
    row.dataset.index = String(i);

    const labelWrap = document.createElement('div');
    labelWrap.innerHTML = `<b>inlet_${i}</b><br/><small>U & T</small>`;

    const inputU = document.createElement('input');
    inputU.type = 'text';
    inputU.className = 'inlet-input';
    inputU.dataset.field = 'u';
    inputU.placeholder = '(0 0 0)';
    const uParsed = parseVector(uVal || defaults.inletU);
    inputU.value = `(${uParsed[0]} ${uParsed[1]} ${uParsed[2]})`;

    const inputT = document.createElement('input');
    inputT.type = 'text';
    inputT.className = 'inlet-input';
    inputT.dataset.field = 't';
    inputT.placeholder = defaults.inletT;
    inputT.value = tVal ?? '';

    const velUnit = document.createElement('select');
    velUnit.className = 'mini inlet-vel-unit';
    velUnit.innerHTML = `<option value="m/s" selected>m/s</option>
                         <option value="ft/min">ft/min</option>
                         <option value="ft/s">ft/s</option>
                         <option value="km/h">km/h</option>
                         <option value="mph">mph</option>`;

    const tUnit = document.createElement('select');
    tUnit.className = 'mini inlet-t-unit';
    tUnit.innerHTML = `<option value="K" selected>K</option><option value="C">C</option><option value="F">F</option>`;

    const controls = document.createElement('div');
    controls.className = 'controls';
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.alignItems = 'center';
    controls.appendChild(inputU);
    controls.appendChild(velUnit);
    controls.appendChild(inputT);
    controls.appendChild(tUnit);

    row.appendChild(labelWrap);
    row.appendChild(controls);
    return row;
  }

  let inletCount = 0;

  async function renderFromFiles(Utxt, Ttxt, DEFAULTS) {
    const inletIdxU = listIndexedPatches(Utxt, "inlet");
    const inletIdxT = listIndexedPatches(Ttxt, "inlet");
    inletCount  = Math.max(inletIdxU.at(-1) || 0, inletIdxT.at(-1) || 0, 1);

    const inletList = byId("inletList");
    inletList.innerHTML = "";
    for (let i = 1; i <= inletCount; i++) {
      const u = getPatchBlock(Utxt, `inlet_${i}`);
      const t = getPatchBlock(Ttxt, `inlet_${i}`);
      const uVal = u ? (u.inner.match(/uniform\s*\(([^)]+)\)/)?.[1] ?? DEFAULTS.inletU) : DEFAULTS.inletU;
      const tVal = t ? (t.inner.match(/uniform\s*([^;]+);/)?.[1] ?? DEFAULTS.inletT) : DEFAULTS.inletT;
      inletList.appendChild(makeInletRow(i, uVal, tVal, DEFAULTS));
    }
    Array.from(document.querySelectorAll('.inlet-row')).forEach(row => {
      const vSel = row.querySelector('.inlet-vel-unit'); if (vSel) vSel.value = 'm/s';
      const tSel = row.querySelector('.inlet-t-unit');   if (tSel) tSel.value = 'K';
    });
    byId("inletCount").textContent = String(inletCount);
    BC.ensureEditableInputs();
  }

  function collect() {
    const rows = Array.from(document.querySelectorAll(".inlet-row"));
    rows.sort((a,b) => Number(a.dataset.index) - Number(b.dataset.index));
    const values = rows.map(row => {
      const u = row.querySelector('.inlet-input[data-field="u"]')?.value?.trim() || BC.DEFAULTS.inletU;
      const t = row.querySelector('.inlet-input[data-field="t"]')?.value?.trim() || BC.DEFAULTS.inletT;
      const vSel = row.querySelector('.inlet-vel-unit')?.value || 'm/s';
      const tSel = row.querySelector('.inlet-t-unit')?.value || 'K';
      return { u, t, vUnit: vSel, tUnit: tSel };
    });
    return { values, count: rows.length };
  }

  function applyToFiles(Utxt, Ttxt, inletValues, fns) {
    const N = Math.max(inletValues.length, 1);

    // Clean surplus
    for (const k of listIndexedPatches(Utxt, "inlet")) if (k > N) Utxt = removePatch(Utxt, `inlet_${k}`);
    for (const k of listIndexedPatches(Ttxt, "inlet")) if (k > N) Ttxt = removePatch(Ttxt, `inlet_${k}`);

    // Upsert each inlet
    for (let i = 1; i <= N; i++) {
      const item = inletValues[i-1] || { u: BC.DEFAULTS.inletU, t: BC.DEFAULTS.inletT, vUnit: 'm/s', tUnit: 'K' };
      const uVec = parseVector(item.u.replace(/[()]/g,''));
      const uMs = [ fns.toMs(String(uVec[0]), item.vUnit) ?? 0,
                    fns.toMs(String(uVec[1]), item.vUnit) ?? 0,
                    fns.toMs(String(uVec[2]), item.vUnit) ?? 0 ];
      const uVal = `${uMs[0]} ${uMs[1]} ${uMs[2]}`;

      const tK = fns.toK(item.t, item.tUnit) ?? BC.DEFAULTS.inletT;
      const tVal = `${tK}`;

      Utxt = upsertPatch(Utxt, `inlet_${i}`, [
        `type            fixedValue;`,
        `value           uniform (${uVal});`,
      ]);
      Utxt = replaceValueUniformInPatch(Utxt, `inlet_${i}`, `(${uVal})`);

      Ttxt = upsertPatch(Ttxt, `inlet_${i}`, [
        `type            fixedValue;`,
        `value           uniform ${tVal};`,
      ]);
      Ttxt = replaceValueUniformInPatch(Ttxt, `inlet_${i}`, tVal);
    }
    return { Utxt, Ttxt };
  }

  function addRow() {
    inletCount++;
    byId("inletList").appendChild(makeInletRow(inletCount, BC.DEFAULTS.inletU, BC.DEFAULTS.inletT, BC.DEFAULTS));
    byId("inletCount").textContent = String(document.querySelectorAll(".inlet-row").length);
    BC.ensureEditableInputs();
  }
  function removeRow() {
    const rows = document.querySelectorAll(".inlet-row");
    if (rows.length <= 1) return;
    rows[rows.length - 1].remove();
    byId("inletCount").textContent = String(document.querySelectorAll(".inlet-row").length);
    inletCount = document.querySelectorAll(".inlet-row").length;
    BC.ensureEditableInputs();
  }

  BC.register('inlet', { renderFromFiles, collect, applyToFiles, addRow, removeRow });
})();
