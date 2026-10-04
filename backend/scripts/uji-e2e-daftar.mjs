/**
 * Uji end-to-end pendaftaran akun dan email selamat datang.
 *
 * Yang diuji adalah perjalanan lengkap lewat HTTP sungguhan, bukan fungsi
 * satuan. Email benar-benar dikirim ke SMTP sink lokal dan isinya dibaca
 * kembali, sehingga yang diperiksa adalah email yang sungguh diterima
 * pengguna — bukan template yang dipanggil langsung dari kode.
 *
 * Cakupan:
 *
 *   1. Pendaftaran form manual TANPA nomor WhatsApp -> email terkirim, isinya
 *      memuat ajakan melengkapi nomor.
 *   2. Pendaftaran form manual DENGAN nomor WhatsApp -> email terkirim, isinya
 *      TIDAK memuat ajakan itu, dan nomor tersimpan dalam bentuk kanonik 628...
 *   3. Nomor yang tidak valid ditolak, pendaftaran tidak jadi.
 *   4. Nomor yang sudah dipakai akun lain ditolak.
 *   5. Pendaftaran lewat Google untuk akun BARU -> email terkirim, respons
 *      memuat `perluOnboarding: true`.
 *   6. Login ulang lewat Google dengan akun yang sama -> TIDAK ada email kedua,
 *      `perluOnboarding` false.
 *   7. PATCH /auth/me melengkapi nomor -> `perluOnboarding` jadi false.
 *   8. Nomor dari onboarding tidak boleh menabrak nomor akun lain.
 *   9. Toggle pendaftaran publik benar-benar menutup endpoint /auth/register.
 *
 * Jalankan: DATABASE_PATH=/tmp/e2e-daftar.db node scripts/uji-e2e-daftar.mjs
 */

import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as tunggu } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dbPath = process.env.DATABASE_PATH;
if (!dbPath || !/^\/tmp\/|^\/var\/tmp\//.test(dbPath)) {
  console.error('FATAL: DATABASE_PATH wajib menunjuk ke /tmp.');
  console.error('Jalankan: DATABASE_PATH=/tmp/e2e-daftar.db node scripts/uji-e2e-daftar.mjs');
  process.exit(1);
}

const PORT_SMTP = 2527;
const PORT_HTTP = 3198;
const BASE = `http://127.0.0.1:${PORT_HTTP}/api/v1`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootBackend = join(__dirname, '..');

let lulus = 0;
let gagal = 0;
function cek(nama, syarat, detail = '') {
  if (syarat) {
    lulus++;
    console.log(`  LULUS  ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}${detail ? ` — ${detail}` : ''}`);
  }
}

// ============================================================
// SMTP sink: menampung semua email yang masuk supaya bisa dihitung
// jumlahnya (untuk membuktikan tidak ada email kedua saat login ulang).
// ============================================================
const emailTertangkap = [];

const smtp = createServer((socket) => {
  let mode = 'perintah';
  let dari = '';
  let ke = [];
  let data = '';

  socket.write('220 sink.local ESMTP siap\r\n');

  socket.on('data', (buf) => {
    const teks = buf.toString('utf8');

    if (mode === 'data') {
      data += teks;
      if (data.includes('\r\n.\r\n')) {
        emailTertangkap.push({ dari, ke: [...ke], isi: data });
        mode = 'perintah';
        data = '';
        socket.write('250 OK tersimpan\r\n');
      }
      return;
    }

    for (const baris of teks.split('\r\n').filter(Boolean)) {
      const atas = baris.toUpperCase();

      if (atas.startsWith('EHLO') || atas.startsWith('HELO')) {
        socket.write('250-sink.local\r\n250 AUTH PLAIN LOGIN\r\n');
      } else if (atas.startsWith('AUTH')) {
        socket.write('235 Autentikasi berhasil\r\n');
      } else if (atas.startsWith('MAIL FROM')) {
        dari = baris.slice(baris.indexOf(':') + 1).trim();
        socket.write('250 OK\r\n');
      } else if (atas.startsWith('RCPT TO')) {
        ke.push(baris.slice(baris.indexOf(':') + 1).trim());
        socket.write('250 OK\r\n');
      } else if (atas.startsWith('DATA')) {
        mode = 'data';
        data = '';
        socket.write('354 Kirim data\r\n');
      } else if (atas.startsWith('QUIT')) {
        socket.write('221 Sampai jumpa\r\n');
        socket.end();
      } else {
        socket.write('250 OK\r\n');
      }
    }
  });

  socket.on('error', () => {});
});

await new Promise((r) => smtp.listen(PORT_SMTP, '127.0.0.1', r));
console.log(`SMTP sink mendengarkan di 127.0.0.1:${PORT_SMTP}`);

// ============================================================
// Siapkan database uji
// ============================================================
const { db, createUser, setSettings } = await import('../dist/db.js');
const { hashPassword } = await import('../dist/security.js');

// Akun yang sudah ada, dipakai untuk menguji tabrakan nomor.
createUser({
  name: 'Pemilik Nomor',
  email: 'pemilik@example.com',
  passwordHash: hashPassword('password-lama-123'),
  role: 'user',
  apiKey: 'wa_pemilik0000000000000000000000000001',
  quotaPerDay: 50,
  phone: '628111111111',
  status: 'active',
});

setSettings({
  mail_enabled: 'true',
  mail_provider: 'mailpit',
  mail_host: '127.0.0.1',
  mail_port: String(PORT_SMTP),
  mail_secure: 'false',
  mail_user: '',
  mail_pass: '',
  mail_from_address: 'noreply@mail.srvx.my.id',
  mail_from_name: 'SRVX Apps',
  registration_enabled: 'true',
  google_auth_enabled: 'true',
  google_allowed_domains: '',
});

// ============================================================
// Jalankan backend
// ============================================================
console.log('Menjalankan backend...');
const server = spawn('node', ['dist/server.js'], {
  cwd: rootBackend,
  env: {
    ...process.env,
    DATABASE_PATH: dbPath,
    PORT: String(PORT_HTTP),
    HOST: '127.0.0.1',
    JWT_SECRET: 'rahasia-uji-daftar',
    PANEL_BASE_URL: 'http://127.0.0.1:5174',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logServer = '';
server.stdout.on('data', (d) => (logServer += d.toString()));
server.stderr.on('data', (d) => (logServer += d.toString()));

let siap = false;
for (let i = 0; i < 60; i++) {
  await tunggu(500);
  try {
    const r = await fetch(`${BASE}/health`);
    if (r.ok) {
      siap = true;
      break;
    }
  } catch {
    /* belum siap */
  }
}

if (!siap) {
  console.error('FATAL: backend tidak siap.');
  console.error(logServer.slice(-3000));
  server.kill();
  smtp.close();
  process.exit(1);
}
console.log('Backend siap.\n');

async function minta(jalur, opsi = {}) {
  const r = await fetch(`${BASE}${jalur}`, {
    ...opsi,
    headers: { 'Content-Type': 'application/json', ...(opsi.headers || {}) },
  });
  let isi = null;
  try {
    isi = await r.json();
  } catch {
    /* balasan tanpa body */
  }
  return { status: r.status, body: isi };
}

function post(jalur, data, headers) {
  return minta(jalur, { method: 'POST', body: JSON.stringify(data), headers });
}

/**
 * Decode quoted-printable.
 *
 * Nodemailer mengirim teks non-ASCII (dan baris panjang) dalam bentuk ini, jadi
 * isi email harus didekode dulu sebelum dicocokkan. Tanpa langkah ini, kata
 * seperti "WhatsApp" bisa terpotong oleh soft line break dan pencocokan gagal
 * meski emailnya benar.
 */
function decodeQuotedPrintable(teks) {
  return teks
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Ambil email terakhir untuk alamat tertentu, sudah didekode. */
function emailUntuk(alamat) {
  const cocok = emailTertangkap.filter((e) => e.ke.join(' ').includes(alamat));
  if (cocok.length === 0) return null;
  const terakhir = cocok[cocok.length - 1];
  return { jumlah: cocok.length, isi: decodeQuotedPrintable(terakhir.isi) };
}

/** Tunggu sampai email untuk alamat tertentu muncul (pengiriman asinkron). */
async function tungguEmail(alamat, batasMs = 8000) {
  const mulai = Date.now();
  while (Date.now() - mulai < batasMs) {
    const e = emailUntuk(alamat);
    if (e) return e;
    await tunggu(200);
  }
  return null;
}

// ============================================================
// 1. Pendaftaran manual TANPA nomor WhatsApp
// ============================================================
console.log('--- 1. Daftar manual tanpa nomor WhatsApp ---');
const r1 = await post('/auth/register', {
  name: 'Tanpa Nomor',
  email: 'tanpa-nomor@example.com',
  password: 'rahasia123',
});
cek('pendaftaran berhasil (201)', r1.status === 201, `status: ${r1.status} ${JSON.stringify(r1.body)}`);

const e1 = await tungguEmail('tanpa-nomor@example.com');
cek('email selamat datang terkirim', e1 !== null, 'tidak ada email masuk ke sink');
cek('email ditujukan ke alamat pendaftar', e1?.isi.includes('tanpa-nomor@example.com') === true);
cek('subjek menyebut pendaftaran berhasil', e1?.isi.toLowerCase().includes('pendaftaran') === true);
cek(
  'email memuat ajakan melengkapi nomor WhatsApp',
  e1?.isi.toLowerCase().includes('nomor whatsapp') === true,
  'bagian nomor WhatsApp tidak ditemukan'
);
cek('email memuat angka kuota harian', e1?.isi.includes('100') === true);
cek(
  'email menyebut metode pendaftaran form',
  e1?.isi.toLowerCase().includes('formulir') === true,
  'tidak menyebut formulir'
);

// ============================================================
// 2. Pendaftaran manual DENGAN nomor WhatsApp
// ============================================================
console.log('\n--- 2. Daftar manual dengan nomor WhatsApp ---');
const r2 = await post('/auth/register', {
  name: 'Dengan Nomor',
  email: 'dengan-nomor@example.com',
  password: 'rahasia123',
  phone: '0812-3456-789',
});
cek('pendaftaran berhasil (201)', r2.status === 201, `status: ${r2.status} ${JSON.stringify(r2.body)}`);
cek(
  'nomor disimpan dalam bentuk kanonik 628...',
  r2.body?.user?.phone === '628123456789',
  `tersimpan: ${r2.body?.user?.phone}`
);

const e2 = await tungguEmail('dengan-nomor@example.com');
cek('email selamat datang terkirim', e2 !== null);
cek(
  'email TIDAK memuat ajakan melengkapi nomor',
  e2?.isi.toLowerCase().includes('lengkapi nomor') === false,
  'ajakan melengkapi nomor masih muncul padahal nomor sudah diisi'
);

// Nomor benar-benar tersimpan di database, bukan hanya di respons.
const baris = db.prepare('SELECT phone FROM users WHERE email = ?').get('dengan-nomor@example.com');
cek('nomor tersimpan di database', baris?.phone === '628123456789', `db: ${baris?.phone}`);

// ============================================================
// 3. Nomor tidak valid ditolak
// ============================================================
console.log('\n--- 3. Nomor tidak valid ---');
const r3 = await post('/auth/register', {
  name: 'Nomor Ngawur',
  email: 'nomor-ngawur@example.com',
  password: 'rahasia123',
  phone: 'abc',
});
cek('ditolak dengan 400', r3.status === 400, `status: ${r3.status}`);
cek('pesan galat menyebut format yang benar', /format|valid/i.test(r3.body?.error || ''), r3.body?.error);

const adaNgawur = db.prepare('SELECT id FROM users WHERE email = ?').get('nomor-ngawur@example.com');
cek('akun TIDAK jadi dibuat', adaNgawur === undefined);

// ============================================================
// 4. Nomor yang sudah dipakai ditolak
// ============================================================
console.log('\n--- 4. Nomor sudah dipakai akun lain ---');
const r4 = await post('/auth/register', {
  name: 'Perebut Nomor',
  email: 'perebut@example.com',
  password: 'rahasia123',
  phone: '628111111111',
});
cek('ditolak dengan 409', r4.status === 409, `status: ${r4.status} ${JSON.stringify(r4.body)}`);
cek('pesan galat menyebut nomor sudah dipakai', /sudah dipakai/i.test(r4.body?.error || ''), r4.body?.error);

// ============================================================
// 5. Daftar lewat Google (akun baru)
// ============================================================
console.log('\n--- 5. Daftar lewat Google, akun baru ---');
const r5 = await post('/auth/google', {
  email: 'google-baru@example.com',
  name: 'Pengguna Google',
  googleId: 'gid_uji_baru_001',
});
cek('login Google berhasil (200)', r5.status === 200, `status: ${r5.status} ${JSON.stringify(r5.body)}`);
cek('respons memuat token', typeof r5.body?.token === 'string' && r5.body.token.length > 10);
cek(
  'respons menandai perluOnboarding true',
  r5.body?.perluOnboarding === true,
  `nilai: ${r5.body?.perluOnboarding}`
);
cek('akun Google baru belum punya nomor', !r5.body?.user?.phone, `phone: ${r5.body?.user?.phone}`);

const e5 = await tungguEmail('google-baru@example.com');
cek('email selamat datang terkirim', e5 !== null);
cek(
  'email menyebut pendaftaran via Google',
  e5?.isi.toLowerCase().includes('google') === true,
  'tidak menyebut Google'
);
cek(
  'email mengarahkan melengkapi nomor WhatsApp',
  e5?.isi.toLowerCase().includes('nomor whatsapp') === true
);

// ============================================================
// 6. Login ulang lewat Google TIDAK mengirim email kedua
// ============================================================
console.log('\n--- 6. Login ulang lewat Google ---');
const r6 = await post('/auth/google', {
  email: 'google-baru@example.com',
  name: 'Pengguna Google',
  googleId: 'gid_uji_baru_001',
});
cek('login ulang berhasil', r6.status === 200, `status: ${r6.status}`);
cek(
  'perluOnboarding false untuk akun lama',
  r6.body?.perluOnboarding === false,
  `nilai: ${r6.body?.perluOnboarding}`
);
await tunggu(1500);
const e6 = emailUntuk('google-baru@example.com');
cek('email TIDAK terkirim ulang', e6?.jumlah === 1, `jumlah email: ${e6?.jumlah}`);

// ============================================================
// 7. PATCH /auth/me melengkapi nomor
// ============================================================
console.log('\n--- 7. Melengkapi nomor lewat PATCH /auth/me ---');
const tokenGoogle = r5.body.token;
const r7 = await minta('/auth/me', {
  method: 'PATCH',
  body: JSON.stringify({ phone: '0813-9999-8888' }),
  headers: { Authorization: `Bearer ${tokenGoogle}` },
});
cek('patch berhasil (200)', r7.status === 200, `status: ${r7.status} ${JSON.stringify(r7.body)}`);
cek(
  'nomor tersimpan kanonik 628...',
  r7.body?.user?.phone === '6281399998888',
  `tersimpan: ${r7.body?.user?.phone}`
);
cek(
  'perluOnboarding berubah jadi false',
  r7.body?.user?.perluOnboarding === false,
  `nilai: ${r7.body?.user?.perluOnboarding}`
);

const r7b = await minta('/auth/me', { headers: { Authorization: `Bearer ${tokenGoogle}` } });
cek('GET /auth/me ikut menampilkan nomor', r7b.body?.phone === '6281399998888', `phone: ${r7b.body?.phone}`);
cek('GET /auth/me melaporkan perluOnboarding false', r7b.body?.perluOnboarding === false);

// ============================================================
// 8. Nomor dari onboarding tidak boleh menabrak akun lain
// ============================================================
console.log('\n--- 8. Tabrakan nomor dari onboarding ---');
const r8 = await minta('/auth/me', {
  method: 'PATCH',
  body: JSON.stringify({ phone: '628111111111' }),
  headers: { Authorization: `Bearer ${tokenGoogle}` },
});
cek('ditolak dengan 409', r8.status === 409, `status: ${r8.status} ${JSON.stringify(r8.body)}`);

const masihLama = db.prepare('SELECT phone FROM users WHERE email = ?').get('google-baru@example.com');
cek('nomor lama tidak tertimpa', masihLama?.phone === '6281399998888', `db: ${masihLama?.phone}`);

// Nomor tidak valid lewat PATCH juga ditolak.
const r8b = await minta('/auth/me', {
  method: 'PATCH',
  body: JSON.stringify({ phone: 'xyz' }),
  headers: { Authorization: `Bearer ${tokenGoogle}` },
});
cek('nomor tidak valid ditolak di PATCH', r8b.status === 400, `status: ${r8b.status}`);

// Tanpa token harus 401 — endpoint ini tidak boleh terbuka.
const r8c = await minta('/auth/me', {
  method: 'PATCH',
  body: JSON.stringify({ phone: '628123123123' }),
});
cek('tanpa token ditolak (401)', r8c.status === 401, `status: ${r8c.status}`);

// ============================================================
// 9. Toggle pendaftaran publik benar-benar menutup endpoint
// ============================================================
console.log('\n--- 9. Toggle pendaftaran publik ---');
setSettings({ registration_enabled: 'false' });
const r9 = await post('/auth/register', {
  name: 'Ditolak',
  email: 'ditolak@example.com',
  password: 'rahasia123',
});
cek('pendaftaran ditolak 403 saat toggle mati', r9.status === 403, `status: ${r9.status}`);
cek('pesan galat menyebut ditutup', /ditutup/i.test(r9.body?.error || ''), r9.body?.error);

const adaDitolak = db.prepare('SELECT id FROM users WHERE email = ?').get('ditolak@example.com');
cek('akun tidak dibuat saat pendaftaran ditutup', adaDitolak === undefined);

// Google tetap boleh mendaftar meski form manual ditutup (perilaku lama yang
// dipertahankan — lihat komentar di server.ts).
const r9b = await post('/auth/google', {
  email: 'google-saat-tutup@example.com',
  name: 'Google Saat Tutup',
  googleId: 'gid_uji_tutup_001',
});
cek('Google tetap bisa mendaftar saat form manual ditutup', r9b.status === 200, `status: ${r9b.status}`);

setSettings({ registration_enabled: 'true' });

// ============================================================
// Ringkasan
// ============================================================
console.log(`\n==================== ${lulus} LULUS / ${gagal} GAGAL ====================`);
if (gagal > 0) {
  console.log('\nCuplikan log backend:');
  console.log(logServer.slice(-2000));
}

server.kill();
smtp.close();
process.exit(gagal > 0 ? 1 : 0);
