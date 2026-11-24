'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let GAMES = [];
let CFG = null;
let idx = 0;
let mode = 'title'; // title | menu | modal | running
let modalOnClose = null;
let accentRGB = '224,178,58';

// ---------------- Sonido (sintetizado, sin archivos externos) ----------------
const sfx = (() => {
  let ctx;
  const tones = {
    move:   { f: 880, d: .05, t: 'sine', v: .05 },
    select: { f: 660, d: .2, t: 'triangle', v: .08, up: 2 },
    back:   { f: 440, d: .12, t: 'sine', v: .06, up: .5 },
    error:  { f: 170, d: .22, t: 'square', v: .03 },
    start:  { f: 392, d: .7, t: 'triangle', v: .09, up: 2 }
  };
  return type => {
    if (!CFG?.settings.sound) return;
    try {
      ctx ||= new AudioContext();
      const p = tones[type]; const t = ctx.currentTime;
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = p.t; o.frequency.setValueAtTime(p.f, t);
      if (p.up) o.frequency.exponentialRampToValueAtTime(p.f * p.up, t + p.d);
      g.gain.setValueAtTime(p.v, t);
      g.gain.exponentialRampToValueAtTime(.0001, t + p.d);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + p.d + .02);
    } catch { /* sin audio */ }
  };
})();

// ---------------- Utilidades de estado ----------------
const cur = () => GAMES[idx];
const pathsOf = (gid, vid) => ((CFG.paths[gid] ||= {})[vid] ||= {});
const curVariant = (g = cur()) => g.variants.find(v => v.id === CFG.selectedVariant[g.id]) || g.variants[0];

const keyOf = (g, v) => `${g}:${v}`;
const installOf = (g, v) => CFG.installs?.[keyOf(g.id, v.id)] || null;

function activeSeedOf(g) {
  const list = CFG.seeds?.[g.id] || [];
  return list.find(s => s.id === CFG.activeSeed?.[g.id]) || null;
}

function missing(g, v) {
  const p = CFG.paths[g.id]?.[v.id] || {};
  const m = [];
  if (v.seedRom) { if (!activeSeedOf(g)) m.push('generar una seed'); }
  else if (v.type === 'emu' && !p.rom) m.push('tu dump');
  if (v.type === 'port' && !installOf(g, v)) m.push('instalar el port');
  if (v.type === 'manual' && !p.exe) m.push('ejecutable');
  if (v.needsRom && !p.rom) m.push('archivo del juego');
  if (v.import?.mode === 'copy-rom' && !p.dump?.ready && !m.includes('instalar el port')) m.push('importar tu dump');
  return m;
}

const isReady = g => g.variants.some(v => missing(g, v).length === 0);

function fmtTime(sec) {
  if (!sec) return '0 min';
  const h = Math.floor(sec / 3600); const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
function fmtDate(ms) {
  if (!ms) return 'Nunca';
  return new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}
function hexToRGB(h) {
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

const save = () => api.setConfig({
  settings: CFG.settings, paths: CFG.paths, selectedVariant: CFG.selectedVariant, lastIndex: idx
});

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, error ? 4500 : 2800);
}

// ---------------- Render ----------------
function buildList() {
  $('#list').innerHTML = GAMES.map((g, i) => `
    <button class="item" data-i="${i}" tabindex="-1">
      <span class="yr">${g.randomizer ? '✦' : esc(g.era.match(/\d{4}/)?.[0] || '')}</span>
      <span class="nm">${esc(g.short || g.title)}</span>
      <span class="dot ${isReady(g) ? 'ok' : ''}"></span>
    </button>`).join('');
  $('#list').querySelectorAll('.item').forEach(el => {
    el.addEventListener('mouseenter', () => mode === 'menu' && select(+el.dataset.i));
    el.addEventListener('click', () => { select(+el.dataset.i); play(); });
  });
}

function select(i, animate = true) {
  i = (i + GAMES.length) % GAMES.length;
  const changed = i !== idx;
  idx = i;
  const g = cur();

  document.querySelectorAll('.item').forEach((el, k) => el.classList.toggle('sel', k === idx));

  const root = document.documentElement.style;
  root.setProperty('--accent', g.theme[0]);
  root.setProperty('--accent-deep', g.theme[1]);
  accentRGB = hexToRGB(g.theme[0]);

  showCover(g, changed);

  $('#d-era').textContent = g.era;
  $('#d-title').textContent = g.title;
  $('#d-desc').textContent = g.desc;
  renderVariant();

  const s = CFG.stats[g.id] || {};
  $('#d-play').textContent = `Tiempo de juego: ${fmtTime(s.playtime)}`;
  $('#d-last').textContent = `Última sesión: ${fmtDate(s.lastPlayed)}`;

  if (animate && changed) {
    const d = $('#detail');
    d.classList.remove('swap'); void d.offsetWidth; d.classList.add('swap');
  }
}

// Portada: vertical (carátula) -> nítida en el panel y difuminada de fondo;
// horizontal (arte o captura) -> fondo nítido.
let coverToken = 0;
function showCover(g, changed) {
  const art = $('#bgart');
  const box = $('#d-box');
  const token = ++coverToken;
  art.classList.remove('show');
  if (!g.cover) {
    box.hidden = true; $('#detail').classList.remove('has-box');
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (token !== coverToken) return;
    const portrait = img.naturalHeight >= img.naturalWidth * 0.9;
    setTimeout(() => {
      if (token !== coverToken) return;
      art.style.backgroundImage = `url("${g.cover}")`;
      art.classList.toggle('blur', portrait);
      art.classList.add('show');
    }, changed ? 200 : 0);
    box.hidden = !portrait;
    if (portrait) box.src = g.cover;
    $('#detail').classList.toggle('has-box', portrait);
  };
  img.onerror = () => { if (token === coverToken) { box.hidden = true; $('#detail').classList.remove('has-box'); } };
  img.src = g.cover;
}

function renderVariant() {
  const g = cur(); const v = curVariant(g);
  const n = g.variants.length; const k = g.variants.indexOf(v);
  $('#v-name').textContent = v.name;
  $('#v-prev').disabled = n < 2;
  $('#v-next').disabled = n < 2;
  $('#v-dots').innerHTML = n > 1 ? g.variants.map((_, j) => `<i class="${j === k ? 'on' : ''}"></i>`).join('') : '';
  const m = missing(g, v);
  const st = $('#v-status');
  if (m.length) { st.className = 'warn'; st.textContent = `Falta configurar: ${m.join(', ')}`; }
  else {
    st.className = 'ok';
    const first = v.type === 'port' && v.import?.mode === 'guided' && !(CFG.stats[g.id]?.playtime);
    st.textContent = first ? '✓ Instalado · la primera vez el juego te pedirá tu dump' : '✓ Listo para jugar';
  }
}

function cycleVariant(dir) {
  const g = cur(); if (g.variants.length < 2) return;
  const k = g.variants.indexOf(curVariant(g));
  CFG.selectedVariant[g.id] = g.variants[(k + dir + g.variants.length) % g.variants.length].id;
  sfx('move'); renderVariant(); save();
}

// ---------------- Jugar ----------------
async function play() {
  const g = cur(); const v = curVariant(g);
  const m = missing(g, v);
  if (m.length) {
    sfx('error');
    toast(`Falta: ${m.join(', ')}`, true);
    openGameConfig();
    return;
  }
  sfx('start');
  mode = 'running';
  $('#running').hidden = false;
  $('#running-title').textContent = g.title;
  $('#running-sub').textContent = 'Iniciando…';
  const r = await api.launch(g.id, v.id);
  if (!r.ok) {
    $('#running').hidden = true; mode = 'menu';
    sfx('error'); toast(r.error, true);
    return;
  }
  $('#running-sub').textContent = v.type === 'emu'
    ? 'Esc o mantén SELECT + START para abrir el menú'
    : `${v.name} · el launcher volverá al cerrar el juego`;
}

function onExit({ gameId, seconds, stats }) {
  CFG.stats = stats;
  $('#running').hidden = true;
  mode = 'menu';
  select(idx, false);
  const g = GAMES.find(x => x.id === gameId);
  if (seconds < 20) toast(`${g.title} se cerró enseguida. Si usa su propio launcher, es normal.`);
  else toast(`Sesión de ${g.title}: ${fmtTime(seconds)}`);
}

// ---------------- Modales ----------------
function openModal(html, bind, onClose) {
  const panel = $('#panel');
  panel.innerHTML = html;
  $('#modal').hidden = false;
  mode = 'modal';
  modalOnClose = onClose || null;
  bind?.(panel);
  panel.querySelector('[data-close]')?.addEventListener('click', closeModal);
}
function refocus(i) {
  const f = [...$('#panel').querySelectorAll('.focusable')];
  (f[Math.min(i, f.length - 1)] || f[0])?.focus();
}
function closeModal() {
  $('#modal').hidden = true;
  mode = 'menu';
  sfx('back');
  const cb = modalOnClose; modalOnClose = null;
  cb?.();
}
function focusIndex() {
  return [...$('#panel').querySelectorAll('.focusable')].indexOf(document.activeElement);
}

function pathRow(label, value, attrs) {
  return `<div class="row">
    <label>${esc(label)}</label>
    <div class="path ${value ? '' : 'empty'}" title="${esc(value || '')}">${value ? esc(value) : '— sin seleccionar —'}</div>
    <button class="focusable" ${attrs} data-act="pick">Examinar</button>
    ${value ? `<button class="focusable" ${attrs} data-act="clear" title="Quitar">✕</button>` : ''}
  </div>`;
}

const confirmUninstall = new Set();
const portBusy = new Set();

function dumpBlock(g, v) {
  const imp = v.import;
  if (!imp) return '';
  if (imp.mode === 'guided') {
    return `<div class="step"><span class="num">2</span><div><b>Tu dump</b><p class="note">${esc(imp.steps)}</p></div></div>`;
  }
  const d = CFG.paths[g.id]?.[v.id]?.dump;
  let status = '<span class="tag warn">Sin importar</span>';
  if (d?.ready) status = d.verified ? '<span class="tag ok">✓ Verificado</span>' : '<span class="tag ok">✓ Importado</span>';
  else if (d) status = '<span class="tag warn">Importado, falta el paso final</span>';
  return `<div class="step"><span class="num">2</span><div class="grow">
      <div class="row tight"><b>Tu dump</b>${status}
        <button class="focusable" data-import="${v.id}">${d ? 'Volver a importar' : 'Importar dump'}</button></div>
      ${d ? `<p class="note">${esc(d.detail || '')}</p>` : ''}
      <p class="note">${esc(imp.steps)}</p>
    </div></div>`;
}

function portBlock(g, v) {
  const inst = installOf(g, v);
  const key = keyOf(g.id, v.id);
  const busy = portBusy.has(key);
  let html = `<div class="step"><span class="num">1</span><div class="grow">`;
  if (busy) {
    html += `<div class="row tight"><b>Instalando…</b></div>`;
  } else if (!inst) {
    html += `<div class="row tight"><b>Port</b><span class="tag warn">No instalado</span>
      <button class="focusable primary-sm" data-install="${v.id}">Descargar e instalar</button></div>`;
  } else {
    html += `<div class="row tight"><b>Port</b><span class="tag ok">Instalado · ${esc(inst.tag)}</span>
      <button class="focusable" data-update="${v.id}">Buscar actualización</button>
      <button class="focusable" data-opendir="${v.id}">Carpeta</button>
      <button class="focusable" data-uninstall="${v.id}">${confirmUninstall.has(key) ? '¿Seguro? Pulsa otra vez' : 'Desinstalar'}</button></div>`;
  }
  html += `<div class="progress" data-prog="${key}"><div class="fill"></div><span></span></div>`;
  html += `<p class="note">Se descarga la última versión oficial desde github.com/${esc(v.repo)}.</p></div></div>`;
  return html + dumpBlock(g, v);
}

function openGameConfig(focusAt = 0) {
  const g = cur();
  let html = `<h3>Configurar · ${esc(g.title)}</h3>`;
  if (g.randomizer) html += seedsBlock(g);
  for (const v of g.variants) {
    const p = pathsOf(g.id, v.id);
    const repoUrl = v.repo ? `https://github.com/${v.repo}` : null;
    html += `<div class="block"><div class="block-head"><h4>${esc(v.name)}</h4>
      ${repoUrl ? `<button class="focusable link" data-repo="${esc(repoUrl)}">Ver proyecto ↗</button>` : ''}</div>`;

    if (v.type === 'emu' && v.seedRom) {
      html += `<p class="note">Juega la seed activa con el emulador integrado. Cada seed guarda sus propias partidas.</p>`;
    } else if (v.type === 'emu') {
      html += pathRow('Tu dump', p.rom, `data-v="${v.id}" data-f="rom"`);
      html += `<p class="note">Se juega dentro del launcher. La primera vez se descarga el núcleo del emulador; después funciona sin conexión. Las partidas se guardan solas.</p>`;
    }

    if (v.type === 'port') html += portBlock(g, v);

    if (v.type === 'manual') {
      html += pathRow('Ejecutable', p.exe, `data-v="${v.id}" data-f="exe"`);
      if (v.needsRom) html += pathRow('Archivo del juego', p.rom, `data-v="${v.id}" data-f="rom"`);
      html += `<p class="note">Busca <b>${esc(v.exeHint)}</b> en la carpeta donde lo tengas.${v.seedRom ? ' Se abrirá con la seed activa.' : ''}</p>`;
      if (v.import) html += dumpBlock(g, v);
    }

    if (v.type !== 'emu') {
      html += `<div class="row"><label>Argumentos extra</label>
        <input type="text" class="focusable" data-args="${v.id}" value="${esc(p.extraArgs || '')}" placeholder="opcional"></div>`;
    }
    html += `</div>`;
  }
  html += `<div class="block"><p class="note">Portada opcional: coloca una imagen llamada <b>${g.id}.jpg</b> (o .png / .webp) en la carpeta de portadas.</p></div>
    <div class="panel-actions">
      <button class="focusable" id="open-covers">Carpeta de portadas</button>
      <button class="focusable" data-close>Cerrar</button>
    </div>`;

  const reopen = at => { if (mode === 'modal') openGameConfig(at); };
  const varOf = id => g.variants.find(x => x.id === id);

  openModal(html, panel => {
    panel.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', async () => {
      const v = varOf(b.dataset.v);
      const field = b.dataset.f;
      const at = focusIndex();
      if (b.dataset.act === 'clear') {
        delete pathsOf(g.id, v.id)[field];
        if (field === 'exe') delete pathsOf(g.id, v.id).dump;
      } else {
        const file = await api.pickFile({
          title: field === 'exe' ? `Ejecutable · ${v.name}` : `Tu dump · ${g.title}`,
          extensions: field === 'exe' ? ['exe'] : v.romExt
        });
        if (!file) return;
        pathsOf(g.id, v.id)[field] = file;
        sfx('select');
      }
      await save();
      reopen(at);
    }));

    panel.querySelectorAll('[data-install]').forEach(b => b.addEventListener('click', async () => {
      const v = varOf(b.dataset.install);
      const key = keyOf(g.id, v.id);
      const at = focusIndex();
      portBusy.add(key); sfx('select'); reopen(at);
      const r = await api.installPort(g.id, v.id);
      portBusy.delete(key);
      if (r.ok) {
        CFG.installs[key] = r.info;
        toast(`${v.name} instalado (${r.info.tag})`);
      } else { sfx('error'); toast(r.error, true); }
      reopen(at);
    }));

    panel.querySelectorAll('[data-update]').forEach(b => b.addEventListener('click', async () => {
      const v = varOf(b.dataset.update);
      b.textContent = 'Comprobando…';
      const r = await api.checkPort(g.id, v.id);
      if (!r.ok) { toast(r.error, true); b.textContent = 'Buscar actualización'; return; }
      if (!r.hasUpdate) { toast(`Ya tienes la última versión (${r.latest}).`); b.textContent = 'Buscar actualización'; return; }
      b.removeAttribute('data-update');
      b.textContent = `Actualizar a ${r.latest}`;
      b.dataset.install = v.id;
      b.addEventListener('click', async () => {
        const key = keyOf(g.id, v.id);
        const at = focusIndex();
        portBusy.add(key); reopen(at);
        const u = await api.installPort(g.id, v.id);
        portBusy.delete(key);
        if (u.ok) { CFG.installs[key] = u.info; toast(`Actualizado a ${u.info.tag}`); } else toast(u.error, true);
        reopen(at);
      }, { once: true });
    }));

    panel.querySelectorAll('[data-opendir]').forEach(b => b.addEventListener('click', () => api.openPortDir(g.id, b.dataset.opendir)));

    panel.querySelectorAll('[data-uninstall]').forEach(b => b.addEventListener('click', async () => {
      const v = varOf(b.dataset.uninstall);
      const key = keyOf(g.id, v.id);
      const at = focusIndex();
      if (!confirmUninstall.has(key)) { confirmUninstall.add(key); sfx('error'); return reopen(at); }
      confirmUninstall.delete(key);
      await api.uninstallPort(g.id, v.id);
      delete CFG.installs[key];
      if (CFG.paths[g.id]?.[v.id]) delete CFG.paths[g.id][v.id].dump;
      sfx('back'); toast(`${v.name} desinstalado`); reopen(at);
    }));

    panel.querySelectorAll('[data-import]').forEach(b => b.addEventListener('click', async () => {
      const v = varOf(b.dataset.import);
      const at = focusIndex();
      const file = await api.pickFile({ title: `Tu dump · ${g.title}`, extensions: v.import.romExt });
      if (!file) return;
      b.textContent = 'Verificando…';
      const r = await api.importDump(g.id, v.id, file);
      if (!r.ok) { sfx('error'); toast(r.error, true); return reopen(at); }
      pathsOf(g.id, v.id).dump = {
        file: r.target, verified: r.verified, detail: r.detail, ready: !r.post || r.post.ok
      };
      if (r.post && !r.post.ok) { sfx('error'); toast(r.post.error, true); }
      else { sfx('select'); toast(r.verified ? 'Dump verificado e importado' : 'Dump importado'); }
      reopen(at);
    }));

    panel.querySelectorAll('[data-args]').forEach(inp => inp.addEventListener('change', () => {
      pathsOf(g.id, inp.dataset.args).extraArgs = inp.value.trim();
      save();
    }));
    panel.querySelectorAll('[data-repo]').forEach(b => b.addEventListener('click', () => api.openUrl(b.dataset.repo)));
    panel.querySelector('#open-covers').addEventListener('click', () => api.openCovers());
    if (g.randomizer) bindSeeds(panel, g, reopen);
    refocus(focusAt);
  }, async () => {
    confirmUninstall.clear();
    await reloadCovers();
    buildList(); select(idx, false);
  });
}

// ---------------- Randomizer: seeds ----------------
const fmtWhen = ms => new Date(ms).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function seedsBlock(g) {
  const list = CFG.seeds?.[g.id] || [];
  const active = CFG.activeSeed?.[g.id];
  const rows = list.length
    ? list.map(sd => `<div class="dep seed ${sd.id === active ? 'active' : ''}">
        <span class="dep-icon">${sd.id === active ? '◆' : '◇'}</span>
        <div class="dep-name"><b>${esc(sd.name)}</b><small>${fmtWhen(sd.at)}${sd.extras?.length ? ` · ${sd.extras.length} archivo(s) extra` : ''}</small></div>
        <div class="seed-actions">
          ${sd.id === active ? '<span class="tag ok">En uso</span>' : `<button class="focusable" data-seed-use="${sd.id}">Usar</button>`}
          <button class="focusable" data-seed-del="${sd.id}" title="Borrar seed y sus partidas">${confirmSeedDel === sd.id ? '¿Borrar?' : '✕'}</button>
        </div>
      </div>`).join('')
    : '<p class="note">Aún no tienes seeds.</p>';
  return `<div class="block"><div class="block-head"><h4>Seeds</h4>
      <button class="focusable link" data-repo="https://github.com/${esc(g.randomizer.repo)}">Ver proyecto ↗</button></div>
    <div class="step"><span class="num">1</span><div class="grow">
      <div class="row tight"><b>Genera una seed</b>
        <button class="focusable primary-sm" id="seed-gen">Abrir generador</button>
        <button class="focusable" id="seed-import">Importar .z64</button>
        <button class="focusable" id="seed-dir">Carpeta</button></div>
      <p class="note">Se abre el generador oficial (${esc(g.randomizer.site.replace(/^https:\/\/|\/$/g, ''))}) dentro del launcher. Necesitas ${esc(g.randomizer.needs)}. Al pulsar descargar, la seed se guarda sola aquí y queda lista para jugar.</p>
    </div></div>
    <div class="step"><span class="num">2</span><div class="grow"><b>Tus seeds</b>${rows}</div></div>
  </div>`;
}

let confirmSeedDel = null;
function bindSeeds(panel, g, reopen) {
  panel.querySelector('#seed-gen').addEventListener('click', () => { sfx('select'); api.openGenerator(g.id); });
  panel.querySelector('#seed-dir').addEventListener('click', () => api.openSeedsDir(g.id));
  panel.querySelector('#seed-import').addEventListener('click', async () => {
    const file = await api.pickFile({ title: 'Importar seed', extensions: ['z64', 'n64', 'v64'] });
    if (!file) return;
    const r = await api.importSeed(g.id, file);
    if (!r.ok) { sfx('error'); toast(r.error, true); }
  });
  panel.querySelectorAll('[data-seed-use]').forEach(b => b.addEventListener('click', () => { sfx('select'); api.selectSeed(g.id, b.dataset.seedUse); }));
  panel.querySelectorAll('[data-seed-del]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.seedDel;
    if (confirmSeedDel !== id) { confirmSeedDel = id; sfx('error'); return reopen(focusIndex()); }
    confirmSeedDel = null;
    await api.deleteSeed(g.id, id);
    sfx('back');
  }));
}

function onSeedsChanged({ gameId, seeds, active, message }) {
  (CFG.seeds ||= {})[gameId] = seeds;
  (CFG.activeSeed ||= {})[gameId] = active;
  if (message) { sfx('start'); toast(message); }
  if (cur().id === gameId) {
    if (mode === 'modal' && $('#seed-gen')) openGameConfig(focusIndex());
    renderVariant();
  }
  buildList(); document.querySelectorAll('.item').forEach((el, k) => el.classList.toggle('sel', k === idx));
}

// ---------------- Actualizaciones ----------------
let APP = { version: '', packaged: false, update: { status: 'idle' } };
function updateText(u) {
  switch (u.status) {
    case 'dev': return 'Modo desarrollo: las actualizaciones solo funcionan en la versión instalada.';
    case 'unavailable': return 'Actualizador no disponible en esta compilación.';
    case 'checking': return 'Buscando actualizaciones…';
    case 'latest': return 'Tienes la última versión.';
    case 'downloading': return `Descargando v${u.version}… ${u.percent || 0}%`;
    case 'ready': return `v${u.version} descargada. Se instalará al reiniciar.`;
    case 'error': return `No se pudo comprobar: ${u.error}`;
    default: return 'Se comprueba solo al abrir el launcher.';
  }
}
function onUpdateStatus(u) {
  const prev = APP.update.status;
  APP.update = u;
  const el = $('#upd-text');
  if (el) el.textContent = updateText(u);
  const btn = $('#upd-btn');
  if (btn) btn.textContent = u.status === 'ready' ? 'Reiniciar y actualizar' : 'Buscar actualizaciones';
  if (u.status === 'ready' && prev !== 'ready') toast(`Hay una versión nueva (v${u.version}). Reinicia desde Ajustes para instalarla.`);
}

function onPortProgress({ key, phase, got, total }) {
  const el = document.querySelector(`[data-prog="${key}"]`);
  if (!el) return;
  el.classList.add('on');
  const pct = total ? Math.round((got / total) * 100) : null;
  el.querySelector('.fill').style.width = pct != null ? `${pct}%` : '100%';
  el.querySelector('span').textContent = phase === 'Descargando'
    ? `Descargando ${(got / 1048576).toFixed(1)}${total ? ` / ${(total / 1048576).toFixed(1)}` : ''} MB`
    : phase;
}

function openSettings(focusAt = 0) {
  const s = CFG.settings;
  const tog = (key, label) => `<div class="row"><label>${esc(label)}</label>
    <button class="focusable" data-tog="${key}">${s[key] ? 'Sí' : 'No'}</button></div>`;
  const html = `<h3>Ajustes</h3>
    <div class="block"><h4>Dependencias</h4>
      <div class="row"><label>Ports y emuladores</label><button class="focusable primary-sm" id="open-deps">Descargar dependencias</button></div>
      <p class="note">Descarga todos los ports desde sus repositorios y los núcleos del emulador de una sola vez.</p>
    </div>
    <div class="block"><h4>Versión ${esc(APP.version)}</h4>
      <div class="row"><label>Actualizaciones</label><span class="note grow" id="upd-text">${esc(updateText(APP.update))}</span>
        <button class="focusable" id="upd-btn">${APP.update.status === 'ready' ? 'Reiniciar y actualizar' : 'Buscar actualizaciones'}</button></div>
    </div>
    <div class="block"><h4>Juego</h4>
      ${tog('emuFullscreen', 'Emulador a pantalla completa')}
      <div class="row"><label>Emulador integrado</label>
        <button class="focusable" id="emu-log">Registro del emulador</button>
        <button class="focusable" id="emu-clear">Borrar caché</button></div>
      <p class="note">Si un juego del emulador se queda en negro: abre el registro o borra la caché (se vuelve a descargar al jugar). F12 dentro del juego abre la consola.</p>
      ${tog('minimizeOnLaunch', 'Minimizar al abrir un port')}
    </div>
    <div class="block"><h4>Launcher</h4>
      ${tog('sound', 'Sonidos del menú')}
      <div class="row"><label>Pantalla completa</label><button class="focusable" id="fs">Alternar (F11)</button></div>
    </div>
    <div class="panel-actions">
      <button class="focusable" id="quit">Salir del launcher</button>
      <button class="focusable" data-close>Cerrar</button>
    </div>`;

  openModal(html, panel => {
    panel.querySelectorAll('[data-tog]').forEach(b => b.addEventListener('click', async () => {
      const k = b.dataset.tog; s[k] = !s[k];
      b.textContent = s[k] ? 'Sí' : 'No'; sfx('move'); await save();
    }));
    panel.querySelector('#fs').addEventListener('click', () => api.toggleFullscreen());
    panel.querySelector('#upd-btn').addEventListener('click', async () => {
      if (APP.update.status === 'ready') return api.installUpdate();
      onUpdateStatus(await api.checkUpdate());
    });
    panel.querySelector('#emu-log').addEventListener('click', () => api.openEmuLog());
    panel.querySelector('#emu-clear').addEventListener('click', async () => {
      const r = await api.clearEmuCache();
      if (!r.ok) { sfx('error'); toast(r.error, true); return; }
      CFG.emuCores = {};
      sfx('select'); toast('Caché del emulador borrada. Se descargará de nuevo al jugar.');
    });
    panel.querySelector('#open-deps').addEventListener('click', () => { sfx('select'); openDeps(); });
    panel.querySelector('#quit').addEventListener('click', () => api.quit());
    refocus(focusAt);
  }, () => { buildList(); select(idx, false); });
}

// ---------------- Dependencias ----------------
const depsState = new Map();   // key -> { state, text, got, total }
let depsRunning = false;
let depsItems = [];

function depRow(it) {
  const st = depsState.get(it.key);
  let tag;
  if (st?.state === 'working') tag = `<span class="tag run">${esc(st.text || 'Trabajando…')}</span>`;
  else if (st?.state === 'error') tag = `<span class="tag err" title="${esc(st.text)}">Error</span>`;
  else if (st?.state === 'done') tag = `<span class="tag ok">✓ ${esc(st.text)}</span>`;
  else if (it.installed) tag = `<span class="tag ok">✓ ${it.kind === 'port' ? `Instalado · ${esc(it.installed)}` : 'En caché'}</span>`;
  else tag = '<span class="tag warn">Pendiente</span>';
  const pct = st?.state === 'working' && st.total ? Math.round(st.got / st.total * 100) : null;
  return `<div class="dep" data-dep="${esc(it.key)}">
    <span class="dep-icon">${it.kind === 'port' ? '⬢' : '◆'}</span>
    <div class="dep-name"><b>${esc(it.name)}</b><small>${esc(it.game)}</small>
      ${st?.state === 'error' ? `<small class="dep-err">${esc(st.text)}</small>` : ''}</div>
    ${tag}
    <div class="dep-bar ${st?.state === 'working' ? 'on' : ''}"><div style="width:${pct ?? (st?.state === 'working' ? 100 : 0)}%" class="${pct == null ? 'indet' : ''}"></div></div>
  </div>`;
}

async function openDeps(focusAt = 0) {
  const { items, manual } = await api.listDeps();
  depsItems = items;
  const pending = items.filter(i => !i.installed).length;
  const html = `<h3>Dependencias</h3>
    <p class="note">Descarga de una vez todos los ports desde sus repositorios oficiales de GitHub y los núcleos del emulador integrado, y los deja listos en el launcher. Lo que ya tengas se salta.</p>
    <div class="deps">
      <h4>Ports</h4>${items.filter(i => i.kind === 'port').map(depRow).join('')}
      <h4>Emulador integrado</h4>${items.filter(i => i.kind === 'core').map(depRow).join('')}
    </div>
    <p class="note">Sin descarga automática (se configuran a mano): ${esc(manual.join(', '))}.</p>
    <p class="note">Recuerda: después tienes que importar tu dump en Configurar de cada juego.</p>
    <div class="panel-actions">
      <button class="focusable primary-sm" id="deps-run" ${depsRunning ? 'disabled' : ''}>${depsRunning ? 'Descargando…' : pending ? `Descargar dependencias (${pending})` : 'Todo descargado ✓'}</button>
      <button class="focusable" id="deps-upd" ${depsRunning ? 'disabled' : ''}>Descargar y actualizar todo</button>
      <button class="focusable" data-close>Cerrar</button>
    </div>`;

  openModal(html, panel => {
    const start = async updates => {
      if (depsRunning) return;
      depsRunning = true; depsState.clear(); sfx('select');
      openDeps(focusIndex());
      const r = await api.runDeps({ updates });
      depsRunning = false;
      const data = await api.getConfig();
      CFG.installs = data.cfg.installs; CFG.emuCores = data.cfg.emuCores;
      if (!r.ok) { sfx('error'); toast(r.error, true); }
      else {
        const s = r.summary;
        const msg = `Dependencias: ${s.done} descargadas, ${s.skipped} ya estaban${s.failed ? `, ${s.failed} con error` : ''}.`;
        s.failed ? (sfx('error'), toast(msg, true)) : (sfx('start'), toast(msg));
      }
      if (mode === 'modal' && $('#deps-run')) openDeps(focusIndex());
      buildList(); select(idx, false);
    };
    panel.querySelector('#deps-run').addEventListener('click', () => start(false));
    panel.querySelector('#deps-upd').addEventListener('click', () => start(true));
    refocus(focusAt);
  }, () => { buildList(); select(idx, false); });
}

function onDepsProgress({ key, state, text, phase, got, total }) {
  const prev = depsState.get(key) || {};
  const label = phase === 'Descargando' && got
    ? `Descargando ${(got / 1048576).toFixed(1)}${total ? ` / ${(total / 1048576).toFixed(1)}` : ''} MB`
    : (phase || text || prev.text);
  depsState.set(key, { state, text: label, got, total });
  const row = document.querySelector(`[data-dep="${CSS.escape(key)}"]`);
  if (!row) return;
  const it = depsItems.find(i => i.key === key);
  if (!it) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = depRow(it);
  row.replaceWith(tmp.firstElementChild);
}

async function reloadCovers() {
  const data = await api.getConfig();
  data.games.forEach((g, i) => { GAMES[i].cover = g.cover; });
}

// ---------------- Entrada (teclado + mando) ----------------
function enterMenu() {
  if (mode !== 'title') return;
  sfx('start');
  $('#title-screen').classList.add('out');
  $('#menu').hidden = false;
  mode = 'menu';
  select(idx, false);
  if (!Object.keys(CFG.installs || {}).length && !Object.keys(CFG.emuCores || {}).length) {
    setTimeout(() => toast('Consejo: pulsa START › Descargar dependencias para bajarlo todo de una vez.'), 900);
  }
}
function toTitle() {
  sfx('back');
  $('#menu').hidden = true;
  $('#title-screen').classList.remove('out');
  mode = 'title';
}

function handle(action) {
  if (mode === 'running') return;
  if (mode === 'title') {
    if (['a', 'start'].includes(action)) enterMenu();
    return;
  }
  if (mode === 'menu') {
    switch (action) {
      case 'up': sfx('move'); select(idx - 1); break;
      case 'down': sfx('move'); select(idx + 1); break;
      case 'left': case 'lb': cycleVariant(-1); break;
      case 'right': case 'rb': cycleVariant(1); break;
      case 'a': play(); break;
      case 'x': case 'y': sfx('select'); openGameConfig(); break;
      case 'start': case 'select': sfx('select'); openSettings(); break;
      case 'b': toTitle(); break;
    }
    return;
  }
  if (mode === 'modal') {
    const f = [...$('#panel').querySelectorAll('.focusable')];
    const i = f.indexOf(document.activeElement);
    switch (action) {
      case 'up': case 'left': sfx('move'); (f[i - 1] || f[f.length - 1])?.focus(); break;
      case 'down': case 'right': sfx('move'); (f[i + 1] || f[0])?.focus(); break;
      case 'a': document.activeElement?.click(); break;
      case 'b': closeModal(); break;
    }
  }
}

const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'a', ' ': 'a', Escape: 'b', Backspace: 'b',
  c: 'x', C: 'x', q: 'lb', Q: 'lb', e: 'rb', E: 'rb', Tab: 'start'
};
addEventListener('keydown', e => {
  if (e.key === 'F11') { e.preventDefault(); api.toggleFullscreen(); return; }
  const typing = e.target.tagName === 'INPUT';
  if (typing && !['Escape', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) return;
  let act = KEYMAP[e.key];
  if (!act) return;
  if (mode === 'title' && e.key === 'Enter') act = 'start';
  // Enter/Espacio sobre un botón del modal ya disparan click nativo
  if (mode === 'modal' && ((act === 'a' && !typing) || e.key === 'Tab')) return;
  e.preventDefault();
  handle(act);
});

$('#title-screen').addEventListener('click', enterMenu);
$('#v-prev').addEventListener('click', () => cycleVariant(-1));
$('#v-next').addEventListener('click', () => cycleVariant(1));
$('#btn-play').addEventListener('click', play);
$('#btn-config').addEventListener('click', () => openGameConfig());
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

// Gamepad API (mapeo estándar XInput: 0=A 1=B 2=X 3=Y 4=LB 5=RB 8=Back 9=Start 12-15=cruceta)
const pad = { prev: {}, next: {} };
const DIRS = ['up', 'down', 'left', 'right'];
function pollPad() {
  const gp = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (gp && document.hasFocus()) {
    const b = n => !!gp.buttons[n]?.pressed;
    const ax = n => gp.axes[n] || 0;
    const now = {
      up: b(12) || ax(1) < -.55, down: b(13) || ax(1) > .55,
      left: b(14) || ax(0) < -.55, right: b(15) || ax(0) > .55,
      a: b(0), b: b(1), x: b(2), y: b(3), lb: b(4), rb: b(5), select: b(8), start: b(9)
    };
    const t = performance.now();
    for (const k in now) {
      if (!now[k]) continue;
      if (!pad.prev[k]) { handle(k); pad.next[k] = t + 380; }
      else if (DIRS.includes(k) && t > pad.next[k]) { handle(k); pad.next[k] = t + 120; }
    }
    pad.prev = now;
  } else {
    pad.prev = {};
  }
  requestAnimationFrame(pollPad);
}

// ---------------- Partículas (destellos flotantes) ----------------
function startParticles() {
  const c = $('#particles'); const x = c.getContext('2d');
  let W, H; const dpr = devicePixelRatio || 1;
  const resize = () => { W = c.width = innerWidth * dpr; H = c.height = innerHeight * dpr; };
  resize(); addEventListener('resize', resize);
  const mk = init => ({
    x: Math.random() * W, y: init ? Math.random() * H : H + 20,
    r: (Math.random() * 1.6 + .4) * dpr,
    vy: -(Math.random() * .35 + .08) * dpr, vx: (Math.random() - .5) * .18 * dpr,
    a: Math.random() * 6.28, tw: Math.random() * .03 + .008
  });
  const P = Array.from({ length: 110 }, () => mk(true));
  (function frame() {
    x.clearRect(0, 0, W, H);
    x.globalCompositeOperation = 'lighter';
    for (const p of P) {
      p.y += p.vy; p.x += p.vx + Math.sin(p.a) * .1; p.a += p.tw;
      if (p.y < -20) Object.assign(p, mk(false));
      const al = .25 + .4 * (.5 + .5 * Math.sin(p.a));
      const R = p.r * 5;
      const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      g.addColorStop(0, `rgba(255,255,255,${al})`);
      g.addColorStop(.25, `rgba(${accentRGB},${al * .6})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(p.x, p.y, R, 0, 6.283); x.fill();
    }
    requestAnimationFrame(frame);
  })();
}

function tickClock() {
  $('#clock').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

// ---------------- Inicio ----------------
(async function init() {
  const data = await api.getConfig();
  GAMES = data.games; CFG = data.cfg; APP = data.app || APP;
  idx = Math.min(CFG.lastIndex || 0, GAMES.length - 1);
  buildList();
  select(idx, false);
  startParticles();
  tickClock(); setInterval(tickClock, 15000);
  api.onGameExited(onExit);
  api.onPortProgress(onPortProgress);
  api.onSeedsChanged(onSeedsChanged);
  api.onUpdateStatus(onUpdateStatus);
  api.onCoversChanged?.(async () => { await reloadCovers(); select(idx, false); });
  api.onDepsProgress(onDepsProgress);
  requestAnimationFrame(pollPad);
})();
