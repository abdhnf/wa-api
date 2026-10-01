/**
 * Test integrasi: GET /api/v1/users/:id/blast-link (admin, READ-ONLY).
 *
 * Fokus pembuktian:
 *  1. Endpoint menolak non-admin (akses DITOLAK).
 *  2. User tanpa token  -> hasToken:false, launchUrl:null, dan TIDAK menerbitkan token.
 *  3. User punya token  -> launchUrl berisi token yang benar.
 *  4. READ-ONLY: setelah endpoint dipanggil, blast_access_token di DB tidak berubah.
 *  5. User tak dikenal  -> 404.
 *  6. GET /users tetap tidak membocorkan hash/token, tapi mengirim hasBlastToken.
 *
 * Dijalankan di atas DB terpisah via DATABASE_PATH supaya DB produksi tidak tersentuh.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blastlink-'));
const DB_PATH = path.join(tmp, 'wa.db');
const PORT = 3400 + Math.floor(Math.random() * 200);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' :: ' + extra : ''}`); }
};

// --- seed DB terpisah lewat skrip seed yang sudah ada ---
function runSeed() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(BACKEND, 'scripts', '_seed-reset-pin.mjs')], {
      env: { ...process.env, DATABASE_PATH: DB_PATH },
      stdio: 'inherit',
    });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('seed exit ' + c))));
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(BACKEND, 'dist', 'server.js')], {
      env: { ...process.env, DATABASE_PATH: DB_PATH, PORT: String(PORT), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); if (/listening|ready|started/i.test(out)) resolve(p); });
    p.stderr.on('data', (d) => { out += d.toString(); });
    p.on('exit', (c) => reject(new Error(`server exit ${c}: ${out.slice(-400)}`)));
    setTimeout(() => resolve(p), 4000);
  });
}

const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const j = async (r) => { try { return await r.json(); } catch { return null; } };

async function main() {
  await runSeed();
  const srv = await startServer();

  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const adminKey = db.prepare("SELECT api_key FROM users WHERE role='admin' LIMIT 1").get()?.api_key;
  const users = db.prepare("SELECT id, email, role, blast_access_token FROM users").all();
  const admin = users.find((u) => u.role === 'admin');
  const withToken = users.find((u) => u.role !== 'admin' && u.blast_access_token);
  const withoutToken = users.find((u) => u.role !== 'admin' && !u.blast_access_token);
  const normalKey = db.prepare("SELECT api_key FROM users WHERE role!='admin' AND blast_access_token IS NOT NULL LIMIT 1").get()?.api_key;
  db.close();

  console.log('\n== 1. Kontrol akses ==');
  let r = await fetch(`${BASE}/users/${withToken.id}/blast-link`);
  ok('tanpa auth -> 401', r.status === 401, 'status=' + r.status);

  r = await fetch(`${BASE}/users/${withToken.id}/blast-link`, { headers: { 'x-api-key': normalKey } });
  ok('non-admin -> akses DITOLAK', r.status === 401 || r.status === 403, 'status=' + r.status);

  console.log('\n== 2. User yang sudah punya token ==');
  r = await fetch(`${BASE}/users/${withToken.id}/blast-link`, { headers: { 'x-api-key': adminKey } });
  let body = await j(r);
  ok('status 200', r.status === 200, 'status=' + r.status);
  ok('hasToken true', body?.hasToken === true);
  ok('launchUrl memuat token asli', !!body?.launchUrl && body.launchUrl.includes(withToken.blast_access_token));
  ok('launchUrl mengarah ke /auth/launch', /\/auth\/launch\?token=/.test(body?.launchUrl || ''), body?.launchUrl);
  ok('tidak mengirim blast_access_token mentah sebagai field', !('blastAccessToken' in (body || {})));

  console.log('\n== 3. User yang BELUM punya token (read-only, jangan terbitkan) ==');
  r = await fetch(`${BASE}/users/${withoutToken.id}/blast-link`, { headers: { 'x-api-key': adminKey } });
  body = await j(r);
  ok('status 200', r.status === 200, 'status=' + r.status);
  ok('hasToken false', body?.hasToken === false);
  ok('launchUrl null', body?.launchUrl === null);
  ok('ada pesan penjelas', typeof body?.message === 'string' && body.message.length > 10);

  const db2 = new DatabaseSync(DB_PATH, { readOnly: true });
  const after = db2.prepare('SELECT blast_access_token FROM users WHERE id = ?').get(withoutToken.id);
  db2.close();
  ok('READ-ONLY: token TIDAK diterbitkan', after.blast_access_token === null, 'jadi=' + after.blast_access_token);

  console.log('\n== 4. User tidak dikenal ==');
  r = await fetch(`${BASE}/users/usr_tidakada/blast-link`, { headers: { 'x-api-key': adminKey } });
  ok('-> 404', r.status === 404, 'status=' + r.status);

  console.log('\n== 5. GET /users tidak bocorkan rahasia ==');
  r = await fetch(`${BASE}/users`, { headers: { 'x-api-key': adminKey } });
  body = await j(r);
  const sample = body?.users?.[0] || {};
  ok('passwordHash tidak dikirim', !('passwordHash' in sample));
  ok('blastPinHash tidak dikirim', !('blastPinHash' in sample));
  ok('blastAccessToken tidak dikirim', !('blastAccessToken' in sample));
  ok('hasBlastPin ada', 'hasBlastPin' in sample);
  ok('hasBlastToken ada', 'hasBlastToken' in sample);
  const uWith = body?.users?.find((u) => u.id === withToken.id);
  const uWithout = body?.users?.find((u) => u.id === withoutToken.id);
  ok('hasBlastToken true utk pemilik token', uWith?.hasBlastToken === true);
  ok('hasBlastToken false utk yang belum', uWithout?.hasBlastToken === false);

  console.log('\n== 6. Admin sendiri ==');
  r = await fetch(`${BASE}/users/${admin.id}/blast-link`, { headers: { 'x-api-key': adminKey } });
  ok('admin bisa lihat link-nya sendiri', r.status === 200, 'status=' + r.status);

  srv.kill('SIGKILL');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

  console.log(`\n===== HASIL: ${pass} PASS, ${fail} FAIL =====`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
