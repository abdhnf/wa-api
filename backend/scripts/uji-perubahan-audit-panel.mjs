/**
 * Uji formatter kolom "Perubahan" pada tabel API Logs.
 *
 * Kenapa diuji terpisah: seluruh gunanya tabel audit adalah membuat pembaca
 * menyimpulkan hal yang BENAR. Formatter yang keliru tidak membuat aplikasi
 * crash — ia hanya menampilkan "—" pada baris yang sebenarnya berubah, atau
 * "→ broadcast" tanpa menjelaskan bahwa nilai lamanya memang tidak dicatat.
 * Keduanya lolos dari uji tipe dan dari mata yang melihat sekilas.
 *
 * Berkas sumbernya TypeScript, jadi ditranspilasi lebih dulu dengan `tsc` milik
 * panel (pola yang sama dengan `uji-util-waktu-panel.mjs`).
 *
 * Jalankan: node backend/scripts/uji-perubahan-audit-panel.mjs
 */
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const AKAR = fileURLToPath(new URL('../..', import.meta.url));
const PANEL = join(AKAR, 'panel');
const KELUARAN = join(PANEL, '.tmp-uji-perubahan');

if (existsSync(KELUARAN)) rmSync(KELUARAN, { recursive: true, force: true });

execFileSync(
  join(PANEL, 'node_modules/.bin/tsc'),
  [
    'src/lib/perubahanAudit.ts',
    '--ignoreConfig',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--skipLibCheck',
    '--outDir', KELUARAN,
  ],
  { cwd: PANEL, stdio: 'pipe' },
);

const berkas = join(KELUARAN, 'perubahanAudit.js');
if (!existsSync(berkas)) {
  console.error('  transpile tidak menghasilkan berkas — periksa tsc');
  process.exit(1);
}

const { ringkasPerubahan, bisaDihapus } = await import(berkas);

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

const J = (o) => JSON.stringify(o);

console.log('--- 1. nilai lama dan baru keduanya ada ---');
cek(
  'preset strict -> broadcast tampil sebagai panah',
  ringkasPerubahan(J({ preset: 'broadcast' }), J({ preset: 'strict' })),
  { teks: 'preset: strict → broadcast', bahaya: true },
);
cek(
  'tanpa catatan "tidak dicatat" (nilai lama ADA)',
  ringkasPerubahan(J({ preset: 'broadcast' }), J({ preset: 'strict' })).catatan,
  undefined,
);

console.log('\n--- 2. hanya nilai baru: "tidak dicatat", BUKAN "tidak berubah" ---');
const hanyaBaru = ringkasPerubahan(J({ preset: 'broadcast' }), null);
cek('teks menandai arah tanpa asal', hanyaBaru.teks, 'preset: → broadcast');
cek('ada catatan eksplisit', hanyaBaru.catatan, 'nilai lama tidak dicatat untuk aksi ini');
// Ini asersi yang paling mudah salah: kalau `params_before` NULL ditampilkan
// sebagai "—", pembaca menyimpulkan tidak ada perubahan padahal ada.
cek('BUKAN "—"', hanyaBaru.teks !== '—', true);

console.log('\n--- 2b. hanya nilai lama: aksi yang menghapus/mengosongkan ---');
// Kasus ini TIDAK ada di draf pertama, dan ketiadaannya membuat mutasi
// `if (!baru) return KOSONG` lolos 22/22. Padahal baris seperti ini nyata:
// DELETE dengan body kosong, atau aksi yang mengosongkan sebuah nilai.
cek(
  'lama ada, baru kosong -> panah ke kosong, bukan "—"',
  ringkasPerubahan(null, J({ preset: 'strict' })).teks,
  'preset: strict → ∅',
);
cek(
  'BUKAN "—" (perubahan tetap terlihat)',
  ringkasPerubahan(null, J({ preset: 'strict' })).teks !== '—',
  true,
);
cek(
  'tidak diberi catatan "nilai lama tidak dicatat" (justru nilai lama yang ada)',
  ringkasPerubahan(null, J({ preset: 'strict' })).catatan,
  undefined,
);

console.log('\n--- 3. tidak ada params sama sekali: permintaan ditolak ---');
cek('keduanya null -> "—"', ringkasPerubahan(null, null), { teks: '—' });
cek('keduanya undefined -> "—"', ringkasPerubahan(undefined, undefined), { teks: '—' });

console.log('\n--- 4. hanya kunci yang berubah yang ditampilkan ---');
const cfgLama = { rateLimiter: { maxPerDay: 1500 }, replyRatio: { enabled: true } };
const cfgBaru = { rateLimiter: { maxPerDay: 800 }, replyRatio: { enabled: true } };
const beda = ringkasPerubahan(J({ config: cfgBaru }), J({ config: cfgLama }));
cek('objek besar diringkas jadi jumlah field', /^config: \{\d+ field\} → \{\d+ field\}$/.test(beda.teks), true);
cek('tidak membocorkan isi config', beda.teks.includes('maxPerDay'), false);

console.log('\n--- 5. perubahan menjadi preset broadcast ditandai bahaya ---');
cek(
  'strict -> broadcast: bahaya',
  ringkasPerubahan(J({ preset: 'broadcast' }), J({ preset: 'strict' })).bahaya,
  true,
);
cek(
  'balanced -> broadcast: bahaya',
  ringkasPerubahan(J({ preset: 'broadcast' }), J({ preset: 'balanced' })).bahaya,
  true,
);
cek(
  'sudah broadcast -> broadcast: TIDAK bahaya (tidak berubah)',
  ringkasPerubahan(J({ preset: 'broadcast' }), J({ preset: 'broadcast' })).bahaya,
  undefined,
);
cek(
  'broadcast -> strict: TIDAK bahaya (justru memulihkan)',
  ringkasPerubahan(J({ preset: 'strict' }), J({ preset: 'broadcast' })).bahaya,
  undefined,
);

console.log('\n--- 6. JSON rusak tidak menjatuhkan tampilan ---');
cek('params bukan JSON -> "—"', ringkasPerubahan('bukan json', null), { teks: '—' });
cek('params array -> "—" (bukan objek parameter)', ringkasPerubahan('[1,2,3]', null), { teks: '—' });
cek(
  'params_before rusak, params sah -> tetap tampil',
  ringkasPerubahan(J({ preset: 'strict' }), '{{{').teks,
  'preset: → strict',
);

console.log('\n--- 7. lebih dari 3 kunci: sisanya dihitung, bukan disembunyikan ---');
const banyak = ringkasPerubahan(
  J({ a: 2, b: 2, c: 2, d: 2, e: 2 }),
  J({ a: 1, b: 1, c: 1, d: 1, e: 1 }),
);
cek('menyebut jumlah sisanya', banyak.teks.includes('(+2 lainnya)'), true);

console.log('\n--- 8. nilai null & string kosong dibedakan ---');
cek(
  'null eksplisit tampil "null", bukan kosong',
  ringkasPerubahan(J({ reason: null }), J({ reason: 'uji' })).teks,
  'reason: uji → null',
);

console.log('\n--- 9. siapa boleh menghapus ---');
cek('admin boleh hapus baris audit', bisaDihapus({ audit: true }, true), true);
cek('non-admin TIDAK boleh hapus baris audit', bisaDihapus({ audit: true }, false), false);
cek('non-admin boleh hapus catatan galat biasa', bisaDihapus({ audit: false }, false), true);
cek('non-admin boleh hapus baris lama tanpa kolom audit', bisaDihapus({}, false), true);

console.log(`\n=== HASIL: ${lulus} lulus, ${gagal} gagal ===`);
rmSync(KELUARAN, { recursive: true, force: true });
process.exit(gagal === 0 ? 0 : 1);
