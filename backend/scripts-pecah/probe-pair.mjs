/**
 * Buktikan apakah status /sessions/:id/pair dan /sessions/:id/qr memang tidak
 * deterministik — atau justru regresi akibat pemecahan.
 *
 * Caranya: jalankan DIST YANG SAMA berulang kali dan catat status kedua route.
 * Kalau satu dist saja sudah menghasilkan status berbeda antar-jalankan, maka
 * perbedaan itu sifat route-nya (proses pairing WhatsApp yang bergantung waktu
 * dan jaringan), bukan akibat pemecahan berkas.
 *
 * Jalankan: node scripts-pecah/probe-pair.mjs /tmp/banding/dist-asli 4
 */
import { spawn } from 'node:child_process';
import { setTimeout as tunggu } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const DIST = process.argv[2] || '/tmp/banding/dist-asli';
const ULANG = Number(process.argv[3] || 4);
const DB = '/tmp/probe-pair.db';
const PORT = 3196;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

async function sekali(jalankanKe) {
  for (const s of ['', '-shm', '-wal']) {
    try {
      rmSync(DB + s);
    } catch {}
  }

  const server = spawn('node', ['server.js'], {
    cwd: DIST,
    env: {
      ...process.env,
      DATABASE_PATH: DB,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      JWT_SECRET: 'probe',
      ADMIN_EMAIL: 'admin@abdhnf.com',
      ADMIN_PASSWORD: 'admin123',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', () => {});

  let siap = false;
  for (let i = 0; i < 40; i++) {
    await tunggu(250);
    try {
      if ((await fetch(`${BASE}/health`)).ok) {
        siap = true;
        break;
      }
    } catch {}
  }
  if (!siap) {
    server.kill('SIGKILL');
    return { run: jalankanKe, pair: 'server-mati', qr: 'server-mati' };
  }

  const H = { 'content-type': 'application/json' };
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email: 'admin@abdhnf.com', password: 'admin123' }),
  });
  const token = login.ok ? (await login.json()).token : null;
  const H2 = { ...H, authorization: `Bearer ${token}` };

  const ses = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: H2,
    body: JSON.stringify({ name: 'probe' }),
  });
  const sj = await ses.json().catch(() => null);
  const sid = sj?.id || sj?.session?.id;

  let pair = '-';
  let qr = '-';
  if (sid) {
    try {
      const r = await fetch(`${BASE}/sessions/${sid}/pair`, { method: 'POST', headers: H2, body: '{}' });
      pair = r.status;
    } catch (e) {
      pair = `ERR`;
    }
    try {
      const r = await fetch(`${BASE}/sessions/${sid}/qr`, { headers: H2 });
      qr = r.status;
    } catch (e) {
      qr = `ERR`;
    }
  }

  server.kill('SIGTERM');
  await tunggu(700);
  server.kill('SIGKILL');
  return { run: jalankanKe, pair, qr };
}

console.log(`  dist   : ${DIST}`);
console.log(`  ulangan: ${ULANG}`);
console.log();
console.log('  jalankan | pair | qr');
console.log('  ---------+------+-----');
const hasil = [];
for (let i = 1; i <= ULANG; i++) {
  const h = await sekali(i);
  hasil.push(h);
  console.log(`  ${String(i).padStart(8)} | ${String(h.pair).padStart(4)} | ${String(h.qr).padStart(4)}`);
}

const pairSet = [...new Set(hasil.map((h) => String(h.pair)))];
const qrSet = [...new Set(hasil.map((h) => String(h.qr)))];
console.log();
console.log(`  nilai pair yang muncul : ${pairSet.join(', ')}`);
console.log(`  nilai qr yang muncul   : ${qrSet.join(', ')}`);
console.log();
if (pairSet.length > 1 || qrSet.length > 1) {
  console.log('  KESIMPULAN: status kedua route TIDAK DETERMINISTIK pada dist ini.');
  console.log('  Perbedaan antar-build karena itu bukan bukti regresi.');
} else {
  console.log('  KESIMPULAN: status konsisten pada dist ini.');
}
