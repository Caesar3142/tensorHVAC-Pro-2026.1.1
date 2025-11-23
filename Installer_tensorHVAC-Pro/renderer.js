// Tab switching
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.dataset.tab;
    
    // Update tab buttons
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Update tab content
    tabContents.forEach(content => {
      content.classList.remove('active');
      if (content.id === `${targetTab}-tab`) {
        content.classList.add('active');
      }
    });
    
    // Clear log when switching tabs
    document.getElementById('log').textContent = '';
  });
});

const logEl = document.getElementById('log');

// Map titles → parent element ids for install
const titleToId = {
  // #1 WSL/Ubuntu (1.1–1.5 → s-1)
  '#1.1 Create WSL directory (if needed)': 's-1',
  '#1.2 Download Ubuntu 24.04 rootfs': 's-1',
  '#1.3 Import Ubuntu (WSL2)': 's-1',
  '#1.4 Create user tensorcfd + sudo': 's-1',
  '#1.5 Set default distro to Ubuntu': 's-1',

  // #2 OpenFOAM
  '#2 Install OpenFOAM 2506': 's-2',

  // #3 ParaView (3.1–3.2 → s-3)
  '#3.1 Download ParaView zip': 's-3',
  '#3.2 Extract ParaView → C:\\tensorCFD\\tools': 's-3',

  // #4 tCFD-Pre (4.1–4.2 → s-4)
  '#4.1 Download tCFD-Pre zip': 's-4',
  '#4.2 Extract tCFD-Pre → C:\\tensorCFD\\tools': 's-4',

  // #5 Setup (5.1–5.2 → s-5)
  '#5.1 Download Setup-tensorHVAC-Pro-2026.1.1': 's-5',
  '#5.2 Extract Setup → C:\\tensorCFD\\tensorHVAC-Pro\\tensorHVAC-Pro-2026.1.1': 's-5',

  // #6 Launcher (6.1–6.2 → s-6)
  '#6.1 Download Launcher 2026.1.1': 's-6',
  '#6.2 Extract Launcher → C:\\tensorCFD\\tensorHVAC-Pro\\tensorHVAC-Pro-2026.1.1': 's-6',

  // #7 Shortcut
  'Create desktop shortcut': 's-7'
};

// Map titles → parent element ids for uninstall
const titleToIdUninstall = {
  '#1 Uninstall WSL/Ubuntu (and OpenFOAM)': 's-u-1',
  '#2 Remove ParaView': 's-u-2',
  '#3 Remove tCFD-Pre': 's-u-3',
  '#4 Remove tensorHVAC-Pro-2026.1.1': 's-u-4',
  '#5 Remove Launcher-tensorHVAC-Pro-2026.1.1': 's-u-5',
  '#6 Remove Licensing leftovers + shortcuts': 's-u-6',
  '#7 Clean AppData Programs folders': 's-u-7',
  '#8 Clean desktop shortcuts': 's-u-8'
};

function setStatus(id, status) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = status;
  el.classList.remove('running', 'done', 'error');
  if (status === 'running') el.classList.add('running');
  if (status === 'done') el.classList.add('done');
  if (status === 'error') el.classList.add('error');
}

/* -------- Install Checklist + EULA wiring -------- */
const cbWSL = document.getElementById('cb-wsl');
const cbOF = document.getElementById('cb-openfoam');
const cbPV = document.getElementById('cb-paraview');
const cbPRE = document.getElementById('cb-tcfdpre');
const cbSetup = document.getElementById('cb-setup');
const cbLauncher = document.getElementById('cb-launcher');
const cbSC = document.getElementById('cb-shortcut');
const cbEULA = document.getElementById('cb-eula');

const btnAll = document.getElementById('checkAll');
const btnNone = document.getElementById('uncheckAll');

function setAll(val) {
  [cbWSL, cbOF, cbPV, cbPRE, cbSetup, cbLauncher, cbSC].forEach(el => { if (el) el.checked = val; });
}
if (btnAll) btnAll.addEventListener('click', () => setAll(true));
if (btnNone) btnNone.addEventListener('click', () => setAll(false));

const startBtn = document.getElementById('startBtn');
function updateStartEnabled() {
  if (!cbEULA) return;
  if (startBtn) startBtn.disabled = !cbEULA.checked;
}
if (cbEULA) { cbEULA.addEventListener('change', updateStartEnabled); updateStartEnabled(); }

/* -------------------------- Start Installation -------------------------- */
if (startBtn) {
  startBtn.addEventListener('click', async () => {
    if (cbEULA && !cbEULA.checked) { alert('You must agree to the License Agreement to proceed.'); return; }

    startBtn.disabled = true;
    logEl.textContent = '';

    ['s-1','s-2','s-3','s-4','s-5','s-6','s-7'].forEach(id => setStatus(id, 'pending'));

    const selections = {
      wsl: cbWSL?.checked ?? true,
      openfoam: cbOF?.checked ?? true,
      paraview: cbPV?.checked ?? true,
      tcfDpre: cbPRE?.checked ?? true,
      setupApp: cbSetup?.checked ?? true,
      launcher: cbLauncher?.checked ?? true,
      shortcut: cbSC?.checked ?? true
    };

    const payload = cbEULA ? { selections, eulaAccepted: !!cbEULA.checked } : { selections };
    const result = await window.installer.start(payload);

    if (!result.ok) {
      setStatus('s-7', 'error');
      if (result.error === 'EULA_NOT_ACCEPTED') alert('Please accept the License Agreement before starting.');
      else alert('Installation ended with error. Check the log for details.');
    } else {
      alert('All done!');
    }
    startBtn.disabled = false;
  });
}

/* -------- Uninstall Checklist wiring -------- */
const cbWSLUninstall = document.getElementById('cb-wsl-uninstall');
const cbPVUninstall = document.getElementById('cb-paraview-uninstall');
const cbPREUninstall = document.getElementById('cb-tcfdpre-uninstall');
const cbAPPUninstall = document.getElementById('cb-app-uninstall');
const cbLAUUninstall = document.getElementById('cb-launcher-uninstall');
const cbLOUninstall = document.getElementById('cb-leftovers-uninstall');
const cbPROGUninstall = document.getElementById('cb-programs-uninstall');
const cbSCUninstall = document.getElementById('cb-shortcuts-uninstall');

const btnAllUninstall = document.getElementById('checkAllUninstall');
const btnNoneUninstall = document.getElementById('uncheckAllUninstall');

function setAllUninstall(val) {
  [cbWSLUninstall, cbPVUninstall, cbPREUninstall, cbAPPUninstall, cbLAUUninstall, cbLOUninstall, cbPROGUninstall, cbSCUninstall].forEach(cb => { if (cb) cb.checked = val; });
}
if (btnAllUninstall) btnAllUninstall.addEventListener('click', () => setAllUninstall(true));
if (btnNoneUninstall) btnNoneUninstall.addEventListener('click', () => setAllUninstall(false));

const uninstallBtn = document.getElementById('uninstallBtn');
if (uninstallBtn) {
  uninstallBtn.addEventListener('click', async () => {
    uninstallBtn.disabled = true;
    logEl.textContent = '';
    Object.values(titleToIdUninstall).forEach(id => setStatus(id, 'pending'));

    const selections = {
      wsl: cbWSLUninstall?.checked ?? true,
      paraview: cbPVUninstall?.checked ?? true,
      tcfdpre: cbPREUninstall?.checked ?? true,
      app: cbAPPUninstall?.checked ?? true,
      launcher: cbLAUUninstall?.checked ?? true,
      leftovers: cbLOUninstall?.checked ?? true,
      programs: cbPROGUninstall?.checked ?? true,
      shortcuts: cbSCUninstall?.checked ?? true
    };

    let result;
    try {
      result = await window.uninstaller.start({ confirm: false, selections });
    } catch {
      result = await window.uninstaller.start(false);
    }

    if (result?.canceled) {
      uninstallBtn.disabled = false;
      return;
    }
    alert(result?.ok ? 'Uninstall complete.' : 'Uninstall finished with warnings/errors. Check the log.');
    uninstallBtn.disabled = false;
  });
}

/* ------------------------------- Log Wiring ----------------------------- */
window.installer.onLog((line) => {
  logEl.textContent += line;
  logEl.scrollTop = logEl.scrollHeight;
});
window.installer.onStep(({ title, status }) => {
  const id = titleToId[title];
  if (id) setStatus(id, status);
});

window.uninstaller.onLog(line => {
  logEl.textContent += line;
  logEl.scrollTop = logEl.scrollHeight;
});
window.uninstaller.onStep(({ title, status }) => {
  const id = titleToIdUninstall[title];
  if (id) setStatus(id, status);
});
