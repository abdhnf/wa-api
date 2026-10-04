/**
 * Uji end-to-end alur reset password lewat HTTP sungguhan.
 *
 * Yang diuji bukan fungsi satuan, melainkan perjalanan lengkap:
 *
 *   1. SMTP sink lokal menangkap email yang dikirim backend.
 *   2. POST /auth/forgot-password -> token dibuat, email terkirim.
 *   3. Token diambil DARI EMAIL yang tertangkap (bukan dari database), lalu
 *      dibuka seperti pengguna mengklik tautannya.
 *   4. GET /auth/reset-password/verify -> token valid.
 *   5. POST /auth/reset-password -> password berubah.
 *   6. Login dengan password baru -> berhasil.
 *   7. Tautan yang sama dipakai lagi -> ditolak.
 *
 * Langkah 3 penting: mengambil token dari isi email membuktikan tautan yang
 * benar-benar diterima pengguna itu berfungsi, bukan hanya token yang kita
 * sisipkan sendiri ke database.
 *
 * Jalankan: DATABASE_PATH=/tmp/e2e-reset.db node scripts/uji-e2e-reset.mjs
 */

import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as tunggu } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dbPath = process.env.DATABASE_PATH;
if (!dbPath || !/^\/tmp\/|^\/var\/tmp\//.test(dbPath)) {
  console.error('FATAL: DATABASE_PATH wajib menunjuk ke /tmp.');
  console.error('Jalankan: DATABASE_PATH=/tmp/e2e-reset.db node scripts/uji-e2e-reset.mjs');
  process.exit(1);
}

const PORT_SMTP = 2526;
const PORT_HTTP = 3199;
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
// SMTP sink: cukup untuk menerima satu email dan menyimpannya.
// Tidak perlu lengkap — yang penting DATA-nya tertangkap utuh.
// ============================================================
const emailTertangkap = [];

const smtp = createServer((socket) => {
  let mode = 'perintah';
  let buffer = '';
  let dataEmail = '';
  let penerima = '';

  socket.write('220 sink.local ESMTP siap\r\n');

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');

    while (true) {
      if (mode === 'data') {
        // Di mode DATA, kita baca sampai baris "\r\n.\r\n".
        const akhir = buffer.indexOf('\r\n.\r\n');
        if (akhir === -1) return;
        dataEmail += buffer.slice(0, akhir);
        buffer = buffer.slice(akhir + 5);
        emailTertangkap.push({ ke: penerima, isi: dataEmail });
        dataEmail = '';
        mode = 'perintah';
        socket.write('250 2.0.0 OK: diterima\r\n');
        continue;
      }

      const idx = buffer.indexOf('\r\n');
      if (idx === -1) return;
      const baris = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const atas = baris.toUpperCase();

      if (atas.startsWith('EHLO') || atas.startsWith('HELO')) {
        socket.write('250-sink.local\r\n250 AUTH PLAIN LOGIN\r\n');
      } else if (atas.startsWith('AUTH')) {
        socket.write('235 2.7.0 Autentikasi berhasil\r\n');
      } else if (atas.startsWith('MAIL FROM')) {
        socket.write('250 2.1.0 OK\r\n');
      } else if (atas.startsWith('RCPT TO')) {
        penerima = baris.replace(/^RCPT TO:\s*<?/i, '').replace(/>?\s*$/, '');
        socket.write('250 2.1.5 OK\r\n');
      } else if (atas.startsWith('DATA')) {
        mode = 'data';
        socket.write('354 Kirim data, akhiri dengan .\r\n');
      } else if (atas.startsWith('QUIT')) {
        socket.write('221 2.0.0 Bye\r\n');
        socket.end();
      } else if (atas.startsWith('RSET') || atas.startsWith('NOOP')) {
        socket.write('250 2.0.0 OK\r\n');
      } else {
        socket.write('250 2.0.0 OK\r\n');
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
const { db } = await import('../dist/db.js');
const { createUser, setSettings } = await import('../dist/db.js');
const { hashPassword } = await import('../dist/security.js');

const EMAIL = 'e2e@example.com';
const PASSWORD_LAMA = 'password-awal-123';
const PASSWORD_BARU = 'password-baru-456';

createUser({
  name: 'Pengguna E2E',
  email: EMAIL,
  passwordHash: hashPassword(PASSWORD_LAMA),
  role: 'user',
  apiKey: 'wa_e2e_reset_0001',
  quotaPerDay: 100,
  status: 'active',
});

// Arahkan pengiriman ke sink lokal. Tidak ada autentikasi — sekaligus menguji
// jalur "SMTP tanpa login" yang dipakai Mailpit.
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
  mail_reset_ttl_minutes: '30',
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
    JWT_SECRET: 'rahasia-uji-e2e',
    PANEL_BASE_URL: 'http://127.0.0.1:5174',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logServer = '';
server.stdout.on('data', (d) => (logServer += d.toString()));
server.stderr.on('data', (d) => (logServer += d.toString()));

// Tunggu backend siap — bukan sekadar tidur, tapi mengecek endpoint health.
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
  console.error('FATAL: backend tidak siap. Log:');
  console.error(logServer.slice(-3000));
  server.kill();
  smtp.close();
  process.exit(1);
}
console.log('Backend siap.\n');

function bereskan() {
  try { server.kill(); } catch {}
  try { smtp.close(); } catch {}
}
process.on('exit', bereskan);

// ============================================================
// 1. Minta tautan reset
// ============================================================
console.log('== 1. Permintaan reset ==');

const r1 = await fetch(`${BASE}/auth/forgot-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL }),
});
const b1 = await r1.json();
cek('HTTP 200', r1.status === 200, `status ${r1.status}`);
cek('membalas success:true', b1.success === true);
cek(
  'pesan tidak mengonfirmasi email terdaftar',
  /kalau email tersebut terdaftar/i.test(b1.message || ''),
  b1.message
);

// Tunggu email sampai (pengiriman asinkron dari sisi server).
for (let i = 0; i < 40 && emailTertangkap.length === 0; i++) await tunggu(250);

cek('email tertangkap SMTP sink', emailTertangkap.length > 0, `jumlah: ${emailTertangkap.length}`);

const email = emailTertangkap[0];
if (!email) {
  console.error('\nTidak ada email tertangkap. Log server:');
  console.error(logServer.slice(-3000));
  process.exit(1);
}

// ============================================================
// 2. Isi email
// ============================================================
console.log('\n== 2. Isi email ==');

cek('dikirim ke alamat yang benar', email.ke.includes(EMAIL), email.ke);
cek('ada header Subject', /^Subject:/im.test(email.isi));
cek('subjek menyebut atur ulang password', /atur ulang password/i.test(email.isi));
cek('bertipe multipart (HTML + teks)', /multipart\/alternative/i.test(email.isi));
cek('memuat versi HTML', /<html/i.test(email.isi));
cek('memuat palet panel (warna pine)', /#\s*1f6f5c|#1F6F5C|pine/i.test(email.isi) || /background-color:#/i.test(email.isi));
cek('ada tombol/tautan reset', /reset-password\?token=/i.test(email.isi));
cek('menyebut masa berlaku 30 menit', /30 menit/i.test(email.isi));

/**
 * Decode quoted-printable.
 *
 * nodemailer meng-encode badan email dengan QP begitu ada karakter non-ASCII
 * (tanda pisah "—" sudah cukup). Akibatnya tanda "=" menjadi "=3D" dan baris
 * panjang dipotong dengan soft break "=\r\n". Token di dalam tautan ikut
 * terpotong, jadi harus didecode dulu sebelum bisa dicocokkan.
 */
function decodeQuotedPrintable(teks) {
  return teks
    .replace(/=\r?\n/g, '') // soft line break
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

const emailTerbaca = decodeQuotedPrintable(email.isi);

// Ekstrak token DARI EMAIL — inilah yang membuktikan tautan asli berfungsi.
const cocok = emailTerbaca.match(/reset-password\?token=([a-f0-9]{64})/i);
cek('token 64 hex ditemukan di dalam email', Boolean(cocok), 'pola token tidak ditemukan');

if (!cocok) {
  console.error('\nIsi email (potongan):');
  console.error(email.isi.slice(0, 2000));
  process.exit(1);
}
const tokenDariEmail = cocok[1];

// ============================================================
// 3. Verifikasi token lewat HTTP
// ============================================================
console.log('\n== 3. Verifikasi token ==');

const r2 = await fetch(`${BASE}/auth/reset-password/verify?token=${tokenDariEmail}`);
const b2 = await r2.json();
cek('HTTP 200', r2.status === 200);
cek('token dinyatakan valid', b2.valid === true, b2.message);
cek('nama pengguna dikembalikan', b2.name === 'Pengguna E2E', b2.name);

const r2b = await fetch(`${BASE}/auth/reset-password/verify?token=${'a'.repeat(64)}`);
const b2b = await r2b.json();
cek('token palsu ditolak', b2b.valid === false);

// ============================================================
// 4. Ganti password
// ============================================================
console.log('\n== 4. Ganti password ==');

const r3 = await fetch(`${BASE}/auth/reset-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: tokenDariEmail, password: PASSWORD_BARU }),
});
const b3 = await r3.json();
cek('HTTP 200', r3.status === 200, JSON.stringify(b3));
cek('membalas success:true', b3.success === true, b3.error);

// ============================================================
// 5. Token sekali pakai
// ============================================================
console.log('\n== 5. Token sekali pakai ==');

const r4 = await fetch(`${BASE}/auth/reset-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token: tokenDariEmail, password: 'password-lain-789' }),
});
cek('pemakaian kedua ditolak (HTTP 400)', r4.status === 400, `status ${r4.status}`);

// ============================================================
// 6. Login dengan password baru
// ============================================================
console.log('\n== 6. Login ==');

const r5 = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD_BARU }),
});
const b5 = await r5.json();
cek('login dengan password BARU berhasil', r5.status === 200 && Boolean(b5.token), JSON.stringify(b5).slice(0, 200));

const r6 = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD_LAMA }),
});
cek('login dengan password LAMA gagal', r6.status !== 200, `status ${r6.status}`);

// ============================================================
// 7. Anti-enumerasi lewat HTTP
// ============================================================
console.log('\n== 7. Anti-enumerasi ==');

const r7 = await fetch(`${BASE}/auth/forgot-password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'tidak-ada-sama-sekali@example.com' }),
});
const b7 = await r7.json();
cek('email tidak terdaftar tetap dibalas 200', r7.status === 200, `status ${r7.status}`);
cek('pesannya identik dengan email terdaftar', b7.message === b1.message);

// ============================================================
// 8. Pengaturan email lewat HTTP (admin)
// ============================================================
console.log('\n== 8. Pengaturan email ==');

const r8 = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }),
});
const b8 = await r8.json();
cek('login admin bootstrap berhasil', Boolean(b8.token), JSON.stringify(b8).slice(0, 150));

if (b8.token) {
  const r9 = await fetch(`${BASE}/settings`, {
    headers: { Authorization: `Bearer ${b8.token}` },
  });
  const b9 = await r9.json();
  cek('GET /settings mengembalikan blok mail', Boolean(b9?.settings?.mail), JSON.stringify(b9).slice(0, 200));
  cek('password TIDAK dikirim utuh (bertopeng)', b9?.settings?.mail?.pass === '••••••••' || b9?.settings?.mail?.pass === '');
  cek('preset provider tersedia', Array.isArray(b9?.mailPresets) && b9.mailPresets.length >= 5, `jumlah: ${b9?.mailPresets?.length}`);
  cek('preset memuat Brevo', (b9?.mailPresets || []).some((p) => p.id === 'brevo'));

  const r10 = await fetch(`${BASE}/settings/mail`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b8.token}` },
    body: JSON.stringify({ resetTtlMenit: 45 }),
  });
  const b10 = await r10.json();
  cek('PATCH konfigurasi email berhasil', r10.status === 200 && b10.success === true, JSON.stringify(b10));

  const r11 = await fetch(`${BASE}/settings/mail`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${b8.token}` },
    body: JSON.stringify({ fromAddress: 'bukan-email' }),
  });
  cek('alamat pengirim tidak valid ditolak', r11.status === 400, `status ${r11.status}`);

  const r12 = await fetch(`${BASE}/settings/mail/test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${b8.token}` },
  });
  const b12 = await r12.json();
  cek('uji koneksi SMTP berhasil ke sink', r12.status === 200 && b12.success === true, JSON.stringify(b12));
}

// ============================================================
console.log(`\n== Ringkasan ==`);
console.log(`  Lulus: ${lulus}`);
console.log(`  Gagal: ${gagal}`);
console.log(gagal === 0 ? '\n  SEMUA UJI E2E LULUS\n' : '\n  ADA UJI YANG GAGAL\n');

bereskan();
process.exit(gagal === 0 ? 0 : 1);
