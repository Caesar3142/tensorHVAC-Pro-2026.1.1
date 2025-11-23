// /src/scripts/solver-run.js
// Live log + Start/Stop + Clear Results + live residual chart (x-axis = simulation time)

(() => {
  const $ = (id) => document.getElementById(id);
  const caseRoot = localStorage.getItem("activeCase");

  const LOG_NAME    = "run.log";
  const DECOMP_PATH = "system/decomposeParDict";
  const HELPER_NAME = ".run-tools.sh";      // helper script written to the case root
  const POLL_MS     = 1000;

  let pollTimer = null;
  let lastShown = "";

  /* ---------------- common utils ---------------- */
  function ensureCase() {
    if (!caseRoot) {
      alert("No active case. Go to Home and create/open a case first.");
      window.location.href = "home.html";
      return false;
    }
    return true;
  }

  function basename(p) { return (p || "").replace(/[\\\/]$/, "").split(/[\\/]/).pop() || "case"; }

  function wslQuotedCaseCd() {
    const win = caseRoot.replace(/\\/g, "/");
    return `cd "$(wslpath -a \"${win}\")"`;
  }

  function mkWSL(inner) {
    // Always: source OpenFOAM + cd into the case dir, then run 'inner'
    return `wsl -d Ubuntu bash -lc "source /usr/lib/openfoam/openfoam2506/etc/bashrc 2>/dev/null || source /opt/openfoam*/etc/bashrc 2>/dev/null; ${wslQuotedCaseCd()}; ${inner}"`;
  }

  // Prefer numberOfSubdomains; fallback to product of n(a b c)
  function parseCoresFromDecompose(text) {
    const m1 = text.match(/^\s*numberOfSubdomains\s+(\d+)\s*;/m);
    if (m1) return Math.max(1, parseInt(m1[1], 10));
    const m2 = text.match(/^\s*n\s*\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)\s*;/m);
    if (m2) {
      const a = parseInt(m2[1], 10), b = parseInt(m2[2], 10), c = parseInt(m2[3], 10);
      const prod = a * b * c;
      if (prod > 0) return prod;
    }
    return null;
  }

  async function readCoresFromDecomposeFile() {
    try {
      const txt = await window.api.readCaseFile(caseRoot, DECOMP_PATH);
      const n = parseCoresFromDecompose(txt);
      if (n && Number.isFinite(n) && n > 0) return n;
    } catch (e) {
      console.warn("[solver-run] Could not read decomposeParDict:", e?.message || e);
    }
    // Last resort: UI field if file not saved yet
    const fallback = Math.max(1, Math.floor(Number(($("#nSub") || {}).value || 1)));
    return fallback;
  }

  /* ---------------- helper bash script ---------------- */
  const HELPER_CONTENT = `#!/usr/bin/env bash
set -u

LOG="${LOG_NAME}"

log() { echo "$@" | tee -a "$LOG" ; }

stop_in_case() {
  local case_dir="$(pwd)"
  log ">>> Stop requested in: $case_dir"
  # Scan processes whose CWD equals this case dir and signal their process groups
  local targets=("mpirun" "buoyantSimpleFoam" "decomposePar" "reconstructPar")
  for sig in INT TERM; do
    for p in /proc/[0-9]*; do
      local pid="\${p#/proc/}"
      local cwd exePath baseExe
      cwd="$(readlink -f "$p/cwd" 2>/dev/null)" || continue
      [[ "$cwd" == "$case_dir" ]] || continue
      exePath="$(readlink -f "$p/exe" 2>/dev/null)" || continue
      baseExe="$(basename "$exePath" 2>/dev/null)"
      for t in "\${targets[@]}"; do
        if [[ "$baseExe" == "$t" ]]; then
          local pgid
          pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" || true
          if ([[ -n "\$pgid" ]]); then
            log ">>> sending SIG\$sig to PGID=\$pgid ($t, pid=\$pid)"
            kill -s "\$sig" "-\$pgid" 2>/dev/null || true
          fi
        fi
      done
    done
    sleep 1
  done
  log ">>> Stop signals sent (INT/TERM)."
}

clear_results() {
  log "===== CLEAR \$(date) ====="
  log "Removing processor* ..."
  shopt -s nullglob
  rm -rf -- processor* 2>/dev/null || true
  log "Removing time directories ..."
  foamListTimes -rm 2>&1 | tee -a "$LOG"
  log "===== CLEAR DONE \$(date) ====="
}

case "\${1:-}" in
  stop)  stop_in_case ;;
  clear) clear_results ;;
  *)     echo "Usage: $0 {stop|clear}" ;;
esac
`;

  async function ensureHelperScript() {
    try {
      // Always (re)write to be safe; tiny file.
      await window.api.writeCaseFile(caseRoot, HELPER_NAME, HELPER_CONTENT);
      // Make it executable in WSL
      await window.exec.run(mkWSL(`chmod +x "${HELPER_NAME}"`), { cwd: caseRoot });
    } catch (e) {
      console.error("[solver-run] ensureHelperScript failed:", e);
      // Don't block; Stop/Clear will error out clearly if missing.
    }
  }

  /* ---------------- ui helpers ---------------- */
  function setBusy(running) {
    $("startRun") && ($("startRun").disabled = running);
    $("stopRun")  && ($("stopRun").disabled  = !running);

    const badge = $("runStatus");
    if (badge) {
      badge.classList.remove("status-idle","status-running","status-failed","status-done");
      if (running) { badge.textContent = "Running"; badge.classList.add("status-running"); }
      else         { badge.textContent = "Idle";    badge.classList.add("status-idle");    }
    }
  }

  function markDone(ok) {
    const badge = $("runStatus");
    if (badge) {
      badge.classList.remove("status-idle","status-running","status-failed","status-done");
      if (ok) { badge.textContent = "Finished";      badge.classList.add("status-done"); }
      else    { badge.textContent = "Stopped/Failed";badge.classList.add("status-failed"); }
    }
  }

  function setLog(text) {
    const log = $("runLog");
    if (!log) return;
    if (!text) text = "(no output yet)";
    if (text === lastShown) return;
    lastShown = text;
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.textContent = text;
    if ($("autoScroll")?.checked && atBottom) {
      log.scrollTop = log.scrollHeight;
    }
  }

  /* ---------------- residuals: parsing + canvas chart (x = Time) ---------------- */

  // Aggregated residuals: field -> { initial: {t,v}[], final: {t,v}[] }
  const residualAgg = {};
  let lastParsedLength = 0;
  let currentTime = 0; // last seen "Time = ..." value (seconds)

  // regexes
  const reSolve = /Solving\s+for\s+(\w+).*?Initial\s+residual\s*=\s*([+\-]?\d+(?:\.\d+)?(?:e[+\-]?\d+)?)\s*,\s*Final\s+residual\s*=\s*([+\-]?\d+(?:\.\d+)?(?:e[+\-]?\d+)?)\s*/i;
  const reTime  = /^\s*Time\s*=\s*([+\-]?\d+(?:\.\d+)?(?:e[+\-]?\d+)?)\s*$/i;
  const reExec  = /^\s*ExecutionTime\s*=/i;

  function ensureField(field) {
    if (!residualAgg[field]) residualAgg[field] = { initial: [], final: [] };
  }

  // Parse new log, building {t,v} pairs per field. A "step" is committed when:
  // - we see a boundary line (Time=... or ExecutionTime=...) AND we have seen solver lines since last boundary,
  // - or EOF with pending solver values.
  function parseResidualsFromLog(logText) {
    if (!logText) return;

    // Skip if nothing new
    if (logText.length === lastParsedLength) return;
    lastParsedLength = logText.length;

    const lines = logText.split(/\r?\n/);

    let stepHasData = false;
    let lastSeen = {}; // field -> {initial, final}

    const commitStep = () => {
      // for each field, push the last-seen residuals at currentTime
      for (const [field, vals] of Object.entries(lastSeen)) {
        ensureField(field);
        residualAgg[field].initial.push({ t: currentTime, v: vals.initial });
        residualAgg[field].final.push({   t: currentTime, v: vals.final   });
      }
      lastSeen = {};
      stepHasData = false;
    };

    for (const raw of lines) {
      const line = raw;

      // Track simulation time
      const tmatch = line.match(reTime);
      if (tmatch) {
        const tVal = Number(tmatch[1]);
        if (Number.isFinite(tVal)) currentTime = tVal;
        // note: don't commit here; commit only when we actually have solver data
        continue;
      }

      // Residual lines
      const m = line.match(reSolve);
      if (m) {
        const field   = m[1];
        const initial = Number(m[2]);
        const final   = Number(m[3]);
        if (Number.isFinite(initial) && Number.isFinite(final)) {
          lastSeen[field] = { initial, final };
          stepHasData = true;
        }
        continue;
      }

      // Step boundary: only commit when we actually have data since last boundary
      if (reExec.test(line)) {
        if (stepHasData) commitStep();
        continue;
      }
    }

    // If log ends mid-step and we saw data, still commit it
    if (stepHasData) commitStep();
  }

  function drawResidualChart() {
    const canvas = $("residualChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    // clear
    ctx.clearRect(0, 0, W, H);

    const field  = $("residualField")?.value || "p_rgh";
    const series = $("residualSeries")?.value || "final";
    const dataObj = residualAgg[field];
    let arr = dataObj ? dataObj[series] : [];

    // keep only finite, positive samples and sort by time
    let samples = arr
      .filter(d => d && Number.isFinite(d.v) && d.v > 0 && Number.isFinite(d.t))
      .sort((a,b) => a.t - b.t)
      .map(d => [d.t, d.v]);

    // padding
    const padL = 56, padR = 12, padT = 12, padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // axes
    ctx.strokeStyle = "#c7ced7";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    if (samples.length === 0) {
      ctx.fillStyle = "#6b7280";
      ctx.fillText("No residual data yet…", padL + 10, padT + 20);
      return;
    }

    // Downsample (keep last in bucket)
    const MAX_POINTS = 1500;
    if (samples.length > MAX_POINTS) {
      const factor = samples.length / MAX_POINTS;
      const ds = [];
      let acc = 0, last;
      for (let i = 0; i < samples.length; i++) {
        acc += 1;
        last = samples[i];
        if (acc >= factor) { ds.push(last); acc = 0; }
      }
      if (acc > 0 && last) ds.push(last);
      samples = ds;
    }

    const times = samples.map(([t]) => t);
    const vals  = samples.map(([,v]) => v);
    const minT  = Math.min(...times);
    const maxT  = Math.max(...times);
    const minV  = Math.min(...vals);
    const maxV  = Math.max(...vals);
    const minL  = Math.floor(Math.log10(minV));
    const maxL  = Math.ceil (Math.log10(maxV));

    // y grid + labels (log scale)
    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let p = maxL; p >= minL; p--) {
      const y = padT + (maxL - p) * (plotH / (maxL - minL || 1));
      ctx.strokeStyle = "#eef1f5";
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + plotW, y);
      ctx.stroke();
      ctx.fillText(`1e${p}`, padL - 8, y);
    }

    // x ticks (time)
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const N = samples.length;
    const xOf = (t) => padL + ((t - minT) / (maxT - minT || 1)) * plotW;
    const yOf = (v) => {
      const lv = Math.log10(v);
      return padT + ((maxL - lv) / (maxL - minL || 1)) * plotH;
    };

    // choose ~10 ticks
    const TICKS = 10;
    for (let k = 0; k <= TICKS; k++) {
      const t = minT + (k / TICKS) * (maxT - minT);
      const x = xOf(t);
      ctx.fillText((Math.abs(t) < 1e-2 ? t : +t.toFixed(2)).toString(), x, padT + plotH + 6);
    }

    // connecting line
    ctx.strokeStyle = "rgba(37, 99, 235, .6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const [t, v] = samples[i];
      const x = xOf(t);
      const y = yOf(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // point markers
    ctx.fillStyle = "#2563eb";
    for (let i = 0; i < N; i++) {
      const [t, v] = samples[i];
      const x = xOf(t);
      const y = yOf(v);
      ctx.beginPath();
      ctx.arc(x, y, 2.0, 0, Math.PI * 2);
      ctx.fill();
    }

    // title
    ctx.fillStyle = "#111827";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`Field: ${field}  •  Series: ${series}  •  Samples: ${N}`, padL + 8, padT + 8);
  }

  /* ---------------- log polling ---------------- */
  async function readLogFile() {
    try {
      const txt = await window.api.readCaseFile(caseRoot, LOG_NAME);
      setLog(txt);
      // Parse residuals + redraw chart on every poll
      parseResidualsFromLog(txt);
      drawResidualChart();
    } catch {
      /* ignore if not present */
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(readLogFile, POLL_MS);
    readLogFile();
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function clearLog() {
    try { await window.api.writeCaseFile(caseRoot, LOG_NAME, ""); } catch {}
    setLog("");
    // reset parsing state
    for (const k of Object.keys(residualAgg)) delete residualAgg[k];
    lastParsedLength = 0;
    currentTime = 0;
    drawResidualChart();
  }

  /* ---------------- run sequence ---------------- */
  async function startRunning() {
    if (!ensureCase()) return;
    if (!window.exec?.run) { alert("Execution API not available."); return; }

    setBusy(true);
    await clearLog();
    await ensureHelperScript();

    const project = basename(caseRoot);
    const N = await readCoresFromDecomposeFile();

    // Log to file only (no piping back to host to avoid buffer limits)
    const header      = mkWSL(`echo "===== START $(date) — N=${N} =====" > ${LOG_NAME}`);
    const decompose   = mkWSL(`decomposePar                                >> ${LOG_NAME} 2>&1`);
    const solver      = mkWSL(`mpirun -np ${N} buoyantSimpleFoam -parallel  >> ${LOG_NAME} 2>&1`);
    const reconstruct = mkWSL(`reconstructPar                               >> ${LOG_NAME} 2>&1`);
    const touchFoam   = mkWSL(`{ touch "${project}.foam"; echo "Created ${project}.foam"; } >> ${LOG_NAME} 2>&1`);
    const footerOK    = mkWSL(`echo "===== DONE $(date) ====="                             >> ${LOG_NAME}`);
    const footerNG    = mkWSL(`echo "===== STOPPED/FAILED $(date) ====="                   >> ${LOG_NAME}`);

    try {
      startPolling();

      await window.exec.run(header, { cwd: caseRoot });

      let r = await window.exec.run(decompose, { cwd: caseRoot, timeout: 60 * 60_000 });
      if (!r?.ok) throw new Error(`decomposePar failed (code ${r?.code ?? "?"}).`);

      r = await window.exec.run(solver, { cwd: caseRoot, timeout: 24 * 60 * 60_000 });
      if (!r?.ok) console.warn("[solver-run] buoyantSimpleFoam exit code:", r?.code);

      r = await window.exec.run(reconstruct, { cwd: caseRoot, timeout: 4 * 60 * 60_000 });
      if (!r?.ok) console.warn("[solver-run] reconstructPar exit code:", r?.code);

      await window.exec.run(touchFoam, { cwd: caseRoot, timeout: 60_000 });
      await window.exec.run(footerOK,  { cwd: caseRoot });

      markDone(true);
      alert("Run sequence finished.");
    } catch (e) {
      console.error("[solver-run] startRunning error:", e);
      try { await window.exec.run(footerNG, { cwd: caseRoot }); } catch {}
      markDone(false);
      alert(e?.message || "Run stopped/failed. See log for details.");
    } finally {
      setBusy(false);
      setTimeout(readLogFile, 300);
    }
  }

  /* ---------------- stop / clear via helper script ---------------- */
  async function stopRunning() {
    if (!ensureCase()) return;
    if (!window.exec?.run) { alert("Execution API not available."); return; }

    try {
      await ensureHelperScript();
      // The helper does: find PIDs in this cwd, signal INT then TERM to their PGIDs, and logs it.
      const cmd = mkWSL(`./${HELPER_NAME} stop`);
      await window.exec.run(cmd, { cwd: caseRoot, timeout: 20_000 });

      $("runStatus")?.classList.remove("status-running");
      $("runStatus")?.classList.add("status-failed");
      $("runStatus").textContent = "Stopped/Failed";
      alert("Stop signal sent (see Run log for details).");
      setTimeout(readLogFile, 500);
    } catch (e) {
      console.error("[solver-run] stopRunning error:", e);
      alert(e?.message || "Stop failed.");
    } finally {
      setBusy(false);
    }
  }

  async function clearResults() {
    if (!ensureCase()) return;
    if (!window.exec?.run) { alert("Execution API not available."); return; }

    try {
      await ensureHelperScript();
      const cmd = mkWSL(`./${HELPER_NAME} clear`);
      await window.exec.run(cmd, { cwd: caseRoot, timeout: 120_000 });
      alert("Results cleared (processor* and time directories).");
      setTimeout(readLogFile, 300);
    } catch (e) {
      console.error("[solver-run] clearResults error:", e);
      alert(e?.message || "Failed to clear results.");
    }
  }

  /* ---------------- wire up ---------------- */
  window.addEventListener("DOMContentLoaded", () => {
    $("startRun")    ?.addEventListener("click", startRunning);
    $("stopRun")     ?.addEventListener("click", stopRunning);
    $("clearLog")    ?.addEventListener("click", clearLog);
    $("clearResults")?.addEventListener("click", clearResults);

    // selection changes for chart
    $("residualField")  ?.addEventListener("change", drawResidualChart);
    $("residualSeries") ?.addEventListener("change", drawResidualChart);

    setBusy(false);
    readLogFile(); // initial render (also draws chart if log exists)
  });
})();
