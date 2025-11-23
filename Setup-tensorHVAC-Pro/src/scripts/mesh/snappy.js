import { findBalancedBlock, findParensBlock, findNamedInnerBlock, readLevelPair } from './parsing.js';
import { LOCAL_TO_LEVEL } from './constants.js';
import { $ } from './dom.js';

/* Canonical single-surface entries */
const GEO_CANON = {
  ceiling: { geomEntry: `ceiling.stl { type triSurfaceMesh; name ceiling; }`, refName: "ceiling", defaultLevel: [0,0] },
  floor:   { geomEntry: `floor.stl   { type triSurfaceMesh; name floor; }`,   refName: "floor",   defaultLevel: [0,0] },
  inlet:   { geomEntry: `inlet_1.stl { type triSurfaceMesh; name inlet_1; }`, refName: "inlet_1", defaultLevel: [0,1] },
  object:  { geomEntry: `object_1.stl{ type triSurfaceMesh; name object_1;}`, refName: "object_1", defaultLevel: null },
  outlet:  { geomEntry: `outlet.stl  { type triSurfaceMesh; name outlet; }`,  refName: "outlet",  defaultLevel: [0,1] },
  wall:    { geomEntry: `wall_1.stl  { type triSurfaceMesh; name wall_1; }`,  refName: "wall_1",  defaultLevel: [0,0] },
  //wind:    { geomEntry: `wind.stl    { type triSurfaceMesh; name wind; }`,    refName: "wind",    defaultLevel: [0,0] },
};

export function presetFromSnappy(text) {
  const [start, end] = findBalancedBlock(text, /refinementSurfaces\s*\{/mi);
  if (start == null) return;
  const body = text.slice(start, end);

  const seen = new Set();
  const names = [];
  const re = /\b(object_\d+)\s*\{/gmi;
  let m;
  while ((m = re.exec(body))) {
    const nm = m[1];
    if (!seen.has(nm)) { seen.add(nm); names.push(nm); }
  }
  if (!names.length) return;

  for (const nm of names) {
    const blk = findNamedInnerBlock(body, nm);
    if (!blk) continue;
    const lv = readLevelPair(blk);
    if (lv) {
      const entry = Object.entries(LOCAL_TO_LEVEL)
        .find(([, v]) => lv[0] === v[0] && lv[1] === v[1]);
      const key = entry?.[0];
      if (key && $("localRes")) $("localRes").value = key;
      break;
    }
  }
}

export function readIndexedCounts(flags) {
  const nIn = Math.max(1, parseInt($('num-inlet')?.value ?? '1', 10) || 1);
  const nOb = Math.max(1, parseInt($('num-object')?.value ?? '1', 10) || 1);
  const nWa = Math.max(1, parseInt($('num-wall')?.value  ?? '1', 10) || 1);
  return {
    inlet:  flags.inlet  ? nIn : 0,
    object: flags.object ? nOb : 0,
    wall:   flags.wall   ? nWa : 0,
  };
}

export function buildGeometryBodyWithCounts(flags, counts) {
  const lines = [];
  for (const k of ["ceiling","floor","outlet"]) {
    if (!flags[k]) continue;
    lines.push("    " + GEO_CANON[k].geomEntry);
  }
  if (flags.inlet)  for (let i = 1; i <= counts.inlet;  i++) lines.push(`    inlet_${i}.stl { type triSurfaceMesh; name inlet_${i}; }`);
  if (flags.object) for (let i = 1; i <= counts.object; i++) lines.push(`    object_${i}.stl { type triSurfaceMesh; name object_${i}; }`);
  if (flags.wall)   for (let i = 1; i <= counts.wall;   i++) lines.push(`    wall_${i}.stl { type triSurfaceMesh; name wall_${i}; }`);
  return "\n" + lines.join("\n") + "\n";
}

export function buildRefinementBodyWithCounts(flags, localPair, counts) {
  const lines = [];
  for (const k of ["ceiling","floor","outlet"]) {
    if (!flags[k]) continue;
    const { refName: rn, defaultLevel: lv } = GEO_CANON[k];
    lines.push(`        ${rn}        { level (${lv[0]} ${lv[1]}); }`);
  }
  if (flags.inlet)  for (let i = 1; i <= counts.inlet;  i++) lines.push(`        inlet_${i}        { level (0 1); }`);
  if (flags.object) for (let i = 1; i <= counts.object; i++) lines.push(`        object_${i}       { level (${localPair[0]} ${localPair[1]}); }`);
  if (flags.wall)   for (let i = 1; i <= counts.wall;   i++) lines.push(`        wall_${i}         { level (0 0); }`);
  return "\n" + lines.join("\n") + "\n";
}

export function buildFeaturesBodyWithCounts(flags, counts, inletLevel = 2, objectLevel = 2, wallLevel = 1) {
  const lines = [];
  if (flags.inlet)  for (let i = 1; i <= counts.inlet;  i++) lines.push(`        { file "inlet_${i}.eMesh"; level ${inletLevel}; }`);
  if (flags.object) for (let i = 1; i <= counts.object; i++) lines.push(`        { file "object_${i}.eMesh"; level ${objectLevel}; }`);
  if (flags.wall)   for (let i = 1; i <= counts.wall;   i++) lines.push(`        { file "wall_${i}.eMesh"; level ${wallLevel}; }`);
  return "\n" + lines.join("\n") + "\n";
}

export function rewriteSnappyFeatures(text, flags, counts, inletLevel = 2, objectLevel = 2, wallLevel = 1) {
  const [cmcStart, cmcEnd] = findBalancedBlock(text, /castellatedMeshControls\s*\{/mi);
  if (cmcStart == null) throw new Error("Could not find 'castellatedMeshControls { ... }'.");

  const cmcBefore = text.slice(0, cmcStart);
  let   cmcBody   = text.slice(cmcStart, cmcEnd);
  const cmcAfter  = text.slice(cmcEnd);

  while (true) {
    const [innerStart, innerEnd] = findParensBlock(cmcBody, /features\s*\(/mi);
    if (innerStart == null) break;
    const kwIdx = cmcBody.lastIndexOf("features", innerStart);
    let endIdx = innerEnd + 1;
    while (endIdx < cmcBody.length && /\s/.test(cmcBody[endIdx])) endIdx++;
    if (cmcBody[endIdx] === ';') endIdx++;
    while (endIdx < cmcBody.length && /\s/.test(cmcBody[endIdx])) endIdx++;
    cmcBody = cmcBody.slice(0, kwIdx) + cmcBody.slice(endIdx);
  }

  const inner = buildFeaturesBodyWithCounts(flags, counts, inletLevel, objectLevel, wallLevel);
  const injectAt = cmcBody.search(/\bnCellsBetweenLevels\b.*?;/m);
  const idx = injectAt >= 0 ? cmcBody.indexOf(";", injectAt) + 1 : cmcBody.length;
  const block = `\n    features\n    (\n${inner}    );\n`;

  const cmcBodyNew = cmcBody.slice(0, idx) + block + cmcBody.slice(idx);
  return cmcBefore + cmcBodyNew + cmcAfter;
}

export function rewriteSnappyWithGeometryChecklist(text, flags, localPair) {
  const counts = readIndexedCounts(flags);
  { // geometry { ... }
    const [start, end] = findBalancedBlock(text, /geometry\s*\{/mi);
    if (start == null) throw new Error("Could not find 'geometry { ... }' in snappyHexMesh.");
    const before = text.slice(0, start);
    const after  = text.slice(end);
    const expanded = buildGeometryBodyWithCounts(flags, counts);
    text = before + expanded + after;
  }
  { // refinementSurfaces { ... }
    const [cmcStart, cmcEnd] = findBalancedBlock(text, /castellatedMeshControls\s*\{/mi);
    if (cmcStart == null) throw new Error("Could not find 'castellatedMeshControls { ... }'.");
    const cmcBefore = text.slice(0, cmcStart);
    const cmcBody   = text.slice(cmcStart, cmcEnd);
    const cmcAfter  = text.slice(cmcEnd);

    const [rsStart, rsEnd] = findBalancedBlock(cmcBody, /refinementSurfaces\s*\{/mi);
    if (rsStart == null) throw new Error("Could not find 'refinementSurfaces { ... }'.");
    const rsBefore = cmcBody.slice(0, rsStart);
    const rsAfter  = cmcBody.slice(rsEnd);

    const expandedRS = buildRefinementBodyWithCounts(flags, localPair, counts);
    const newCmcBody = rsBefore + expandedRS + rsAfter;
    text = cmcBefore + newCmcBody + cmcAfter;
  }
  return text;
}

export function replaceLocationInMesh(text, x, y, z) {
  const vec = `${x} ${y} ${z}`;
  const [start, end] = findBalancedBlock(text, /castellatedMeshControls\s*\{/mi);
  if (start != null) {
    const before = text.slice(0, start);
    const body   = text.slice(start, end);
    const after  = text.slice(end);

    const rx = /(\blocationInMesh\s*\()\s*[-+.\deE]+\s+[-+.\deE]+\s+[-+.\deE]+(\s*\)\s*;)/m;
    if (rx.test(body)) return before + body.replace(rx, `$1${vec}$2`) + after;
    return before + body.replace(/\s*$/, `\n    locationInMesh (${vec});\n`) + after;
  }
  const rxGlobal = /(\blocationInMesh\s*\()\s*[-+.\deE]+\s+[-+.\deE]+\s+[-+.\deE]+(\s*\)\s*;)/m;
  if (rxGlobal.test(text)) return text.replace(rxGlobal, `$1${vec}$2`);
  return text + `\n\n// inserted by UI\nlocationInMesh (${vec});\n`;
}
