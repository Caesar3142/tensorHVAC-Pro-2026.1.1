/* eslint-disable no-console */
import { $, fnum } from './dom.js';
import {
  BLOCK_CANDIDATES, SNAPPY_CANDIDATES, FEATURE_CANDIDATES,
  LOCAL_TO_LEVEL, TCFDPRE_PATH
} from './constants.js';
import {
  presetFromSnappy, rewriteSnappyWithGeometryChecklist, rewriteSnappyFeatures,
  replaceLocationInMesh, readIndexedCounts
} from './snappy.js';
import { upsertSurfaceFeatureExtract } from './featureExtract.js';
import { computeGlobalBBox } from './stlIO.js';
import {
  buildVerticesBlock, replaceVerticesBalanced, deltaFromKey,
  tripleFromBBox, replaceGlobalCellsInBlock
} from './blockMesh.js';
import {
  readChecklistFromLocalStorage, setChecklistUI, inferChecklistFromSnappy,
  loadLocUI, toggleGlobalManualField, getChecklistFromUI, writeChecklistToLocalStorage
} from './state.js';
import { wireGeometryImport } from './ui.js';

const caseRoot = localStorage.getItem("activeCase");
let blockPathInCase = null;
let snappyPathInCase = null;
let featurePathInCase = null;

/* ------------------------- small helpers ------------------------- */
async function readFirstExisting(paths) {
  for (const p of paths) {
    try {
      const text = await window.api.readCaseFile(caseRoot, p);
      return { path: p, text };
    } catch { /* continue */ }
  }
  return { path: paths[0], text: "" };
}
function setImportStatus(msg, isError = false) {
  const el = $('importStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('danger', !!isError);
}
async function ensureTriSurface() {
  const rel = "constant/triSurface";
  if (window.api?.mkdirp) {
    try { await window.api.mkdirp(caseRoot, rel); return; } catch {}
  }
  try {
    const keep = `${rel}/.keep`;
    await window.api.writeCaseFile(caseRoot, keep, "keep");
    if (window.api?.unlink) await window.api.unlink(caseRoot, keep);
  } catch {}
}

// detect missing binary/path
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

/* ---------------- Auto-detect geometry counts from STL files ------------------ */
function detectGeometryCounts(files) {
  const counts = { inlet: 0, outlet: 0, wall: 0, object: 0 };
  
  for (const filename of files) {
    // Match patterns like inlet_1.stl, inlet_2.stl, etc.
    const inletMatch = filename.match(/^inlet_(\d+)\.(stl|obj)$/i);
    if (inletMatch) {
      const num = parseInt(inletMatch[1], 10);
      counts.inlet = Math.max(counts.inlet, num);
    }
    
    const outletMatch = filename.match(/^outlet_(\d+)\.(stl|obj)$/i);
    if (outletMatch) {
      const num = parseInt(outletMatch[1], 10);
      counts.outlet = Math.max(counts.outlet, num);
    }
    
    const wallMatch = filename.match(/^wall_(\d+)\.(stl|obj)$/i);
    if (wallMatch) {
      const num = parseInt(wallMatch[1], 10);
      counts.wall = Math.max(counts.wall, num);
    }
    
    const objectMatch = filename.match(/^object_(\d+)\.(stl|obj)$/i);
    if (objectMatch) {
      const num = parseInt(objectMatch[1], 10);
      counts.object = Math.max(counts.object, num);
    }
  }
  
  return counts;
}

function updateGeometryCounts(counts) {
  // Auto-update counts based on detected files
  // Only increase if detected count is greater than current value
  // This allows manual increases but auto-detects from files
  // We don't decrease counts automatically - user may have set them manually
  
  const inletEl = $('num-inlet');
  if (inletEl && counts.inlet > 0) {
    const current = parseInt(inletEl.value || '1', 10) || 1;
    if (counts.inlet > current) {
      inletEl.value = String(counts.inlet);
    }
  }
  
  const outletEl = $('num-outlet');
  if (outletEl && counts.outlet > 0) {
    const current = parseInt(outletEl.value || '1', 10) || 1;
    if (counts.outlet > current) {
      outletEl.value = String(counts.outlet);
    }
  }
  
  const wallEl = $('num-wall');
  if (wallEl && counts.wall > 0) {
    const current = parseInt(wallEl.value || '1', 10) || 1;
    if (counts.wall > current) {
      wallEl.value = String(counts.wall);
    }
  }
  
  const objectEl = $('num-object');
  if (objectEl && counts.object > 0) {
    const current = parseInt(objectEl.value || '1', 10) || 1;
    if (counts.object > current) {
      objectEl.value = String(counts.object);
    }
  }
}

/* ---------------- triSurface list + clearing UI ------------------ */
async function refreshTriList() {
  const list = $('triList');
  const count = $('triListCount');
  if (!list || !window.api?.listDir) return;
  try {
    await ensureTriSurface();
    const files = (await window.api.listDir(caseRoot, "constant/triSurface")) || [];
    const shown = files.filter(f => /\.(stl|obj)$/i.test(f));

    list.innerHTML = '';
    if (!shown.length) {
      list.innerHTML = `<li class="muted">No STL/OBJ files found.</li>`;
    } else {
      for (const f of shown) {
        const li = document.createElement('li');
        li.className = 'pill';
        li.style.display = 'inline-block';
        li.style.margin = '4px';
        li.textContent = f;
        list.appendChild(li);
      }
    }
    if (count) count.textContent = `${shown.length} file(s)`;
    
    // Auto-detect and update geometry counts
    const detectedCounts = detectGeometryCounts(shown);
    updateGeometryCounts(detectedCounts);
  } catch (e) {
    console.error('[triSurface] refresh failed:', e);
    setImportStatus(`Failed to list triSurface: ${e?.message || e}`, true);
  }
}

async function clearSTLs() {
  if (!window.api?.listDir || !window.api?.unlink) {
    alert('Filesystem bridge not available.');
    return;
  }
  const ok = confirm("Delete ALL .stl and .obj files in constant/triSurface?\nThis cannot be undone.");
  if (!ok) return;

  try {
    setImportStatus('Clearing triSurface…');
    const files = (await window.api.listDir(caseRoot, "constant/triSurface")) || [];
    const targets = files.filter(f => /\.(stl|obj)$/i.test(f));
    for (const f of targets) {
      try { await window.api.unlink(caseRoot, `constant/triSurface/${f}`); }
      catch (e) { console.warn('[triSurface] unlink failed:', f, e); }
    }
    try { window.stlAPI?.refresh?.(caseRoot); } catch {}
    await refreshTriList(); // This will auto-detect and update counts (which will be 0 after clearing)
    setImportStatus(`Cleared ${targets.length} STL/OBJ file(s) from triSurface.`);
  } catch (e) {
    console.error('[triSurface] clear failed:', e);
    setImportStatus(`Failed to clear triSurface: ${e?.message || e}`, true);
  }
}

/* ------------------------------ init ----------------------------- */
async function init() {
  if (!caseRoot) { alert("No active case. Go to Home."); window.location.href="home.html"; return; }

  const blk = await readFirstExisting(BLOCK_CANDIDATES);
  const snp = await readFirstExisting(SNAPPY_CANDIDATES);
  const sfe = await readFirstExisting(FEATURE_CANDIDATES);

  blockPathInCase   = blk.path;
  snappyPathInCase  = snp.path;
  featurePathInCase = sfe.path;

  try { presetFromSnappy(snp.text); } catch {}
  const inferred = inferChecklistFromSnappy(snp.text);
  const stored = readChecklistFromLocalStorage();
  setChecklistUI(stored ?? inferred);

  loadLocUI();
  toggleGlobalManualField();

  wireGeometryImport(caseRoot);
  document.addEventListener('triSurface:changed', refreshTriList);
  
  // Also listen for custom events from stlIO.js
  window.addEventListener('triSurface:changed', refreshTriList);

  await refreshTriList();
}

/* ----------------------- tCFD-Pre launcher ----------------------- */
$('btnPrepare')?.addEventListener('click', async (e) => {
  e.preventDefault();
  if (!window.exec?.run) { alert('Exec bridge not available.'); return; }
  try {
    const cmd = `"${TCFDPRE_PATH}"`;
    const res = await window.exec.run(cmd, { timeout: 15000 });

    if (!res || !res.ok) {
      if (isMissingBinary(res, TCFDPRE_PATH)) {
        alert('tCFD-Pre path looks invalid. Please set the correct path in Tools → Set tCFD-Pre Path…');
      } else {
        console.warn('[btnPrepare] tCFD-Pre may have opened successfully but returned non-ok:', res);
      }
    }
  } catch (err) {
    if (isMissingBinary(err, TCFDPRE_PATH)) {
      alert('Failed to launch tCFD-Pre: the configured path appears invalid.');
    } else {
      console.warn('[btnPrepare] non-fatal launch error (suppressing popup):', err);
    }
  }
});

/* -------------------- triSurface buttons wiring ------------------ */
$('btnRefreshTri')?.addEventListener('click', refreshTriList);
$('btnClearSTLs')?.addEventListener('click', clearSTLs);

/* ----------------------- Apply Mesh pipeline --------------------- */
$('applyMesh').addEventListener('click', async () => {
  const status = ("status" in window ? $("status") : null) || { textContent: "" };
  status.textContent = "Updating files…";
  try {
    const blkText = await window.api.readCaseFile(caseRoot, blockPathInCase);
    let snpText = await window.api.readCaseFile(caseRoot, snappyPathInCase);

    const gKey = $("globalRes").value;
    const lKey = $("localRes").value;
    const pair = LOCAL_TO_LEVEL[lKey] || LOCAL_TO_LEVEL.medium;

    const flags = getChecklistFromUI();
    writeChecklistToLocalStorage(flags);
    const counts = readIndexedCounts(flags);

    snpText = rewriteSnappyWithGeometryChecklist(snpText, flags, pair);
    snpText = rewriteSnappyFeatures(snpText, flags, counts, 2, 2, 2, 1);

    await upsertSurfaceFeatureExtract(caseRoot, featurePathInCase, flags, counts, 150);

    status.textContent = "Computing coordinates…";
    const bb = await computeGlobalBBox(caseRoot);

    let newBlk = replaceVerticesBalanced(blkText, bb);

    let delta;
    if (gKey === 'manual') {
      const raw = $('globalResDelta').value.trim();
      const norm = raw.replace(',', '.');
      const val = parseFloat(norm);
      if (!Number.isFinite(val) || val <= 0) {
        alert("Manual Δ: please enter a positive number (e.g., 0.25 or 2e-1).");
        status.textContent = "Error: invalid manual Δ."; $('globalResDelta').focus(); return;
      }
      delta = val;
    } else {
      delta = deltaFromKey(gKey);
    }

    const triple = tripleFromBBox(bb, delta);
    newBlk = replaceGlobalCellsInBlock(newBlk, triple);

    let lix, liy, liz, source;
    if (($('locMode').value || 'auto') === 'manual') {
      const x = parseFloat($('locX').value);
      const y = parseFloat($('locY').value);
      const z = parseFloat($('locZ').value);
      if (![x,y,z].every(n => Number.isFinite(n))) {
        alert("Manual location-in-mesh: please enter numeric x, y, z values.");
        status.textContent = "Error: invalid manual location-in-mesh."; return;
      }
      lix = x; liy = y; liz = z; source = "manual";
    } else {
      lix = 0.5 * (bb.xmin + bb.xmax);
      liy = 0.5 * (bb.ymin + bb.ymax);
      liz = 0.5 * (bb.zmin + bb.zmax);
      source = "auto-midpoint";
    }
    let newSnp = replaceLocationInMesh(snpText, fnum(lix), fnum(liy), fnum(liz));

    await window.api.writeCaseFile(caseRoot, blockPathInCase, newBlk);
    await window.api.writeCaseFile(caseRoot, snappyPathInCase, newSnp);

    if (window.exec?.run) {
      status.textContent += ` — Δ=${fnum(delta)} — locationInMesh=(${fnum(lix)} ${fnum(liy)} ${fnum(liz)}) [${source}] — running meshing…`;

      const projectName = (caseRoot.replace(/[\\\/]$/, '').split(/[\\\/]/).pop()) || 'case';
      const wslCase = `$(wslpath -a "${caseRoot.replace(/\\/g, '/')}\")`;
      const mk = (inner) =>
        `wsl -d Ubuntu bash -lc "source /usr/lib/openfoam/openfoam2506/etc/bashrc 2>/dev/null || source /opt/openfoam*/etc/bashrc 2>/dev/null; cd ${wslCase}; ${inner}"`;

      let res = await window.exec.run(mk('blockMesh'), { cwd: caseRoot, timeout: 10 * 60_000 });
      if (!res.ok) { status.textContent += ` blockMesh failed (code ${res.code}).`; console.error('[blockMesh] failed', res); alert(`meshing step 1 failed (code ${res.code}). Please check your geometries.`); return; }
      status.textContent += ' blockMesh done. Running surfaceFeatureExtract...';

      res = await window.exec.run(mk('surfaceFeatureExtract'), { cwd: caseRoot, timeout: 10 * 60_000 });
      if (!res.ok) { status.textContent += ` surfaceFeatureExtract failed (code ${res.code}).`; console.error('[surfaceFeatureExtract] failed', res); alert(`feature extraction failed (code ${res.code}). Please check your geometries.`); return; }
      status.textContent += ' feature extraction done. Running snappyHexMesh...';

      res = await window.exec.run(mk('snappyHexMesh -overwrite'), { cwd: caseRoot, timeout: 30 * 60_000 });
      if (!res.ok) { status.textContent += ` snappyHexMesh failed (code ${res.code}).`; console.error('[snappyHexMesh] failed', res); alert(`snappyHexMesh failed (code ${res.code}).`); return; }
      status.textContent += ' snappyHexMesh done.';

      res = await window.exec.run(mk(`touch "${projectName}.foam"`), { cwd: caseRoot });
      if (!res.ok) { status.textContent += ` touch failed (code ${res.code}).`; console.error('[touch] failed', res); alert(`touch failed (code ${res.code}). Check console for details.`); return; }

      status.textContent += ` viewer file created. locationInMesh=(${fnum(lix)} ${fnum(liy)} ${fnum(liz)}) [${source}]`;
      console.log('[touch] created:', `${projectName}.foam`);
      alert(`Finished meshing.\nΔ = ${fnum(delta)}\nlocationInMesh = (${fnum(lix)} ${fnum(liy)} ${fnum(liz)}) [${source}]\nOpen ${projectName}.foam in ParaView to check the mesh.`);
    } else {
      console.warn('window.exec.run is not available — check preload wiring.');
      status.textContent += ` Files updated. Δ=${fnum(delta)}; locationInMesh=(${fnum(lix)} ${fnum(liy)} ${fnum(liz)}) [${source}] (No exec bridge; skipping auto-run.)`;
    }
  } catch (e) {
    console.error(e);
    $("status").textContent = "Error updating files.";
    alert(e.message || "Failed to update files.");
  }
});

/* ---------------------- Check Mesh (ParaView) --------------------- */
$('btnCheck')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const status = $('status');
  if (!caseRoot) { alert('No active case.'); return; }
  if (!window.exec?.run) { alert('Exec bridge not available.'); return; }

  const projectName = (caseRoot.replace(/[\\\/]$/, '').split(/[\\\/]/).pop()) || 'case';
  const wslCase = `$(wslpath -a "${caseRoot.replace(/\\/g, '/')}\")`;
  const touchCmd =
    `wsl -d Ubuntu bash -lc "source /opt/openfoam2506/etc/bashrc 2>/dev/null || source /usr/lib/openfoam/openfoam2506/etc/bashrc 2>/dev/null; cd ${wslCase}; touch '${projectName}.foam'"`;

  try {
    status.textContent = 'Preparing viewer file (.foam)…';
    const res = await window.exec.run(touchCmd, { cwd: caseRoot, timeout: 60_000 });
    if (!res || !res.ok) {
      console.error('[btnCheck] touch failed', res);
      alert(`Failed to create ${projectName}.foam.\n(code ${res?.code ?? 'n/a'})`);
      status.textContent = 'Error: could not create .foam file.';
      return;
    }

    const platform = (window.api?.env?.platform) || (navigator.platform || '').toLowerCase();
    let paraviewExe = null;
    if (platform.includes('win')) paraviewExe = 'C:\\tensorCFD\\tools\\ParaView-mod-tensorCFD-2026.1.1\\bin\\paraview.exe';
    else if (platform.includes('mac') || platform.includes('darwin')) paraviewExe = '/Applications/ParaView.app/Contents/MacOS/paraview';
    else paraviewExe = '/usr/bin/paraview';

    const foamPath = platform.includes('win')
      ? `${caseRoot.replace(/[\\\/]$/, '')}\\${projectName}.foam`
      : `${caseRoot.replace(/[\\\/]$/, '')}/${projectName}.foam`;

    status.textContent = 'Opening ParaView…';
    const openCmd = platform.includes('win') ? `"${paraviewExe}" "${foamPath}"` : `${paraviewExe} "${foamPath}"`;
    const resOpen = await window.exec.run(openCmd, { cwd: caseRoot, timeout: 10_000 });

    if (!resOpen || !resOpen.ok) {
      if (isMissingBinary(resOpen, paraviewExe)) {
        alert('ParaView path looks invalid. Verify it under Tools → Set ParaView Path…');
        status.textContent = 'Error: ParaView path invalid.';
      } else {
        console.warn('[btnCheck] ParaView launch returned non-ok (suppressing popup):', resOpen);
        status.textContent = 'Tried to launch ParaView.';
      }
      return;
    }
    status.textContent = `Opened in ParaView: ${projectName}.foam`;
  } catch (err) {
    if (isMissingBinary(err, 'paraview')) {
      alert('Failed to launch ParaView: invalid path.');
    } else {
      console.warn('[btnCheck] error (suppressing popup):', err);
    }
    status.textContent = 'Error during Check Mesh.';
  }
});

/* ----------------------------- nav ------------------------------- */
$('backPre')?.addEventListener('click', ()=> window.location.href="home.html");
$('goSolver')?.addEventListener('click', ()=> window.location.href="boundaries.html");

/* ------------------ Reset count when unchecked ------------------ */
function resetCountOnUncheck(chkId, numId) {
  const chk = $(chkId);
  const num = $(numId);
  if (!chk || !num) return;
  chk.addEventListener('change', () => {
    if (!chk.checked) num.value = 1;
  });
}

resetCountOnUncheck('chk-inlet', 'num-inlet');
resetCountOnUncheck('chk-object', 'num-object');
resetCountOnUncheck('chk-wall', 'num-wall');

/* ---------------------------- start ------------------------------ */
init();
