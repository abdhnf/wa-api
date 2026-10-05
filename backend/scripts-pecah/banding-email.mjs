/**
 * Buktikan keluaran template email IDENTIK sebelum vs sesudah pemecahan.
 *
 * Untuk refactor template, membandingkan status HTTP atau nama ekspor saja tidak
 * cukup — yang menentukan adalah STRING HTML yang benar-benar dikirim ke klien
 * email. Berkas ini merender keenam fungsi template dengan masukan yang sama
 * pada dua versi, lalu membandingkan hasilnya karakter per karakter.
 *
 * mail-templates.ts tidak punya impor sama sekali, jadi versi lama bisa
 * dikompilasi berdiri sendiri tanpa menyalin berkas lain.
 *
 * Jalankan: node scripts-pecah/banding-email.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const AKAR = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const LAMA_TS = '/tmp/mail-templates.ts.asli';
const LAMA_DIR = '/tmp/mail-lama';

if (!existsSync(LAMA_TS)) {
  console.error('FATAL: /tmp/mail-templates.ts.asli tidak ada.');
  process.exit(1);
}

// --- 1. Kompilasi versi lama berdiri sendiri -------------------------------
// npx harus dijalankan dari direktori backend: di /tmp tidak ada tsc dan npx
// akan mencoba mengunduhnya (gagal tanpa pesan yang jelas).
mkdirSync(LAMA_DIR, { recursive: true });
writeFileSync(`${LAMA_DIR}/mail-templates.ts`, readFileSync(LAMA_TS));
execFileSync('npx', ['tsc', `${LAMA_DIR}/mail-templates.ts`, '--target', 'es2022', '--module', 'esnext',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--outDir', LAMA_DIR],
  { cwd: AKAR, stdio: 'pipe' });
console.log(`  versi lama dikompilasi: ${LAMA_DIR}/mail-templates.js`);

const lama = await import(pathToFileURL(`${LAMA_DIR}/mail-templates.js`).href);
const baru = await import(pathToFileURL(`${AKAR}/dist/mail-templates.js`).href);

// --- 2. Masukan yang sama untuk kedua versi -------------------------------
const MASUKAN = {
  reset: {
    namaPenerima: 'Budi & <b>Santoso</b>', // sengaja berisi karakter HTML
    tautanReset: 'https://panel.contoh.id/reset?token=abc123&x=1',
    berlakuMenit: 30,
    alamatIp: '103.23.224.70',
  },
  registrasi: {
    namaPenerima: 'Siti "Ayu" <script>alert(1)</script>',
    email: 'siti@contoh.id',
    nomorWhatsapp: '628123456789',
    tautanPanel: 'https://panel.contoh.id/masuk',
    tautanPanduan: 'https://panel.contoh.id/panduan',
  },
  registrasiTanpaNomor: {
    namaPenerima: 'Tanpa Nomor',
    email: 'tanpa@contoh.id',
    nomorWhatsapp: null,
    tautanPanel: 'https://panel.contoh.id/masuk',
    tautanPanduan: 'https://panel.contoh.id/panduan',
  },
  uji: {
    namaPenerima: 'Admin',
    namaBrand: 'WA Gateway',
    // waktuKirim WAJIB diisi: tanpa ini template memakai `new Date()`, sehingga
    // hash berbeda tiap render dan perbandingan menjadi tidak bermakna.
    waktuKirim: new Date('2026-10-05T04:45:00.000Z'),
    alamatServer: 'smtp-relay.brevo.com:587',
    pengirim: 'noreply@mail.srvx.my.id',
  },
};

const KASUS = [
  ['templateResetPassword', () => lama.templateResetPassword(MASUKAN.reset), () => baru.templateResetPassword(MASUKAN.reset)],
  ['templateResetPasswordTeks', () => lama.templateResetPasswordTeks(MASUKAN.reset), () => baru.templateResetPasswordTeks(MASUKAN.reset)],
  ['templateRegistrasiBerhasil', () => lama.templateRegistrasiBerhasil(MASUKAN.registrasi), () => baru.templateRegistrasiBerhasil(MASUKAN.registrasi)],
  ['templateRegistrasiBerhasilTeks', () => lama.templateRegistrasiBerhasilTeks(MASUKAN.registrasi), () => baru.templateRegistrasiBerhasilTeks(MASUKAN.registrasi)],
  ['templateRegistrasiBerhasil (tanpa nomor)', () => lama.templateRegistrasiBerhasil(MASUKAN.registrasiTanpaNomor), () => baru.templateRegistrasiBerhasil(MASUKAN.registrasiTanpaNomor)],
  ['templateRegistrasiBerhasilTeks (tanpa nomor)', () => lama.templateRegistrasiBerhasilTeks(MASUKAN.registrasiTanpaNomor), () => baru.templateRegistrasiBerhasilTeks(MASUKAN.registrasiTanpaNomor)],
  ['templateEmailUji', () => lama.templateEmailUji(MASUKAN.uji), () => baru.templateEmailUji(MASUKAN.uji)],
  ['templateEmailUjiTeks', () => lama.templateEmailUjiTeks(MASUKAN.uji), () => baru.templateEmailUjiTeks(MASUKAN.uji)],
  ['bangunTautanReset', () => lama.bangunTautanReset('https://panel.contoh.id/', 'tok_abc'), () => baru.bangunTautanReset('https://panel.contoh.id/', 'tok_abc')],
  ['escapeHtml', () => lama.escapeHtml('<a href="x">&amp;</a>'), () => baru.escapeHtml('<a href="x">&amp;</a>')],
  ['BRAND', () => JSON.stringify(lama.BRAND), () => JSON.stringify(baru.BRAND)],
];

// --- 3. Bandingkan ---------------------------------------------------------
console.log();
console.log('  keluaran template: lama vs baru');
console.log('  ' + '-'.repeat(62));
let beda = 0;
let totalChar = 0;

for (const [nama, fLama, fBaru] of KASUS) {
  let a, b;
  try {
    a = String(fLama());
  } catch (e) {
    a = `LEMPAR: ${e.message}`;
  }
  try {
    b = String(fBaru());
  } catch (e) {
    b = `LEMPAR: ${e.message}`;
  }

  const ha = createHash('sha256').update(a).digest('hex').slice(0, 12);
  const hb = createHash('sha256').update(b).digest('hex').slice(0, 12);
  totalChar += a.length;

  if (a === b) {
    console.log(`  SAMA   ${nama.padEnd(44)} ${String(a.length).padStart(5)} char  ${ha}`);
  } else {
    beda++;
    console.log(`  BEDA   ${nama.padEnd(44)} lama=${a.length} baru=${b.length}`);
    console.log(`         lama sha=${ha}  baru sha=${hb}`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`         beda pertama di char ${i}:`);
        console.log(`           lama: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}`);
        console.log(`           baru: ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`);
        break;
      }
    }
  }
}

console.log();
console.log(`  ${KASUS.length} kasus, ${totalChar} karakter keluaran dibandingkan`);
if (beda === 0) {
  console.log('  KESIMPULAN: keluaran IDENTIK — refactor tidak mengubah satu karakter pun.');
} else {
  console.log(`  KESIMPULAN: ${beda} kasus BERBEDA — ada perubahan perilaku.`);
}

process.exit(beda === 0 ? 0 : 1);
