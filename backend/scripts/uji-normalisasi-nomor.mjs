/**
 * Uji normalisasi nomor telepon.
 *
 * Kenapa berkas ini ada: `normalisasiNomor()` dipakai jalur pendaftaran user,
 * penambahan user oleh admin, onboarding, DAN pengelompokan penerima di decision
 * log. Sebelumnya tidak ada uji sama sekali, sehingga bug `0062...` -> `620062...`
 * bisa hidup tanpa ketahuan: hasilnya tetap deretan digit yang "kelihatan benar".
 *
 * Bentuk kanonik yang diharapkan: `628` + 7–13 digit, tanpa plus/spasi/strip.
 *
 * Jalankan dari backend/: node scripts/uji-normalisasi-nomor.mjs
 */
const { normalisasiNomor, nomorValid, formatNomorTampil } = await import('../dist/phone.js');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
};

const KANONIK = '6281234567890';

console.log('=== 1. Semua penulisan lazim bertemu di satu bentuk ===');
const varian = [
  ['081234567890', 'awalan 0'],
  ['0812-3456-7890', 'awalan 0 + strip'],
  ['0812 3456 7890', 'awalan 0 + spasi'],
  ['+6281234567890', 'plus + 62'],
  ['+62 812-3456-7890', 'plus + spasi + strip'],
  ['6281234567890', 'sudah kanonik'],
  ['62812 3456 7890', 'kanonik + spasi'],
  ['81234567890', 'tanpa awalan'],
  ['(0812) 3456-7890', 'tanda kurung'],
  ['006281234567890', 'awalan internasional 00'],
  ['0062 812 3456 7890', 'awalan 00 + spasi'],
];
for (const [masukan, label] of varian) {
  check(`"${label}"`, normalisasiNomor(masukan) === KANONIK,
    `${masukan} -> ${normalisasiNomor(masukan)}`);
}

console.log('\n=== 2. Regresi: 00 tidak boleh jadi 620062... ===');
// Bug lama: `0062...` masuk cabang `0`, hasilnya `62` + `062...` = `620062...`.
const hasil00 = normalisasiNomor('006281234567890');
check('0062... -> 62812... (bukan 620062...)', hasil00 === KANONIK, String(hasil00));
check('tidak mengandung 6200', !String(hasil00).includes('6200'), String(hasil00));

console.log('\n=== 3. Masukan tidak valid ditolak, bukan ditebak ===');
const invalid = [
  [null, 'null'],
  [undefined, 'undefined'],
  ['', 'string kosong'],
  ['abc', 'tanpa digit'],
  ['---', 'hanya tanda'],
  ['123', 'terlalu pendek'],
  ['0812', 'terlalu pendek (lokal)'],
  ['628123456789012345678', 'terlalu panjang'],
  ['0000', 'nol semua'],
];
for (const [masukan, label] of invalid) {
  check(`tolak: ${label}`, normalisasiNomor(masukan) === null, String(normalisasiNomor(masukan)));
}

console.log('\n=== 4. nomorValid konsisten dengan normalisasiNomor ===');
check('valid untuk 0812...', nomorValid('081234567890') === true);
check('valid untuk 0062...', nomorValid('006281234567890') === true);
check('tidak valid untuk abc', nomorValid('abc') === false);
check('tidak valid untuk null', nomorValid(null) === false);

console.log('\n=== 5. Tampilan tidak mengubah bentuk simpanan ===');
check('format tampil memuat +62', formatNomorTampil(KANONIK).includes('+62'),
  formatNomorTampil(KANONIK));
check('format tampil kosong untuk null', formatNomorTampil(null) === '');

console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
process.exit(fail === 0 ? 0 : 1);
