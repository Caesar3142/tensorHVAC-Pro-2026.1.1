// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('installer', {
  start: (opts) => ipcRenderer.invoke('start-install', opts),
  onLog: (cb) => ipcRenderer.on('log', (_e, line) => cb(line)),
  onStep: (cb) => ipcRenderer.on('step', (_e, payload) => cb(payload))
});
