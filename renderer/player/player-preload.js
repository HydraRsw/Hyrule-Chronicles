// Puente mínimo entre el reproductor del emulador y el launcher.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hc', {
  exit: () => ipcRenderer.send('player:exit'),
  toggleFullscreen: () => ipcRenderer.invoke('player:fullscreen'),
  saveSram: (id, data, sk) => ipcRenderer.invoke('player:save', id, 'sram', data, sk),
  loadSram: (id, sk) => ipcRenderer.invoke('player:load', id, 'sram', sk),
  saveState: (id, data, sk) => ipcRenderer.invoke('player:save', id, 'state', data, sk),
  loadState: (id, sk) => ipcRenderer.invoke('player:load', id, 'state', sk),
  stateInfo: (id, sk) => ipcRenderer.invoke('player:stateInfo', id, sk)
});
