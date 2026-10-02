// Uji integrasi: endpoint admin POST /api/v1/users/:id/reset-pin.
//
// Menjalankan server backend sungguhan (dist) di atas DB sementara, lalu menguji
// lewat HTTP. Yang dikunci:
//   1. admin bisa memasang PIN baru untuk user lain
//   2. PIN hasil reset BENAR-BENAR bisa dipakai membuka Blast (verify-blast-launch)
//   3. mode hapus (pin kosong) -> PIN hilang, Blast menolak sampai PIN dipasang lagi
//   4. validasi: PIN bukan 6 digit ditolak
//   5. non-admin ditolak (403); user tak dikenal -> 404
//   6. respons daftar user TIDAK membocorkan hash PIN / token blast
//
// Jalankan: node scripts/verify-reset-pin.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

let pass = 0, fail = 0;
function cek(nama, aktual, harap) {
  const ok = JSON.stringify(aktual) === JSON.stringify(harap);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${nama}`);
  if (!ok) console.log(`       harap=${JSON.stringify(harap)}  aktual=${JSON.stringify(aktual)}`);
}

const tmp = mkdtempSync(join(tmpdir(), 'resetpin-'));
const dbPath = join(tmp, 'wa.db');

function jalankan(script, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script], { cwd: DIR, env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    // stderr SENGAJA dipisah, bukan digabung ke stdout. Node menulis
    // ExperimentalWarning (node:sqlite) ke stderr; kalau digabung, baris
    // "(Use `node --trace-warnings ...`)" jadi baris terakhir dan JSON.parse gagal.
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${script} gagal:\n${out}\n${err}`))));
  });
}

// Ambil baris JSON terakhir dari stdout, tanpa bergantung pada urutan baris lain.
function ambilJson(teks) {
  const baris = teks.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('{') && s.endsWith('}'));
  if (baris.length === 0) throw new Error(`tidak menemukan JSON di stdout:\n${teks}`);
  return JSON.parse(baris[baris.length - 1]);
}

// 1. Seed DB
const { out: seedOut, err: seedErr } = await jalankan('scripts/_seed-reset-pin.mjs', { DATABASE_PATH: dbPath });
const seed = ambilJson(seedOut);

// Pastikan seed benar-benar menulis ke DB sementara, bukan DB produksi.
if (!existsSync(dbPath)) throw new Error(`seed tidak membuat DB di ${dbPath} — DATABASE_PATH mungkin diabaikan`);
if (seedErr.trim()) console.log(`(catatan stderr seed) ${seedErr.trim().split('\n')[0]}`);

// 2. Jalankan server uji
const server = spawn(process.execPath, ['dist/server.js'], {
  cwd: DIR,
  env: { ...process.env, DATABASE_PATH: dbPath, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function tungguSiap() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server tidak siap. log:\n${serverLog.slice(-1500)}`);
}

const H = (key) => ({ 'Content-Type': 'application/json', 'X-API-Key': key });
const post = (path, body, key) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: H(key), body: JSON.stringify(body ?? {}) });

try {
  await tungguSiap();

  // --- 1. admin pasang PIN baru ---
  let r = await post(`/users/${seed.targetId}/reset-pin`, { pin: '135790' }, seed.adminKey);
  let j = await r.json();
  cek('admin bisa memasang PIN baru (200)', r.status, 200);
  cek('mode = set', j.mode, 'set');
  cek('hasBlastPin = true', j.hasBlastPin, true);

  // --- 2. PIN hasil reset benar-benar bisa membuka Blast ---
  r = await fetch(`${BASE}/auth/verify-blast-launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: seed.blastToken, pin: '135790' }),
  });
  j = await r.json();
  cek('PIN hasil reset diterima Blast (200)', r.status, 200);
  cek('handshake sukses', j.success, true);

  // PIN lama/salah tetap ditolak
  r = await fetch(`${BASE}/auth/verify-blast-launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: seed.blastToken, pin: '000000' }),
  });
  cek('PIN salah ditolak (401)', r.status, 401);

  // --- 3. mode hapus ---
  r = await post(`/users/${seed.targetId}/reset-pin`, {}, seed.adminKey);
  j = await r.json();
  cek('admin bisa menghapus PIN (200)', r.status, 200);
  cek('mode = cleared', j.mode, 'cleared');
  cek('hasBlastPin = false', j.hasBlastPin, false);

  r = await fetch(`${BASE}/auth/verify-blast-launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: seed.blastToken, pin: '135790' }),
  });
  cek('setelah dihapus, Blast menolak (400)', r.status, 400);

  // --- 4. validasi format PIN ---
  r = await post(`/users/${seed.targetId}/reset-pin`, { pin: '12345' }, seed.adminKey);
  cek('PIN 5 digit ditolak (400)', r.status, 400);
  r = await post(`/users/${seed.targetId}/reset-pin`, { pin: 'abcdef' }, seed.adminKey);
  cek('PIN non-numerik ditolak (400)', r.status, 400);
  r = await post(`/users/${seed.targetId}/reset-pin`, { pin: '1234567' }, seed.adminKey);
  cek('PIN 7 digit ditolak (400)', r.status, 400);

  // --- 5. otorisasi ---
  // requireAdmin yang ada menjawab 401 (jatuh ke jalur JWT) untuk API key non-admin,
  // bukan 403. Yang penting aksesnya DITOLAK — kunci itu, jangan kunci kode spesifiknya.
  r = await post(`/users/${seed.targetId}/reset-pin`, { pin: '111222' }, seed.nonAdminKey);
  cek('non-admin ditolak', [401, 403].includes(r.status), true);
  r = await post('/users/usr_tidakada/reset-pin', { pin: '111222' }, seed.adminKey);
  cek('user tidak dikenal -> 404', r.status, 404);

  // --- 6. tidak membocorkan hash PIN / token blast ---
  r = await fetch(`${BASE}/users`, { headers: H(seed.adminKey) });
  const list = await r.json();
  const target = list.users.find((u) => u.id === seed.targetId);
  cek('daftar user tidak memuat blastPinHash', 'blastPinHash' in target, false);
  cek('daftar user tidak memuat blastAccessToken', 'blastAccessToken' in target, false);
  cek('daftar user tidak memuat passwordHash', 'passwordHash' in target, false);
  cek('daftar user memuat hasBlastPin (boolean)', typeof target.hasBlastPin, 'boolean');

  // --- 7. alur lengkap: pasang ulang lalu masuk lagi ---
  r = await post(`/users/${seed.targetId}/reset-pin`, { pin: '246810' }, seed.adminKey);
  cek('pasang ulang PIN (200)', r.status, 200);
  r = await fetch(`${BASE}/auth/verify-blast-launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: seed.blastToken, pin: '246810' }),
  });
  cek('PIN baru bisa dipakai masuk Blast (200)', r.status, 200);
} finally {
  server.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
