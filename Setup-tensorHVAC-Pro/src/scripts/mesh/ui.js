import { $, setImportStatus } from './dom.js';
import { GEO_KEYS } from './constants.js';
import { getChecklistFromUI, writeChecklistToLocalStorage,
         updateLocInputsEnabled, persistLocUI, toggleGlobalManualField } from './state.js';
import { importGeometryFiles } from './stlIO.js';

export function wireGeometryImport(caseRoot) {
  function openFileDialogAndImport() {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.stl,.STL,.obj,.OBJ';
    picker.multiple = true;

    picker.style.position = 'fixed'; picker.style.left = '-9999px'; picker.style.top = '0'; picker.style.opacity = '0';
    document.body.appendChild(picker);

    picker.addEventListener('change', async () => {
      const files = Array.from(picker.files || []);
      if (!files.length) { document.body.removeChild(picker); return; }
      setImportStatus('Importing geometry...');
      try { await importGeometryFiles(caseRoot, files); }
      catch (err) { setImportStatus(`Failed to import: ${err?.message || err}`, true); }
      finally { document.body.removeChild(picker); }
    }, { once: true });

    try {
      const btn = $('btnImport');
      if (btn) { btn.style.pointerEvents = 'auto'; btn.style.zIndex = 2; btn.style.position = 'relative'; }
    } catch {}
    picker.click();
  }

  $('btnImport')?.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation(); openFileDialogAndImport();
  });

  // Persist checklist on change
  for (const k of GEO_KEYS) {
    const el = $(`chk-${k}`);
    if (el) {
      el.addEventListener('change', () => {
        writeChecklistToLocalStorage(getChecklistFromUI());
        const status = $('status'); if (status) status.textContent =
          "Checklist updated (will apply to snappyHexMeshDict on 'Update Mesh').";
      });
    }
  }

  // Count inputs feedback
  ['num-inlet','num-object','num-wall'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', () => {
      const status = $('status');
      if (status) status.textContent = "Counts updated (will apply to snappyHexMeshDict on 'Update Mesh').";
    });
  });

  // Location UI
  $('locMode').addEventListener('change', () => { updateLocInputsEnabled(); persistLocUI(); });
  ['locX','locY','locZ'].forEach(id => { const el = $(id); if (el) el.addEventListener('input', persistLocUI); });

  // Global res manual toggle
  $('globalRes').addEventListener('change', () => { toggleGlobalManualField(); });
}
