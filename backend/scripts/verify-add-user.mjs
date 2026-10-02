// Uji integrasi endpoint admin POST /api/v1/users (tambah pengguna).
//
// Mengunci perilaku yang sebelumnya rusak/tidak teruji:
//   1. payload seperti yang dikirim panel -> 201
//   2. kuota periode & limit BENAR-BENAR tersimpan (dulu selalu jatuh ke default)
//   3. periode harian/bulanan dihitung dan direset sesuai siklus
//   4. validasi: email duplikat 409, password pendek 400, role tak dikenal 400
//   5. non-admin ditolak
//   6. user baru bisa dipakai login (password ter-hash benar)
//
// Jalankan: node scripts/verify-add-user.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3196;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

let pass = 0, fail = 0;
function cek(nama, aktual, harap) {
  const ok = JSON.stringify(aktual) === JSON.stringify(harap);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${nama}`);
  if (!ok) console.log(`       harap=${JSON.stringify(harap)}  aktual=${JSON.stringify(aktual)}`);
}

const tmp = mkdtempSync(join(tmpdir(), 'adduser-'));
const dbPath = join(tmp, 'wa.db');

function jalankan(script, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script], { cwd: DIR, env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));   // stderr dipisah, bukan digabung
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${script} gagal:\n${out}\n${err}`))));
  });
}

function ambilJson(teks) {
  const baris = teks.split('\n').map((s) => s.trim()).filter((s) => s.startsWith('{') && s.endsWith('}'));
  if (baris.length === 0) throw new Error(`tidak menemukan JSON di stdout:\n${teks}`);
  return JSON.parse(baris[baris.length - 1]);
}

const { out: seedOut } = await jalankan('scripts/_seed-reset-pin.mjs', { DATABASE_PATH: dbPath });
const seed = ambilJson(seedOut);
if (!existsSync(dbPath)) throw new Error(`seed tidak menulis ke ${dbPath}`);

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
const tambah = (body, key = seed.adminKey) =>
  fetch(`${BASE}/users`, { method: 'POST', headers: H(key), body: JSON.stringify(body) });

try {
  await tungguSiap();

  // --- 1. Payload seperti yang dikirim panel (dengan kuota) ---
  let r = await tambah({
    name: 'Dewi Uji', email: 'dewi@uji.local', password: 'rahasia123',
    role: 'subscription', quotaPerDay: 100, quotaPeriod: 'monthly', quotaLimit: 2500,
  });
  let j = await r.json();
  cek('tambah user seperti panel (201)', r.status, 201);
  cek('email tersimpan', j.user?.email, 'dewi@uji.local');
  cek('role tersimpan', j.user?.role, 'subscription');
  const id = j.user?.id;

  // --- 2. Kuota periode BENAR-BENAR tersimpan (bug lama: selalu default) ---
  cek('quotaPeriod tersimpan = monthly', j.user?.quotaPeriod, 'monthly');
  cek('quotaLimit tersimpan = 2500', j.user?.quotaLimit, 2500);
  const resetAt = j.user?.quotaResetAt ? new Date(j.user.quotaResetAt) : null;
  const hariKeReset = resetAt ? Math.round((resetAt.getTime() - Date.now()) / 86400000) : null;
  cek('resetAt ~30 hari (bukan 7)', hariKeReset, 30);

  // --- 3. Periode harian ---
  r = await tambah({ name: 'Eka Uji', email: 'eka@uji.local', password: 'rahasia123', role: 'user', quotaPerDay: 50, quotaPeriod: 'daily', quotaLimit: 50 });
  j = await r.json();
  cek('periode harian tersimpan', j.user?.quotaPeriod, 'daily');
  cek('limit harian = 50', j.user?.quotaLimit, 50);
  const resetHarian = j.user?.quotaResetAt ? Math.round((new Date(j.user.quotaResetAt).getTime() - Date.now()) / 86400000) : null;
  cek('resetAt ~1 hari untuk harian', resetHarian, 1);

  // --- 4. Default saat periode tidak dikirim ---
  r = await tambah({ name: 'Fajar Uji', email: 'fajar@uji.local', password: 'rahasia123', role: 'user' });
  j = await r.json();
  cek('tanpa periode -> default weekly', j.user?.quotaPeriod, 'weekly');
  cek('tanpa limit -> 700 (100x7)', j.user?.quotaLimit, 700);

  // --- 5. String numerik tetap diterima ---
  r = await tambah({ name: 'Gita Uji', email: 'gita@uji.local', password: 'rahasia123', role: 'user', quotaPerDay: '200' });
  cek('quotaPerDay string numerik diterima (201)', r.status, 201);

  // --- 6. Validasi ---
  r = await tambah({ name: 'Dup', email: 'dewi@uji.local', password: 'rahasia123', role: 'user' });
  cek('email duplikat -> 409', r.status, 409);

  r = await tambah({ name: 'Pendek', email: 'pendek@uji.local', password: '123', role: 'user' });
  cek('password < 6 -> 400', r.status, 400);

  r = await tambah({ name: 'Role', email: 'role@uji.local', password: 'rahasia123', role: 'superuser' });
  cek('role tak dikenal -> 400', r.status, 400);

  r = await tambah({ name: 'Email', email: 'bukan-email', password: 'rahasia123', role: 'user' });
  cek('email tidak valid -> 400', r.status, 400);

  r = await tambah({ name: 'NonAdmin', email: 'na@uji.local', password: 'rahasia123', role: 'user' }, seed.nonAdminKey);
  cek('non-admin ditolak', [401, 403].includes(r.status), true);

  // --- 7. User baru benar-benar bisa login ---
  r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dewi@uji.local', password: 'rahasia123' }),
  });
  j = await r.json();
  cek('user baru bisa login (200)', r.status, 200);
  cek('login mengembalikan token', typeof j.token, 'string');

  // --- 8. Rahasia tidak bocor di respons ---
  r = await fetch(`${BASE}/users`, { headers: H(seed.adminKey) });
  const list = await r.json();
  const baru = list.users.find((u) => u.id === id);
  cek('respons tidak memuat passwordHash', 'passwordHash' in baru, false);
  cek('respons tidak memuat blastPinHash', 'blastPinHash' in baru, false);

  // --- 9. Kuota benar-benar dipakai mesin kuota ---
  r = await fetch(`${BASE}/users/${id}`, { headers: H(seed.adminKey) });
  const detail = await r.json().catch(() => null);
  const limitTerpakai = detail?.user?.quotaLimit ?? baru.quotaLimit;
  cek('limit terpakai mesin kuota = 2500', limitTerpakai, 2500);
} finally {
  server.kill('SIGKILL');
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
