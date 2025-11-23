const btn = document.getElementById('startBtn');
const logEl = document.getElementById('log');

// Map titles → parent element ids (collapse substeps to s-1..s-7)
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
  '#5.1 Download Setup-tensorHVAC-Pro-2026.1.0': 's-5',
  '#5.2 Extract Setup → C:\\tensorCFD\\tensorHVAC-Pro\\tensorHVAC-Pro-2026.1.0': 's-5',

  // #6 Launcher (6.1–6.2 → s-6)
  '#6.1 Download Launcher 2026.1.0': 's-6',
  '#6.2 Extract Launcher → C:\\tensorCFD\\tensorHVAC-Pro\\tensorHVAC-Pro-2026.1.0': 's-6',

  // #7 Shortcut
  'Create desktop shortcut': 's-7'
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

/* -------- Checklist + EULA wiring -------- */
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

function updateStartEnabled() {
  if (!cbEULA) return;
  btn.disabled = !cbEULA.checked;
}
if (cbEULA) { cbEULA.addEventListener('change', updateStartEnabled); updateStartEnabled(); }

/* -------------------------- Start Installation -------------------------- */
btn.addEventListener('click', async () => {
  if (cbEULA && !cbEULA.checked) { alert('You must agree to the License Agreement to proceed.'); return; }

  btn.disabled = true;
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
  btn.disabled = false;
});

/* ------------------------------- Log Wiring ----------------------------- */
window.installer.onLog((line) => {
  logEl.textContent += line;
  logEl.scrollTop = logEl.scrollHeight;
});
window.installer.onStep(({ title, status }) => {
  const id = titleToId[title];
  if (id) setStatus(id, status);
});
