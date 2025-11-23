// triSurfaceList.js — auto-injects a "triSurface Files" card into .grid
(function () {
  const ROOT_DIR = "constant/triSurface";
  const EXT_RE = /\.(stl|obj|ply)$/i;

  function $(id) { return document.getElementById(id); }

  function renderCard(bodyHTML, title = "Geometry files") {
    const grid = document.querySelector(".grid");
    if (!grid) return;
    // Avoid duplicating if reloaded
    let card = document.getElementById("triSurfaceCard");
    if (!card) {
      card = document.createElement("div");
      card.id = "triSurfaceCard";
      card.className = "card full";
      grid.prepend(card);
    }
    card.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <h3 style="margin:0">${title}</h3>
        <div class="row">
          <span class="pill"><span id="triListCount">0</span> file(s)</span>
          <button id="btnRefreshTri" class="btn">↻ refresh</button>
          <button id="btnClearSTLs" class="btn">🗑 clear</button>
        </div>
      </div>
      <div class="muted" style="margin:6px 0 12px">
        Files inside <code>${ROOT_DIR}/</code>
      </div>
      <ul id="triList" style="list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:6px"></ul>
      <div id="importStatus" class="muted" style="margin-top:8px"></div>
    `;
  }

  function setImportStatus(msg, isError = false) {
    const el = $("importStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("danger", !!isError);
  }

  async function ensureTriSurface(caseRoot) {
    // Create the folder if possible (desktop build)
    if (window.api?.mkdirp) {
      try { await window.api.mkdirp(caseRoot, ROOT_DIR); return; } catch {}
    }
    // Fallback: touch/delete a .keep so the dir exists
    try {
      const keep = `${ROOT_DIR}/.keep`;
      await window.api?.writeCaseFile?.(caseRoot, keep, "keep");
      if (window.api?.unlink) await window.api.unlink(caseRoot, keep);
    } catch {}
  }

  async function listViaBridge(caseRoot) {
    await ensureTriSurface(caseRoot);
    const files = (await window.api.listDir(caseRoot, ROOT_DIR)) || [];
    return files.filter(f => EXT_RE.test(f));
  }

  async function listViaFetch() {
    // When hosted on web server with directory listing or a JSON manifest.
    const tryRoots = [
      "../constant/triSurface/",
      "../../constant/triSurface/",
      "/constant/triSurface/"
    ];

    // JSON manifest (preferred for web builds)
    for (const root of tryRoots) {
      try {
        const res = await fetch(root + "triSurfaceFiles.json", { credentials: "same-origin" });
        if (res.ok) {
          const json = await res.json();
          const list = (json?.files || []).filter(f => EXT_RE.test(f));
          if (list.length) return list;
        }
      } catch {}
    }

    // Parse directory index HTML
    for (const root of tryRoots) {
      try {
        const res = await fetch(root, { credentials: "same-origin" });
        if (!res.ok) continue;
        const text = await res.text();
        const doc = new DOMParser().parseFromString(text, "text/html");
        const links = Array.from(doc.querySelectorAll("a"))
          .map(a => a.getAttribute("href"))
          .filter(Boolean)
          .filter(h => EXT_RE.test(h));
        if (links.length) return links;
      } catch {}
    }
    return [];
  }

  function paintList(files) {
    const listEl = $("triList");
    const cntEl  = $("triListCount");
    if (!listEl) return;

    listEl.innerHTML = "";
    if (!files.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "No STL/OBJ/PLY files found.";
      listEl.appendChild(li);
    } else {
      for (const f of files) {
        const li = document.createElement("li");
        li.className = "pill";
        li.textContent = f;
        listEl.appendChild(li);
      }
    }
    if (cntEl) cntEl.textContent = String(files.length);
  }

  async function refresh() {
    try {
      setImportStatus("Loading…");
      const caseRoot = localStorage.getItem("activeCase");

      let files = [];
      if (window.api?.listDir && caseRoot) {
        // Desktop/Electron style build
        files = await listViaBridge(caseRoot);
      } else {
        // Pure web build
        files = await listViaFetch();
      }
      paintList(files);
      setImportStatus(files.length ? "" : "Tip: add STL/OBJ/PLY files into constant/triSurface/");
    } catch (e) {
      console.error("[triSurface] refresh failed:", e);
      setImportStatus(`Failed to list triSurface: ${e?.message || e}`, true);
    }
  }

  async function clearFiles() {
    const caseRoot = localStorage.getItem("activeCase");
    if (!(window.api?.listDir && window.api?.unlink && caseRoot)) {
      alert("Clear requires the desktop bridge (window.api).");
      return;
    }
    const ok = confirm("Delete ALL .stl/.obj/.ply in constant/triSurface?\nThis cannot be undone.");
    if (!ok) return;

    try {
      setImportStatus("Clearing triSurface…");
      const files = (await window.api.listDir(caseRoot, ROOT_DIR)) || [];
      const targets = files.filter(f => EXT_RE.test(f));
      for (const f of targets) {
        try { await window.api.unlink(caseRoot, `${ROOT_DIR}/${f}`); }
        catch (err) { console.warn("[triSurface] unlink failed:", f, err); }
      }
      try { window.stlAPI?.refresh?.(caseRoot); } catch {}
      await refresh();
      setImportStatus(`Cleared ${targets.length} file(s).`);
    } catch (e) {
      console.error("[triSurface] clear failed:", e);
      setImportStatus(`Failed to clear triSurface: ${e?.message || e}`, true);
    }
  }

  function wireButtons() {
    $("btnRefreshTri")?.addEventListener("click", refresh);
    $("btnClearSTLs")?.addEventListener("click", clearFiles);
  }

  async function start() {
    // Always inject the card first so users see *something* even if listing fails
    renderCard(`<div class="muted">Initializing…</div>`);
    wireButtons();

    // If you dispatch a custom event elsewhere (e.g. after import), we’ll refresh
    document.addEventListener("triSurface:changed", refresh);

    await refresh();
  }

  document.addEventListener("DOMContentLoaded", start);
})();
