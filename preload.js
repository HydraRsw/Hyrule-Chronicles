const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: patch => ipcRenderer.invoke('config:set', patch),
  pickFile: opts => ipcRenderer.invoke('dialog:pick', opts),
  openUrl: url => ipcRenderer.invoke('shell:open', url),
  openCovers: () => ipcRenderer.invoke('covers:open'),
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen'),
  quit: () => ipcRenderer.invoke('app:quit'),
  launch: (g, v) => ipcRenderer.invoke('game:launch', g, v),
  onGameExited: cb => ipcRenderer.on('game:exited', (_e, d) => cb(d)),

  installPort: (g, v) => ipcRenderer.invoke('port:install', g, v),
  checkPort: (g, v) => ipcRenderer.invoke('port:check', g, v),
  uninstallPort: (g, v) => ipcRenderer.invoke('port:uninstall', g, v),
  openPortDir: (g, v) => ipcRenderer.invoke('port:openDir', g, v),
  importDump: (g, v, file) => ipcRenderer.invoke('dump:import', g, v, file),
  onPortProgress: cb => ipcRenderer.on('port:progress', (_e, d) => cb(d)),

  listDeps: () => ipcRenderer.invoke('deps:list'),
  runDeps: opts => ipcRenderer.invoke('deps:run', opts),
  onDepsProgress: cb => ipcRenderer.on('deps:progress', (_e, d) => cb(d)),

  onCoversChanged: cb => ipcRenderer.on('covers:changed', () => cb()),

  openGenerator: g => ipcRenderer.invoke('rando:open', g),
  importSeed: (g, file) => ipcRenderer.invoke('rando:import', g, file),
  selectSeed: (g, id) => ipcRenderer.invoke('rando:select', g, id),
  deleteSeed: (g, id) => ipcRenderer.invoke('rando:delete', g, id),
  openSeedsDir: g => ipcRenderer.invoke('rando:openDir', g),
  onSeedsChanged: cb => ipcRenderer.on('rando:changed', (_e, d) => cb(d)),

  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openEmuLog: () => ipcRenderer.invoke('emu:openLog'),
  clearEmuCache: () => ipcRenderer.invoke('emu:clearCache'),
  onUpdateStatus: cb => ipcRenderer.on('update:status', (_e, d) => cb(d))
});
