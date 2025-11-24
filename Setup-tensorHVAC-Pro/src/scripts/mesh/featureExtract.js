/* surfaceFeatureExtractDict helpers:
   - remove inlet_1/object_1 blocks when 'inlet'/'object' unchecked
   - upsert indexed entries based on counts
*/
function findFeatureEntryBounds(text, baseName) {
  const rx = new RegExp(String.raw`(^|\n)\s*${baseName}\.stl\s*\{`, "m");
  const m = rx.exec(text);
  if (!m) return null;
  let i = text.indexOf("{", m.index);
  if (i === -1) return null;
  let d = 0, j = i;
  for (; j < text.length; j++) {
    const c = text[j];
    if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) { j++; break; } }
  }
  if (d !== 0) return null;
  const start = m.index + (m[1] ? m[1].length : 0);
  return { start, end: j };
}

function setFeatureEntryBody(text, baseName, bodyLines) {
  const block = `${baseName}.stl
{
${bodyLines.map(l => `    ${l}`).join("\n")}
}
`;
  const b = findFeatureEntryBounds(text, baseName);
  if (!b) return (text.trimEnd() + "\n\n" + block);
  return text.slice(0, b.start) + block + text.slice(b.end);
}

function removeFeatureEntry(text, baseName) {
  const b = findFeatureEntryBounds(text, baseName);
  if (!b) return text;
  return text.slice(0, b.start).replace(/\s*$/, "\n") + text.slice(b.end);
}

function listIndexedFeatureEntries(text, prefix) {
  const rx = new RegExp(String.raw`(^|\n)\s*${prefix}_(\d+)\.stl\s*\{`, "gm");
  const set = new Set(); let m;
  while ((m = rx.exec(text)) !== null) set.add(parseInt(m[2],10));
  return Array.from(set).sort((a,b)=>a-b);
}

export async function upsertSurfaceFeatureExtract(caseRoot, featurePathInCase, flags, counts, angle = 150) {
  let sfeText = "";
  try {
    sfeText = await window.api.readCaseFile(caseRoot, featurePathInCase);
  } catch {
    sfeText = `FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      surfaceFeatureExtractDict;
}
`;
  }

  // helper utils from the same file
  const existingIn = listIndexedFeatureEntries(sfeText, "inlet");
  const existingOu = listIndexedFeatureEntries(sfeText, "outlet");
  const existingOb = listIndexedFeatureEntries(sfeText, "object");
  const existingWa = listIndexedFeatureEntries(sfeText, "wall");

  // === ADD/UPDATE only if the group is checked ===
  if (flags.inlet)  {
    for (let i = 1; i <= counts.inlet;  i++) {
      sfeText = setFeatureEntryBody(sfeText, `inlet_${i}`, [
        `extractionMethod    extractFromSurface;`,
        `includedAngle       ${angle};`,
      ]);
    }
  }
  if (flags.object) {
    for (let i = 1; i <= counts.object; i++) {
      sfeText = setFeatureEntryBody(sfeText, `object_${i}`, [
        `extractionMethod    extractFromSurface;`,
        `includedAngle       ${angle};`,
      ]);
    }
  }
  if (flags.wall) {
    for (let i = 1; i <= counts.wall;   i++) {
      sfeText = setFeatureEntryBody(sfeText, `wall_${i}`, [
        `extractionMethod    extractFromSurface;`,
        `includedAngle       ${angle};`,
      ]);
    }
  }
  if (flags.outlet) {
    for (let i = 1; i <= counts.outlet; i++) {
      sfeText = setFeatureEntryBody(sfeText, `outlet_${i}`, [
        `extractionMethod    extractFromSurface;`,
        `includedAngle       ${angle};`,
      ]);
    }
  }

  // === Trim surplus or unchecked groups ===
  // If a group is unchecked, remove EVERYTHING (indexed and legacy non-indexed).
  if (!flags.inlet) {
    // Remove all indexed inlets
    for (const k of existingIn) sfeText = removeFeatureEntry(sfeText, `inlet_${k}`);
    // Remove legacy non-indexed inlet
    sfeText = removeFeatureEntry(sfeText, `inlet`);
    // Safety purge: remove any stray inlet_* blocks left by unusual dict edits
    sfeText = sfeText.replace(/(^|\n)\s*inlet_\d+\.stl\s*\{[\s\S]*?\}\s*/gm, "\n");
  } else {
    // When still checked: shrink if counts decreased
    for (const k of existingIn) if (k > counts.inlet) sfeText = removeFeatureEntry(sfeText, `inlet_${k}`);
  }

  if (!flags.outlet) {
    // Remove all indexed outlets
    for (const k of existingOu) sfeText = removeFeatureEntry(sfeText, `outlet_${k}`);
    // Remove legacy non-indexed outlet
    sfeText = removeFeatureEntry(sfeText, `outlet`);
    // Safety purge: remove any stray outlet_* blocks left by unusual dict edits
    sfeText = sfeText.replace(/(^|\n)\s*outlet_\d+\.stl\s*\{[\s\S]*?\}\s*/gm, "\n");
  } else {
    // When still checked: shrink if counts decreased
    for (const k of existingOu) if (k > counts.outlet) sfeText = removeFeatureEntry(sfeText, `outlet_${k}`);
  }

  if (!flags.object) {
    // Remove all indexed objects
    for (const k of existingOb) sfeText = removeFeatureEntry(sfeText, `object_${k}`);
    // Remove legacy non-indexed object
    sfeText = removeFeatureEntry(sfeText, `object`);
    // Safety purge
    sfeText = sfeText.replace(/(^|\n)\s*object_\d+\.stl\s*\{[\s\S]*?\}\s*/gm, "\n");
  } else {
    // When still checked: shrink if counts decreased
    for (const k of existingOb) if (k > counts.object) sfeText = removeFeatureEntry(sfeText, `object_${k}`);
  }

  if (!flags.wall) {
    // Remove all indexed walls
    for (const k of existingWa) sfeText = removeFeatureEntry(sfeText, `wall_${k}`);
    // Remove legacy non-indexed wall
    sfeText = removeFeatureEntry(sfeText, `wall`);
    // Safety purge
    sfeText = sfeText.replace(/(^|\n)\s*wall_\d+\.stl\s*\{[\s\S]*?\}\s*/gm, "\n");
  } else {
    // When still checked: shrink if counts decreased
    for (const k of existingWa) if (k > counts.wall) sfeText = removeFeatureEntry(sfeText, `wall_${k}`);
  }

  await window.api.writeCaseFile(caseRoot, featurePathInCase, sfeText);
}

