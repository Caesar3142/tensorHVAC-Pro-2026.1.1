const btn = document.getElementById('startBtn');
const logEl = document.getElementById('log');

const titleToId = {
  '#1 Uninstall WSL/Ubuntu (and OpenFOAM)': 's-1',
  '#2 Remove ParaView': 's-2',
  '#3 Remove tCFD-Pre': 's-3',
  '#4 Remove tensorHVAC-Pro-2026.1.0': 's-4',
  '#5 Remove Launcher-tensorHVAC-Pro-2026.1.0': 's-5',
  '#6 Remove Licensing leftovers + shortcuts': 's-6',
  '#7 Clean AppData Programs folders': 's-7',
  '#8 Clean desktop shortcuts': 's-8'
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

const cbWSL = document.getElementById('cb-wsl');
const cbPV  = document.getElementById('cb-paraview');
const cbPRE = document.getElementById('cb-tcfdpre');
const cbAPP = document.getElementById('cb-app');
const cbLAU = document.getElementById('cb-launcher');
const cbLO  = document.getElementById('cb-leftovers');
const cbPROG = document.getElementById('cb-programs');
const cbSC   = document.getElementById('cb-shortcuts');

const btnAll = document.getElementById('checkAll');
const btnNone = document.getElementById('uncheckAll');

function setAll(val) {
  [cbWSL, cbPV, cbPRE, cbAPP, cbLAU, cbLO, cbPROG, cbSC].forEach(cb => { if (cb) cb.checked = val; });
}
btnAll.addEventListener('click', () => setAll(true));
btnNone.addEventListener('click', () => setAll(false));

btn.addEventListener('click', async () => {
  btn.disabled = true;
  logEl.textContent = '';
  Object.values(titleToId).forEach(id => setStatus(id, 'pending'));

  const selections = {
    wsl: cbWSL.checked,
    paraview: cbPV.checked,
    tcfdpre: cbPRE.checked,
    app: cbAPP.checked,
    launcher: cbLAU.checked,
    leftovers: cbLO.checked,
    programs: cbPROG.checked,
    shortcuts: cbSC.checked
  };

  let result;
  try {
    result = await window.uninstaller.start({ confirm: false, selections });
  } catch {
    result = await window.uninstaller.start(false);
  }

  if (result?.canceled) {
    btn.disabled = false;
    return;
  }
  alert(result?.ok ? 'Uninstall complete.' : 'Uninstall finished with warnings/errors. Check the log.');
  btn.disabled = false;
});

window.uninstaller.onLog(line => {
  logEl.textContent += line;
  logEl.scrollTop = logEl.scrollHeight;
});
window.uninstaller.onStep(({ title, status }) => {
  const id = titleToId[title];
  if (id) setStatus(id, status);
});
