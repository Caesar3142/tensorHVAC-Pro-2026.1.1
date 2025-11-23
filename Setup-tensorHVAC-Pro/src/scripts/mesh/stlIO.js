import { setImportStatus, fnum } from './dom.js';

const newBBox = () => ({ xmin:+Infinity, ymin:+Infinity, zmin:+Infinity, xmax:-Infinity, ymax:-Infinity, zmax:-Infinity });
const bboxValid = (bb) => [bb.xmin,bb.ymin,bb.zmin,bb.xmax,bb.ymax,bb.zmax].every(Number.isFinite);

function abToText(ab, cap = 8_000_000) {
  const slice = ab.byteLength > cap ? ab.slice(0, cap) : ab;
  try { return new TextDecoder("utf-8").decode(slice); }
  catch {
    const u8 = new Uint8Array(slice);
    let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }
}
function abToTextStrict(ab) {
  try { return new TextDecoder("utf-8").decode(ab); }
  catch {
    const u8 = new Uint8Array(ab);
    let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return s;
  }
}

function parseAsciiSTLVertices(text, acc) {
  const re = /vertex\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;
  let m, any = false;
  while ((m = re.exec(text)) !== null) {
    const x = +m[1], y = +m[2], z = +m[3];
    if (x < acc.xmin) acc.xmin = x; if (x > acc.xmax) acc.xmax = x;
    if (y < acc.ymin) acc.ymin = y; if (y > acc.ymax) acc.ymax = y;
    if (z < acc.zmin) acc.zmin = z; if (z > acc.zmax) acc.zmax = z;
    any = true;
  }
  return any;
}
function parseBinarySTLVertices(ab, acc) {
  if (ab.byteLength < 84) return false;
  const dv = new DataView(ab);
  let off = 80;
  const triCount = dv.getUint32(off, true); off += 4;
  for (let i = 0; i < triCount; i++) {
    off += 12; // normal
    for (let v = 0; v < 3; v++) {
      const x = dv.getFloat32(off, true); off += 4;
      const y = dv.getFloat32(off, true); off += 4;
      const z = dv.getFloat32(off, true); off += 4;
      if (x < acc.xmin) acc.xmin = x; if (x > acc.xmax) acc.xmax = x;
      if (y < acc.ymin) acc.ymin = y; if (y > acc.ymax) acc.ymax = y;
      if (z < acc.zmin) acc.zmin = z; if (z > acc.zmax) acc.zmax = z;
    }
    off += 2;
    if (off > ab.byteLength) break;
  }
  return true;
}

export function getSTLNames(caseRoot) {
  if (window.stlAPI?.listSTLs) {
    const all = window.stlAPI.listSTLs(caseRoot) || [];
    if (all.length) return all;
  }
  if (window.api?.listDir) {
    try {
      const files = window.api.listDir(caseRoot, "constant/triSurface") || [];
      return files.filter(f => /\.(stl|obj)$/i.test(f));
    } catch {}
  }
  const info = window.stlAPI?.caseInfo?.(caseRoot);
  const exists = info?.exists || {};
  return Object.keys(exists).filter(k => exists[k]);
}
function readSTL(caseRoot, name) {
  if (window.stlAPI?.readSTLFromCase) return window.stlAPI.readSTLFromCase(caseRoot, name);
  if (window.api?.readCaseFileBinary) return window.api.readCaseFileBinary(caseRoot, `constant/triSurface/${name}`);
  const txt = window.api.readCaseFile(caseRoot, `constant/triSurface/${name}`);
  const enc = new TextEncoder();
  return enc.encode(txt).buffer;
}

export async function computeGlobalBBox(caseRoot) {
  const names = getSTLNames(caseRoot);
  if (!names || !names.length) throw new Error("No STL/OBJ files found in constant/triSurface.");

  const acc = newBBox();
  let parsed = false;

  for (const name of names) {
    try {
      const ab = await readSTL(caseRoot, name);
      const head = abToText(ab, 4096).trim().toLowerCase();
      let ok = false;
      if (head.startsWith("solid")) {
        ok = parseAsciiSTLVertices(abToText(ab), acc) || parseBinarySTLVertices(ab, acc);
      } else {
        ok = parseBinarySTLVertices(ab, acc) || parseAsciiSTLVertices(abToText(ab), acc);
      }
      if (ok) parsed = true; else console.warn("[meshing] Could not parse", name);
    } catch (e) {
      console.warn("[meshing] Failed reading", name, e?.message);
    }
  }

  if (!parsed || !bboxValid(acc)) throw new Error("Failed to compute a valid bbox from triSurface meshes.");
  return acc;
}

/* ------------ Import helpers --------------- */
async function ensureTriSurface(caseRoot) {
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
function sanitizeName(name) { return name.replace(/[^a-zA-Z0-9._-]/g, "_"); }
function looksAsciiSTLFromHead(textHead) { const t = textHead.trim(); return t.startsWith("solid") && /facet\s+normal/i.test(textHead); }

function binarySTLtoAscii(ab, solidName = "geometry") {
  if (ab.byteLength < 84) throw new Error("Invalid STL (too small).");
  const dv = new DataView(ab);
  let off = 80; // header
  const triCount = dv.getUint32(off, true); off += 4;

  const lines = [];
  lines.push(`solid ${solidName}`);
  for (let i = 0; i < triCount; i++) {
    const nx = dv.getFloat32(off, true); off += 4;
    const ny = dv.getFloat32(off, true); off += 4;
    const nz = dv.getFloat32(off, true); off += 4;

    const v = new Array(9);
    for (let k = 0; k < 9; k++) { v[k] = dv.getFloat32(off, true); off += 4; }
    off += 2; // attribute

    lines.push(`  facet normal ${fnum(nx)} ${fnum(ny)} ${fnum(nz)}`);
    lines.push(`    outer loop`);
    lines.push(`      vertex ${fnum(v[0])} ${fnum(v[1])} ${fnum(v[2])}`);
    lines.push(`      vertex ${fnum(v[3])} ${fnum(v[4])} ${fnum(v[5])}`);
    lines.push(`      vertex ${fnum(v[6])} ${fnum(v[7])} ${fnum(v[8])}`);
    lines.push(`    endloop`);
    lines.push(`  endfacet`);
    if (off > ab.byteLength) break;
  }
  lines.push(`endsolid ${solidName}`);
  return lines.join("\n");
}

async function writeSTLPortable(caseRoot, relPath, arrayBuffer, originalName = "geometry") {
  const head = abToText(arrayBuffer, 2048);
  if (looksAsciiSTLFromHead(head)) {
    await window.api.writeCaseFile(caseRoot, relPath, abToTextStrict(arrayBuffer)); return;
  }
  const ascii = binarySTLtoAscii(arrayBuffer, originalName.replace(/\.[^.]+$/, ""));
  await window.api.writeCaseFile(caseRoot, relPath, ascii);
}

export async function importGeometryFiles(caseRoot, fileList) {
  await ensureTriSurface(caseRoot);
  let okCount = 0, skipCount = 0, errs = [];

  for (const file of fileList) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!["stl","obj"].includes(ext)) { skipCount++; continue; }

    const name = sanitizeName(file.name);
    const rel  = `constant/triSurface/${name}`;

    try {
      const buf = await file.arrayBuffer();
      if (ext === "obj") {
        const txt = new TextDecoder("utf-8").decode(buf);
        await window.api.writeCaseFile(caseRoot, rel, txt);
      } else {
        await writeSTLPortable(caseRoot, rel, buf, name);
      }
      okCount++;
    } catch (e) {
      errs.push(`${name}: ${e?.message || e}`);
    }
  }

  try { window.stlAPI?.refresh?.(caseRoot); } catch {}

  let msg = `Imported ${okCount} file(s).`;
  if (skipCount) msg += ` Skipped ${skipCount} (unsupported extension).`;
  if (errs.length) msg += ` Some errors occurred:\n- ${errs.join("\n- ")}`;
  setImportStatus(msg, errs.length > 0);
}
