// Puente de la ventana de Four Swords: UDP al servidor de salas (vía el proceso principal).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fsnet', {
  setServer: addr => ipcRenderer.send('fs:server', String(addr)),
  send: data => ipcRenderer.send('fs:send', typeof data === 'string' ? data : new Uint8Array(data)),
  onMessage: cb => ipcRenderer.on('fs:msg', (_e, bytes) => cb(new Uint8Array(bytes))),
  toggleFullscreen: () => ipcRenderer.invoke('player:fullscreen'),
  exit: () => ipcRenderer.send('player:exit')
});
