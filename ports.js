// Gestor de ports: descarga desde GitHub Releases, instala, actualiza e importa el dump.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const UA = { 'User-Agent': 'HyruleChronicles-Launcher', Accept: 'application/vnd.github+json' };

async function get(url, headers) {
  try {
    return await fetch(url, { headers });
  } catch {
    throw new Error('Sin conexión con GitHub. Revisa tu internet e inténtalo de nuevo.');
  }
}

async function latestRelease(repo) {
  const res = await get(`https://api.github.com/repos/${repo}/releases/latest`, UA);
  if (res.status === 404) throw new Error('El proyecto no tiene releases publicadas.');
  if (res.status === 403) throw new Error('GitHub limitó las consultas. Prueba de nuevo en unos minutos.');
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}.`);
  const j = await res.json();
  return { tag: j.tag_name, assets: (j.assets || []).map(a => ({ name: a.name, url: a.browser_download_url, size: a.size })) };
}

function pickAsset(assets, re) {
  return assets.find(a => re.test(a.name)) || null;
}

async function download(url, dest, onProgress) {
  const res = await get(url, { 'User-Agent': UA['User-Agent'] });
  if (!res.ok) throw new Error(`Descarga fallida (${res.status}).`);
  const total = +res.headers.get('content-length') || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(value)) await new Promise(r => out.once('drain', r));
    const now = Date.now();
    if (now - last > 150) { onProgress?.(got, total); last = now; }
  }
  await new Promise((r, j) => out.end(err => (err ? j(err) : r())));
  onProgress?.(got, total);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let err = '';
    p.stderr?.on('data', d => { err += d; });
    p.once('error', reject);
    p.once('exit', code => (code === 0 ? resolve() : reject(new Error(err.trim() || `${cmd} terminó con código ${code}`))));
  });
}

// Windows 10+ trae tar.exe (bsdtar), que abre .zip. Si falla, usa PowerShell.
async function extractZip(zip, dir) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    await run('tar', ['-xf', zip, '-C', dir]);
  } catch {
    await run('powershell', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`]);
  }
}

function findFile(dir, re, depth = 4) {
  if (depth < 0 || !fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) if (e.isFile() && re.test(e.name)) return path.join(dir, e.name);
  for (const e of entries) {
    if (e.isDirectory()) {
      const f = findFile(path.join(dir, e.name), re, depth - 1);
      if (f) return f;
    }
  }
  return null;
}

async function install(variant, dir, onProgress) {
  onProgress?.({ phase: 'Consultando GitHub…' });
  const rel = await latestRelease(variant.repo);
  const asset = pickAsset(rel.assets, variant.asset);
  if (!asset) {
    throw new Error(`No encontré la descarga para Windows en ${rel.tag}. Archivos: ${rel.assets.map(a => a.name).join(', ') || 'ninguno'}.`);
  }
  const tmp = path.join(dir, '..', `.${path.basename(dir)}-${Date.now()}-${asset.name}`);
  await download(asset.url, tmp, (got, total) => onProgress?.({ phase: 'Descargando', got, total }));
  try {
    onProgress?.({ phase: 'Descomprimiendo…' });
    if (/\.zip$/i.test(asset.name)) await extractZip(tmp, dir);   // se descomprime encima: conserva dumps y partidas
    else {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(tmp, path.join(dir, asset.name));
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  const exe = findFile(dir, variant.exe);
  if (!exe) throw new Error('Se descargó, pero no encontré el ejecutable dentro.');
  if (variant.portable) fs.writeFileSync(path.join(path.dirname(exe), 'portable.txt'), '');
  return { tag: rel.tag, exe, dir, installedAt: Date.now() };
}

async function checkUpdate(variant, installed) {
  const rel = await latestRelease(variant.repo);
  return { latest: rel.tag, hasUpdate: !!installed && rel.tag !== installed.tag };
}

function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// Devuelve { verified: true|false|null, detail }
//  true  -> hash coincide con la lista oficial
//  false -> hash conocido como NO compatible (se rechaza)
//  null  -> no hay lista para comprobar
async function verifyDump(file, imp) {
  if (imp.sha256) {
    const h = await hashFile(file, 'sha256');
    return h === imp.sha256.toLowerCase()
      ? { verified: true, detail: 'SHA-256 correcto' }
      : { verified: false, detail: 'El SHA-256 no coincide con la versión que necesita este port (USA).' };
  }
  if (imp.hashList) {
    const sha1 = await hashFile(file, 'sha1');
    try {
      const res = await fetch(imp.hashList, { headers: { 'User-Agent': UA['User-Agent'] } });
      if (!res.ok) throw new Error();
      const list = (await res.text()).toLowerCase();
      return list.includes(sha1)
        ? { verified: true, detail: 'Versión compatible (SHA-1 en la lista oficial)' }
        : { verified: false, detail: `Ese dump no aparece en la lista de versiones compatibles (SHA-1 ${sha1.slice(0, 10)}…).` };
    } catch {
      return { verified: null, detail: 'No se pudo consultar la lista de versiones compatibles.' };
    }
  }
  return { verified: null, detail: 'El propio port comprobará la versión al arrancar.' };
}

async function importDump(variant, exePath, file) {
  const imp = variant.import;
  const check = await verifyDump(file, imp);
  if (check.verified === false) return { ok: false, error: check.detail };
  const dir = path.dirname(exePath);
  const target = path.join(dir, imp.targetName || path.basename(file));
  if (path.resolve(target) !== path.resolve(file)) fs.copyFileSync(file, target);
  return { ok: true, target, verified: check.verified, detail: check.detail };
}

module.exports = { install, checkUpdate, importDump, verifyDump, findFile, run };
