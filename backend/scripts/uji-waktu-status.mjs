/**
 * Uji waktu per transisi status pesan (statusTimes).
 *
 * Dijalankan terhadap DB TERISOLASI di /tmp, bukan data nyata. Setiap kasus
 * memeriksa perilaku yang bisa salah secara diam-diam: penimpaan waktu saat
 * `pacing` dipanggil berulang, konversi detik→milidetik, dan timestamp kosong
 * yang bisa tersimpan sebagai 1 Januari 1970.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'uji-statustimes-'));
process.env.DATABASE_PATH = join(dir, 'uji.db');

// Impor FASAD `db.js` lebih dulu, bukan langsung `db/pesan.js`. Skema tabel
// dibuat sebagai efek samping saat fasad diimpor; tanpa ini `INSERT INTO
// messages` gagal "no such table" di DB baru.
await import('../dist/db.js');

const { insertMessage, updateMessageStatus, getMessageById } = await import('../dist/db/pesan.js');

let lulus = 0;
let gagal = 0;
function cek(nama, benar, bukti = '') {
  if (benar) lulus++; else gagal++;
  console.log(`  ${benar ? 'OK   ' : 'GAGAL'}  ${nama}${bukti ? `  — ${bukti}` : ''}`);
}

function pesanBaru(id, status = 'queued', timestamp = new Date().toISOString()) {
  insertMessage({
    id, sessionId: 'sess-uji', mode: 'text', to: '628123456789',
    text: 'halo', status, jitterDelayMs: 1200, timestamp,
  });
}

console.log('\n[1] Waktu status awal dicatat saat pesan masuk antrean');
const t0 = new Date().toISOString();
pesanBaru('m1', 'queued', t0);
const m1 = getMessageById('m1');
cek('statusTimes ada', !!m1?.statusTimes, JSON.stringify(m1?.statusTimes));
cek('statusTimes.queued terisi', typeof m1?.statusTimes?.queued === 'number');
cek('statusTimes.queued == created_at', m1?.statusTimes?.queued === Date.parse(t0),
  `${m1?.statusTimes?.queued} vs ${Date.parse(t0)}`);
cek('tidak ada status lain', Object.keys(m1?.statusTimes ?? {}).length === 1,
  Object.keys(m1?.statusTimes ?? {}).join(','));

console.log('\n[2] Tiap transisi menambah waktunya sendiri');
updateMessageStatus('m1', 'pacing');
const setelahPacing = getMessageById('m1')?.statusTimes?.pacing;
cek('pacing tercatat', typeof setelahPacing === 'number');
// Timestamp uji dibangkitkan relatif terhadap jam sekarang, bukan angka tetap.
// Angka tetap seperti 1780000000 jatuh di MEI 2026, sedangkan `queued` memakai
// jam nyata — perbandingan urutannya jadi gagal karena alasan yang salah.
const detik = Math.floor(Date.now() / 1000);
const T_SENT = detik + 1;
const T_DELIVERED = detik + 2;
const T_READ = detik + 3;
updateMessageStatus('m1', 'sending');
updateMessageStatus('m1', 'sent', undefined, undefined, T_SENT);
updateMessageStatus('m1', 'delivered', undefined, undefined, T_DELIVERED);
updateMessageStatus('m1', 'read', undefined, undefined, T_READ);
const akhir = getMessageById('m1')?.statusTimes ?? {};
cek('5 status tercatat', ['queued', 'pacing', 'sending', 'sent', 'delivered', 'read'].every(k => typeof akhir[k] === 'number'),
  Object.keys(akhir).join(','));

console.log('\n[3] Timestamp detik WhatsApp dikonversi ke milidetik');
cek('sent: detik -> milidetik', akhir.sent === T_SENT * 1000, `${akhir.sent} vs ${T_SENT * 1000}`);
cek('delivered: detik -> milidetik', akhir.delivered === T_DELIVERED * 1000, `${akhir.delivered} vs ${T_DELIVERED * 1000}`);
cek('read: detik -> milidetik', akhir.read === T_READ * 1000, `${akhir.read} vs ${T_READ * 1000}`);
cek('urutan waktu naik', akhir.queued <= akhir.pacing && akhir.pacing <= akhir.sending &&
  akhir.sending <= akhir.sent && akhir.sent <= akhir.delivered && akhir.delivered <= akhir.read);

console.log('\n[4] pacing dipanggil BERULANG tidak menimpa waktu pertama');
const pacingPertama = akhir.pacing;
await new Promise(r => setTimeout(r, 15));
updateMessageStatus('m1', 'pacing');
updateMessageStatus('m1', 'pacing');
const pacingTerakhir = getMessageById('m1')?.statusTimes?.pacing;
cek('waktu pacing tidak berubah', pacingTerakhir === pacingPertama,
  `pertama ${pacingPertama}, terakhir ${pacingTerakhir}`);

console.log('\n[5] Timestamp kosong TIDAK jadi 1 Januari 1970');
const sebelum = Date.now();
pesanBaru('m2');
updateMessageStatus('m2', 'sent', undefined, undefined, 0);
const w0 = getMessageById('m2')?.statusTimes?.sent;
cek('timestamp 0 -> jam server', typeof w0 === 'number' && w0 >= sebelum && w0 <= Date.now() + 1000, String(w0));
updateMessageStatus('m2', 'delivered', undefined, undefined, undefined);
const wU = getMessageById('m2')?.statusTimes?.delivered;
cek('undefined -> jam server', typeof wU === 'number' && wU >= sebelum, String(wU));
updateMessageStatus('m2', 'read', undefined, undefined, NaN);
const wN = getMessageById('m2')?.statusTimes?.read;
cek('NaN -> jam server', typeof wN === 'number' && wN >= sebelum, String(wN));

console.log('\n[6] Nilai milidetik langsung tidak dikali lagi');
pesanBaru('m3');
const ms = 1780000000000;
updateMessageStatus('m3', 'sent', undefined, undefined, ms);
cek('ms tetap ms', getMessageById('m3')?.statusTimes?.sent === ms, String(getMessageById('m3')?.statusTimes?.sent));

console.log('\n[7] Status mundur ditolak DAN tidak menambah waktu');
pesanBaru('m4');
updateMessageStatus('m4', 'read', undefined, undefined, 1780000060);
updateMessageStatus('m4', 'sent', undefined, undefined, 1780000000);
const m4 = getMessageById('m4');
cek('status tetap read', m4?.status === 'read', String(m4?.status));
cek('statusTimes.sent TIDAK muncul', m4?.statusTimes?.sent === undefined, JSON.stringify(m4?.statusTimes));

console.log('\n[8] failed tetap lolos walau sudah read');
updateMessageStatus('m4', 'failed', 'ditolak server', undefined, 1780000090);
const m4b = getMessageById('m4');
cek('status jadi failed', m4b?.status === 'failed', String(m4b?.status));
cek('errorDetail tersimpan', m4b?.errorDetail === 'ditolak server', String(m4b?.errorDetail));
cek('waktu failed tercatat', m4b?.statusTimes?.failed === 1780000090000, String(m4b?.statusTimes?.failed));

console.log('\n[9] Pesan lama tanpa statusTimes tidak bikin error');
insertMessage({
  id: 'm5', sessionId: 'sess-uji', mode: 'text', to: '628999', text: 'lama',
  status: 'sent', jitterDelayMs: 0, timestamp: new Date().toISOString(),
  statusTimes: undefined,
});
const m5 = getMessageById('m5');
cek('pesan baru tetap dapat statusTimes', !!m5?.statusTimes, JSON.stringify(m5?.statusTimes));
updateMessageStatus('m5', 'delivered');
cek('update setelahnya jalan', getMessageById('m5')?.statusTimes?.delivered !== undefined);

console.log(`\n${'='.repeat(56)}`);
console.log(`  LULUS: ${lulus}   GAGAL: ${gagal}`);
console.log('='.repeat(56));

rmSync(dir, { recursive: true, force: true });
process.exit(gagal === 0 ? 0 : 1);
