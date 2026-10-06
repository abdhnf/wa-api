/**
 * Isi DB uji dengan pesan yang punya statusTimes lengkap, lalu cetak id-nya.
 * Dipakai untuk verifikasi tampilan panel di browser.
 *
 * DB ini TERPISAH dari DB kerja — path-nya diterima dari argumen pertama.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('pakai: node seed-pesan-uji.mjs <path-db>');
  process.exit(1);
}
mkdirSync(dirname(dbPath), { recursive: true });
process.env.DATABASE_PATH = dbPath;

await import('../dist/db.js');
const { insertMessage, updateMessageStatus } = await import('../dist/db/pesan.js');
const { upsertSession } = await import('../dist/db/sessions.js');
const { db } = await import('../dist/db/client.js');

// Ambil user admin yang benar-benar ada di DB ini. Tanpa ini, pesan uji
// diatribusikan ke id bawaan `usr_c26f74d6` yang tidak ada di DB segar —
// dan `GET /admin/users/:id/logs` mengembalikan daftar kosong, sehingga
// halaman Users tampak "tidak ada pesan" padahal datanya ada.
const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (!admin) {
  console.error('  tidak ada user admin di DB ini — jalankan dulu bootstrap-nya');
  process.exit(1);
}
const UID = admin.id;

// Sesi pengirim. Tanpa baris ini, tabel riwayat di Playground kosong walau
// pesannya ada — halaman itu memilih sesi dulu, dan id sesi yang tidak ada di
// tabel `sessions` tidak muncul di pemilih sesi.
upsertSession({
  id: 'sess-verifikasi',
  name: 'Sesi Uji Verifikasi',
  phone: '628000000001',
  status: 'connected',
  riskScore: 0,
  warmupDay: 1,
  messagesSentToday: 0,
  deliveryRate: 100,
  userId: UID,
}, UID);

const t0 = Date.now();
// Idempoten: hapus dulu pesan uji dari jalannya yang sebelumnya, supaya skrip
// ini bisa dijalankan berulang tanpa `UNIQUE constraint failed: messages.id`.
db.prepare("DELETE FROM messages WHERE id LIKE 'msg_uji_%'").run();

const pesan = [
  // Lulus lengkap: queued -> read, dengan jeda yang terlihat jelas.
  { id: 'msg_uji_lengkap', status: 'read', times: { queued: t0, pacing: t0 + 1200, sending: t0 + 2400, sent: t0 + 3100, delivered: t0 + 5400, read: t0 + 26000 } },
  // Berhenti di delivered.
  { id: 'msg_uji_delivered', status: 'delivered', times: { queued: t0 + 60000, pacing: t0 + 61200, sending: t0 + 62400, sent: t0 + 63100, delivered: t0 + 65400 } },
  // Gagal setelah sempat terkirim — menguji baris `failed` di akhir.
  { id: 'msg_uji_gagal', status: 'failed', times: { queued: t0 + 120000, pacing: t0 + 121200, sending: t0 + 122400, sent: t0 + 123100, failed: t0 + 125000 } },
  // Pesan LAMA: tanpa statusTimes sama sekali — menguji fallback teks.
  { id: 'msg_uji_lama', status: 'sent', times: null },
  // Status terminal selain `failed` — bentuk yang benar-benar muncul di
  // produksi (not_registered). Sebelum diperbaiki, tahapnya hilang dari daftar.
  { id: 'msg_uji_tdk_terdaftar', status: 'not_registered', times: { queued: t0 + 180000, not_registered: t0 + 184200 } },
  { id: 'msg_uji_nomor_salah', status: 'invalid_number', times: { queued: t0 + 240000, invalid_number: t0 + 241000 } },
];

for (const p of pesan) {
  insertMessage({
    id: p.id,
    sessionId: 'sess-verifikasi',
    userId: UID,
    mode: 'text',
    to: '628123456789',
    text: `Uji tampilan waktu status: ${p.id}`,
    status: p.status,
    jitterDelayMs: 1200,
    timestamp: new Date(t0).toISOString(),
    ...(p.times ? { statusTimes: p.times } : {}),
  });
}

// Untuk pesan LAMA, hapus statusTimes dari payload supaya benar-benar
// menyerupai pesan yang dibuat sebelum fitur ini dipasang.
const row = db.prepare('SELECT payload FROM messages WHERE id = ?').get('msg_uji_lama');
const obj = JSON.parse(row.payload);
delete obj.statusTimes;
db.prepare('UPDATE messages SET payload = ? WHERE id = ?').run(JSON.stringify(obj), 'msg_uji_lama');

// Pesan berstatus akhir harus punya waktunya lengkap; status di kolom `status`
// ikut disetel agar tabel panel menampilkan tahap terakhir.
updateMessageStatus('msg_uji_lengkap', 'read');
updateMessageStatus('msg_uji_delivered', 'delivered');
updateMessageStatus('msg_uji_gagal', 'failed', 'Nomor tidak terdaftar di WhatsApp');

// Status terminal juga harus disetel lewat fungsi ini, bukan hanya lewat
// `insertMessage` — tanpa ini kolom `status` tetap berisi status awal.
updateMessageStatus('msg_uji_tdk_terdaftar', 'not_registered');
updateMessageStatus('msg_uji_nomor_salah', 'invalid_number');

const cek = db.prepare('SELECT id, status, payload FROM messages').all();
console.log('  pesan tersimpan:');
for (const r of cek) {
  const st = JSON.parse(r.payload).statusTimes;
  console.log(`    ${r.id}  status=${r.status}  tahap=${st ? Object.keys(st).length : 'TIDAK ADA'}`);
}
