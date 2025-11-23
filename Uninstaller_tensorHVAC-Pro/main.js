// main.js (Uninstaller for tensorHVAC-Pro-2026.1.0)
'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 640,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
    title: 'tensorHVAC-Pro-2026.1.0 Uninstaller'
  });
  win.loadFile('index.html');
}

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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function sendLog(line = '') {
  if (win && win.webContents) win.webContents.send('log', line.toString());
}
function sendStep(title, status) {
  if (win && win.webContents) win.webContents.send('step', { title, status });
}

function runCmd(title, command, shell = true) {
  return new Promise((resolve) => {
    sendStep(title, 'running');
    const child = spawn(command, { shell });

    child.stdout.on('data', (d) => sendLog(d));
    child.stderr.on('data', (d) => sendLog(d));

    child.on('close', (code) => {
      if (code === 0) {
        sendStep(title, 'done');
        resolve();
      } else {
        sendLog(`\n[WARN] "${title}" exited with code ${code}. Continuing.\n`);
        sendStep(title, 'done');
        resolve();
      }
    });
  });
}

ipcMain.handle('start-uninstall', async (_e, opts = {}) => {
  if (!opts.confirm) {
    const res = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Cancel', 'Uninstall'],
      defaultId: 1,
      cancelId: 0,
      title: 'Confirm Uninstall',
      message:
        'This will remove WSL Ubuntu (and OpenFOAM), ParaView, tCFD-Pre, tensorHVAC-Pro-2026.1.0, and its Launcher.',
      detail: 'Action is irreversible. Proceed?'
    });
    if (res !== 1) return { ok: false, canceled: true };
  }

  const selections = {
    wsl: true,
    paraview: true,
    tcfdpre: true,
    app: true,
    launcher: true,
    leftovers: true,
    programs: true,
    shortcuts: true,
    ...(opts.selections || {})
  };

  sendLog('--- Uninstall Selection Summary ---\n');
  for (const [k, v] of Object.entries(selections)) {
    sendLog(`${k}: ${v ? 'ON' : 'OFF'}\n`);
  }
  sendLog('-----------------------------------\n\n');

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
      cmd: `rmdir /s /q "C:\\tensorCFD\\tools\\tCFD-Pre-2026.1.0" 2>nul`
    });

  if (selections.app)
    steps.push({
      title: '#4 Remove tensorHVAC-Pro-2026.1.0',
      cmd: `rmdir /s /q "C:\\tensorCFD\\tensorHVAC-Pro\\tensorHVAC-Pro-2026.1.0" 2>nul`
    });

  if (selections.launcher)
    steps.push({
      title: '#5 Remove Launcher-tensorHVAC-Pro-2026.1.0',
      cmd: `rmdir /s /q "C:\\tensorCFD\\tensorHVAC-Pro\\Launcher-tensorHVAC-Pro-2026.1.0" 2>nul`
    });

  if (selections.leftovers)
    steps.push({
      title: '#6 Remove Licensing leftovers + shortcuts',
      cmd: `rmdir /s /q "C:\\tensorCFD\\Licensing" 2>nul & del /q "%USERPROFILE%\\Desktop\\*tensorHVAC*.lnk" 2>nul`
    });

  if (selections.programs)
    steps.push({
      title: '#7 Clean AppData Programs folders',
      cmd: `rmdir /s /q "%LOCALAPPDATA%\\Programs\\tensorhvac-pro" 2>nul & rmdir /s /q "%LOCALAPPDATA%\\Programs\\tensorHVAC-Pro-Launcher" 2>nul`
    });

  if (selections.shortcuts)
    steps.push({
      title: '#8 Clean desktop shortcuts',
      cmd: `del /q "%USERPROFILE%\\Desktop\\*tensorHVAC*.lnk" 2>nul`
    });

  try {
    sendLog('Starting uninstall...\n\n');
    for (const s of steps) {
      sendLog(`==> ${s.title}\n`);
      await runCmd(s.title, s.cmd);
      sendLog('\n');
    }
    sendLog('✅ Uninstall completed.\n');
    return { ok: true };
  } catch (err) {
    sendLog(`\n❌ Error: ${err.message}\n`);
    return { ok: false, error: err.message };
  }
});
