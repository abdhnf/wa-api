/**
 * Uji: basis URL panel konsisten dan bisa diatur dari tabel `settings`.
 *
 * Yang dibuktikan (bukan sekadar build hijau):
 *  A. Nilai dari tabel `settings` MENANG atas env — sebelumnya tautan reset
 *     password mengabaikan tabel dan selalu memakai env.
 *  B. Tanpa nilai di tabel, env dipakai (perilaku cadangan tetap utuh).
 *  C. PATCH /settings menolak nilai tanpa skema http/https (400).
 *  D. PATCH /settings menyimpan nilai yang sah, dan GET mengembalikannya.
 *  E. Email SELAMAT DATANG memakai basis yang sama — kedua jalur konsisten.
 *
 * Dijalankan di atas DB terpisah; DB produksi tidak tersentuh.
 *
 * Jalankan: DATABASE_PATH=/tmp/e2e-base-url.db node scripts/uji-base-url-panel.mjs
 */
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as tunggu } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dbPath = process.env.DATABASE_PATH;
if (!dbPath || !/^\/tmp\/|^\/var\/tmp\//.test(dbPath)) {
  console.error('FATAL: DATABASE_PATH wajib menunjuk ke /tmp.');
  process.exit(1);
}

const PORT_SMTP = 2531;
const PORT_HTTP = 3211;
const BASE = `http://127.0.0.1:${PORT_HTTP}/api/v1`;
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootBackend = join(__dirname, '..');

// Nilai yang sengaja BERBEDA antara env dan tabel, supaya bisa dibuktikan
// mana yang benar-benar dipakai.
const URL_ENV = 'http://127.0.0.1:5174';
const URL_TABEL = 'https://panel-dari-tabel.uji.example';

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
// SMTP sink — menangkap email sungguhan yang dikirim backend.
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
      } else {
        socket.write('250 2.0.0 OK\r\n');
      }
    }
  });
  socket.on('error', () => {});
});

await new Promise((r) => smtp.listen(PORT_SMTP, '127.0.0.1', r));

// ============================================================
// Siapkan DB uji
// ============================================================
const { createUser, setSettings } = await import('../dist/db.js');
const { hashPassword } = await import('../dist/security.js');

const EMAIL_USER = 'uji-basurl-user@uji.local';
const EMAIL_ADMIN = 'uji-basurl-admin@uji.local';
const PASSWORD = 'rahasia-uji-123';

createUser({
  name: 'Pengguna Basis URL',
  email: EMAIL_USER,
  passwordHash: hashPassword(PASSWORD),
  role: 'user',
  apiKey: 'wa_uji_basurl_user_0001',
  quotaPerDay: 100,
  status: 'active',
});

createUser({
  name: 'Admin Basis URL',
  email: EMAIL_ADMIN,
  passwordHash: hashPassword(PASSWORD),
  role: 'admin',
  apiKey: 'wa_uji_basurl_admin_0001',
  quotaPerDay: 1000,
  status: 'active',
});

// SMTP ke sink lokal. `panel_base_url` SENGAJA tidak diisi di sini.
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
    JWT_SECRET: 'rahasia-uji-basurl',
    PANEL_BASE_URL: URL_ENV,
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
    if (r.ok) { siap = true; break; }
  } catch { /* belum siap */ }
}

if (!siap) {
  console.error('FATAL: backend tidak siap. Log:');
  console.error(logServer.slice(-3000));
  server.kill();
  smtp.close();
  process.exit(1);
}
console.log('Backend siap.\n');

/** Decode quoted-printable supaya token di tautan bisa dicocokkan. */
function decodeQP(teks) {
  return teks
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Minta reset password dan kembalikan email yang tertangkap. */
async function mintaResetDanTungguEmail() {
  emailTertangkap.length = 0;
  await fetch(`${BASE}/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL_USER }),
  });
  for (let i = 0; i < 40 && emailTertangkap.length === 0; i++) await tunggu(250);
  return emailTertangkap[0] || null;
}

/** Ambil token login admin untuk memanggil PATCH /settings. */
async function loginAdmin() {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL_ADMIN, password: PASSWORD }),
  });
  const b = await r.json();
  return b.token || b.accessToken || b.data?.token || null;
}

const tokenAdmin = await loginAdmin();
if (!tokenAdmin) {
  console.error('FATAL: gagal login admin. Log:');
  console.error(logServer.slice(-2000));
  server.kill();
  smtp.close();
  process.exit(1);
}
const authHeader = { Authorization: `Bearer ${tokenAdmin}`, 'Content-Type': 'application/json' };

try {
  // ============================================================
  // A. Tabel MENANG atas env
  // ============================================================
  console.log('== A. Nilai dari tabel settings harus menang atas env ==');

  const rSet = await fetch(`${BASE}/settings`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify({ panelBaseUrl: URL_TABEL }),
  });
  cek('PATCH /settings menerima panelBaseUrl', rSet.status === 200, `status ${rSet.status}`);

  const emailA = await mintaResetDanTungguEmail();
  cek('email reset tertangkap', Boolean(emailA));
  if (emailA) {
    const isiA = decodeQP(emailA.isi);
    cek(
      'tautan reset memakai nilai dari TABEL (bukan env)',
      isiA.includes(`${URL_TABEL}/reset-password`),
      `mencari "${URL_TABEL}/reset-password"`
    );
    cek(
      'tautan reset TIDAK memakai nilai env',
      !isiA.includes(`${URL_ENV}/reset-password`),
      `env "${URL_ENV}" seharusnya tidak muncul`
    );
  }

  // ============================================================
  // B. Cadangan ke env saat tabel kosong
  // ============================================================
  console.log('\n== B. Tabel kosong -> jatuh ke env ==');

  const rKosong = await fetch(`${BASE}/settings`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify({ panelBaseUrl: '' }),
  });
  cek('PATCH menerima nilai kosong', rKosong.status === 200, `status ${rKosong.status}`);

  const emailB = await mintaResetDanTungguEmail();
  cek('email reset tertangkap', Boolean(emailB));
  if (emailB) {
    const isiB = decodeQP(emailB.isi);
    cek(
      'tautan reset jatuh ke nilai env',
      isiB.includes(`${URL_ENV}/reset-password`),
      `mencari "${URL_ENV}/reset-password"`
    );
  }

  // ============================================================
  // C. Validasi nilai tanpa skema
  // ============================================================
  console.log('\n== C. Validasi nilai tidak sah ==');

  for (const buruk of ['172.30.30.229:5174', 'ftp://contoh.local', 'https://ada spasi.local']) {
    const r = await fetch(`${BASE}/settings`, {
      method: 'PATCH',
      headers: authHeader,
      body: JSON.stringify({ panelBaseUrl: buruk }),
    });
    cek(`ditolak 400: "${buruk}"`, r.status === 400, `status ${r.status}`);
  }

  // Nilai yang ditolak tidak boleh tersimpan.
  const emailC = await mintaResetDanTungguEmail();
  if (emailC) {
    const isiC = decodeQP(emailC.isi);
    cek(
      'nilai tidak sah TIDAK tersimpan (email tetap pakai env)',
      isiC.includes(`${URL_ENV}/reset-password`),
      'seharusnya masih memakai env'
    );
  }

  // ============================================================
  // D. GET mengembalikan nilai tersimpan
  // ============================================================
  console.log('\n== D. GET /settings mengembalikan panelBaseUrl ==');

  await fetch(`${BASE}/settings`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify({ panelBaseUrl: URL_TABEL }),
  });
  const rGet = await fetch(`${BASE}/settings`, { headers: authHeader });
  const bGet = await rGet.json();
  cek(
    'GET /settings memuat panelBaseUrl',
    bGet?.settings?.panelBaseUrl === URL_TABEL,
    `nilai: ${bGet?.settings?.panelBaseUrl}`
  );

  // Garis miring di ujung dibuang agar tidak jadi "//" saat digabung path.
  await fetch(`${BASE}/settings`, {
    method: 'PATCH',
    headers: authHeader,
    body: JSON.stringify({ panelBaseUrl: `${URL_TABEL}/` }),
  });
  const rGet2 = await fetch(`${BASE}/settings`, { headers: authHeader });
  const bGet2 = await rGet2.json();
  cek(
    'garis miring di ujung dibuang',
    bGet2?.settings?.panelBaseUrl === URL_TABEL,
    `nilai: ${bGet2?.settings?.panelBaseUrl}`
  );

  // ============================================================
  // E. Email selamat datang memakai basis yang sama
  // ============================================================
  console.log('\n== E. Email selamat datang konsisten dengan reset password ==');

  emailTertangkap.length = 0;
  await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Pendaftar Basis URL',
      email: 'pendaftar-basurl@uji.local',
      password: PASSWORD,
      phone: '6281234567899',
    }),
  });
  for (let i = 0; i < 40 && emailTertangkap.length === 0; i++) await tunggu(250);

  const emailE = emailTertangkap[0];
  cek('email selamat datang tertangkap', Boolean(emailE));
  if (emailE) {
    const isiE = decodeQP(emailE.isi);
    cek(
      'tautan email selamat datang memakai basis yang SAMA',
      isiE.includes(URL_TABEL),
      `mencari "${URL_TABEL}"`
    );
  }
} catch (err) {
  console.error('\nERROR tak terduga:', err);
  gagal++;
} finally {
  server.kill();
  smtp.close();
}

console.log(`\n=== ${lulus} LULUS / ${gagal} GAGAL ===`);
if (gagal > 0) {
  console.log('\nLog server (ekor):');
  console.log(logServer.slice(-2000));
}
process.exit(gagal === 0 ? 0 : 1);
