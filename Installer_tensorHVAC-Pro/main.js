// main.js
'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

let win;

/* ----------------------------- Window setup ----------------------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    title: 'tensorHVAC-Pro Installer/Uninstaller',
    icon: path.join(__dirname, 'assets', 'app.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile('index.html');
}

/* ------------------------------ App lifecycle --------------------------- */
app.whenReady().then(() => {
  createWindow();

  // ---- Application Menu (adds Help → About) ----
  const menu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => shell.openExternal('https://tensorhvac.com/hvac-simulation-software')
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ------------------------------- Utilities ------------------------------ */
function log(line = '') {
  if (win && !win.isDestroyed()) win.webContents.send('log', line.toString());
}
function sendStep(title, status) {
  if (win && !win.isDestroyed()) win.webContents.send('step', { title, status });
}
function runCmd(title, command, shellExec = true, allowNonZero = false) {
  return new Promise((resolve, reject) => {
    sendStep(title, 'running');
    const child = spawn(command, { shell: shellExec });
    child.on('error', (err) => { sendStep(title, 'error'); log(`[spawn error] ${err.message}\n`); reject(err); });
    child.stdout.on('data', (d) => log(d));
    child.stderr.on('data', (d) => log(d));
    child.on('close', (code) => {
      if (code === 0) { sendStep(title, 'done'); resolve(); }
      else if (allowNonZero) { 
        log(`\n[WARN] "${title}" exited with code ${code}. Continuing.\n`);
        sendStep(title, 'done'); 
        resolve(); 
      }
      else { sendStep(title, 'error'); reject(new Error(`Command failed (${code}): ${title}`)); }
    });
  });
}
function runPowerShellScript(title, scriptText, tempName = `tensor_script_${Date.now()}.ps1`) {
  const psPath = path.join(os.tmpdir(), tempName);
  fs.writeFileSync(psPath, scriptText, 'utf8');
  return runCmd(title, `powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`);
}
// helpers
const tmpPath = (...parts) => path.join(os.tmpdir(), ...parts);
const psq = (s) => String(s).replace(/'/g, "''");

/* -------------------------- WSL2 prerequisites --------------------------- */
function wslPrereqSteps() {
  const psEnable = `
$ErrorActionPreference = 'SilentlyContinue'
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart | Out-Host
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart | Out-Host
`.trim();
  const psServices = `
$ErrorActionPreference = 'SilentlyContinue'
foreach ($svc in @('vmcompute','hns','LxssManager')) {
  try {
    if (Get-Service -Name $svc -ErrorAction Stop) {
      Set-Service -Name $svc -StartupType Automatic -ErrorAction SilentlyContinue
      Start-Service -Name $svc -ErrorAction SilentlyContinue
    }
  } catch {}
}
`.trim();
  return [
    { title: '#0.1 Enable Windows features for WSL2', cmd: `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psEnable.replace(/"/g,'\\"')}"` },
    { title: '#0.2 Ensure WSL services are running',  cmd: `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psServices.replace(/"/g,'\\"')}"` },
    { title: '#0.3 Update WSL kernel (best effort)',  cmd: `wsl --update` },
    { title: '#0.4 Set default WSL version = 2',      cmd: `wsl --set-default-version 2` },
    { title: '#0.5 Show WSL status',                  cmd: `wsl --status` },
  ];
}

/* ---------------------------- URLs & Targets ----------------------------- */
const DEST_TOOLS = 'C:\\tensorCFD\\tools';
const DEST_APP   = 'C:\\tensorCFD\\tensorHVAC-Pro\\tensorHVAC-Pro-2026.1.1'; // version folder

const URL_UBUNTU   = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz';

const URL_PARAVIEW = 'https://www.dropbox.com/scl/fi/c95pwelb9jgrbj970ppcc/ParaView-mod-tensorCFD-2026.1.0.zip?rlkey=5g43c5cpulclmlxr0ev77daqo&st=8u3w5wat&dl=1';
const URL_TCFD_PRE = 'https://www.dropbox.com/scl/fi/wl8x4ua73ncwyj2d4jjci/tCFD-Pre-2026.1.1.zip?rlkey=b2uxxbyuv6r5fklumn16eshyw&st=8ldrce34&dl=1';

const URL_SETUP    = 'https://www.dropbox.com/scl/fi/o61bqrqllewl2gemm6art/tensorHVAC-Pro-2026.1.1.zip?rlkey=g9tkw5j6yalmfmd5gg6ala5sa&st=1afypi9o&dl=1';

const SHORTCUT_NAME = 'tensorHVAC-Pro-2026.1.1';

/* ---------------------- Download / Extract helpers ---------------------- */
async function downloadFile(label, url, outPathAbs) {
  await runCmd(label, `curl -L -o "${outPathAbs}" "${url}"`);
}
async function expandZip(label, zipPathAbs, destDirAbs) {
  const ps = `
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath '${psq(destDirAbs)}')){ New-Item -ItemType Directory -Path '${psq(destDirAbs)}' -Force | Out-Null }
Expand-Archive -Path '${psq(zipPathAbs)}' -DestinationPath '${psq(destDirAbs)}' -Force
Write-Output "Expanded to ${psq(destDirAbs)}"
`.trim();
  await runPowerShellScript(label, ps, `expand_${Date.now()}.ps1`);
}

/* ----------------------------- Orchestrator ----------------------------- */
ipcMain.handle('start-install', async (_evt, opts = {}) => {
  const selections = {
    wsl: true, openfoam: true, paraview: true, tcfDpre: true,
    setupApp: true, shortcut: true,
    ...(opts.selections || {})
  };

  const hasEulaProp = (opts && Object.prototype.hasOwnProperty.call(opts, 'eulaAccepted'));
  const eulaAccepted = hasEulaProp ? !!opts.eulaAccepted : true;
  if (!eulaAccepted) { log('❌ License Agreement not accepted. Aborting.\n'); return { ok: false, error: 'EULA_NOT_ACCEPTED' }; }
  if (!hasEulaProp) log('ℹ️ No EULA flag from renderer; assuming accepted.\n');

  // Summary
  log('--- Selection Summary ---\n');
  log(`#1 WSL/Ubuntu: ${selections.wsl ? 'ON' : 'OFF'}\n`);
  log(`#2 OpenFOAM:   ${selections.openfoam ? 'ON' : 'OFF'}\n`);
  log(`#3 ParaView:   ${selections.paraview ? 'ON' : 'OFF'}\n`);
  log(`#4 tCFD-Pre:   ${selections.tcfDpre ? 'ON' : 'OFF'}\n`);
  log(`#5 Setup App:  ${selections.setupApp ? 'ON' : 'OFF'}\n`);
  log(`#6 Shortcut:   ${selections.shortcut ? 'ON' : 'OFF'}\n`);
  log('-------------------------\n\n');

  try {
    // Optional: WSL2 prerequisites
    for (const s of wslPrereqSteps()) { await runCmd(s.title, s.cmd); }

    // #1. Install Ubuntu
    if (selections.wsl) {
      const ubZip = tmpPath('ubuntu2404.rootfs.tar.gz');
      await runCmd('#1.1 Create WSL directory (if needed)', `if not exist C:\\WSL\\Ubuntu mkdir C:\\WSL\\Ubuntu`);
      await downloadFile('#1.2 Download Ubuntu 24.04 rootfs', URL_UBUNTU, ubZip);
      await runCmd('#1.3 Import Ubuntu (WSL2)', `wsl --import Ubuntu C:\\WSL\\Ubuntu "${ubZip}" --version 2`);
      await runCmd('#1.4 Create user tensorcfd + sudo', `wsl -d Ubuntu --user root bash -c "useradd -m -s /bin/bash tensorcfd && echo 'tensorcfd:1234' | chpasswd && usermod -aG sudo tensorcfd && printf '[user]\\ndefault=tensorcfd\\n' > /etc/wsl.conf"`);
      await runCmd('#1.5 Set default distro to Ubuntu', `wsl -s Ubuntu`);
    }

    // #2. Install OpenFOAM
    if (selections.openfoam) {
      await runCmd('#2 Install OpenFOAM 2506',
        `wsl -d Ubuntu --user tensorcfd bash -c "echo '1234' | sudo -S bash -c 'curl -s https://dl.openfoam.com/add-debian-repo.sh | bash && apt-get update -y && apt-get install -y openfoam2506-default'"`);
    }

    // #3. Install ParaView mod → C:\tensorCFD\tools
    if (selections.paraview) {
      const pvZip = tmpPath('paraview.zip');
      await downloadFile('#3.1 Download ParaView zip', URL_PARAVIEW, pvZip);
      await expandZip('#3.2 Extract ParaView → C:\\tensorCFD\\tools', pvZip, DEST_TOOLS);
    }

    // #4. Install tCFD-Pre → C:\tensorCFD\tools
    if (selections.tcfDpre) {
      const preZip = tmpPath('tCFD-Pre.zip');
      await downloadFile('#4.1 Download tCFD-Pre zip', URL_TCFD_PRE, preZip);
      await expandZip('#4.2 Extract tCFD-Pre → C:\\tensorCFD\\tools', preZip, DEST_TOOLS);
    }

    // #5. Setup-tensorHVAC-Pro-2026.1.1 → C:\tensorCFD\tensorHVAC-Pro\tensorHVAC-Pro-2026.1.1
    if (selections.setupApp) {
      const appZip = tmpPath('tensorHVAC-Pro-Setup.zip');
      await downloadFile('#5.1 Download Setup-tensorHVAC-Pro-2026.1.1', URL_SETUP, appZip);
      await expandZip('#5.2 Extract Setup → C:\\tensorCFD\\tensorHVAC-Pro', appZip, DEST_APP);
    }

    // #6. Create desktop shortcut
    if (selections.shortcut) {
      const setupExePath = path.join(DEST_APP, 'tensorHVAC-Pro.exe');
      const ps = `
$ErrorActionPreference = 'SilentlyContinue'

$target = '${psq(setupExePath)}'
$work   = Split-Path -Path $target -Parent

# Verify the executable exists
if (-not (Test-Path -LiteralPath $target)) {
  Write-Output ('Setup app not found at: ' + $target)
  Write-Output 'Shortcut not created.'
  exit 0
}

Write-Output ('Using Setup app: ' + $target)

$shortcutName  = '${psq(SHORTCUT_NAME)}.lnk'
$userDesktop   = Join-Path $env:USERPROFILE 'Desktop'
$publicDesktop = Join-Path $env:Public 'Desktop'
$lnkUser   = Join-Path $userDesktop  $shortcutName
$lnkPublic = Join-Path $publicDesktop $shortcutName

$tmpLnk = Join-Path $env:TEMP ('tensorhvac_pro_setup_' + [guid]::NewGuid().ToString() + '.lnk')

try {
  $sh = New-Object -ComObject WScript.Shell
  $s  = $sh.CreateShortcut($tmpLnk)
  $s.TargetPath       = $target
  $s.WorkingDirectory = $work
  $s.IconLocation     = "$target,0"
  $s.Description      = 'Launch tensorHVAC-Pro 2026.1.1'
  $s.Save()
} catch {
  Write-Output ('Failed to build shortcut: ' + $_.Exception.Message)
  throw
}

if (-not (Test-Path -LiteralPath $userDesktop))   { New-Item -ItemType Directory -Path $userDesktop   -Force | Out-Null }
if (-not (Test-Path -LiteralPath $publicDesktop)) { New-Item -ItemType Directory -Path $publicDesktop -Force | Out-Null }

Copy-Item -LiteralPath $tmpLnk -Destination $lnkUser   -Force
Copy-Item -LiteralPath $tmpLnk -Destination $lnkPublic -Force
Remove-Item -LiteralPath $tmpLnk -Force -ErrorAction SilentlyContinue

Write-Output 'Created Desktop shortcuts:'
Write-Output (' - ' + $lnkUser)
Write-Output (' - ' + $lnkPublic)
`.trim();

      await runPowerShellScript('Create desktop shortcut', ps, 'tensor_create_shortcut.ps1');
    }

    log('\n✅ All selected steps finished successfully.\n');
    return { ok: true };
  } catch (err) {
    log('\n❌ Error: ' + err.message + '\n');
    return { ok: false, error: err.message };
  }
});

/* ----------------------------- Uninstall Handler ----------------------------- */
ipcMain.handle('start-uninstall', async (_e, opts = {}) => {
  if (!opts.confirm) {
    const res = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancel', 'Uninstall'],
      defaultId: 1,
      cancelId: 0,
      title: 'Confirm Uninstall',
      message:
        'This will remove WSL Ubuntu (and OpenFOAM), ParaView, tCFD-Pre, and tensorHVAC-Pro-2026.1.1.',
      detail: 'Action is irreversible. Proceed?'
    });
    if (res !== 1) return { ok: false, canceled: true };
  }

  const selections = {
    wsl: true,
    paraview: true,
    tcfdpre: true,
    app: true,
    leftovers: true,
    shortcuts: true,
    ...(opts.selections || {})
  };

  log('--- Uninstall Selection Summary ---\n');
  for (const [k, v] of Object.entries(selections)) {
    log(`${k}: ${v ? 'ON' : 'OFF'}\n`);
  }
  log('-----------------------------------\n\n');

  const steps = [];

  if (selections.wsl)
    steps.push({
      title: '#1 Uninstall WSL/Ubuntu (and OpenFOAM)',
      cmd: `wsl --terminate Ubuntu & wsl --unregister Ubuntu & rmdir /s /q "C:\\WSL\\Ubuntu" 2>nul`
    });

  if (selections.paraview)
    steps.push({
      title: '#2 Remove ParaView',
      cmd: `rmdir /s /q "C:\\tensorCFD\\tools\\ParaView-mod-tensorCFD-2026.1.0" 2>nul`
    });

  if (selections.tcfdpre)
    steps.push({
      title: '#3 Remove tCFD-Pre',
      cmd: `rmdir /s /q "C:\\tensorCFD\\tools\\tCFD-Pre-2026.1.1" 2>nul`
    });

  if (selections.app)
    steps.push({
      title: '#4 Remove tensorHVAC-Pro-2026.1.1',
      cmd: `rmdir /s /q "C:\\tensorCFD\\tensorHVAC-Pro\\tensorHVAC-Pro-2026.1.1" 2>nul`
    });

  if (selections.leftovers)
    steps.push({
      title: '#5 Remove Licensing leftovers',
      cmd: `rmdir /s /q "C:\\tensorCFD\\Licensing" 2>nul`
    });

  if (selections.shortcuts)
    steps.push({
      title: '#6 Clean desktop shortcuts',
      cmd: `del /q "%USERPROFILE%\\Desktop\\*tensorHVAC*.lnk" 2>nul`
    });

  try {
    log('Starting uninstall...\n\n');
    for (const s of steps) {
      log(`==> ${s.title}\n`);
      await runCmd(s.title, s.cmd, true, true); // allowNonZero = true for uninstall
      log('\n');
    }
    log('✅ Uninstall completed.\n');
    return { ok: true };
  } catch (err) {
    log(`\n❌ Error: ${err.message}\n`);
    return { ok: false, error: err.message };
  }
});
