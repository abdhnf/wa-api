/**
 * Membuat pratinjau HTML dari template email.
 *
 * Berguna untuk memeriksa tampilan email tanpa harus mengirim sungguhan dan
 * membuka kotak surat. Hasilnya bisa dibuka langsung di browser.
 *
 * Jalankan dari direktori backend:
 *   node scripts/generate-preview-email.mjs
 *
 * Hasil ditulis ke direktori yang diberikan lewat argumen pertama, atau ke
 * ../pratinjau-email secara bawaan.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  templateResetPassword,
  templateEmailUji,
  templateRegistrasiBerhasil,
  bangunTautanReset,
  BRAND,
} from '../dist/mail-templates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const keluaran = resolve(process.argv[2] || join(__dirname, '..', 'pratinjau-email'));
mkdirSync(keluaran, { recursive: true });

// Token contoh. Hanya untuk tampilan — bukan token yang bisa dipakai.
const TOKEN_CONTOH = 'Kj7mQ2xR9pLv4TnW8sYb3AcE6dGh1FzU';
const BASIS_URL = 'http://172.30.30.229:5174';

const tautan = bangunTautanReset(BASIS_URL, TOKEN_CONTOH);

const emailReset = templateResetPassword({
  namaPenerima: 'srvx',
  tautan,
  ttlMenit: 30,
  alamatIp: '103.147.8.22',
});

const emailUji = templateEmailUji({ tujuan: 'admin@abdhnf.com' });

// Email registrasi dibuat dua versi karena isinya memang berbeda: pendaftar
// lewat Google belum punya nomor WhatsApp dan perlu diarahkan melengkapinya.
const emailDaftarManual = templateRegistrasiBerhasil({
  namaPenerima: 'srvx',
  email: 'srvx@example.com',
  metode: 'manual',
  kuotaPerHari: 100,
  kuotaPerMinggu: 700,
  butuhNomorWa: false,
  tautanPanel: BASIS_URL,
});

const emailDaftarGoogle = templateRegistrasiBerhasil({
  namaPenerima: 'srvx',
  email: 'srvx@gmail.com',
  metode: 'google',
  kuotaPerHari: 100,
  kuotaPerMinggu: 700,
  butuhNomorWa: true,
  tautanPanel: BASIS_URL,
});

writeFileSync(join(keluaran, 'email-reset-password.html'), emailReset);
writeFileSync(join(keluaran, 'email-uji-konfigurasi.html'), emailUji);
writeFileSync(join(keluaran, 'email-daftar-manual.html'), emailDaftarManual);
writeFileSync(join(keluaran, 'email-daftar-google.html'), emailDaftarGoogle);

const halaman = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pratinjau Email ${BRAND.nama}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px;
    background: #f4f1e8;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #1c2b23;
  }
  .kepala { max-width: 1240px; margin: 0 auto 24px; }
  h1 { font-size: 19px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .kepala p { margin: 0; font-size: 13px; color: #5c6b62; }
  .kisi {
    max-width: 1240px; margin: 0 auto;
    display: grid; gap: 20px;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  }
  .kartu {
    background: #fff; border: 1px solid #e2ddcd; border-radius: 8px;
    overflow: hidden; display: flex; flex-direction: column;
  }
  .kartu header {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    padding: 12px 16px; border-bottom: 1px solid #e2ddcd; background: #fbfaf6;
  }
  .kartu h2 { font-size: 13px; margin: 0; font-weight: 600; }
  .kartu header span { font-size: 11px; color: #77857b; }
  iframe { width: 100%; height: 720px; border: 0; background: #fff; }
  .catatan {
    max-width: 1240px; margin: 24px auto 0;
    font-size: 12px; color: #5c6b62; line-height: 1.7;
  }
  .catatan code {
    background: #eae5d8; padding: 1px 5px; border-radius: 4px;
    font-size: 11px;
  }
</style>
</head>
<body>
  <div class="kepala">
    <h1>Pratinjau email ${BRAND.nama}</h1>
    <p>Tampilan sebenarnya dari template yang dikirim ke pengguna. Lebar di bawah didekatkan ke lebar klien email desktop.</p>
  </div>

  <div class="kisi">
    <div class="kartu">
      <header>
        <h2>Reset Password</h2>
        <span>tautan berlaku 30 menit</span>
      </header>
      <iframe src="email-reset-password.html" title="Pratinjau email reset password"></iframe>
    </div>

    <div class="kartu">
      <header>
        <h2>Uji Konfigurasi</h2>
        <span>dikirim dari halaman Pengaturan</span>
      </header>
      <iframe src="email-uji-konfigurasi.html" title="Pratinjau email uji konfigurasi"></iframe>
    </div>

    <div class="kartu">
      <header>
        <h2>Pendaftaran — Form Manual</h2>
        <span>nomor WhatsApp sudah diisi</span>
      </header>
      <iframe src="email-daftar-manual.html" title="Pratinjau email pendaftaran form manual"></iframe>
    </div>

    <div class="kartu">
      <header>
        <h2>Pendaftaran — Google</h2>
        <span>belum ada nomor WhatsApp</span>
      </header>
      <iframe src="email-daftar-google.html" title="Pratinjau email pendaftaran lewat Google"></iframe>
    </div>
  </div>

  <div class="catatan">
    <p>
      Tautan di dalam pratinjau <strong>tidak berfungsi</strong> — tokennya contoh, bukan token nyata.
      Tujuannya hanya memeriksa tampilan. Untuk mencoba alur yang sebenarnya, pakai
      <code>Uji Koneksi</code> di halaman Pengaturan panel.
    </p>
    <p>
      Tampilan email di klien sungguhan bisa sedikit berbeda karena banyak klien menghapus
      sebagian CSS. Susunannya sengaja memakai tabel dan gaya sebaris agar tetap utuh.
    </p>
  </div>
</body>
</html>
`;

writeFileSync(join(keluaran, 'index.html'), halaman);

console.log(`Selesai. ${5} berkas ditulis ke: ${keluaran}`);
console.log('  index.html                    - halaman pratinjau');
console.log('  email-reset-password.html     - email reset password');
console.log('  email-uji-konfigurasi.html    - email uji konfigurasi');
console.log('  email-daftar-manual.html      - email pendaftaran form manual');
console.log('  email-daftar-google.html      - email pendaftaran lewat Google');
