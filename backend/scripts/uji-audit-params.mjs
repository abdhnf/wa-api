/**
 * Uji penyaring `params` untuk kolom audit `api_logs.params`.
 *
 * Yang dibuktikan: nomor telepon tidak pernah masuk log dalam bentuk mentah,
 * kredensial dibuang, dan ukuran dibatasi. Ini penting karena `api_logs` dibaca
 * oleh admin dan (nanti) oleh agen lewat MCP — log yang menyimpan nomor penerima
 * berubah menjadi salinan data pribadi, dan log yang menyimpan password adalah
 * kebocoran kedua.
 */
import { saringParams, saringNilai, namaFieldRahasia, PENANDA_RAHASIA, BATAS_PARAMS } from '../dist/audit-params.js';
import { hashRecipient } from '../dist/db/decision-log.js';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
};

console.log('=== 1. Nomor telepon diganti hash, bukan disimpan ===');
const nomor = '6281234567890';
const hash = hashRecipient(nomor);

const kasusNomor = [
  ['kanonik', nomor],
  ['awalan 0', '081234567890'],
  ['plus & spasi', '+62 812-3456-7890'],
  ['JID WhatsApp', '6281234567890@s.whatsapp.net'],
  ['awalan 00', '006281234567890'],
];
for (const [label, nilai] of kasusNomor) {
  const hasil = saringNilai(nilai);
  check(`${label} -> hash`, hasil === `hash:${hash}`, `dapat: ${hasil}`);
  check(`${label} tidak menyisakan digit mentah`, !String(hasil).includes('6281234567890'));
}

console.log('\n=== 2. Nomor bersarang di objek & array ===');
const bersarang = saringNilai({
  to: '081234567890',
  recipients: [{ phone: '+6281234567890' }, { phone: '6281234567890' }],
});
const jsonBersarang = JSON.stringify(bersarang);
check('objek bersarang: tidak ada nomor mentah', !/6281234567890|081234567890/.test(jsonBersarang), jsonBersarang);
check('objek bersarang: ketiga nomor jadi hash', (jsonBersarang.match(/"hash:/g) || []).length === 3, jsonBersarang);

console.log('\n=== 3. Kredensial dibuang ===');
const rahasia = [
  ['password', { password: 'rahasia123' }],
  ['newPassword', { newPassword: 'rahasia123' }],
  ['pin', { pin: '123456' }],
  ['blast_pin', { blast_pin: '123456' }],
  ['apiKey', { apiKey: 'wa_live_deadbeef' }],
  ['token', { token: 'abcdef' }],
  ['authorization', { authorization: 'Bearer xyz' }],
  ['secret', { secret: 'xyz' }],
  ['otp', { otp: '999111' }],
];
for (const [label, body] of rahasia) {
  const hasil = JSON.stringify(saringNilai(body));
  check(`${label} -> penanda`, hasil.includes(PENANDA_RAHASIA), hasil);
  check(`${label} nilainya hilang`, !/rahasia123|123456|deadbeef|abcdef|Bearer|999111/.test(hasil), hasil);
}

console.log('\n=== 4. Field biasa TIDAK ikut disensor ===');
// Ini sama pentingnya: penyaring yang terlalu agresif membuat audit tidak
// berguna, karena justru nilai yang ingin diketahui ("preset diubah menjadi
// apa") ikut hilang.
const biasa = saringNilai({ preset: 'broadcast', paused: true, limit: 1500, reason: 'uji coba' });
check('preset tersimpan', biasa.preset === 'broadcast', JSON.stringify(biasa));
check('boolean tersimpan', biasa.paused === true);
check('angka tersimpan', biasa.limit === 1500);
check('teks biasa tersimpan', biasa.reason === 'uji coba');

console.log('\n=== 4b. Nama yang mengandung "pin" tapi bukan PIN ===');
// `typingWPM` tertangkap pola `pin` karena "ty**pin**g". Nilainya angka kecepatan
// mengetik — bagian konfigurasi anti-ban yang justru ingin diaudit. Sensor
// berlebihan sama merusaknya dengan sensor kurang.
const ketik = saringNilai({ typingWPM: 42, typingWPMStdDev: 7 });
check('typingWPM tersimpan', ketik.typingWPM === 42, JSON.stringify(ketik));
check('typingWPMStdDev tersimpan', ketik.typingWPMStdDev === 7);
// Pengecualian TIDAK boleh melemahkan pola: nama lain yang mengandung "pin" tetap disensor.
check('pinCode tetap disensor', JSON.stringify(saringNilai({ pinCode: '1234' })).includes(PENANDA_RAHASIA));
check('pin tetap disensor', JSON.stringify(saringNilai({ pin: '1234' })).includes(PENANDA_RAHASIA));
check('blast_pin tetap disensor', JSON.stringify(saringNilai({ blast_pin: '1234' })).includes(PENANDA_RAHASIA));

console.log('\n=== 5. Angka & id yang mengandung digit tidak dianggap nomor ===');
// "1500" adalah kuota, bukan nomor. Kalau ikut jadi hash, audit kehilangan
// informasi yang justru dibutuhkan.
check('kuota 1500 tetap angka', saringNilai({ maxPerDay: 1500 }).maxPerDay === 1500);
check('id sesi tidak jadi hash', saringNilai('sess-mu2512ti') === 'sess-mu2512ti');
check('batch id tidak jadi hash', saringNilai('cmp_1793152101152_m0vom') === 'cmp_1793152101152_m0vom');
check('preset tidak jadi hash', saringNilai('broadcast') === 'broadcast');
check('string 6 digit tidak jadi hash', saringNilai('123456') === '123456');

console.log('\n=== 6. Batas ukuran & kedalaman ===');
const besar = { content: 'x'.repeat(50000) };
const hasilBesar = saringParams(besar);
check('JSON dipotong di batas', hasilBesar.length <= BATAS_PARAMS + 60, `panjang ${hasilBesar.length}`);
check('ada penanda dipotong', hasilBesar.includes('[dipotong'), hasilBesar.slice(-60));

let dalam = { a: 1 };
for (let i = 0; i < 10; i++) dalam = { anak: dalam };
const hasilDalam = JSON.stringify(saringNilai(dalam));
check('kedalaman dibatasi', hasilDalam.includes('[TERLALU_DALAM]'), hasilDalam.slice(0, 120));

const banyak = { items: Array.from({ length: 100 }, (_, i) => i) };
const hasilBanyak = saringNilai(banyak);
check('array dibatasi 20 + penanda', hasilBanyak.items.length === 21, `panjang ${hasilBanyak.items.length}`);
check('ada penanda sisa elemen', String(hasilBanyak.items[20]).includes('elemen lain'), hasilBanyak.items[20]);

console.log('\n=== 7. Body kosong -> null, bukan "{}" ===');
check('null -> null', saringParams(null) === null);
check('undefined -> null', saringParams(undefined) === null);
check('objek kosong -> null', saringParams({}) === null);
check('objek berisi -> string JSON', typeof saringParams({ a: 1 }) === 'string');

console.log('\n=== 8. Nama field rahasia dikenali tanpa daftar lengkap ===');
for (const nama of ['password', 'oldPassword', 'x_api_key', 'X-Api-Key', 'blastPin', 'refresh_token', 'clientSecret']) {
  check(`"${nama}" dikenali rahasia`, namaFieldRahasia(nama));
}
for (const nama of ['preset', 'sessionId', 'content', 'phone']) {
  check(`"${nama}" bukan rahasia`, !namaFieldRahasia(nama));
}

console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
process.exit(fail === 0 ? 0 : 1);
