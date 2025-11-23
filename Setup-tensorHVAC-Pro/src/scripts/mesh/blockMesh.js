import { fnum } from './dom.js';

export function buildVerticesBlock(bb) {
  const expand = 0.01; // 1% expansion
  const xRange = bb.xmax - bb.xmin;
  const yRange = bb.ymax - bb.ymin;
  const zRange = bb.zmax - bb.zmin;
  const xmin = bb.xmin - expand * xRange;
  const xmax = bb.xmax + expand * xRange;
  const ymin = bb.ymin - expand * yRange;
  const ymax = bb.ymax + expand * yRange;
  const zmin = bb.zmin - expand * zRange;
  const zmax = bb.zmax + expand * zRange;

  return [
    "vertices",
    "(",
    `    (${fnum(xmin)} ${fnum(ymin)} ${fnum(zmin)})`,
    `    (${fnum(xmax)} ${fnum(ymin)} ${fnum(zmin)})`,
    `    (${fnum(xmax)} ${fnum(ymax)} ${fnum(zmin)})`,
    `    (${fnum(xmin)} ${fnum(ymax)} ${fnum(zmin)})`,
    "",
    `    (${fnum(xmin)} ${fnum(ymin)} ${fnum(zmax)})`,
    `    (${fnum(xmax)} ${fnum(ymin)} ${fnum(zmax)})`,
    `    (${fnum(xmax)} ${fnum(ymax)} ${fnum(zmax)})`,
    `    (${fnum(xmin)} ${fnum(ymax)} ${fnum(zmax)})`,
    "",
    ");"
  ].join("\n");
}

export function replaceVerticesBalanced(text, bb) {
  const keyIdx = text.search(/\bvertices\b/);
  if (keyIdx === -1) throw new Error("No 'vertices' keyword found in blockMesh.");

  let i = keyIdx;
  while (i < text.length && text[i] !== "(") i++;
  if (i >= text.length) throw new Error("Malformed vertices: missing '('.");

  let depth = 0, end = -1;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end === -1) throw new Error("Malformed vertices: unterminated ')'.");

  let k = end + 1;
  while (k < text.length && /\s|;/.test(text[k])) k++;

  const before = text.slice(0, keyIdx);
  const after  = text.slice(k);
  return before + buildVerticesBlock(bb) + after;
}

export function deltaFromKey(k) {
  if (k === "coarse") return 0.4;
  if (k === "fine")   return 0.1;
  return 0.2; // medium
}
export function tripleFromBBox(bb, delta) {
  const X = Math.abs(bb.xmax - bb.xmin);
  const Y = Math.abs(bb.ymax - bb.ymin);
  const Z = Math.abs(bb.zmax - bb.zmin);
  const a = Math.max(1, Math.round(X / delta));
  const b = Math.max(1, Math.round(Y / delta));
  const c = Math.max(1, Math.round(Z / delta));
  return [a, b, c];
}
export function replaceGlobalCellsInBlock(text, [nx, ny, nz]) {
  const rx = /(blocks[\s\S]*?hex\s*\(\s*(?:\d+\s+){7}\d+\s*\)\s*)\(\s*\d+\s+\d+\s+\d+\s*\)(\s*simpleGrading\s*\(\s*[-+.\deE]+\s+[-+.\deE]+\s+[-+.\deE]+\s*\)\s*;)/m;
  if (rx.test(text)) return text.replace(rx, `$1(${nx} ${ny} ${nz})$2`);
  const rx2 = /(blocks[\s\S]*?hex\s*\(\s*(?:\d+\s+){7}\d+\s*\)\s*)\(\s*\d+\s+\d+\s+\d+\s*\)/m;
  if (!rx2.test(text)) throw new Error("Could not find cell counts in blockMesh.");
  return text.replace(rx2, `$1(${nx} ${ny} ${nz})`);
}
