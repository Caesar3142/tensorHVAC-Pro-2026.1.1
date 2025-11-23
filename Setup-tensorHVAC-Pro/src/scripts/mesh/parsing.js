/** Balanced { } after opener regex. Returns [start, endExclusive] */
export function findBalancedBlock(text, openerRegex) {
  const opener = openerRegex.exec(text);
  if (!opener) return [null, null];
  const openBraceIdx = text.indexOf("{", opener.index);
  if (openBraceIdx === -1) return [null, null];

  let depth = 0;
  for (let i = openBraceIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return [openBraceIdx + 1, i];
    }
  }
  return [null, null];
}

/** Balanced ( ) after opener regex. Returns [start, endExclusive] */
export function findParensBlock(text, openerRegex) {
  const opener = openerRegex.exec(text);
  if (!opener) return [null, null];
  const openIdx = text.indexOf("(", opener.index);
  if (openIdx === -1) return [null, null];

  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return [openIdx + 1, i];
    }
  }
  return [null, null];
}

/** Grab named inner block e.g. "object_1 { ... }" from a body string */
export function findNamedInnerBlock(body, name) {
  const re = new RegExp(`(^|\\s)${name}\\s*\\{`, "m");
  const m = re.exec(body);
  if (!m) return null;

  const braceIdx = body.indexOf("{", m.index);
  if (braceIdx === -1) return null;

  let depth = 0;
  for (let i = braceIdx; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return body.slice(braceIdx, i + 1);
    }
  }
  return null;
}

/** Read first level (A B); inside a snippet */
export function readLevelPair(blockSnippet) {
  const mm = /\blevel\s*\(\s*(\d+)\s+(\d+)\s*\)\s*;/.exec(blockSnippet);
  return mm ? [ +mm[1], +mm[2] ] : null;
}
