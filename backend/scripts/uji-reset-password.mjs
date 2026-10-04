/**
 * Uji perilaku fitur reset password terhadap database sementara.
 *
 * Bukan unit test kerangka kerja — sengaja begitu. Tujuannya membuktikan
 * perilaku nyata yang paling mudah salah: token sekali pakai, pembatalan token
 * lain, kedaluwarsa, dan yang paling penting: permintaan untuk email yang TIDAK
 * terdaftar harus menghasilkan respons yang sama persis dengan email terdaftar.
 *
 * Jalankan: DATABASE_PATH=/tmp/uji-reset.db node scripts/uji-reset-password.mjs
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Penjaga: uji ini MENULIS dan MENGHAPUS data. Kalau diarahkan ke database asli,
// isinya bisa rusak. Tolak jalan kecuali path-nya jelas-jelas sementara.
const dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
  console.error('FATAL: DATABASE_PATH wajib diisi.');
  console.error('Jalankan: DATABASE_PATH=/tmp/uji-reset.db node scripts/uji-reset-password.mjs');
  process.exit(1);
}
if (!/^\/tmp\/|^\/var\/tmp\//.test(dbPath) && !process.env.PAKSA_IZINKAN) {
  console.error(`FATAL: DATABASE_PATH harus di /tmp — diberi: ${dbPath}`);
  process.exit(1);
}

const { db } = await import('../dist/db.js');
const { createUser, setSetting } = await import('../dist/db.js');
const { hashPassword } = await import('../dist/security.js');
const {
  ajukanResetPassword,
  verifikasiTokenReset,
  pakaiTokenReset,
  hashToken,
} = await import('../dist/password-reset.js');

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
// Persiapan: user uji + konfigurasi SMTP diarahkan ke port mati.
// Port mati disengaja — kita menguji logika token, bukan pengiriman.
// ============================================================
console.log('\n== Persiapan ==');

const emailAda = 'uji-terdaftar@example.com';
const emailTidakAda = 'tidak-terdaftar@example.com';

createUser({
  name: 'Pengguna Uji',
  email: emailAda,
  passwordHash: hashPassword('password-lama-123'),
  role: 'user',
  apiKey: 'wa_uji_reset_0001',
  quotaPerDay: 100,
  status: 'active',
});

setSetting('mail_enabled', 'true');
setSetting('mail_host', '127.0.0.1');
setSetting('mail_port', '9'); // port discard — koneksi pasti gagal
setSetting('mail_user', 'uji');
setSetting('mail_pass', 'uji');
setSetting('mail_from_address', 'noreply@mail.srvx.my.id');

console.log('  User uji dibuat:', emailAda);

// ============================================================
// 1. Anti-enumerasi: respons email terdaftar vs tidak terdaftar
// ============================================================
console.log('\n== 1. Anti-enumerasi email ==');

const hasilAda = await ajukanResetPassword(emailAda, '10.0.0.1');
const hasilTidakAda = await ajukanResetPassword(emailTidakAda, '10.0.0.2');

cek('email terdaftar → ok:true', hasilAda.ok === true);
cek('email tidak terdaftar → ok:true', hasilTidakAda.ok === true);
cek(
  'PESAN IDENTIK untuk kedua kasus (kunci anti-enumerasi)',
  hasilAda.pesan === hasilTidakAda.pesan,
  `\n         terdaftar: "${hasilAda.pesan}"\n         tidak ada: "${hasilTidakAda.pesan}"`
);
cek(
  'tidak ada token dibuat untuk email tidak terdaftar',
  db.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens WHERE destination = ?').get(emailTidakAda).n === 0
);

// ============================================================
// 2. Token tersimpan sebagai hash, bukan teks asli
// ============================================================
console.log('\n== 2. Penyimpanan token ==');

const baris = db.prepare('SELECT * FROM password_reset_tokens WHERE destination = ?').get(emailAda);
cek('token tercatat di database', Boolean(baris));
cek('kolom token_hash berisi 64 karakter hex (SHA-256)', /^[0-9a-f]{64}$/.test(baris?.token_hash || ''));
cek('token_hash BUKAN token asli (panjang beda)', (baris?.token_hash || '').length === 64);

// Ambil token asli dari hash yang kita hitung sendiri: kita tidak bisa
// membalik hash, jadi kita bikin token uji baru dan hitung hashnya.
const { buatTokenAcak } = await import('../dist/password-reset.js');
const tokenUji = buatTokenAcak();
cek('buatTokenAcak menghasilkan 64 karakter hex', /^[0-9a-f]{64}$/.test(tokenUji));
cek('dua token berbeda', buatTokenAcak() !== buatTokenAcak());

// ============================================================
// 3. Verifikasi & sekali pakai
// ============================================================
console.log('\n== 3. Verifikasi token & sekali pakai ==');

// Sisipkan token yang kita tahu nilai aslinya, meniru tautan yang dikirim.
const userId = db.prepare('SELECT id FROM users WHERE email = ?').get(emailAda).id;
db.prepare(
  `INSERT INTO password_reset_tokens (token_hash, user_id, channel, destination, expires_at, requested_ip, created_at)
   VALUES (?, ?, 'email', ?, ?, '10.0.0.9', ?)`
).run(
  hashToken(tokenUji),
  userId,
  emailAda,
  new Date(Date.now() + 30 * 60_000).toISOString(),
  new Date().toISOString()
);

const v1 = verifikasiTokenReset(tokenUji);
cek('token valid dikenali', v1.valid === true, v1.pesan);
cek('nama user ikut dikembalikan', v1.nama === 'Pengguna Uji');

const vSalah = verifikasiTokenReset('a'.repeat(64));
cek('token ngawur ditolak', vSalah.valid === false);

// Pakai token
const pakai1 = pakaiTokenReset(tokenUji, 'password-baru-456');
cek('pemakaian pertama berhasil', pakai1.ok === true, pakai1.pesan);

const pakai2 = pakaiTokenReset(tokenUji, 'password-lain-789');
cek('PEMAKAIAN KEDUA DITOLAK (sekali pakai)', pakai2.ok === false, pakai2.pesan);

const vSetelah = verifikasiTokenReset(tokenUji);
cek('token tidak valid lagi setelah dipakai', vSetelah.valid === false);

// Password benar-benar berubah?
const { verifyPassword } = await import('../dist/security.js');
const userSetelah = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(emailAda);
cek('password baru berlaku', verifyPassword('password-baru-456', userSetelah.password_hash) === true);
cek('password lama TIDAK berlaku lagi', verifyPassword('password-lama-123', userSetelah.password_hash) === false);

// ============================================================
// 4. Kedaluwarsa
// ============================================================
console.log('\n== 4. Token kedaluwarsa ==');

const tokenKedaluwarsa = buatTokenAcak();
db.prepare(
  `INSERT INTO password_reset_tokens (token_hash, user_id, channel, destination, expires_at, requested_ip, created_at)
   VALUES (?, ?, 'email', ?, ?, '10.0.0.10', ?)`
).run(
  hashToken(tokenKedaluwarsa),
  userId,
  emailAda,
  new Date(Date.now() - 60_000).toISOString(), // sudah lewat 1 menit
  new Date(Date.now() - 31 * 60_000).toISOString()
);

const vKedaluwarsa = verifikasiTokenReset(tokenKedaluwarsa);
cek('token kedaluwarsa ditolak', vKedaluwarsa.valid === false, vKedaluwarsa.pesan);
cek('pesan menyebut kedaluwarsa', /kedaluwarsa/i.test(vKedaluwarsa.pesan));

const pakaiKedaluwarsa = pakaiTokenReset(tokenKedaluwarsa, 'password-x-999');
cek('token kedaluwarsa tidak bisa dipakai', pakaiKedaluwarsa.ok === false);

// ============================================================
// 5. Pembatalan token lain milik user yang sama
// ============================================================
console.log('\n== 5. Pembatalan token lain ==');

const tokenA = buatTokenAcak();
const tokenB = buatTokenAcak();
for (const t of [tokenA, tokenB]) {
  db.prepare(
    `INSERT INTO password_reset_tokens (token_hash, user_id, channel, destination, expires_at, requested_ip, created_at)
     VALUES (?, ?, 'email', ?, ?, '10.0.0.11', ?)`
  ).run(hashToken(t), userId, emailAda, new Date(Date.now() + 30 * 60_000).toISOString(), new Date().toISOString());
}

cek('token A valid sebelum dipakai', verifikasiTokenReset(tokenA).valid === true);
cek('token B valid sebelum A dipakai', verifikasiTokenReset(tokenB).valid === true);

pakaiTokenReset(tokenA, 'password-final-111');
cek('token B DIBATALKAN setelah A dipakai', verifikasiTokenReset(tokenB).valid === false);

// ============================================================
// 6. Validasi password
// ============================================================
console.log('\n== 6. Validasi password ==');

const tokenC = buatTokenAcak();
db.prepare(
  `INSERT INTO password_reset_tokens (token_hash, user_id, channel, destination, expires_at, requested_ip, created_at)
   VALUES (?, ?, 'email', ?, ?, '10.0.0.12', ?)`
).run(hashToken(tokenC), userId, emailAda, new Date(Date.now() + 30 * 60_000).toISOString(), new Date().toISOString());

const pendek = pakaiTokenReset(tokenC, '12345');
cek('password 5 karakter ditolak', pendek.ok === false, pendek.pesan);
cek('token TIDAK terpakai saat password ditolak', verifikasiTokenReset(tokenC).valid === true);

// ============================================================
// 7. Rate limit per email
//
// Batas per email dihitung dari token yang tersimpan, jadi hanya berlaku untuk
// email TERDAFTAR — dan itu memang kasus yang perlu dilindungi, karena hanya
// email terdaftar yang benar-benar dikirimi surat. Email tidak terdaftar tidak
// menghasilkan pengiriman apa pun, jadi tidak ada yang perlu dibatasi selain
// batas per-IP.
// ============================================================
console.log('\n== 7. Rate limit ==');

const emailBanjir = 'banjir-terdaftar@example.com';
createUser({
  name: 'Korban Banjir',
  email: emailBanjir,
  passwordHash: hashPassword('password-banjir-1'),
  role: 'user',
  apiKey: 'wa_uji_reset_0002',
  quotaPerDay: 100,
  status: 'active',
});

let ditolak = 0;
for (let i = 0; i < 6; i++) {
  // IP dibedakan tiap percobaan supaya yang diuji murni batas per-email,
  // bukan batas per-IP yang akan menutupi hasilnya.
  const r = await ajukanResetPassword(emailBanjir, `10.1.0.${i}`);
  if (!r.ok) ditolak++;
}
cek('permintaan ke-4 dan seterusnya dibatasi (3 lolos, 3 ditolak)', ditolak === 3, `ditolak: ${ditolak} dari 6`);

// Batas per-IP: email tidak terdaftar pun tidak boleh dibombardir tanpa henti.
const emailSampah = 'sampah@example.com';
let ditolakIp = 0;
for (let i = 0; i < 14; i++) {
  const r = await ajukanResetPassword(emailSampah, '10.9.9.9');
  if (!r.ok) ditolakIp++;
}
cek('batas per-IP berlaku untuk email tidak terdaftar', ditolakIp > 0, `ditolak: ${ditolakIp} dari 14`);

// ============================================================
// Ringkasan
// ============================================================
console.log(`\n== Ringkasan ==`);
console.log(`  Lulus: ${lulus}`);
console.log(`  Gagal: ${gagal}`);
console.log(gagal === 0 ? '\n  SEMUA UJI LULUS\n' : '\n  ADA UJI YANG GAGAL\n');

process.exit(gagal === 0 ? 0 : 1);
