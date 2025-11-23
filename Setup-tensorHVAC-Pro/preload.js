// preload.js
// Secure bridge between renderer and main with contextIsolation enabled.
// Exposes minimal, validated APIs only.

const { contextBridge, ipcRenderer } = require("electron");
const fs = require("fs");
const fse = require("fs-extra");
const path = require("path");

/* ---------------- Utilities ---------------- */

const WANTED_STLS = [
  "wall_1.stl",
  "ground.stl",
  "inlet_1.stl",
  "outlet.stl",
  "object_1.stl",
  "ceiling.stl",
  "wind.stl",
];

// Ensure target is inside parent (prevents path traversal)
function isSubpath(parent, target) {
  const rel = path.relative(path.resolve(parent), path.resolve(target));
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function assertString(v, name) {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} must be a non-empty string`);
}

function safeJoin(parent, ...segs) {
  assertString(parent, "caseRoot");
  const tgt = path.join(parent, ...segs);
  if (!isSubpath(parent, tgt)) throw new Error("Path escape blocked");
  return tgt;
}

function toArrayBuffer(buf) {
  // Return a true ArrayBuffer view over Node Buffer memory
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/* ---------------- IPC helpers ---------------- */

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

/* ---------------- App API (IPC → main) ---------------- */

const api = {
  // License ops
  validateLicense: (email, productKey) => {
    assertString(email, "email");
    assertString(productKey, "productKey");
    return invoke("license:validate", { email, productKey });
  },
  licenseStatus: () => invoke("license:status"),
  licenseClear: () => invoke("license:clear"),
  logout: () => invoke("app:logout"),
  
  // Case ops (go through main)
  createCase: (caseName, casePath) => {
    assertString(caseName, "caseName");
    assertString(casePath, "casePath");
    return invoke("create-case", caseName, casePath);
  },
  openCase: () => invoke("open-case"),

  // Read/write text files via main (safer; used broadly)
  readCaseFile: (caseRoot, relPath) => {
    assertString(caseRoot, "caseRoot");
    assertString(relPath, "relPath");
    return invoke("read-case-file", caseRoot, relPath);
  },
  writeCaseFile: (caseRoot, relPath, content) => {
    assertString(caseRoot, "caseRoot");
    assertString(relPath, "relPath");
    const safeContent = typeof content === "string" ? content : String(content ?? "");
    return invoke("write-case-file", caseRoot, relPath, safeContent);
  },

  // Directory picker
  selectFolder: () => invoke("select-folder"),

  // Exec (CLI bridge via main)
  exec: (cmd, opts = {}) => {
    assertString(cmd, "cmd");
    if (opts.cwd) assertString(opts.cwd, "opts.cwd");
    if (opts.timeout != null && typeof opts.timeout !== "number") {
      throw new Error("opts.timeout must be a number (ms)");
    }
    return invoke("exec:run", cmd, opts);
  },

  // Menu → renderer signal
  onMenuOpenCase: (handler) => {
    if (typeof handler !== "function") return () => {};
    const cb = (_e, ...args) => handler(...args);
    ipcRenderer.on("menu-open-case", cb);
    return () => ipcRenderer.removeListener("menu-open-case", cb);
  },
  
  // Generic invoke helper (for app:proceed, etc.)
  invoke: (channel, ...args) => invoke(channel, ...args),

  // Lightweight native FS helpers used by the meshing UI
  // (operate ONLY within the provided caseRoot with path checks)
  listDir: (caseRoot, rel = "") => {
    assertString(caseRoot, "caseRoot");
    const dir = safeJoin(caseRoot, rel);
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },

  readCaseFileBinary: (caseRoot, relPath) => {
    assertString(caseRoot, "caseRoot");
    assertString(relPath, "relPath");
    const full = safeJoin(caseRoot, relPath);
    const buf = fs.readFileSync(full);
    return toArrayBuffer(buf);
  },

  mkdirp: (caseRoot, relPath) => {
    assertString(caseRoot, "caseRoot");
    assertString(relPath, "relPath");
    const full = safeJoin(caseRoot, relPath);
    fse.ensureDirSync(full);
    return true;
  },

  unlink: (caseRoot, relPath) => {
    assertString(caseRoot, "caseRoot");
    assertString(relPath, "relPath");
    const full = safeJoin(caseRoot, relPath);
    try {
      fs.unlinkSync(full);
      return true;
    } catch {
      return false;
    }
  },

  // Env info (diagnostics)
  env: Object.freeze({
    isPackaged: !process.env.ELECTRON_IS_DEV, // heuristic
    platform: process.platform,
    versions: Object.freeze({
      node: process.versions.node,
      chrome: process.versions.chrome,
      electron: process.versions.electron,
    }),
  }),
};

/* ---------------- STL helpers (read-only, local FS) ---------------- */

function triSurfaceFromCase(caseRoot) {
  try {
    assertString(caseRoot, "caseRoot");
  } catch {
    return null;
  }
  const expected = safeJoin(caseRoot, "constant", "triSurface");
  try {
    if (fs.existsSync(expected) && fs.statSync(expected).isDirectory()) return expected;
  } catch {
    /* ignore */
  }
  return null;
}

const stlAPI = {
  caseInfo: (caseRoot) => {
    const triDir = triSurfaceFromCase(caseRoot);
    const exists = {};
    for (const name of WANTED_STLS) {
      try {
        if (!triDir) {
          exists[name] = false;
          continue;
        }
        const fp = safeJoin(triDir, name);
        exists[name] = fs.existsSync(fp) && fs.statSync(fp).isFile();
      } catch {
        exists[name] = false;
      }
    }
    return { triDir, exists };
  },

  // Returns ArrayBuffer (binary-safe) for STL loaders
  readSTLFromCase: (caseRoot, fileName) => {
    assertString(fileName, "fileName");
    const triDir = triSurfaceFromCase(caseRoot);
    if (!triDir) throw new Error('triSurface not found (expected "<case>/constant/triSurface")');
    const full = safeJoin(triDir, fileName);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new Error(`${fileName} not found in ${triDir}`);
    }
    const buf = fs.readFileSync(full);
    return toArrayBuffer(buf);
  },

  // Optional convenience: list any STL/OBJ names in triSurface
  listSTLs: (caseRoot) => {
    const triDir = triSurfaceFromCase(caseRoot);
    if (!triDir) return [];
    try {
      return fs
        .readdirSync(triDir)
        .filter((f) => /\.(stl|obj)$/i.test(f));
    } catch {
      return [];
    }
  },
};

/* ---------------- Titlebar bridge (project name + path) ---------------- */

const titlebar = {
  // Notify main of the active case path (absolute)
  setActiveCase: (absPath) => {
    if (absPath != null && typeof absPath !== "string") {
      throw new Error("setActiveCase: path must be a string");
    }
    ipcRenderer.send("ui:set-active-case", absPath || "");
  },
};

// Auto-advertise active case (if UI already saved it) once DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  try {
    const p = localStorage.getItem("activeCase");
    if (p) ipcRenderer.send("ui:set-active-case", p);
  } catch {
    /* ignore */
  }
});

/* ---------------- Expose to renderer ---------------- */

contextBridge.exposeInMainWorld("api", Object.freeze(api));
contextBridge.exposeInMainWorld("stlAPI", Object.freeze(stlAPI));
contextBridge.exposeInMainWorld("titlebar", Object.freeze(titlebar));

// Optional: convenient alias for exec
contextBridge.exposeInMainWorld("exec", Object.freeze({ run: api.exec }));
