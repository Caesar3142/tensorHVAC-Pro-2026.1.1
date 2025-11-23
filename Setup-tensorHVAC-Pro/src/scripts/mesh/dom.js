/* eslint-disable no-console */
export const $ = (id) => document.getElementById(id);

export function setImportStatus(msg, isError = false) {
  const el = $('importStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('danger', !!isError);
}

export const fnum = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(6)));
