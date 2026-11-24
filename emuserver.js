// Servidor local (solo 127.0.0.1) para el emulador integrado.
//  /player.html, /player.js  -> página del reproductor (renderer/player)
//  /data/...                 -> archivos de EmulatorJS; se descargan del CDN la primera vez
//                               y quedan en caché para jugar sin conexión
//  /rom/<gameId>/<nombre>    -> el dump que el usuario configuró para ese juego
//
// El puerto es fijo para que el origen no cambie: las partidas guardadas del
// emulador viven en el almacenamiento del navegador asociado a ese origen.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 47811;
const CDN = 'https://cdn.emulatorjs.org/stable/data/';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2'
};
const typeOf = f => TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';

function inside(root, p) {
  const r = path.resolve(root, p);
  return r === root || r.startsWith(root + path.sep) ? r : null;
}

function start({ cacheDir, playerDir, getRom, onFile }) {
  fs.mkdirSync(cacheDir, { recursive: true });

  // Sirve desde la caché; si no está, lo baja del CDN y lo reenvía al
  // emulador a la vez que lo guarda (así EmulatorJS muestra su progreso).
  async function serveData(rel, req, res) {
    const file = inside(cacheDir, rel);
    if (!file) { res.writeHead(400); return res.end(); }
    if (fs.existsSync(file)) { send(res, file, req); onFile?.(rel); return; }

    const up = await fetch(CDN + rel);
    if (!up.ok) { res.writeHead(up.status); return res.end(); }
    const headers = { 'Content-Type': typeOf(file), 'Cache-Control': 'no-cache' };
    const len = up.headers.get('content-length');
    if (len) headers['Content-Length'] = len;
    res.writeHead(200, headers);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.part`;
    const out = fs.createWriteStream(tmp);
    const reader = up.body.getReader();
    let ok = true;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out.write(value);
        if (!res.write(value)) await new Promise(r => res.once('drain', r));
      }
    } catch {
      ok = false;
    }
    res.end();
    await new Promise(r => out.end(r));
    if (ok) {
      try { fs.renameSync(tmp, file); onFile?.(rel); } catch { fs.rmSync(tmp, { force: true }); }
    } else {
      fs.rmSync(tmp, { force: true });
    }
  }

  function send(res, file, req) {
    const stat = fs.statSync(file);
    const headers = {
      'Content-Type': typeOf(file),
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    };
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const p = decodeURIComponent(url.pathname);

      if (p === '/player.html' || p === '/player.js') {   // player-preload.js no se sirve: lo carga Electron
        return send(res, path.join(playerDir, p.slice(1)), req);
      }
      if (p.startsWith('/data/')) {
        return await serveData(p.slice('/data/'.length), req, res);
      }
      const m = p.match(/^\/rom\/([a-z0-9]+)\//);
      if (m) {
        const rom = getRom(m[1]);
        if (!rom || !fs.existsSync(rom)) { res.writeHead(404); return res.end(); }
        return send(res, rom, req);
      }
      res.writeHead(404); res.end();
    } catch (err) {
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(String(err.message || err));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${PORT}` }));
  });
}

module.exports = { start, PORT };
