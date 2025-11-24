/* boundaries.outlet.js — outlet UI & logic */
(() => {
  const BC = window.BC;
  const { byId, toMs, toK, parseVector,
          getPatchBlock, upsertPatch, replaceValueUniformInPatch,
          listIndexedPatches, removePatch } = BC.utils;

  function makeOutletRow(i, uVal, tVal, defaults) {
    const row = document.createElement('div');
    row.className = 'list-row outlet-row';
    row.dataset.index = String(i);

    const labelWrap = document.createElement('div');
    labelWrap.innerHTML = `<b>outlet_${i}</b><br/><small>U & T</small>`;

    const inputU = document.createElement('input');
    inputU.type = 'text';
    inputU.className = 'outlet-input';
    inputU.dataset.field = 'u';
    inputU.placeholder = '(0 0 0)';
    const uParsed = parseVector(uVal || defaults.outletU);
    inputU.value = `(${uParsed[0]} ${uParsed[1]} ${uParsed[2]})`;

    const inputT = document.createElement('input');
    inputT.type = 'text';
    inputT.className = 'outlet-input';
    inputT.dataset.field = 't';
    inputT.placeholder = defaults.outletT;
    inputT.value = tVal ?? '';

    const velUnit = document.createElement('select');
    velUnit.className = 'mini outlet-vel-unit';
    velUnit.innerHTML = `<option value="m/s" selected>m/s</option>
                         <option value="ft/min">ft/min</option>
                         <option value="ft/s">ft/s</option>
                         <option value="km/h">km/h</option>
                         <option value="mph">mph</option>`;

    const tUnit = document.createElement('select');
    tUnit.className = 'mini outlet-t-unit';
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

  let outletCount = 0;

  async function renderFromFiles(Utxt, Ttxt, DEFAULTS) {
    const outletIdxU = listIndexedPatches(Utxt, "outlet");
    const outletIdxT = listIndexedPatches(Ttxt, "outlet");
    outletCount = Math.max(outletIdxU.at(-1) || 0, outletIdxT.at(-1) || 0, 1);

    const outletList = byId("outletList");
    outletList.innerHTML = "";
    for (let i = 1; i <= outletCount; i++) {
      const u = getPatchBlock(Utxt, `outlet_${i}`);
      const t = getPatchBlock(Ttxt, `outlet_${i}`);
      // For inletOutlet type, extract from inletValue or value
      let uVal = DEFAULTS.outletU;
      if (u) {
        const inletMatch = u.inner.match(/inletValue\s+uniform\s*\(([^)]+)\)/);
        const valueMatch = u.inner.match(/value\s+uniform\s*\(([^)]+)\)/);
        uVal = inletMatch ? inletMatch[1] : (valueMatch ? valueMatch[1] : DEFAULTS.outletU);
      }
      const tVal = t ? (t.inner.match(/inletValue\s+uniform\s*([^;]+);/)?.[1] || 
                        t.inner.match(/value\s+uniform\s*([^;]+);/)?.[1] || 
                        DEFAULTS.outletT) : DEFAULTS.outletT;
      outletList.appendChild(makeOutletRow(i, uVal, tVal, DEFAULTS));
    }
    Array.from(document.querySelectorAll('.outlet-row')).forEach(row => {
      const vSel = row.querySelector('.outlet-vel-unit'); if (vSel) vSel.value = 'm/s';
      const tSel = row.querySelector('.outlet-t-unit');   if (tSel) tSel.value = 'K';
    });
    byId("outletCount").textContent = String(outletCount);
    BC.ensureEditableInputs();
  }

  function collect() {
    const rows = Array.from(document.querySelectorAll(".outlet-row"));
    rows.sort((a,b) => Number(a.dataset.index) - Number(b.dataset.index));
    const values = rows.map(row => {
      const u = row.querySelector('.outlet-input[data-field="u"]')?.value?.trim() || BC.DEFAULTS.outletU;
      const t = row.querySelector('.outlet-input[data-field="t"]')?.value?.trim() || BC.DEFAULTS.outletT;
      const vSel = row.querySelector('.outlet-vel-unit')?.value || 'm/s';
      const tSel = row.querySelector('.outlet-t-unit')?.value || 'K';
      return { u, t, vUnit: vSel, tUnit: tSel };
    });
    return { values, count: rows.length };
  }

  function applyToFiles(Utxt, Ttxt, outletValues, fns) {
    const N = Math.max(outletValues.length, 1);

    // Clean surplus
    for (const k of listIndexedPatches(Utxt, "outlet")) if (k > N) Utxt = removePatch(Utxt, `outlet_${k}`);
    for (const k of listIndexedPatches(Ttxt, "outlet")) if (k > N) Ttxt = removePatch(Ttxt, `outlet_${k}`);

    // Upsert each outlet (using inletOutlet type like wind)
    const { setPatchBody } = BC.utils;
    for (let i = 1; i <= N; i++) {
      const item = outletValues[i-1] || { u: BC.DEFAULTS.outletU, t: BC.DEFAULTS.outletT, vUnit: 'm/s', tUnit: 'K' };
      const uVec = parseVector(item.u.replace(/[()]/g,''));
      const uMs = [ fns.toMs(String(uVec[0]), item.vUnit) ?? 0,
                    fns.toMs(String(uVec[1]), item.vUnit) ?? 0,
                    fns.toMs(String(uVec[2]), item.vUnit) ?? 0 ];
      const uVal = `${uMs[0]} ${uMs[1]} ${uMs[2]}`;

      const tK = fns.toK(item.t, item.tUnit) ?? BC.DEFAULTS.outletT;
      const tVal = `${tK}`;

      Utxt = setPatchBody(Utxt, `outlet_${i}`, [
        `type            inletOutlet;`,
        `inletValue      uniform (${uVal});`,
        `value           uniform (${uVal});`,
      ]);

      Ttxt = setPatchBody(Ttxt, `outlet_${i}`, [
        `type            inletOutlet;`,
        `inletValue      uniform ${tVal};`,
        `value           uniform ${tVal};`,
      ]);
    }
    return { Utxt, Ttxt };
  }

  function addRow() {
    outletCount++;
    byId("outletList").appendChild(makeOutletRow(outletCount, BC.DEFAULTS.outletU, BC.DEFAULTS.outletT, BC.DEFAULTS));
    byId("outletCount").textContent = String(document.querySelectorAll(".outlet-row").length);
    BC.ensureEditableInputs();
  }
  function removeRow() {
    const rows = document.querySelectorAll(".outlet-row");
    if (rows.length <= 1) return;
    rows[rows.length - 1].remove();
    byId("outletCount").textContent = String(document.querySelectorAll(".outlet-row").length);
    outletCount = document.querySelectorAll(".outlet-row").length;
    BC.ensureEditableInputs();
  }

  BC.register('outlet', { renderFromFiles, collect, applyToFiles, addRow, removeRow });
})();

