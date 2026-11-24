const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const GAMES = require('./games');
const ports = require('./ports');
const emuserver = require('./emuserver');
const { EventEmitter } = require('events');
const emuEvents = new EventEmitter();

let win = null;
let running = null;
let emu = null; // { origin }

const DEFAULT_CFG = {
  settings: {
    minimizeOnLaunch: true,
    sound: true,
    launcherFullscreen: false,
    emuFullscreen: true
  },
  paths: {},            // paths[gameId][variantId] = { exe, rom, extraArgs, dump }
  installs: {},         // installs["gameId:variantId"] = { tag, exe, dir, installedAt }
  emuCores: {},         // emuCores[core] = fecha en que quedó en caché
  selectedVariant: {},
  seeds: {},            // seeds[gameId] = [{ id, file, name, at, extras: [] }]
  activeSeed: {},       // activeSeed[gameId] = id de la seed en uso
  stats: {},
  lastIndex: 0
};

const userDir = (...p) => path.join(app.getPath('userData'), ...p);
const cfgFile = () => userDir('config.json');
const coversDir = () => userDir('covers');
const portsDir = () => userDir('ports');
const keyOf = (g, v) => `${g}:${v}`;

function loadCfg() {
  try {
    const c = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'));
    return { ...DEFAULT_CFG, ...c, settings: { ...DEFAULT_CFG.settings, ...(c.settings || {}) } };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CFG));
  }
}
let cfg;
function saveCfg() {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2));
}

// Rom que usa una versión: la seed activa (randomizer) o el dump configurado
function activeSeed(gameId) {
  const list = cfg.seeds?.[gameId] || [];
  return list.find(s => s.id === cfg.activeSeed?.[gameId]) || null;
}
function romFor(gameId, v) {
  return v.seedRom ? activeSeed(gameId)?.file || null : cfg.paths[gameId]?.[v.id]?.rom || null;
}

const find = (gameId, variantId) => {
  const game = GAMES.find(g => g.id === gameId);
  return { game, v: game?.variants.find(x => x.id === variantId) };
};
const pathsOf = (g, v) => ((cfg.paths[g] ||= {})[v] ||= {});

function findCover(id) {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const f = path.join(coversDir(), `${id}.${ext}`);
    if (fs.existsSync(f)) return pathToFileURL(f).href + `?t=${fs.statSync(f).mtimeMs}`;
  }
  return null;
}

function splitArgs(str) {
  if (!str) return [];
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] ?? m[2]);
  return out;
}

// Para el renderer: quita RegExp y deja solo lo que necesita la interfaz
function publicGames() {
  return GAMES.map(g => ({
    ...g,
    cover: findCover(g.id),
    variants: g.variants.map(({ asset, exe, ...v }) => ({ ...v, import: v.import && { ...v.import } }))
  }));
}

// La instalación guardada puede quedar obsoleta si el usuario borra la carpeta
function installOf(g, v) {
  const i = cfg.installs[keyOf(g, v)];
  if (i && !fs.existsSync(i.exe)) { delete cfg.installs[keyOf(g, v)]; saveCfg(); return null; }
  return i || null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 768, minWidth: 1024, minHeight: 600,
    fullscreen: cfg.settings.launcherFullscreen,
    backgroundColor: '#04060c', autoHideMenuBar: true, title: 'Hyrule Chronicles',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  cfg = loadCfg();
  fs.mkdirSync(coversDir(), { recursive: true });
  fs.mkdirSync(portsDir(), { recursive: true });
  try {
    emu = await emuserver.start({
      cacheDir: userDir('emulatorjs'),
      playerDir: path.join(__dirname, 'renderer', 'player'),
      getRom: gameId => {
        const g = GAMES.find(x => x.id === gameId);
        const v = g?.variants.find(x => x.type === 'emu');
        return v ? romFor(gameId, v) : null;
      },
      onFile: rel => emuEvents.emit('file', rel)
    });
  } catch (err) {
    emu = { error: err.code === 'EADDRINUSE' ? `El puerto ${emuserver.PORT} está ocupado.` : err.message };
  }
  createWindow();
  watchCovers();
  setupUpdater();
});

// Recarga las portadas en cuanto se añade o cambia una imagen
function watchCovers() {
  let t;
  try {
    fs.watch(coversDir(), () => {
      clearTimeout(t);
      t = setTimeout(() => win?.webContents.send('covers:changed'), 400);
    });
  } catch { /* sin vigilancia: se recargan al cerrar Configurar */ }
}

app.on('window-all-closed', () => app.quit());

// ---------- Estado / configuración ----------

function stateForRenderer() {
  const installs = {};
  for (const g of GAMES) for (const v of g.variants) {
    if (v.type === 'port') { const i = installOf(g.id, v.id); if (i) installs[keyOf(g.id, v.id)] = i; }
  }
  const seeds = {};
  for (const [gid, list] of Object.entries(cfg.seeds || {})) seeds[gid] = list.filter(s => fs.existsSync(s.file));
  return { ...cfg, installs, seeds };
}

ipcMain.handle('config:get', () => ({
  games: publicGames(), cfg: stateForRenderer(),
  app: { version: app.getVersion(), packaged: app.isPackaged, update: updateState }
}));

ipcMain.handle('config:set', (_e, patch) => {
  for (const k of ['settings', 'paths', 'selectedVariant', 'lastIndex']) {
    if (patch && k in patch) cfg[k] = patch[k];
  }
  saveCfg();
  return true;
});

ipcMain.handle('dialog:pick', async (_e, { title, extensions }) => {
  const filters = extensions?.length
    ? [{ name: 'Archivos compatibles', extensions }, { name: 'Todos', extensions: ['*'] }]
    : [{ name: 'Todos', extensions: ['*'] }];
  const r = await dialog.showOpenDialog(win, { title, filters, properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:open', (_e, url) => {
  if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url);
});
ipcMain.handle('covers:open', () => shell.openPath(coversDir()));
ipcMain.handle('window:fullscreen', () => {
  const v = !win.isFullScreen();
  win.setFullScreen(v);
  cfg.settings.launcherFullscreen = v;
  saveCfg();
  return v;
});
ipcMain.handle('app:quit', () => app.quit());

// ---------- Gestor de ports ----------

const busy = new Set();

async function installPort(gameId, variantId, onProgress) {
  const { v } = find(gameId, variantId);
  if (v?.type !== 'port') throw new Error('No es un port descargable.');
  const key = keyOf(gameId, variantId);
  if (busy.has(key)) throw new Error('Ya se está instalando.');
  busy.add(key);
  try {
    const dir = cfg.installs[key]?.dir || path.join(portsDir(), `${gameId}-${variantId}`);
    const info = await ports.install(v, dir, onProgress);
    cfg.installs[key] = info;   // el dump importado sigue en la carpeta (se descomprime encima)
    saveCfg();
    return info;
  } finally {
    busy.delete(key);
  }
}

ipcMain.handle('port:install', async (_e, gameId, variantId) => {
  try {
    const key = keyOf(gameId, variantId);
    const info = await installPort(gameId, variantId, p => win.webContents.send('port:progress', { key, ...p }));
    return { ok: true, info };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('port:check', async (_e, gameId, variantId) => {
  const { v } = find(gameId, variantId);
  try {
    return { ok: true, ...(await ports.checkUpdate(v, installOf(gameId, variantId))) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('port:uninstall', (_e, gameId, variantId) => {
  const key = keyOf(gameId, variantId);
  const i = cfg.installs[key];
  if (i?.dir && i.dir.startsWith(portsDir())) fs.rmSync(i.dir, { recursive: true, force: true });
  delete cfg.installs[key];
  if (cfg.paths[gameId]?.[variantId]) delete cfg.paths[gameId][variantId].dump;
  saveCfg();
  return { ok: true };
});

ipcMain.handle('port:openDir', (_e, gameId, variantId) => {
  const i = installOf(gameId, variantId);
  const exe = i?.exe || cfg.paths[gameId]?.[variantId]?.exe;
  if (exe) shell.openPath(path.dirname(exe));
});

// Importa el dump: verifica, copia junto al .exe y ejecuta el paso posterior si lo hay
ipcMain.handle('dump:import', async (_e, gameId, variantId, file) => {
  const { v } = find(gameId, variantId);
  if (!v?.import || v.import.mode !== 'copy-rom') return { ok: false, error: 'Este port pide el dump por su cuenta.' };
  const exe = v.type === 'port' ? installOf(gameId, variantId)?.exe : cfg.paths[gameId]?.[variantId]?.exe;
  if (!exe) return { ok: false, error: v.type === 'port' ? 'Primero instala el port.' : 'Primero elige el ejecutable.' };

  try {
    const r = await ports.importDump(v, exe, file);
    if (!r.ok) return r;

    let post = null;
    if (v.import.post?.run) {
      const bat = path.join(path.dirname(exe), v.import.post.run);
      if (!fs.existsSync(bat)) {
        post = { ok: false, error: `No encontré ${v.import.post.run} junto al ejecutable.` };
      } else {
        try {
          await ports.run('cmd.exe', ['/c', bat], { cwd: path.dirname(exe) });
          post = { ok: true };
        } catch (err) {
          post = { ok: false, error: `${v.import.post.run} falló: ${err.message.slice(0, 300)}` };
        }
      }
    }

    pathsOf(gameId, variantId).dump = {
      file: r.target, verified: r.verified, detail: r.detail, at: Date.now(),
      ready: !post || post.ok
    };
    saveCfg();
    return { ok: true, ...r, post };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------- Jugar ----------

function finishSession(gameId, t0) {
  const seconds = Math.round((Date.now() - t0) / 1000);
  const s = (cfg.stats[gameId] ||= { playtime: 0, lastPlayed: 0 });
  s.playtime += seconds;
  s.lastPlayed = Date.now();
  saveCfg();
  running = null;
  if (win && !win.isDestroyed()) {
    win.show();
    win.restore();
    win.focus();
    win.webContents.send('game:exited', { gameId, seconds, stats: cfg.stats });
  }
}

function launchEmu(game, v) {
  if (!emu?.origin) return { ok: false, error: `El emulador integrado no pudo iniciarse: ${emu?.error || 'desconocido'}` };
  const rom = romFor(game.id, v);
  if (!rom || !fs.existsSync(rom)) {
    return { ok: false, error: v.seedRom ? 'Genera o importa una seed en Configurar.' : 'Importa tu dump en Configurar.' };
  }
  const seed = v.seedRom ? activeSeed(game.id) : null;

  const q = new URLSearchParams({
    id: game.id, core: v.core, color: game.theme[0], title: game.title, sk: seed ? seed.id : 'main',
    rom: `/rom/${game.id}/${encodeURIComponent(path.basename(rom))}`
  });
  const player = new BrowserWindow({
    width: 1280, height: 720, fullscreen: cfg.settings.emuFullscreen,
    backgroundColor: '#000', autoHideMenuBar: true, title: game.title,
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'player', 'player-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  player.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  player.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(emu.origin)) e.preventDefault(); });
  player.loadURL(`${emu.origin}/player.html?${q}`);

  const t0 = Date.now();
  running = { gameId: game.id };
  win.hide();
  player.once('closed', () => finishSession(game.id, t0));
  return { ok: true };
}

// ---------- Puente del reproductor: salir, pantalla completa y guardados en disco ----------
const savesDir = id => userDir('saves', id);
const validGame = id => typeof id === 'string' && GAMES.some(g => g.id === id);
const validSk = sk => sk === undefined || sk === 'main' || (typeof sk === 'string' && /^[a-z0-9-]{1,40}$/.test(sk));
// Cada seed del randomizer tiene sus propias partidas
const saveFile = (id, kind, sk) => path.join(savesDir(id), sk && sk !== 'main' ? sk : '', kind === 'state' ? 'quicksave.state' : 'game.sav');

ipcMain.on('player:exit', e => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.handle('player:fullscreen', e => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  w.setFullScreen(!w.isFullScreen());
  cfg.settings.emuFullscreen = w.isFullScreen();
  saveCfg();
});
ipcMain.handle('player:save', (_e, id, kind, data, sk) => {
  if (!validGame(id) || !validSk(sk) || !['sram', 'state'].includes(kind) || !(data instanceof Uint8Array)) return false;
  const f = saveFile(id, kind, sk);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', data);
  fs.renameSync(f + '.tmp', f);
  return true;
});
ipcMain.handle('player:load', (_e, id, kind, sk) => {
  if (!validGame(id) || !validSk(sk) || !['sram', 'state'].includes(kind)) return null;
  const f = saveFile(id, kind, sk);
  return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null;
});
ipcMain.handle('player:stateInfo', (_e, id, sk) => {
  if (!validGame(id) || !validSk(sk)) return null;
  const f = saveFile(id, 'state', sk);
  return fs.existsSync(f) ? fs.statSync(f).mtimeMs : null;
});

async function launchProcess(game, v, exe, args) {
  let child;
  try {
    child = spawn(exe, args, { cwd: path.dirname(exe), stdio: 'ignore', windowsHide: false });
  } catch (err) {
    return { ok: false, error: `No se pudo iniciar: ${err.message}` };
  }
  const failed = await new Promise(resolve => {
    child.once('spawn', () => resolve(null));
    child.once('error', err => resolve(err));
  });
  if (failed) return { ok: false, error: `No se pudo iniciar: ${failed.message}` };

  const t0 = Date.now();
  running = { gameId: game.id };
  if (cfg.settings.minimizeOnLaunch) win.minimize();
  child.once('exit', () => finishSession(game.id, t0));
  return { ok: true };
}

ipcMain.handle('game:launch', async (_e, gameId, variantId) => {
  if (running) return { ok: false, error: 'Ya hay un juego en ejecución.' };
  const { game, v } = find(gameId, variantId);
  if (!v) return { ok: false, error: 'Versión desconocida.' };
  const p = cfg.paths[gameId]?.[variantId] || {};

  if (v.type === 'emu') return launchEmu(game, v);

  let exe;
  let args = [];
  if (v.type === 'port') {
    exe = installOf(gameId, variantId)?.exe;
    if (!exe) return { ok: false, error: 'Instala el port en Configurar.' };
  } else {
    exe = p.exe;
    if (!exe || !fs.existsSync(exe)) return { ok: false, error: 'Selecciona el ejecutable en Configurar.' };
    const rom = romFor(gameId, v);
    if (v.seedRom && (!rom || !fs.existsSync(rom))) return { ok: false, error: 'Genera o importa una seed en Configurar.' };
    if (v.needsRom && (!rom || !fs.existsSync(rom))) return { ok: false, error: 'Selecciona el archivo del juego en Configurar.' };
    args = (v.args || []).map(a => a.replace('{rom}', rom || ''));
  }
  if (v.import?.mode === 'copy-rom' && !p.dump?.ready) return { ok: false, error: 'Importa tu dump en Configurar.' };
  args.push(...splitArgs(p.extraArgs));
  return launchProcess(game, v, exe, args);
});

// ---------- Dependencias: descargar todo de una vez ----------

const CORE_LABEL = { nes: 'NES', snes: 'Super Nintendo', gb: 'Game Boy / Color', gba: 'Game Boy Advance', n64: 'Nintendo 64' };

function depsList() {
  const items = [];
  for (const g of GAMES) for (const v of g.variants) {
    if (v.type !== 'port') continue;
    const i = installOf(g.id, v.id);
    items.push({ key: `port:${g.id}:${v.id}`, kind: 'port', gameId: g.id, variantId: v.id, name: v.name, game: g.title, repo: v.repo, installed: i ? i.tag : null });
  }
  const cores = new Map();
  for (const g of GAMES) for (const v of g.variants) {
    if (v.type !== 'emu') continue;
    if (!cores.has(v.core)) cores.set(v.core, []);
    cores.get(v.core).push(g.title);
  }
  for (const [core, titles] of cores) {
    items.push({ key: `core:${core}`, kind: 'core', core, name: `Núcleo ${CORE_LABEL[core] || core}`, game: titles.join(' · '), installed: cfg.emuCores?.[core] ? 'en caché' : null });
  }
  const manual = [];
  for (const g of GAMES) for (const v of g.variants) if (v.type === 'manual') manual.push(`${v.name.split(' · ')[0]} (${g.title})`);
  return { items, manual };
}

// Abre el reproductor en una ventana oculta para que EmulatorJS descargue
// su núcleo a través del servidor local, que lo deja en caché.
function warmCore(core) {
  return new Promise((resolve, reject) => {
    if (!emu?.origin) return reject(new Error(`Emulador no disponible: ${emu?.error || ''}`));
    const w = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    let done = false;
    let settle;
    const finish = err => {
      if (done) return;
      done = true;
      clearTimeout(timeout); clearTimeout(settle);
      emuEvents.off('file', onFile);
      if (!w.isDestroyed()) w.destroy();
      err ? reject(err) : resolve();
    };
    const onFile = rel => {
      if (/^cores\/.+\.data$/i.test(rel)) { clearTimeout(settle); settle = setTimeout(() => finish(), 2000); }
    };
    emuEvents.on('file', onFile);
    const timeout = setTimeout(() => finish(new Error('No se pudo confirmar la descarga; se completará al jugar.')), 240000);
    const q = new URLSearchParams({ warmup: '1', id: `warmup-${core}`, core, rom: '/rom/warmup/none.bin' });
    w.loadURL(`${emu.origin}/player.html?${q}`);
  });
}

let depsRunning = false;
ipcMain.handle('deps:list', () => depsList());

ipcMain.handle('deps:run', async (_e, { updates = false } = {}) => {
  if (depsRunning) return { ok: false, error: 'Ya se están descargando las dependencias.' };
  depsRunning = true;
  const send = d => win.webContents.send('deps:progress', d);
  const { items } = depsList();
  const summary = { done: 0, skipped: 0, failed: 0 };
  try {
    for (let n = 0; n < items.length; n++) {
      const it = items[n];
      const base = { key: it.key, index: n, count: items.length };
      try {
        if (it.kind === 'port') {
          const { v } = find(it.gameId, it.variantId);
          const inst = installOf(it.gameId, it.variantId);
          if (inst) {
            if (!updates) { summary.skipped++; send({ ...base, state: 'done', text: `Instalado · ${inst.tag}` }); continue; }
            send({ ...base, state: 'working', text: 'Buscando actualización…' });
            const chk = await ports.checkUpdate(v, inst);
            if (!chk.hasUpdate) { summary.skipped++; send({ ...base, state: 'done', text: `Al día · ${inst.tag}` }); continue; }
          }
          send({ ...base, state: 'working', text: 'Consultando GitHub…' });
          const info = await installPort(it.gameId, it.variantId, p => send({ ...base, state: 'working', ...p }));
          summary.done++;
          send({ ...base, state: 'done', text: `Instalado · ${info.tag}` });
        } else {
          if (cfg.emuCores?.[it.core] && !updates) { summary.skipped++; send({ ...base, state: 'done', text: 'En caché' }); continue; }
          send({ ...base, state: 'working', text: 'Descargando núcleo…' });
          await warmCore(it.core);
          (cfg.emuCores ||= {})[it.core] = Date.now();
          saveCfg();
          summary.done++;
          send({ ...base, state: 'done', text: 'En caché' });
        }
      } catch (err) {
        summary.failed++;
        send({ ...base, state: 'error', text: err.message });
      }
    }
  } finally {
    depsRunning = false;
  }
  return { ok: true, summary };
});

// ---------- Randomizer: generador web oficial dentro del launcher ----------

const ROM_EXT = /\.(z64|n64|v64)$/i;
const seedsDir = gid => userDir('randomizer', gid);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const randoGame = gid => GAMES.find(g => g.id === gid && g.randomizer);

function sendSeeds(gid, message) {
  const list = (cfg.seeds[gid] || []).filter(s => fs.existsSync(s.file));
  win?.webContents.send('rando:changed', { gameId: gid, seeds: list, active: cfg.activeSeed[gid] || null, message });
}

function addSeed(gid, file, name) {
  const seed = { id: newId(), file, name: name || path.basename(file), at: Date.now(), extras: [] };
  (cfg.seeds[gid] ||= []).unshift(seed);
  cfg.activeSeed[gid] = seed.id;
  saveCfg();
  return seed;
}

const generators = new Map();
ipcMain.handle('rando:open', (_e, gid) => {
  const g = randoGame(gid);
  if (!g) return { ok: false };
  if (generators.has(gid)) { generators.get(gid).focus(); return { ok: true }; }

  const gen = new BrowserWindow({
    width: 1280, height: 860, parent: win, autoHideMenuBar: true, backgroundColor: '#111',
    title: `Generador · ${g.title}`,
    webPreferences: { partition: `persist:rando-${gid}`, contextIsolation: true, sandbox: true }
  });
  generators.set(gid, gen);
  gen.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Todo lo que descargue el generador va a la carpeta de seeds de este juego
  const ses = gen.webContents.session;
  const onDownload = (_ev, item) => {
    const dir = seedsDir(gid);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const fname = `${stamp}_${item.getFilename()}`.replace(/[<>:"/\\|?*]/g, '_');
    const target = path.join(dir, fname);
    item.setSavePath(target);
    item.once('done', (_e2, state) => {
      if (state !== 'completed') return;
      if (ROM_EXT.test(target)) {
        const seed = addSeed(gid, target, item.getFilename());
        sendSeeds(gid, `Nueva seed lista: ${seed.name}`);
      } else {
        const last = (cfg.seeds[gid] || [])[0];
        if (last) { last.extras.push(target); saveCfg(); }
        sendSeeds(gid, `Guardado: ${item.getFilename()}`);
      }
    });
  };
  ses.on('will-download', onDownload);
  gen.once('closed', () => { ses.off('will-download', onDownload); generators.delete(gid); });
  gen.loadURL(g.randomizer.site);
  return { ok: true };
});

ipcMain.handle('rando:import', (_e, gid, file) => {
  if (!randoGame(gid) || !file || !fs.existsSync(file)) return { ok: false, error: 'Archivo no válido.' };
  if (!ROM_EXT.test(file)) return { ok: false, error: 'La seed debe ser una ROM .z64, .n64 o .v64.' };
  const dir = seedsDir(gid);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${newId()}_${path.basename(file)}`);
  fs.copyFileSync(file, target);
  addSeed(gid, target, path.basename(file));
  sendSeeds(gid, 'Seed importada');
  return { ok: true };
});

ipcMain.handle('rando:select', (_e, gid, id) => {
  if (!(cfg.seeds[gid] || []).some(s => s.id === id)) return false;
  cfg.activeSeed[gid] = id; saveCfg(); sendSeeds(gid);
  return true;
});

ipcMain.handle('rando:delete', (_e, gid, id) => {
  const list = cfg.seeds[gid] || [];
  const s = list.find(x => x.id === id);
  if (!s) return false;
  for (const f of [s.file, ...(s.extras || [])]) {
    if (f.startsWith(seedsDir(gid))) fs.rmSync(f, { force: true });
  }
  fs.rmSync(path.join(savesDir(gid), id), { recursive: true, force: true });
  cfg.seeds[gid] = list.filter(x => x.id !== id);
  if (cfg.activeSeed[gid] === id) cfg.activeSeed[gid] = cfg.seeds[gid][0]?.id || null;
  saveCfg(); sendSeeds(gid);
  return true;
});

ipcMain.handle('rando:openDir', (_e, gid) => {
  if (!randoGame(gid)) return;
  fs.mkdirSync(seedsDir(gid), { recursive: true });
  shell.openPath(seedsDir(gid));
});

// ---------- Actualizaciones automáticas (GitHub Releases) ----------

let updateState = { status: 'idle' };
let autoUpdater = null;

function setUpdate(s) {
  updateState = s;
  win?.webContents.send('update:status', s);
}

function setupUpdater() {
  if (!app.isPackaged) { updateState = { status: 'dev' }; return; }
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    updateState = { status: 'unavailable' };
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => setUpdate({ status: 'checking' }));
  autoUpdater.on('update-not-available', () => setUpdate({ status: 'latest' }));
  autoUpdater.on('update-available', i => setUpdate({ status: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', p => setUpdate({ ...updateState, status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', i => setUpdate({ status: 'ready', version: i.version }));
  autoUpdater.on('error', err => setUpdate({ status: 'error', error: String(err?.message || err).split('\n')[0] }));
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
}

ipcMain.handle('update:check', () => {
  if (!autoUpdater) return updateState;
  autoUpdater.checkForUpdates().catch(() => {});
  return { status: 'checking' };
});
ipcMain.handle('update:install', () => {
  if (updateState.status === 'ready') autoUpdater?.quitAndInstall();
});
