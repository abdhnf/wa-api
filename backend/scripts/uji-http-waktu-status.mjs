/**
 * Uji END-TO-END: apakah `statusTimes` benar-benar sampai ke panel.
 *
 * Uji unit di `uji-waktu-status.mjs` membuktikan DB mencatat waktunya. Uji ini
 * membuktikan lapisan yang lebih sering bocor: apakah nilainya IKUT TERKIRIM di
 * respons HTTP `GET /messages/:sessionId` — endpoint yang dibaca RealtimeMonitor,
 * Command Center, dan Playground. Kalau `mapMessageRow` atau serialisasi payload
 * diam-diam memangkasnya, panel akan menerima `undefined` tanpa error apa pun.
 *
 * Server dijalankan dari dist dengan DB terisolasi, jadi tidak menyentuh data
 * nyata dan tidak menyentuh sesi WhatsApp mana pun.
 */
import { spawn } from 'node:child_process';
import { setTimeout as tunggu } from 'node:timers/promises';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'uji-http-waktu-'));
const DB = join(dir, 'uji.db');
const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

let lulus = 0;
let gagal = 0;
function cek(nama, benar, bukti = '') {
  if (benar) lulus++; else gagal++;
  console.log(`  ${benar ? 'OK   ' : 'GAGAL'}  ${nama}${bukti ? `  — ${bukti}` : ''}`);
}

const server = spawn('node', ['server.js'], {
  cwd: new URL('../dist/', import.meta.url).pathname,
  env: {
    ...process.env,
    DATABASE_PATH: DB,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    JWT_SECRET: 'uji-waktu',
    ADMIN_EMAIL: 'admin@abdhnf.com',
    ADMIN_PASSWORD: 'admin123',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d));
server.stderr.on('data', (d) => (log += d));

let siap = false;
for (let i = 0; i < 40; i++) {
  await tunggu(250);
  try {
    if ((await fetch(`${BASE}/health`)).ok) { siap = true; break; }
  } catch {}
}
if (!siap) {
  server.kill('SIGKILL');
  console.error(`  server TIDAK naik:\n${log.slice(-900)}`);
  process.exit(1);
}

// Login admin supaya rute berproteksi diuji sebagai pengguna sah.
const rl = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@abdhnf.com', password: 'admin123' }),
});
const dl = await rl.json();
const token = dl?.token || dl?.accessToken || dl?.data?.token;
cek('login admin berhasil', !!token, `status ${rl.status}`);
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

console.log('\n[1] Kirim pesan lewat API asli -> masuk antrean');
const rKirim = await fetch(`${BASE}/messages/send`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ sessionId: 'sess-uji-http', to: '628123456789', text: 'uji waktu status' }),
});
const dKirim = await rKirim.json().catch(() => ({}));
cek('permintaan diterima', rKirim.status < 500, `status ${rKirim.status}`);
// Kontrak respons: `{ success, messageId, type, status, jitterDelayMs }`.
// Bukan `id` — nama field itu yang dipakai endpoint ini.
const pesanId = dKirim?.messageId;
cek('id pesan dikembalikan', !!pesanId, String(pesanId));

console.log('\n[2] GET /messages/:sessionId — endpoint yang dibaca panel');
const rList = await fetch(`${BASE}/messages/sess-uji-http`, { headers: H });
const dList = await rList.json().catch(() => ({}));
cek('daftar pesan terbaca', rList.status === 200, `status ${rList.status}`);
const daftar = dList?.messages || dList?.data || [];
cek('ada minimal 1 pesan', Array.isArray(daftar) && daftar.length > 0, `${daftar.length} pesan`);

const p = daftar[0] || {};
console.log('\n[3] statusTimes IKUT TERKIRIM di respons HTTP');
cek('field statusTimes ada di respons', p.statusTimes !== undefined, JSON.stringify(p.statusTimes));
cek('statusTimes berisi status awal', typeof p.statusTimes?.queued === 'number',
  `queued=${p.statusTimes?.queued}`);
cek('statusTimes.queued cocok dengan created_at',
  p.statusTimes?.queued === Date.parse(p.timestamp),
  `${p.statusTimes?.queued} vs ${Date.parse(p.timestamp)}`);
cek('field lain tidak rusak', p.id === pesanId && p.status === 'queued' && p.to === '628123456789',
  `id=${p.id} status=${p.status} to=${p.to}`);

console.log('\n[4] GET /messages/status/:id — dipakai pemantauan status tunggal');
const rStatus = await fetch(`${BASE}/messages/status/${pesanId}`, { headers: H });
const dStatus = await rStatus.json().catch(() => ({}));
cek('status terbaca', rStatus.status === 200, `status ${rStatus.status}`);
const ps = dStatus?.message;
cek('statusTimes ikut di endpoint status tunggal', ps?.statusTimes !== undefined,
  JSON.stringify(ps?.statusTimes));
cek('statusTimes.queued sama dengan di daftar', ps?.statusTimes?.queued === p.statusTimes?.queued,
  `${ps?.statusTimes?.queued} vs ${p.statusTimes?.queued}`);

console.log('\n[5] Endpoint lain tidak rusak (regresi)');
for (const jalur of ['/health', '/settings', '/sessions']) {
  const r = await fetch(`${BASE}${jalur}`, { headers: H });
  cek(`GET ${jalur}`, r.status < 500, `status ${r.status}`);
}

console.log(`\n${'='.repeat(56)}`);
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('='.repeat(56));

server.kill('SIGKILL');
await tunggu(300);
rmSync(dir, { recursive: true, force: true });
process.exit(gagal === 0 ? 0 : 1);
