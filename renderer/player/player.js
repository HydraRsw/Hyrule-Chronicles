'use strict';
// Reproductor del emulador integrado (EmulatorJS) con menú de pausa propio.
// Las partidas (SRAM) y el guardado rápido se escriben en disco a través del launcher.

// Todo va dentro de una función para no crear variables globales que choquen con EmulatorJS.
(() => {

// ---------- Diagnóstico: errores visibles en pantalla ----------
// (También quedan en el registro del launcher; F12 abre la consola.)
function showError(msg) {
  let el = document.getElementById('err');
  if (!el) {
    el = document.createElement('pre');
    el.id = 'err';
    el.style.cssText = 'position:fixed;left:20px;right:20px;bottom:20px;z-index:10002;max-height:40vh;overflow:auto;' +
      'margin:0;padding:12px 14px;background:rgba(40,4,4,.92);color:#ffd9d2;border:1px solid #e06a5a;border-radius:4px;' +
      'font:12px Consolas,monospace;white-space:pre-wrap';
    document.body.appendChild(el);
  }
  el.textContent += msg + '\n';
  console.error('[HC] ' + msg);
}
addEventListener('error', e => {
  if (e.target && e.target !== window) {
    const url = e.target.src || e.target.href;
    if (url) showError(`No se pudo cargar: ${url}`);
    return;
  }
  showError(`Error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`);
}, true);
addEventListener('unhandledrejection', e => showError(`Error: ${e.reason?.stack || e.reason?.message || e.reason}`));


const q = new URLSearchParams(location.search);
const GAME = q.get('id');
const SK = q.get('sk') || 'main';  // seed del randomizer: partidas separadas por seed
const WARMUP = q.has('warmup');      // ventana oculta que solo descarga el núcleo
const $ = s => document.querySelector(s);
const hc = window.hc || null;        // puente con el launcher (no existe en la ventana de precarga)

if (WARMUP) { window.alert = () => {}; window.confirm = () => false; }
if (q.get('color')) document.documentElement.style.setProperty('--accent', q.get('color'));
if (q.get('title')) $('#m-title').textContent = q.get('title');

window.EJS_player = '#game';
window.EJS_core = q.get('core');
window.EJS_gameUrl = q.get('rom');
window.EJS_gameName = SK === 'main' ? GAME : `${GAME}-${SK}`;
window.EJS_pathtodata = '/data/';
window.EJS_startOnLoaded = true;
window.EJS_color = q.get('color') || '#e9cf8a';
window.EJS_backgroundColor = '#000000';

const loader = document.createElement('script');
loader.src = '/data/loader.js';
loader.onerror = () => {
  $('#game').innerHTML = '<p style="color:#eee;text-align:center;margin-top:40vh">No se pudo cargar el emulador.<br>' +
    'La primera vez necesita conexión a internet para descargar el núcleo.</p>';
};
document.body.appendChild(loader);

if (WARMUP) $('#hint').remove();
else setTimeout(() => $('#hint').classList.add('hide'), 6000);

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Acceso seguro a EmulatorJS ----------
const emu = () => window.EJS_emulator;
const gm = () => window.EJS_emulator?.gameManager;
const tryCall = fn => { try { return fn(); } catch (e) { console.warn(e); return undefined; } };

function pauseEmu() { tryCall(() => emu()?.pause?.(true)); }
function playEmu() { tryCall(() => emu()?.play?.(true)); }

// ---------- Partidas (SRAM) en disco ----------
async function saveSram() {
  if (!hc || !gm()) return;
  const data = tryCall(() => gm().getSaveFile?.());
  if (data && data.length) await hc.saveSram(GAME, data, SK);
}

async function restoreSram() {
  if (!hc || !gm()) return;
  const data = await hc.loadSram(GAME, SK);
  if (!data) return;
  tryCall(() => {
    const path = gm().getSaveFilePath();
    const FS = gm().FS || emu().Module?.FS;
    FS.writeFile(path, new Uint8Array(data));
    gm().loadSaveFiles();
  });
}

let started = false;
window.EJS_onGameStart = async () => {
  started = true;
  if (WARMUP) return;
  await restoreSram();
  setInterval(saveSram, 20000);       // autoguardado de la partida
  tryCall(() => emu().on?.('exit', () => exitToLauncher(false)));
  refreshStateInfo();
};

// Si EmulatorJS se cierra por su cuenta (botón "Exit" de su barra), volver al launcher.
new MutationObserver(() => {
  if (WARMUP || leaving) return;
  if (/has exited/i.test(document.body.innerText || '')) exitToLauncher(false);
}).observe(document.body, { childList: true, subtree: true, characterData: true });

let leaving = false;
async function exitToLauncher(save = true) {
  if (leaving) return;
  leaving = true;
  if (save) await Promise.race([saveSram(), new Promise(r => setTimeout(r, 1500))]);
  if (hc) hc.exit(); else window.close();
}

// ---------- Menú de pausa ----------
const menu = $('#menu');
const items = () => [...menu.querySelectorAll('button:not(:disabled)')];
let sel = 0;
let menuOpen = false;

function highlight() {
  const list = items();
  sel = (sel + list.length) % list.length;
  list.forEach((b, i) => b.classList.toggle('sel', i === sel));
}

async function refreshStateInfo() {
  if (!hc) return;
  const info = await hc.stateInfo(GAME, SK);
  const btn = menu.querySelector('[data-act="load"]');
  btn.disabled = !info;
  $('#m-loadinfo').textContent = info
    ? `Guardado el ${new Date(info).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
    : 'Sin guardado rápido';
}

function openMenu() {
  if (menuOpen || WARMUP || leaving) return;
  menuOpen = true;
  pauseEmu();
  menu.classList.add('open');
  menu.querySelector('[data-act="save"]').disabled = !started;
  menu.querySelector('[data-act="restart"]').disabled = !started;
  sel = 0;
  refreshStateInfo().then(highlight);
  highlight();
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menu.classList.remove('open');
  // pequeña espera para que la tecla/botón de aceptar no llegue al juego
  setTimeout(playEmu, 200);
}

async function act(name) {
  switch (name) {
    case 'resume': closeMenu(); break;
    case 'save': {
      const st = tryCall(() => gm().getState());
      if (!st) { toast('No se pudo guardar el estado.'); break; }
      await hc?.saveState(GAME, st, SK);
      await saveSram();
      await refreshStateInfo();
      toast('Estado guardado');
      closeMenu();
      break;
    }
    case 'load': {
      const st = await hc?.loadState(GAME, SK);
      if (!st) { toast('No hay guardado rápido.'); break; }
      tryCall(() => gm().loadState(new Uint8Array(st)));
      toast('Estado cargado');
      closeMenu();
      break;
    }
    case 'restart':
      await saveSram();
      tryCall(() => gm().restart());
      toast('Juego reiniciado');
      closeMenu();
      break;
    case 'fullscreen': hc?.toggleFullscreen(); break;
    case 'exit': exitToLauncher(true); break;
  }
}

menu.querySelectorAll('button').forEach(b => {
  b.addEventListener('click', () => act(b.dataset.act));
  b.addEventListener('mouseenter', () => { sel = items().indexOf(b); highlight(); });
});

// Teclado: capturamos antes que EmulatorJS
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopImmediatePropagation();
    menuOpen ? closeMenu() : openMenu();
    return;
  }
  if (!menuOpen) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.key === 'ArrowUp') { sel--; highlight(); }
  else if (e.key === 'ArrowDown') { sel++; highlight(); }
  else if (e.key === 'Enter' || e.key === ' ') items()[sel]?.click();
  else if (e.key === 'Backspace') closeMenu();
}, true);
addEventListener('keyup', e => { if (menuOpen || e.key === 'Escape') { e.stopImmediatePropagation(); } }, true);

// Mando: mantener SELECT + START abre el menú; dentro, cruceta + A / B
let heldSince = 0;
let prev = {};
let repeatAt = 0;
(function poll() {
  const gp = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (gp && !WARMUP) {
    const b = n => !!gp.buttons[n]?.pressed;
    const now = performance.now();
    if (!menuOpen) {
      if (b(8) && b(9)) {
        heldSince ||= now;
        const k = Math.min(1, (now - heldSince) / 600);
        $('#bar').style.width = `${k * 100}%`;
        if (k >= 1) { heldSince = 0; $('#bar').style.width = '0'; openMenu(); }
      } else if (heldSince) { heldSince = 0; $('#bar').style.width = '0'; }
    } else {
      const st = {
        up: b(12) || (gp.axes[1] || 0) < -.55, down: b(13) || (gp.axes[1] || 0) > .55,
        a: b(0), b: b(1), start: b(9)
      };
      const dir = st.up ? -1 : st.down ? 1 : 0;
      if (dir && (!prev.up && !prev.down || now > repeatAt)) {
        sel += dir; highlight(); repeatAt = now + (prev.up || prev.down ? 120 : 380);
      }
      if (st.a && !prev.a) items()[sel]?.click();
      if ((st.b && !prev.b) || (st.start && !prev.start)) closeMenu();
      prev = st;
    }
    if (!menuOpen) prev = { a: b(0), b: b(1), start: b(9) };
  }
  requestAnimationFrame(poll);
})();

// Vigilante: si en 20 s EmulatorJS no ha montado su interfaz, avisar en pantalla
if (!WARMUP) {
  setTimeout(() => {
    if (started || document.querySelector('#game canvas, #game .ejs_parent')) return;
    showError('El emulador no arrancó después de 20 s. Pulsa F12 para ver la consola, o pásale a Claude el archivo de registro ' +
      '(Ajustes › Registro del emulador).');
  }, 20000);
}
})();
