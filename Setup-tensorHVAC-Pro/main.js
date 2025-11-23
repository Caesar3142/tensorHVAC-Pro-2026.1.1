// === Electron + Node core imports ===
// Main Electron modules, path/file utilities, extra fs helpers, and child_process exec.
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const fse = require("fs-extra");
const { exec } = require("child_process");

// === Handshake module import (moved out of this file) ===
// Centralizes the "verify or quit" logic used to gate the protected app.
const { hasValidHandshake, abortForInvalidHandshake } = require("./handshake");

// === Environment flags ===
// OS and packaging flags used for branching logic and UI/UX differences.
const isMac = process.platform === "darwin";
const isDev = !app.isPackaged;

// === Global window reference ===
// Holds the main BrowserWindow instance for lifecycle management.
let mainWindow;

/* ---------- Helpers ---------- */

// === Cross-platform application icon resolution ===
// Picks correct icon format per platform (ico/icns/png) for window/dock.
function getAppIconPath() {
  if (process.platform === "win32") {
    return path.join(__dirname, "assets", "icons", "app.ico");
  } else if (process.platform === "darwin") {
    return path.join(__dirname, "assets", "icons", "app.icns");
  }
  return path.join(__dirname, "assets", "icons", "app.png"); // linux
}

// === Safe path check (anti path traversal) ===
// Ensures 'target' remains within 'parent' (used when reading/writing case files).
function isSubpath(parent, target) {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  return !rel.startsWith("..") && !path.isAbsolute(rel); // allow "" (same dir) too
}

// === App entry discovery ===
// Chooses the first existing HTML entry to load in production layout.
function findEntryFile() {
  const candidates = [
    // Current static layout
    path.join(__dirname, "src", "pages", "home.html"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// === Preload script resolution ===
// Optional preload script (for secure, isolated APIs to renderer).
function getPreloadPath() {
  const p = path.join(__dirname, "preload.js");
  return fs.existsSync(p) ? p : undefined;
}

/* ---------- External tool path config (persisted in userData) ---------- */

// === Path config file location (per-user) ===
// Stores user-chosen paths for external tools (tCFD-Pre, ParaView).
function getConfigPath() {
  // Safe to call after app is ready; used by menu actions
  const userData = app.getPath("userData");
  return path.join(userData, "toolPaths.json");
}

// === Load saved external tool paths ===
// Returns an object map { tCFD-Pre: "...", paraview: "..." } or {}.
function loadToolPaths() {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf8")) || {};
    }
  } catch (_) {}
  return {};
}

// === Save external tool path ===
// Persists a given executable path for a tool key under userData.
function saveToolPath(which, exePath) {
  try {
    const p = getConfigPath();
    const current = loadToolPaths();
    current[which] = exePath;
    fse.ensureDirSync(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify(current, null, 2), "utf8");
    return true;
  } catch (err) {
    dialog.showErrorBox("Failed to save path", err?.message || String(err));
    return false;
  }
}

// === Resolve executable path for a tool ===
// Returns user-configured path if valid, otherwise platform default.
function getToolPath(which) {
  const user = loadToolPaths()[which];
  if (user && fs.existsSync(user)) return user;
  return DEFAULT_LAUNCH_TARGETS[which];
}

// === UI flow to set external tool path ===
// Opens a file picker, normalizes macOS .app to the inner binary, and saves configuration.
async function setExternalPath(which) {
  const niceName = which === "tCFD-Pre" ? "tCFDPre" : "ParaView";
  /** @type {import('electron').OpenDialogOptions} */
  const options = {
    title: `Select ${niceName} executable`,
    properties: ["openFile"],
    // Filters are best-effort; users can still pick any file if needed.
    filters:
      process.platform === "win32"
        ? [{ name: "Executables", extensions: ["exe", "bat", "cmd"] }]
        : process.platform === "darwin"
        ? [{ name: "Apps / Binaries", extensions: ["app", ""] }]
        : [{ name: "Executables", extensions: ["", "sh"] }],
  };

  // On macOS, allow selecting .app bundles as "files"
  if (process.platform === "darwin") {
    options.properties.push("treatPackageAsDirectory");
  }

  const res = await dialog.showOpenDialog(options);
  if (res.canceled || !res.filePaths?.length) return;

  let chosen = res.filePaths[0];

  // If a macOS .app was chosen, try to locate the actual binary inside it.
  if (process.platform === "darwin" && chosen.endsWith(".app")) {
    const candidate =
      which === "tCFDPre"
        ? path.join(chosen, "Contents", "MacOS", "tCFDPre")
        : path.join(chosen, "Contents", "MacOS", "paraview");
    if (fs.existsSync(candidate)) chosen = candidate;
  }

  if (!fs.existsSync(chosen)) {
    dialog.showErrorBox("Invalid selection", `File does not exist:\n${chosen}`);
    return;
  }
  if (saveToolPath(which, chosen)) {
    dialog.showMessageBox({
      type: "info",
      message: `${niceName} path saved`,
      detail: chosen,
    });
  }
}

/* ---------- Native title: show project name + path beside icon ---------- */

// Current case path to reflect in the native title bar
let currentCasePath = null;

function projectNameFromPath(p) {
  if (!p) return "";
  try { return path.basename(p.replace(/[\\\/]$/, "")); } catch { return ""; }
}

// Middle-ellipsis for long paths so titles don't get ridiculous
function ellipsizeMiddle(s, max = 110) {
  if (!s || s.length <= max) return s;
  const keep = Math.max(10, Math.floor((max - 3) / 2));
  return s.slice(0, keep) + "..." + s.slice(-keep);
}

// Update the native title area (and macOS path presentation)
function applyWindowTitle() {
  if (!mainWindow) return;
  const base = "tensorHVAC-Pro";
  if (!currentCasePath) {
    mainWindow.setTitle(base);
    if (process.platform === "darwin") {
      mainWindow.setRepresentedFilename("");
      mainWindow.setDocumentEdited(false);
    }
    return;
  }

  const name = projectNameFromPath(currentCasePath);
  const prettyPath = ellipsizeMiddle(currentCasePath);
  mainWindow.setTitle(`${base} — ${name} — ${prettyPath}`);

  // macOS: show a proxy icon/path in the title bar
  if (process.platform === "darwin") {
    try {
      mainWindow.setRepresentedFilename(currentCasePath);
      mainWindow.setDocumentEdited(false);
    } catch { /* no-op */ }
  }
}

// Single place to set case path and reflect everywhere
function setActiveCasePath(p) {
  currentCasePath = p || null;
  applyWindowTitle();
}

/* ---------- Menu ---------- */

// === Application menu (File/Tools/View/Window/Help) ===
// Wires accelerators, tool launchers, and external docs/help links.
function createMenu() {
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Case…",
          accelerator: isMac ? "Cmd+O" : "Ctrl+O",
          click: () => mainWindow?.webContents.send("menu-open-case"),
        },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Tools",
      submenu: [
        {
          label: "Prepare Geometry (tCFD-Pre)",
          accelerator: isMac ? "Cmd+Shift+B" : "Ctrl+Shift+B",
          click: () => launchExternal("tCFDPre"),
        },
        {
          label: "Check Result (ParaView)",
          accelerator: isMac ? "Cmd+Shift+P" : "Ctrl+Shift+P",
          click: () => launchExternal("paraview"),
        },
        { type: "separator" },
        {
          label: "Set tCFD-Pre Path…",
          click: () => setExternalPath("tCFDPre"),
        },
        {
          label: "Set ParaView Path…",
          click: () => setExternalPath("paraview"),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools", accelerator: isMac ? "Cmd+Alt+I" : "Ctrl+Shift+I" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "window",
      submenu: [{ role: "minimize" }, { role: "zoom" }],
    },
    {
      role: "help",
      submenu: [
        {
          label: "User Guide",
          click: async () => {
            await shell.openExternal("https://tensorhvac.com/tensorhvac-pro-help");
          },
        },
        {
          label: "Theory Guide",
          click: async () => {
            await shell.openExternal("https://tensorhvac.com/theory-guide");
          },
        },
        {
          label: "Tutorials",
          click: async () => {
            await shell.openExternal("https://youtube.com/playlist?list=PLnBq05eeuSstc5cTngPfn6OgrSrtBrFNf&si=rT8898pVjZxEEu5B");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/* ---------- Window ---------- */

// === Main application window creation ===
// Loads the static HTML entry, guards navigation to external links, and sets diagnostics hooks.
function createMainWindow() {
  const iconPath = getAppIconPath();

  // macOS dock icon
  if (isMac) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) app.dock.setIcon(img);
  }

  const preload = getPreloadPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false, // avoid white flash
    backgroundColor: "#121212",
    title: "tensorHVAC-Pro",
    icon: path.join(__dirname, "assets/icons/app.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // allow preload to use Node
      preload,
    },
  });

  // PROD/STATIC (your current HTML layout):
  const entry = findEntryFile();
  if (!entry) return failNoEntry();
  mainWindow.loadFile(entry);

  // Apply initial title
  applyWindowTitle();

  // Security: open external links in browser only
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("will-navigate", (e, url) => {
    const isLocal = url.startsWith("file://");
    if (!isLocal) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Show when ready (reduces blank screen)
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Diagnostics: surface load and crash issues
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("did-fail-load", { code, desc, url });
    mainWindow.webContents.openDevTools({ mode: "detach" });
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    console.error("render-process-gone", details);
  });
  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    console.log("[renderer]", { level, message, line, sourceId });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// === Entry-not-found failure ===
// Informs the user packaging is missing the expected HTML and quits.
function failNoEntry() {
  const msg =
    "Cannot find the app entry HTML.\n\n" +
    "Expected one of:\n" +
    " - src/pages/home.html\n" +
    "Adjust your packaging (build.files) or update findEntryFile() in main.js.";
  dialog.showErrorBox("Startup Error", msg);
  app.quit();
}

/* ---------- IPC: case & file operations ---------- */

// === Create a new CFD case from a master template ===
// Copy from packaged /master (resources/master in prod) to user-selected target path.
ipcMain.handle("create-case", async (_evt, caseName, casePath) => {
  if (!handshakeOK) throw new Error("Unauthorized: invalid launch handshake.");
  if (!caseName || !casePath) throw new Error("Missing case name or target path.");

  const targetPath = path.join(casePath, caseName);

  // ✅ When packaged, master/ lives in resources/master
  const masterPath = app.isPackaged
    ? path.join(process.resourcesPath, "master")
    : path.join(__dirname, "master");

  if (!fs.existsSync(masterPath)) {
    throw new Error(`Master folder not found at: ${masterPath}`);
  }

  await fse.copy(masterPath, targetPath, { overwrite: false, errorOnExist: false });

  // Reflect in native title bar
  setActiveCasePath(targetPath);

  return targetPath;
});

// === Open an existing case directory ===
// Prompts user to pick a folder that contains standard OpenFOAM case structure.
ipcMain.handle("open-case", async () => {
  if (!handshakeOK) throw new Error("Unauthorized: invalid launch handshake.");
  const res = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: 'Open a case folder (contains "0", "constant", and "system")',
  });
  if (res.canceled || !res.filePaths?.length) return null;

  const chosen = res.filePaths[0];

  // Reflect in native title bar
  setActiveCasePath(chosen);

  return chosen;
});

// === Allow renderer to set/restore the active case path (optional) ===
ipcMain.on("ui:set-active-case", (_evt, p) => {
  if (typeof p === "string") setActiveCasePath(p);
});

// === Read a text file from an opened case ===
// Validates subpath to prevent escapes; returns UTF-8 content.
ipcMain.handle("read-case-file", async (_evt, caseRoot, relPath) => {
  if (!handshakeOK) throw new Error("Unauthorized: invalid launch handshake.");
  if (!caseRoot || !relPath) throw new Error("Invalid path.");
  const target = path.join(caseRoot, relPath);
  if (!isSubpath(caseRoot, target)) throw new Error("Path escape blocked.");
  return await fse.readFile(target, "utf8");
});

// === Write a text file into an opened case ===
// Ensures directory exists and writes UTF-8 content safely under case root.
ipcMain.handle("write-case-file", async (_evt, caseRoot, relPath, content) => {
  if (!handshakeOK) throw new Error("Unauthorized: invalid launch handshake.");
  if (!caseRoot || !relPath) throw new Error("Invalid path.");
  const target = path.join(caseRoot, relPath);
  if (!isSubpath(caseRoot, target)) throw new Error("Path escape blocked.");
  await fse.ensureDir(path.dirname(target));
  await fse.writeFile(target, content ?? "", "utf8");
  return true;
});

// === Generic folder picker ===
// Used for case creation targets or other folder selection needs.
ipcMain.handle("select-folder", async () => {
  if (!handshakeOK) throw new Error("Unauthorized: invalid launch handshake.");
  const res = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
    title: "Select a folder",
  });
  if (res.canceled || !res.filePaths?.length) return null;
  return res.filePaths[0];
});

/* ---------- App lifecycle ---------- */

// === Handshake gate flag ===
// Set true only when launcher-provided secret is verified.
let handshakeOK = false;

// === Early handshake enforcement ===
// If invalid, defer dialog until app is ready, then quit. If valid, continue boot.
if (!hasValidHandshake()) {
  // Wait until ready so we can show a proper dialog, then quit.
  app.whenReady().then(abortForInvalidHandshake);
} else {
  handshakeOK = true;

  // === Single instance lock ===
  // Prevents multiple instances; focuses existing window if a second is launched.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    // === App ready: identity, menu, window ===
    // Sets Windows AppUserModelID, builds menu, and opens the main window.
    app.whenReady().then(() => {
      if (process.platform === "win32") {
        app.setAppUserModelId("com.tensorhvac.pro");
      }
      createMenu();
      createMainWindow();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
      });
    });

    // === Quit behavior on all windows closed ===
    // Standard macOS behavior keeps app open; other platforms quit.
    app.on("window-all-closed", () => {
      if (!isMac) app.quit();
    });
  }
}

/* ---------- External tool launchers (platform defaults) ---------- */

// === Default external tool locations per platform ===
// Used when user has not configured custom paths for ParaView/tCFD-Pre.
const DEFAULT_LAUNCH_TARGETS = (() => {
  if (process.platform === "win32") {
    return {
      paraview: "C:\\tensorCFD\\tools\\ParaView-mod-tensorCFD-2026.1.0\\bin\\paraview.exe",
      tCFDPre: "C:\\tensorCFD\\tools\\tCFD-Pre-2026.1.0\\tCFD-Pre-2026.1.0.exe",
    };
  } else if (process.platform === "darwin") {
    return {
      paraview: "/Applications/ParaView.app/Contents/MacOS/paraview",
      tCFDPre: "/Applications/tCFD-Pre.app/Contents/MacOS/tCFD-Pre",
    };
  }
  // Linux (best guess; users can override)
  return {
    paraview: "/usr/bin/paraview",
    tCFDPre: "/usr/bin/tCFD-Pre",
  };
})();

// === Launch external tools (tCFD-Pre/ParaView) ===
// Requires a valid handshake; uses execFile first then falls back to spawn/cmd.
function launchExternal(which) {
  if (!handshakeOK) {
    dialog.showErrorBox("Unauthorized", "This action is blocked due to invalid launch handshake.");
    return false;
  }

  const exe = getToolPath(which);
  if (!exe) {
    dialog.showErrorBox("Launch error", `Unknown app: ${which}`);
    return false;
  }
  if (!fs.existsSync(exe)) {
    dialog.showErrorBox(
      "Executable not found",
      `Could not find:\n${exe}\n\nUse Tools → Set ${which === "tCFD-Pre" ? "tCFDPre" : "ParaView"} Path… to configure.`
    );
    return false;
  }

  const { execFile, spawn } = require("child_process");
  const cwd = path.dirname(exe);

  try {
    const child = execFile(exe, [], { cwd, windowsHide: false }, (err) => {
      if (err) {
        console.warn(`[launcher] execFile failed for ${which}:`, err.message);
        try {
          const fallback = spawn(exe, [], {
            cwd,
            windowsHide: false,
            detached: false,
          });
          fallback.on("error", (e) =>
            console.warn(`[launcher] spawn error for ${which}:`, e.message)
          );
        } catch (spawnErr) {
          dialog.showErrorBox("Failed to launch", `${which}: ${spawnErr?.message || spawnErr}`);
        }
      }
    });

    child?.unref?.();
    return true;
  } catch (err) {
    try {
      if (process.platform === "win32") {
        const fallback = spawn("cmd.exe", ["/c", "start", '""', `"${exe}"`], {
          cwd,
          windowsHide: false,
          shell: false,
        });
        fallback?.unref?.();
        return true;
      }
      throw err;
    } catch (fallbackErr) {
      dialog.showErrorBox("Failed to launch", `${which}: ${fallbackErr?.message || fallbackErr}`);
      return false;
    }
  }
}

/* ---------- Exec bridge (renderer → main) ---------- */

// === Controlled shell command execution ===
// Exposes a guarded exec bridge with timeout; requires valid handshake.
ipcMain.handle("exec:run", async (_evt, cmd, opts = {}) => {
  if (!handshakeOK) throw new Error("Unauthorized: invalid launch handshake.");

  const execOpts = {
    shell: true,
    windowsHide: true,
    timeout: 60_000,
  };
  if (opts.cwd && typeof opts.cwd === "string") execOpts.cwd = opts.cwd;
  if (typeof opts.timeout === "number") execOpts.timeout = opts.timeout;

  return await new Promise((resolve) => {
    exec(cmd, execOpts, (err, stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          code: typeof err.code === "number" ? err.code : 1,
          stdout: stdout || "",
          stderr: (stderr || "") + (err.message ? `\n${err.message}` : ""),
        });
      } else {
        resolve({ ok: true, code: 0, stdout: stdout || "", stderr: stderr || "" });
      }
    });
  });
});

/* ---------- End of main.js ---------- */
