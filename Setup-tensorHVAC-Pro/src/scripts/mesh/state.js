import { GEO_KEYS } from './constants.js';
import { $ } from './dom.js';
import { findBalancedBlock } from './parsing.js';

export function readChecklistFromLocalStorage() {
  try {
    const s = localStorage.getItem("geomChecklist");
    if (!s) return null;
    const obj = JSON.parse(s);
    const out = {};
    for (const k of GEO_KEYS) out[k] = !!obj[k];
    return out;
  } catch { return null; }
}
export function writeChecklistToLocalStorage(flags) {
  try { localStorage.setItem("geomChecklist", JSON.stringify(flags)); } catch {}
}
export function getChecklistFromUI() {
  return {
    ceiling: !!$('chk-ceiling')?.checked,
    floor:   !!$('chk-floor')?.checked,
    inlet:   !!$('chk-inlet')?.checked,
    object:  !!$('chk-object')?.checked,
    outlet:  !!$('chk-outlet')?.checked,
    wall:    !!$('chk-wall')?.checked,
    wind:    !!$('chk-wind')?.checked,
  };
}
export function setChecklistUI(flags) {
  $('chk-ceiling').checked = !!flags.ceiling;
  $('chk-floor').checked   = !!flags.floor;
  $('chk-inlet').checked   = !!flags.inlet;
  $('chk-object').checked  = !!flags.object;
  $('chk-outlet').checked  = !!flags.outlet;
  $('chk-wall').checked    = !!flags.wall;
  $('chk-wind').checked    = !!flags.wind;
}
export function inferChecklistFromSnappy(text) {
  const [gStart, gEnd] = findBalancedBlock(text, /geometry\s*\{/mi);
  const body = (gStart != null) ? text.slice(gStart, gEnd) : "";
  const present = (name) => new RegExp(`\\bname\\s+${name}\\s*;`).test(body) || new RegExp(`${name}\\.stl`, "i").test(body);
  const flags = {
    ceiling: present("ceiling"),
    floor:   present("floor"),
    inlet:   present("inlet_1"),
    object:  present("object_1"),
    outlet:  present("outlet"),
    wall:    present("wall_1"),
    wind:    present("wind"),
  };
  const any = Object.values(flags).some(Boolean);
  if (!any) GEO_KEYS.forEach(k => flags[k] = true);
  return flags;
}

/* Location-in-mesh UI state */
const LOC_MODE_KEY = "locMode"; // "auto" | "manual"
const LOC_VAL_KEY  = "locXYZ";  // {x,y,z}

export function loadLocUI() {
  const mode = localStorage.getItem(LOC_MODE_KEY) || "auto";
  $('locMode').value = mode;
  const saved = JSON.parse(localStorage.getItem(LOC_VAL_KEY) || '{"x":"","y":"","z":""}');
  $('locX').value = saved.x ?? "";
  $('locY').value = saved.y ?? "";
  $('locZ').value = saved.z ?? "";
  updateLocInputsEnabled();
}
export function updateLocInputsEnabled() {
  const manual = $('locMode').value === "manual";
  ['locX','locY','locZ'].forEach(id => {
    const el = $(id);
    el.disabled = !manual;
    el.placeholder = manual ? el.placeholder : "(auto)";
  });
}
export function persistLocUI() {
  const mode = $('locMode').value;
  localStorage.setItem(LOC_MODE_KEY, mode);
  if (mode === "manual") {
    const xyz = { x: $('locX').value, y: $('locY').value, z: $('locZ').value };
    localStorage.setItem(LOC_VAL_KEY, JSON.stringify(xyz));
  }
}

/* Global resolution: show/hide manual Δ field */
export function toggleGlobalManualField() {
  const isManual = ($('globalRes').value === 'manual');
  $('globalResManualWrap').classList.toggle('hidden', !isManual);
}
