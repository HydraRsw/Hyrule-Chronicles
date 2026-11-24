'use strict';
/*
 * Four Swords en Hyrule Chronicles: lobby + partida local u online.
 *
 * Motor: mgba-splitscreen (mGBA en WebAssembly) con 2-4 GBA enlazadas por cable dentro del
 * mismo proceso. Online: lockstep (lockstep.js) a través del servidor de Strikers Online,
 * que reparte los botones de cada jugador a los demás (salas "mp_").
 */
(() => {
  const $ = s => document.querySelector(s);
  const q = new URLSearchParams(location.search);
  const net = window.fsnet || null;                      // puente UDP (preload)
  const { Lockstep, fnv1a, PROTOCOL } = window.HCLockstep;
  const GAME_ID = 'fs';
  const KEY = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
  const store = {
    get: (k, d) => { try { return localStorage.getItem('fs.' + k) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem('fs.' + k, v); } catch { /* sin almacenamiento */ } }
  };

  // ---------- Estado ----------
  let romBytes = null;
  let romTag = 0;            // huella de la ROM: todos deben tener la misma
  let M = null;              // módulo WASM
  let room = null;           // { code, slot, max, players: [{slot,name}], host }
  let started = false;
  let ls = null;             // Lockstep (online)
  let mode = null;           // 'local' | 'online' | 'solo'
  // Solo: el juego exige 2 GBA. Controlas a un Link y cambias al otro; en modo espejo
  // los dos reciben tus botones (para empujar bloques juntos o moverse en grupo).
  const solo = { active: 0, mirror: false };
  let players = 0;
  let mySlot = 0;

  const status = (msg, err = false) => { const s = $('#status'); s.textContent = msg || ''; s.classList.toggle('error', err); };

  // ---------- Lobby: navegación ----------
  function show(id) {
    document.querySelectorAll('.menu').forEach(m => { m.hidden = m.id !== 'menu-' + id; });
    status('');
    const first = document.querySelector(`#menu-${id} .focusable`);
    first?.focus();
    if (id === 'list') listRooms();
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    const go = b.dataset.go;
    if (go === 'exit') return exit();
    show(go);
  }));
  $('#name').value = store.get('name', '');
  $('#name').addEventListener('change', () => store.set('name', $('#name').value.trim().toUpperCase()));
  $('#server').value = store.get('server', q.get('server') || '');
  $('#server').addEventListener('change', () => store.set('server', $('#server').value.trim()));
  $('#delay').value = store.get('delay', '0');
  $('#delay').addEventListener('change', () => store.set('delay', $('#delay').value));
  const myName = () => ($('#name').value.trim().toUpperCase() || 'LINK').slice(0, 12);
  const server = () => $('#server').value.trim() || q.get('server');

  $('#solo').addEventListener('click', startSolo);
  document.querySelectorAll('[data-local]').forEach(b => b.addEventListener('click', () => startLocal(+b.dataset.local)));
  document.querySelectorAll('[data-create]').forEach(b => b.addEventListener('click', () => createRoom(+b.dataset.create)));
  $('#join-go').addEventListener('click', () => joinRoom($('#code').value.trim()));
  $('#list-refresh').addEventListener('click', listRooms);
  $('#room-leave').addEventListener('click', leaveRoom);
  $('#room-start').addEventListener('click', hostStart);

  // ---------- Red: mensajes del servidor ----------
  const waiting = new Map();   // cmd -> resolve
  function sendJson(obj) { net?.send(JSON.stringify(obj)); }
  function request(obj, expect, retries = 6) {
    // UDP: se reenvía hasta recibir respuesta (el servidor es idempotente)
    return new Promise(resolve => {
      let tries = 0;
      const t = setInterval(() => {
        if (++tries > retries) { clearInterval(t); waiting.delete(expect); waiting.delete('mp_error'); resolve(null); return; }
        sendJson(obj);
      }, 500);
      const done = msg => { clearInterval(t); waiting.delete(expect); waiting.delete('mp_error'); resolve(msg); };
      waiting.set(expect, done);
      waiting.set('mp_error', done);
      sendJson(obj);
    });
  }

  net?.onMessage(bytes => {
    if (bytes[0] === 0x7b) {
      let msg; try { msg = JSON.parse(new TextDecoder().decode(bytes)); } catch { return; }
      const w = waiting.get(msg.cmd);
      if (w) w(msg);
      if (msg.cmd === 'mp_roster') onRoster(msg);
      else if (msg.cmd === 'mp_start') onStart(msg);
      else if (msg.cmd === 'mp_closed') onClosed();
      else if (msg.cmd === 'mp_rooms') renderRooms(msg.rooms || []);
      return;
    }
    if (ls) ls.receive(bytes);
  });

  const ERRORS = {
    no_room: 'No hay ninguna sala con ese código.',
    full: 'La sala está llena.',
    started: 'Esa partida ya empezó.',
    version: 'Tu ROM o tu versión del launcher no coincide con la del anfitrión.',
    too_many: 'Tienes demasiadas salas abiertas.'
  };
  const netOk = () => {
    if (!net) { status('El modo online solo funciona dentro del launcher.', true); return false; }
    if (!server()) { status('Configura el servidor en Avanzado.', true); return false; }
    net.setServer(server());
    return true;
  };

  async function createRoom(max) {
    if (!netOk() || !(await ensureRom())) return;
    status('Creando sala…');
    const r = await request({ cmd: 'mp_create', game: GAME_ID, max, name: myName(), ver: romTag, public: $('#public').checked }, 'mp_created');
    if (!r) return status('El servidor no responde. Revisa la dirección en Avanzado.', true);
    if (r.cmd === 'mp_error') return status(ERRORS[r.error] || r.error, true);
    room = { code: r.room, slot: 0, max: r.max, players: [], host: true };
    enterRoom();
  }

  async function joinRoom(code) {
    if (!/^\d{4,6}$/.test(code)) return status('Escribe el código de la sala.', true);
    if (!netOk() || !(await ensureRom())) return;
    status('Uniéndose…');
    const r = await request({ cmd: 'mp_join', room: code, name: myName(), ver: romTag }, 'mp_joined');
    if (!r) return status('El servidor no responde. Revisa la dirección en Avanzado.', true);
    if (r.cmd === 'mp_error') return status(ERRORS[r.error] || r.error, true);
    room = { code: r.room, slot: r.slot, max: r.max, players: [], host: r.slot === 0 };
    enterRoom();
  }

  function listRooms() {
    if (!netOk()) return;
    $('#rooms').innerHTML = '<p class="note">Buscando salas…</p>';
    sendJson({ cmd: 'mp_list', game: GAME_ID });
  }
  function renderRooms(rooms) {
    const box = $('#rooms');
    if (!rooms.length) { box.innerHTML = '<p class="note">No hay salas abiertas ahora mismo.</p>'; return; }
    box.innerHTML = rooms.map(r => `<button class="focusable" data-room="${r.room}">${escapeHtml(r.name)} · ${r.players}/${r.max} <small>código ${r.room}</small></button>`).join('');
    box.querySelectorAll('[data-room]').forEach(b => b.addEventListener('click', () => joinRoom(b.dataset.room)));
  }

  let keepalive = null;
  function enterRoom() {
    show('room');
    $('#room-code').textContent = room.code;
    $('#room-start').hidden = !room.host;
    $('#room-note').textContent = room.host ? 'Pasa el código a tus amigos. Empieza cuando estéis todos (mínimo 2).' : 'Esperando a que el anfitrión empiece…';
    clearInterval(keepalive);
    keepalive = setInterval(() => sendJson({ cmd: 'ping' }), 4000);
    renderRoster();
  }
  function onRoster(msg) {
    if (!room || msg.room !== room.code) return;
    room.players = msg.players;
    renderRoster();
  }
  function renderRoster() {
    const seats = [];
    for (let s = 0; s < room.max; s++) {
      const p = room.players.find(x => x.slot === s);
      seats.push(`<div class="seat p${s} ${p ? 'on' : ''} ${s === room.slot ? 'me' : ''}"><span class="p">JUGADOR ${s + 1}</span>${p ? escapeHtml(p.name) : 'libre'}</div>`);
    }
    $('#roster').innerHTML = seats.join('');
    $('#room-start').disabled = room.players.length < 2;
  }
  function leaveRoom() {
    if (room) sendJson({ cmd: 'mp_leave', room: room.code });
    room = null; clearInterval(keepalive);
    show('main');
  }
  function onClosed() {
    if (!room) return;
    room = null; clearInterval(keepalive);
    if (started) banner('El anfitrión cerró la sala.');
    else { show('main'); status('El anfitrión cerró la sala.', true); }
  }

  let startTimer = null;
  function hostStart() {
    if (!room || room.players.length < 2) return;
    // reenviado unos segundos: si a alguien se le pierde el aviso, le llega el siguiente
    let n = 0;
    clearInterval(startTimer);
    const send = () => sendJson({ cmd: 'mp_start', room: room.code, seed: 'fs' });
    send();
    startTimer = setInterval(() => { send(); if (++n > 8) clearInterval(startTimer); }, 400);
  }

  async function onStart(msg) {
    if (!room || started || msg.room !== room.code) return;
    started = true;
    const slots = room.players.map(p => p.slot).sort((a, b) => a - b);
    // Las GBA se crean en orden: el asiento N es la GBA N (los asientos libres no juegan)
    players = Math.max(...slots) + 1;
    mySlot = room.slot;
    const delay = await chooseDelay();
    ls = new Lockstep({ slot: mySlot, slots, delay, send: bytes => net.send(bytes) });
    await startGame('online');
  }

  async function chooseDelay() {
    const fixed = +$('#delay').value;
    if (fixed) return fixed;
    // Automático: ping al servidor (ida y vuelta) -> frames que cubren la ida al resto
    const t0 = performance.now();
    const pong = await request({ cmd: 'ping' }, 'pong', 2);
    const rtt = pong ? performance.now() - t0 : 150;
    return Math.max(3, Math.min(10, Math.ceil(rtt / 16.7) + 2));
  }

  // ---------- ROM ----------
  async function ensureRom() {
    if (romBytes) return true;
    const url = q.get('rom');
    if (!url) { status('Configura tu ROM de Four Swords en el launcher.', true); return false; }
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(r.status);
      romBytes = new Uint8Array(await r.arrayBuffer());
      romTag = (PROTOCOL * 1000000) + (fnv1a(romBytes) % 1000000);
      return true;
    } catch (e) {
      status('No se pudo leer la ROM. Revísala en Configurar.', true);
      return false;
    }
  }

  // ---------- Partida ----------
  async function startLocal(n) {
    if (!(await ensureRom())) return;
    players = n; mySlot = 0;
    await startGame('local');
  }

  async function startSolo() {
    if (!(await ensureRom())) return;
    players = 2; mySlot = 0; solo.active = 0; solo.mirror = false;
    await startGame('solo');
  }
  function soloSwitch() {
    solo.active = (solo.active + 1) % players;
    if (M) M._mgs_set_audio_source(solo.active + 1);
    soloHelp();
  }
  function soloMirror() { solo.mirror = !solo.mirror; soloHelp(); }
  function soloHelp() {
    const el = $('#solo-help');
    el.hidden = mode !== 'solo';
    el.classList.toggle('mirror', solo.mirror);
    el.textContent = `Controlas al Link ${solo.active + 1}${solo.mirror ? ' · ESPEJO: los dos te siguen' : ''} · Tab / L3: cambiar · C / R3: espejo`;
  }

  async function startGame(m) {
    mode = m;
    status('Cargando el emulador…');
    try {
      M = await window.MgbaSplitScreenWasm({ locateFile: p => new URL('engine/' + p, location.href).href });
    } catch (e) {
      return status('No se pudo cargar el emulador: ' + e.message, true);
    }
    M._mgs_init(players);
    const ptr = M._malloc(romBytes.length);
    M.HEAPU8.set(romBytes, ptr);
    const rc = M._mgs_load_rom(ptr, romBytes.length);
    M._free(ptr);
    if (rc === 0) return status('El emulador no aceptó la ROM.', true);
    M._mgs_set_fs_assist(1);                       // ayuda del enlace de Four Swords
    M._mgs_set_audio_source(mode === 'online' ? mySlot + 1 : 1);

    $('#lobby').hidden = true;
    $('#game').hidden = false;
    setupScreens();
    soloHelp();
    startAudio();
    requestAnimationFrame(loop);
  }

  // Pantallas: la mía grande; las de los demás en miniatura. En local, cuadrícula.
  const screen = $('#screen');
  const sctx = screen.getContext('2d');
  const thumbs = [];
  let imgs = [];
  function setupScreens() {
    imgs = [];
    for (let i = 0; i < players; i++) imgs.push(new ImageData(240, 160));
    $('#thumbs').innerHTML = '';
    if (mode === 'online' || mode === 'solo') {
      for (let i = 0; i < players; i++) {
        if (mode === 'online' && i === mySlot) continue;
        const c = document.createElement('canvas'); c.width = 240; c.height = 160; c.className = 'p' + i;
        $('#thumbs').appendChild(c); thumbs.push({ i, ctx: c.getContext('2d') });
      }
      screen.width = 240; screen.height = 160;
    } else {
      const cols = players > 2 ? 2 : 2, rows = players > 2 ? 2 : 1;
      screen.width = 240 * cols; screen.height = 160 * rows;
    }
    fit();
  }
  function fit() {
    const W = innerWidth, H = innerHeight;
    const strip = mode === 'online' || mode === 'solo' ? 140 : 0;
    const k = Math.max(1, Math.floor(Math.min(W / screen.width, (H - strip) / screen.height)));
    const s = Math.min(W / screen.width, H / screen.height, k);
    screen.style.width = screen.width * s + 'px';
    screen.style.height = screen.height * s + 'px';
    screen.style.left = (W - screen.width * s) / 2 + 'px';
    screen.style.top = (strip ? Math.max(0, (H - strip - screen.height * s) / 2) : (H - screen.height * s) / 2) + 'px';
  }
  addEventListener('resize', fit);

  function copyVideo(i) {
    const p = M._mgs_get_video(i);
    if (!p) return null;
    const w = M._mgs_get_video_width(i) || 240, h = M._mgs_get_video_height(i) || 160;
    if (imgs[i].width !== w || imgs[i].height !== h) imgs[i] = new ImageData(w, h);
    const d = imgs[i].data;
    d.set(M.HEAPU8.subarray(p, p + w * h * 4));
    for (let k = 3; k < d.length; k += 4) d[k] = 255;
    return imgs[i];
  }
  function render() {
    if (mode === 'solo') {
      const img = copyVideo(solo.active); if (img) sctx.putImageData(img, 0, 0);
      for (const t of thumbs) {
        const im = copyVideo(t.i); if (im) t.ctx.putImageData(im, 0, 0);
        t.ctx.canvas.style.opacity = t.i === solo.active ? '1' : '.6';
      }
      return;
    }
    if (mode === 'online') {
      const img = copyVideo(mySlot); if (img) sctx.putImageData(img, 0, 0);
      for (const t of thumbs) { const im = copyVideo(t.i); if (im) t.ctx.putImageData(im, 0, 0); }
    } else {
      for (let i = 0; i < players; i++) {
        const img = copyVideo(i); if (!img) continue;
        sctx.putImageData(img, (i % 2) * 240, Math.floor(i / 2) * 160);
      }
    }
  }

  // Huella del estado para detectar desincronizaciones: las 4 pantallas
  function stateHash() {
    let h = 0x811c9dc5;
    for (let i = 0; i < players; i++) {
      const p = M._mgs_get_video(i); if (!p) continue;
      const w = M._mgs_get_video_width(i) || 240, hh = M._mgs_get_video_height(i) || 160;
      h = fnv1a(M.HEAPU8.subarray(p, p + w * hh * 4), h);
    }
    return h;
  }

  // ---------- Entrada ----------
  const keyboard = new Set();
  addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); togglePause(); return; }
    if (e.key === 'F11') { e.preventDefault(); net?.toggleFullscreen(); return; }
    if (mode === 'solo' && !$('#game').hidden && !e.repeat) {
      if (e.code === 'Tab') { e.preventDefault(); soloSwitch(); return; }
      if (e.code === 'KeyC') { e.preventDefault(); soloMirror(); return; }
    }
    if (!$('#game').hidden) { keyboard.add(e.code); e.preventDefault(); }
  });
  addEventListener('keyup', e => keyboard.delete(e.code));
  addEventListener('blur', () => keyboard.clear());

  // Teclado = jugador 1 en local, o tú en online
  const KB = { ArrowUp: KEY.UP, ArrowDown: KEY.DOWN, ArrowLeft: KEY.LEFT, ArrowRight: KEY.RIGHT,
               KeyX: KEY.A, KeyZ: KEY.B, Enter: KEY.START, Backspace: KEY.SELECT, ShiftRight: KEY.SELECT,
               KeyA: KEY.L, KeyS: KEY.R };
  function keyboardKeys() { let k = 0; for (const c of keyboard) k |= KB[c] || 0; return k; }
  // Mando estándar (Xbox): A->A, B/X->B, LB->L, RB->R, Start, Back->Select, cruceta o stick
  function padKeys(gp) {
    if (!gp) return 0;
    const b = n => !!gp.buttons[n]?.pressed, ax = n => gp.axes[n] || 0;
    let k = 0;
    if (b(0)) k |= KEY.A; if (b(1) || b(2)) k |= KEY.B;
    if (b(4)) k |= KEY.L; if (b(5)) k |= KEY.R;
    if (b(9)) k |= KEY.START; if (b(8)) k |= KEY.SELECT;
    if (b(12) || ax(1) < -0.5) k |= KEY.UP; if (b(13) || ax(1) > 0.5) k |= KEY.DOWN;
    if (b(14) || ax(0) < -0.5) k |= KEY.LEFT; if (b(15) || ax(0) > 0.5) k |= KEY.RIGHT;
    return k;
  }
  const pads = () => [...(navigator.getGamepads?.() || [])].filter(Boolean);
  function localKeys(player) {
    // local: jugador 1 = teclado + mando 1; jugador N = mando N
    const gp = pads()[player];
    return (player === 0 ? keyboardKeys() : 0) | padKeys(gp);
  }

  // ---------- Bucle a 60 fps ----------
  const FRAME_MS = 1000 / 60;
  let last = performance.now(), acc = 0, paused = false, frames = 0, fpsT = performance.now(), fps = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = now - last; last = now;
    if (dt > 100) dt = 100;
    acc += dt;
    let ran = 0;
    if (mode === 'solo') {
      // L3 / R3 del mando: cambiar de Link / espejo
      const gp = pads()[0];
      const l3 = !!gp?.buttons[10]?.pressed, r3 = !!gp?.buttons[11]?.pressed;
      if (l3 && !solo.l3) soloSwitch();
      if (r3 && !solo.r3) soloMirror();
      solo.l3 = l3; solo.r3 = r3;
      while (acc >= FRAME_MS && ran < 4) {
        if (!paused) {
          const k = keyboardKeys() | padKeys(gp);
          for (let i = 0; i < players; i++) M._mgs_set_keys(i, solo.mirror || i === solo.active ? k : 0);
          M._mgs_run_frame();
          ran++;
        }
        acc -= FRAME_MS;
      }
      if (paused) acc = 0;
    } else if (mode === 'local') {
      while (acc >= FRAME_MS && ran < 4) {
        if (!paused) {
          for (let i = 0; i < players; i++) M._mgs_set_keys(i, localKeys(i));
          M._mgs_run_frame();
          ran++;
        }
        acc -= FRAME_MS;
      }
      if (paused) acc = 0;
    } else {
      // Online: nunca se pausa (los demás siguen); el ritmo lo marcan los botones de todos
      while (acc >= FRAME_MS && ran < 4) {
        ls.pushLocal(keyboardKeys() | padKeys(pads()[0]));
        if (!ls.ready()) { acc = Math.min(acc, FRAME_MS * 3); break; }
        const keys = ls.advance();
        for (let i = 0; i < players; i++) M._mgs_set_keys(i, keys[i] || 0);
        M._mgs_run_frame();
        if (ls.shouldCheck()) ls.recordCheck(stateHash());
        acc -= FRAME_MS;
        ran++;
      }
      if (!ran) ls.flush();                  // esperando: reenviar lo mío por si se perdió
      watchNet(now);
    }
    if (ran) { render(); pumpAudio(); frames += ran; }
    if (now - fpsT > 1000) { fps = frames; frames = 0; fpsT = now; hud(); }
  }

  let lastNetCheck = 0, pingT = 0;
  function watchNet(now) {
    if (now - lastNetCheck < 500) return;
    lastNetCheck = now;
    if (now - pingT > 4000) { pingT = now; sendJson({ cmd: 'ping' }); }
    if (ls.desync) banner(`Desincronización con el jugador ${ls.desync.slot + 1} (frame ${ls.desync.frame}). Salid y volved a entrar a la sala.`);
    else {
      const gone = ls.silent(8000);
      if (gone.length) banner(`Esperando al jugador ${gone.map(s => s + 1).join(', ')}… (sin conexión)`);
      else hideBanner();
    }
  }
  function hud() {
    $('#hud-net').textContent = mode === 'online'
      ? `Jugador ${mySlot + 1} · ${fps} fps · retardo ${ls.delay} · sala ${room?.code || ''}`
      : mode === 'solo' ? `Solo · 2 Links · ${fps} fps`
      : `${players} jugadores en este PC · ${fps} fps`;
  }
  function banner(t) { const b = $('#banner'); b.textContent = t; b.hidden = false; }
  function hideBanner() { $('#banner').hidden = true; }

  // ---------- Audio (tu GBA) ----------
  let actx = null, playAt = 0;
  function startAudio() {
    try { actx = new AudioContext(); playAt = 0; } catch { actx = null; }
  }
  function pumpAudio() {
    if (!M) return;
    const ptr = M._mgs_get_audio();
    const n = M._mgs_audio_frames();
    if (!actx || n <= 0 || !ptr) return;
    const rate = M._mgs_get_audio_rate ? M._mgs_get_audio_rate() : 32768;
    const pcm = new Int16Array(M.HEAPU8.buffer, ptr, n * 2);
    const buf = actx.createBuffer(2, n, rate);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) { L[i] = pcm[i * 2] / 32768; R[i] = pcm[i * 2 + 1] / 32768; }
    const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
    const t = actx.currentTime;
    if (playAt < t || playAt > t + 0.25) playAt = t + 0.05;     // reengancha si se desfasa
    src.start(playAt); playAt += n / rate;
  }

  // ---------- Pausa / salir ----------
  function togglePause() {
    if ($('#game').hidden) return;
    const p = $('#pause');
    if (p.hidden) {
      p.hidden = false; paused = mode === 'local';
      $('#pause-note').textContent = mode === 'online' ? 'En online la partida sigue para los demás mientras ves este menú.' : '';
      $('#pause-resume').focus();
    } else { p.hidden = true; paused = false; }
  }
  $('#pause-resume').addEventListener('click', togglePause);
  $('#pause-exit').addEventListener('click', exit);
  function exit() {
    if (room) sendJson({ cmd: 'mp_leave', room: room.code });
    try { M?._mgs_quit?.(); } catch { /* nada */ }
    setTimeout(() => (net ? net.exit() : window.close()), 150);
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // Navegación del lobby con el mando
  let padPrev = {};
  (function padNav() {
    requestAnimationFrame(padNav);
    if (!$('#lobby').hidden || !$('#pause').hidden) {
      const gp = pads()[0]; if (!gp) return;
      const b = n => !!gp.buttons[n]?.pressed;
      const st = { up: b(12) || (gp.axes[1] || 0) < -0.5, down: b(13) || (gp.axes[1] || 0) > 0.5, a: b(0), b: b(1) };
      const list = [...document.querySelectorAll('section:not([hidden]) .menu:not([hidden]) .focusable, #pause:not([hidden]) .focusable')].filter(x => !x.disabled && x.offsetParent);
      const i = list.indexOf(document.activeElement);
      if (st.up && !padPrev.up) (list[i - 1] || list[list.length - 1])?.focus();
      if (st.down && !padPrev.down) (list[i + 1] || list[0])?.focus();
      if (st.a && !padPrev.a) document.activeElement?.click();
      if (st.b && !padPrev.b) document.querySelector('section:not([hidden]) .menu:not([hidden]) .back')?.click();
      padPrev = st;
    }
  })();

  show('main');
  if (!net) status('Vista previa sin launcher: solo el modo local.');
})();
