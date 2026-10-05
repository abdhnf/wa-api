/**
 * Bandingkan permukaan HTTP dist ASLI vs dist hasil PEMECAHAN.
 *
 * Cara kerja: jalankan kedua dist bergantian di atas DB /tmp yang sama, login
 * sebagai admin, lalu tembak SETIAP route yang terdaftar dengan metode yang
 * benar. Status code dibandingkan satu per satu.
 *
 * Daftar route dibaca dari /tmp/route-list.json yang dihasilkan dari server.ts
 * asli — bukan ditulis manual. Percobaan menulisnya manual sebelumnya meleset
 * total (72 route karangan yang tidak cocok dengan 74 route nyata).
 *
 * Parameter :id diganti nilai contoh yang sah supaya rute sampai ke handler,
 * bukan ditolak di lapisan validasi path.
 *
 * Jalankan: node scripts-pecah/banding-http.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as tunggu } from 'node:timers/promises';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const DB = '/tmp/banding-http.db';
const PORT = 3197;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;

const ROUTES = JSON.parse(readFileSync('/tmp/route-list.json', 'utf8'));

/** Ganti parameter path dengan nilai contoh; :id tetap "sess_uji" agar formatnya sah. */
function isiParameter(jalur, id) {
  let p = jalur.replace(/:batchId/g, id.batch || 'bat_uji');
  // :id dipetakan sesuai awalan route: id user untuk /users, id sesi untuk
  // /sessions, dan seterusnya. Tanpa ini, rute ber-:id menjawab 404 di kedua
  // versi dan handler-nya tidak pernah diuji.
  if (p.startsWith('/admin/users/')) p = p.replace(/:id/g, id.user || 'usr_uji');
  else if (p.startsWith('/users/')) p = p.replace(/:id/g, id.user || 'usr_uji');
  else if (p.startsWith('/sessions/')) p = p.replace(/:id/g, id.session || 'sess_uji');
  else if (p.startsWith('/messages/')) p = p.replace(/:id/g, id.message || 'msg_uji');
  else p = p.replace(/:id/g, id.session || 'sess_uji');
  return p;
}

/**
 * Siapkan objek nyata di DB uji supaya rute ber-:id benar-benar sampai ke
 * handler, bukan berhenti di 404 "tidak ditemukan".
 */
async function siapkanObjek(headers) {
  const id = {};

  const kirim = async (jalur, body) => {
    try {
      const r = await fetch(BASE + jalur, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => null);
      return j;
    } catch {
      return null;
    }
  };

  const u = await kirim('/users', {
    name: 'Uji Banding',
    email: `uji-banding-${Date.now()}@contoh.local`,
    password: 'rahasia123',
  });
  id.user = u?.id || u?.user?.id || null;

  const s = await kirim('/sessions', { name: 'uji-banding' });
  id.session = s?.id || s?.session?.id || null;

  const w = await kirim('/webhooks', { url: 'https://contoh.local/hook', events: ['sent'] });
  id.webhook = w?.id || null;

  return id;
}

/** Body contoh per route supaya validasi skema tidak menolak sebelum handler jalan. */
const BODY_CONTOH = {
  'POST /auth/login': { email: 'x@y.z', password: 'salah' },
  'POST /auth/register': { email: 'a@b.c', password: 'rahasia123' },
  'POST /auth/forgot-password': { email: 'x@y.z' },
  'POST /auth/reset-password': { token: 'x', password: 'rahasia123' },
  'POST /users': { email: 'a@b.c', password: 'rahasia123' },
  'PATCH /users/:id': {},
  'POST /users/:id/reset-password': { password: 'rahasia123' },
  'POST /sessions': { nama: 'uji' },
  'POST /messages/send': { sessionId: 'sess_uji', to: '628123', text: 'hai' },
};

async function jalankan(distDir, label) {
  // DB segar per versi: kalau kedua versi berbagi DB, versi kedua mewarisi data
  // yang dibuat versi pertama sehingga perbedaan bisa tersamarkan.
  for (const s of ['', '-shm', '-wal']) {
    try {
      rmSync(DB + s);
    } catch {}
  }

  const server = spawn('node', ['server.js'], {
    cwd: distDir,
    env: {
      ...process.env,
      DATABASE_PATH: DB,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      JWT_SECRET: 'banding',
      // Kredensial bootstrap DB /tmp. Tanpa ini, DB segar membuat
      // admin@example.com dan seluruh rute berproteksi hanya menjawab 401 —
      // handler-nya tidak pernah benar-benar diuji.
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
      if ((await fetch(`${BASE}/health`)).ok) {
        siap = true;
        break;
      }
    } catch {}
  }
  if (!siap) {
    server.kill('SIGKILL');
    console.error(`  ${label}: server TIDAK naik. Log:\n${log.slice(-800)}`);
    process.exit(1);
  }

  // Login admin: rute berproteksi diuji sebagai pengguna sah, bukan anonim.
  let token = null;
  try {
    const r = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@abdhnf.com', password: 'admin123' }),
    });
    if (r.ok) token = (await r.json()).token;
  } catch {}

  const hasil = {};
  const H = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const bersama = token ? await siapkanObjek(H) : {};
  console.log(`    objek uji: user=${bersama.user || '-'} session=${bersama.session || '-'} webhook=${bersama.webhook || '-'}`);

  for (const [metode, pola] of ROUTES) {
    // Rute ber-:id memakai objek SEGAR, bukan objek bersama. Alasannya: rute
    // seperti POST /sessions/:id/logout dan DELETE /sessions/:id merusak objek
    // yang dipakai bersama, sehingga rute berikutnya (pair, qr) gagal karena
    // warisan keadaan — bukan karena kodenya berbeda. Tanpa pemisahan ini,
    // perbandingan menghasilkan perbedaan palsu.
    let id = bersama;
    if (pola.includes(':') && token) {
      id = await siapkanObjek(H);
    }

    const jalur = isiParameter(pola, id);
    const kunci = `${metode} ${pola}`;
    try {
      const r = await fetch(BASE + jalur, {
        method: metode,
        headers: H,
        body: metode === 'GET' || metode === 'DELETE'
          ? undefined
          : JSON.stringify(BODY_CONTOH[`${metode} ${pola}`] ?? {}),
      });
      const teks = await r.text();

      // Bentuk respons: nama-nama field pada tingkat teratas, diurutkan.
      // Nilainya tidak dibandingkan (memuat id acak dan waktu), tapi KUNCI-nya
      // dibandingkan — kalau ada field yang hilang atau berubah nama, itu
      // regresi kontrak yang harus terlihat.
      let bentuk = `non-json:${teks.length}`;
      try {
        const j = JSON.parse(teks);
        if (Array.isArray(j)) {
          bentuk = `array[${j.length}]`;
        } else if (j && typeof j === 'object') {
          bentuk = Object.keys(j).sort().join(',');
        } else {
          bentuk = `primitif:${typeof j}`;
        }
      } catch {}

      hasil[kunci] = { status: r.status, bentuk };
    } catch (e) {
      hasil[kunci] = { status: `ERR:${e.message}`, bentuk: '-' };
    }
  }

  server.kill('SIGTERM');
  await tunggu(800);
  server.kill('SIGKILL');

  return { hasil, token, log };
}

const ASLI = process.argv[2] || '/tmp/banding/dist-asli';
const BARU = process.argv[3] || '/tmp/banding/dist-pecahan';
const LABEL_A = process.argv[4] || 'ASLI';
const LABEL_B = process.argv[5] || 'PECAHAN';
for (const d of [ASLI, BARU]) {
  if (!existsSync(d)) {
    console.error(`FATAL: ${d} tidak ada. Build dulu.`);
    process.exit(1);
  }
}

console.log(`  ${ROUTES.length} route akan dibandingkan.`);
console.log(`  Menjalankan ${LABEL_A} (${ASLI})...`);
const a = await jalankan(ASLI, LABEL_A);
console.log(`    token admin: ${a.token ? 'dapat' : 'TIDAK dapat'}`);

console.log(`  Menjalankan ${LABEL_B} (${BARU})...`);
const b = await jalankan(BARU, LABEL_B);
console.log(`    token admin: ${b.token ? 'dapat' : 'TIDAK dapat'}`);

console.log();
console.log('  PERBANDINGAN STATUS + BENTUK RESPONS');
let beda = 0;
let hilang404 = 0;
for (const k of Object.keys(a.hasil)) {
  const x = a.hasil[k];
  const y = b.hasil[k];
  if (x.status !== y.status || x.bentuk !== y.bentuk) {
    beda++;
    if (y.status === 404) hilang404++;
    console.log(`  BEDA  ${k.padEnd(44)}`);
    console.log(`        asli    : status=${x.status}  bentuk=${x.bentuk}`);
    console.log(`        pecahan : status=${y.status}  bentuk=${y.bentuk}`);
  }
}

if (beda === 0) {
  console.log(`  ${Object.keys(a.hasil).length} route: status DAN bentuk respons IDENTIK.`);
} else {
  console.log(`  Total berbeda: ${beda} (404 di pecahan: ${hilang404})`);
}

console.log();
console.log('  Ringkasan status (asli -> pecahan):');
const hitung = {};
for (const k of Object.keys(a.hasil)) {
  const key = `${a.hasil[k].status} -> ${b.hasil[k].status}`;
  hitung[key] = (hitung[key] || 0) + 1;
}
for (const [k, v] of Object.entries(hitung).sort()) {
  console.log(`    ${k.padEnd(18)} ${v} route`);
}

// Route 404 di KEDUA versi berarti tidak terdaftar di dua-duanya — bukan regresi,
// tapi tetap dilaporkan supaya tidak dikira aman. Penyebabnya nilai contoh yang
// tidak ada di DB /tmp, bukan route hilang.
const kosong = Object.keys(a.hasil).filter((k) => a.hasil[k].status === 404 && b.hasil[k].status === 404);
if (kosong.length) {
  console.log();
  console.log(`  404 di KEDUA versi (${kosong.length} route) — objek contohnya tidak ada di DB uji:`);
  for (const k of kosong) console.log(`    ${k}`);
}

process.exit(beda === 0 ? 0 : 1);
