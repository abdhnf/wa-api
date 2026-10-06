/**
 * Uji util waktu status di panel wa-api (`panel/src/lib/messageStatus.tsx`).
 *
 * Kenapa berkas terpisah: `scripts/uji-waktu-status.mjs` menguji BACKEND
 * (penulisan statusTimes ke DB). Yang diuji di sini adalah sisi TAMPILAN —
 * bagaimana catatan waktu disusun jadi baris. Dua hal berbeda yang bisa rusak
 * sendiri-sendiri: backend bisa benar sementara tampilannya menyesatkan.
 *
 * Berkas sumbernya TypeScript + JSX, jadi Node tak bisa mengimpornya langsung.
 * Transpile dulu dengan `tsc` milik panel (bukan regex — pendekatan itu rapuh
 * dan sudah terbukti gagal). Hasilnya diimpor dari dalam folder panel supaya
 * `react/jsx-runtime` dan `lucide-react` bisa diresolusi.
 *
 * Jalankan: node scripts-pecah/uji-util-waktu-panel.mjs
 */
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const AKAR = fileURLToPath(new URL('../..', import.meta.url)); // ~/projects/wa-api
const PANEL = join(AKAR, 'panel');
const KELUARAN = join(PANEL, '.tmp-uji-panel');

if (existsSync(KELUARAN)) rmSync(KELUARAN, { recursive: true, force: true });

execFileSync(
  join(PANEL, 'node_modules/.bin/tsc'),
  [
    'src/lib/messageStatus.tsx',
    '--ignoreConfig',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--jsx', 'react-jsx',
    '--skipLibCheck',
    '--outDir', KELUARAN,
  ],
  { cwd: PANEL, stdio: 'pipe' },
);

const berkas = join(KELUARAN, 'messageStatus.js');
if (!existsSync(berkas)) {
  console.error('  transpile tidak menghasilkan berkas — periksa tsc');
  process.exit(1);
}

const { susunBarisWaktu, ringkasWaktu, formatJam, formatSelisih, jamStatusTerakhir } = await import(berkas);

let lulus = 0;
let gagal = 0;
function cek(nama, aktual, harapan) {
  const a = JSON.stringify(aktual);
  const h = JSON.stringify(harapan);
  if (a === h) {
    lulus++;
    console.log(`  LULUS  ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL  ${nama}`);
    console.log(`           harap: ${h}`);
    console.log(`           dapat: ${a}`);
  }
}

const T0 = new Date('2026-10-06T02:45:27.000Z').getTime();

console.log('--- 1. pesan lama: tanpa catatan ---');
cek('undefined -> tanpa baris', susunBarisWaktu(undefined), []);
cek('objek kosong -> tanpa baris', susunBarisWaktu({}), []);
cek('ringkasan undefined', ringkasWaktu(undefined), undefined);

console.log('\n--- 2. alur lengkap ---');
const lengkap = { queued: T0, pacing: T0 + 1200, sending: T0 + 2400, sent: T0 + 3100, delivered: T0 + 5400, read: T0 + 26000 };
const baris = susunBarisWaktu(lengkap);
cek('jumlah tahap', baris.length, 6);
cek('urutan', baris.map((b) => b.status), ['queued', 'pacing', 'sending', 'sent', 'delivered', 'read']);
cek('tahap pertama tanpa selisih', baris[0].selisih, null);
cek('label pertama', baris[0].tahap, 'Masuk antrean');
cek('label terakhir', baris[5].tahap, 'Dibaca penerima');
cek('selisih pacing', baris[1].selisih, '+1,2 dtk');
cek('semua punya jam', baris.every((b) => /^\d{2}\.\d{2}\.\d{2}$/.test(b.jam)), true);

console.log('\n--- 3. status terminal selain failed ---');
// Kasus nyata produksi: pesan not_registered hanya punya {queued, not_registered}.
// Sebelum diperbaiki, barisnya hilang sehingga tooltip tampil seolah masih antre.
const tdkTerdaftar = susunBarisWaktu({ queued: T0, not_registered: T0 + 4200 });
cek('not_registered ikut tampil', tdkTerdaftar.length, 2);
cek('urutan', tdkTerdaftar.map((b) => b.status), ['queued', 'not_registered']);
cek('label not_registered', tdkTerdaftar[1].tahap, 'Nomor tidak terdaftar');
cek('selisih not_registered', tdkTerdaftar[1].selisih, '+4,2 dtk');

const nomorSalah = susunBarisWaktu({ queued: T0, invalid_number: T0 + 1000 });
cek('invalid_number ikut tampil', nomorSalah.length, 2);
cek('label invalid_number', nomorSalah[1].tahap, 'Nomor tidak valid');

const dibatalkan = susunBarisWaktu({ queued: T0, cancelled: T0 + 2000 });
cek('cancelled ikut tampil', dibatalkan.length, 2);
cek('label cancelled', dibatalkan[1].tahap, 'Dibatalkan');

console.log('\n--- 4. failed tetap di akhir ---');
const barisGagal = susunBarisWaktu({ queued: T0, pacing: T0 + 1000, sent: T0 + 2000, failed: T0 + 3500 });
cek('failed paling akhir', barisGagal[barisGagal.length - 1].status, 'failed');
cek('label failed', barisGagal[barisGagal.length - 1].tahap, 'Gagal dikirim');

console.log('\n--- 5. ringkasan tooltip ---');
const ringkas = ringkasWaktu({ queued: T0, not_registered: T0 + 4200 });
cek('dua baris', ringkas.split('\n').length, 2);
cek('baris kedua menyebut penyebab', ringkas.split('\n')[1].includes('Nomor tidak terdaftar'), true);

console.log('\n--- 6. format dasar ---');
cek('formatJam', /^\d{2}\.\d{2}\.\d{2}$/.test(formatJam(T0)), true);
cek('formatSelisih panjang', formatSelisih(134000), '+2 mnt 14 dtk');

console.log('\n--- 7. jam status terakhir (kolom tabel) ---');
// Jam ini ditulis langsung di sel tabel, bukan di tooltip. Yang paling penting:
// status tanpa catatan harus menghasilkan null, BUKAN waktu antrean — kalau
// salah, sel "Terkirim" menampilkan jam masuk antrean dan operator salah baca.
cek('tanpa statusTimes -> null', jamStatusTerakhir('sent', undefined), null);
cek('status tidak tercatat -> null', jamStatusTerakhir('sent', { queued: T0 }), null);
cek('objek kosong -> null', jamStatusTerakhir('queued', {}), null);
cek('status terkini -> jam', jamStatusTerakhir('sent', { queued: T0, sent: T0 + 3100 }), formatJam(T0 + 3100));
cek('ambil status terkini, bukan antrean', jamStatusTerakhir('read', lengkap), formatJam(T0 + 26000));
cek('status terminal punya jam', jamStatusTerakhir('not_registered', { queued: T0, not_registered: T0 + 4200 }), formatJam(T0 + 4200));
// Nilai rusak: NaN dan Infinity lolos dari `typeof === 'number'`, jadi keduanya
// harus ditolak lewat Number.isFinite — bukan sekadar cek tipe.
cek('NaN -> null', jamStatusTerakhir('sent', { sent: NaN }), null);
cek('Infinity -> null', jamStatusTerakhir('sent', { sent: Infinity }), null);
cek('string -> null', jamStatusTerakhir('sent', { sent: '2026-10-06' }), null);
cek('null eksplisit -> null', jamStatusTerakhir('sent', { sent: null }), null);

rmSync(KELUARAN, { recursive: true, force: true });

console.log(`\n  RINGKASAN: ${lulus} lulus, ${gagal} gagal`);
process.exit(gagal === 0 ? 0 : 1);
