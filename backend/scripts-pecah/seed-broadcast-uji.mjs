/**
 * Seed DB uji wa-api untuk verifikasi tampilan di wa-broadcast-dashboard.
 *
 * Berbeda dari seed-pesan-uji.mjs (yang untuk panel wa-api), seed ini:
 *   - memberi `batchId` yang sama supaya halaman Broadcast punya kampanye
 *     yang bisa dipilih, dan
 *   - mendaftarkan sesi supaya kolom "Sesi Pengirim" terisi.
 *
 * Jalankan: node seed-broadcast-uji.mjs <path-db>
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('pakai: node seed-broadcast-uji.mjs <path-db>');
  process.exit(1);
}
mkdirSync(dirname(dbPath), { recursive: true });
process.env.DATABASE_PATH = dbPath;

await import('../dist/db.js');
const { insertMessage, updateMessageStatus } = await import('../dist/db/pesan.js');
const { db } = await import('../dist/db/client.js');

const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (!admin) {
  console.error('  tidak ada user admin — jalankan backend dulu agar skema + bootstrap terbentuk');
  process.exit(1);
}
const UID = admin.id;
const SID = 'sess-uji-broadcast';

// Sesi harus ada supaya panel dashboard mengenali pemilik pesan.
db.prepare(
  `INSERT OR REPLACE INTO sessions (id, name, phone, status, user_id, risk_score, warmup_day, messages_sent_today, delivery_rate)
   VALUES (?, ?, ?, 'connected', ?, 5, 3, 12, 98)`
).run(SID, 'Sesi Uji', '628123456789', UID);

const BATCH = 'batch_uji_broadcast';
const t0 = Date.now();

// Seed harus idempoten: skrip ini sering dijalankan ulang saat memverifikasi
// tampilan, dan tanpa pembersihan ia gagal dengan "UNIQUE constraint failed".
db.prepare('DELETE FROM messages WHERE batch_id = ?').run(BATCH);

/**
 * Enam penerima dengan tahap berbeda, supaya sekaligus terlihat:
 *   - badge dengan jam status sebenarnya (bukan created_at),
 *   - tooltip berisi seluruh tahap,
 *   - pesan lama tanpa statusTimes (fallback jujur, tanpa mengarang waktu),
 *   - pesan gagal dengan baris `failed` di akhir.
 */
const penerima = [
  { phone: '628111111001', status: 'read',      times: { queued: t0,            pacing: t0 + 1200,  sending: t0 + 2400,  sent: t0 + 3100,  delivered: t0 + 5400,  read: t0 + 26000 } },
  { phone: '628111111002', status: 'delivered', times: { queued: t0 + 60000,    pacing: t0 + 61200, sending: t0 + 62400, sent: t0 + 63100, delivered: t0 + 65400 } },
  { phone: '628111111003', status: 'sent',      times: { queued: t0 + 120000,   pacing: t0 + 121200, sending: t0 + 122400, sent: t0 + 123100 } },
  { phone: '628111111004', status: 'failed',    times: { queued: t0 + 180000,   pacing: t0 + 181200, sending: t0 + 182400, sent: t0 + 183100, failed: t0 + 185000 } },
  { phone: '628111111005', status: 'pacing',    times: { queued: t0 + 240000,   pacing: t0 + 241200 } },
  { phone: '628111111006', status: 'sent',      times: null }, // pesan lama
  // Kasus pembeda: waktu MASUK ANTREAN (kolom "Waktu") sengaja dibuat 10 menit
  // lebih awal dari waktu status akhir. Tanpa ini, semua jam kebetulan jatuh di
  // menit yang sama sehingga tidak bisa dibuktikan bahwa tampilan memakai waktu
  // status, bukan waktu antrean.
  { phone: '628111111007', status: 'read',      times: { queued: t0 - 600000,   pacing: t0 - 598800, sending: t0 - 597600, sent: t0 - 596900, delivered: t0 - 594600, read: t0 - 60000 } },
];

let n = 0;
for (const p of penerima) {
  const id = `msg_uji_bcast_${++n}`;
  insertMessage({
    id,
    sessionId: SID,
    userId: UID,
    batchId: BATCH,
    mode: 'text',
    to: p.phone,
    text: `Pesan uji broadcast ke ${p.phone}`,
    status: p.status,
    jitterDelayMs: 1200,
    // created_at harus mencerminkan waktu masuk antrean; kalau tidak, kolom
    // "Waktu" dan jam status akan saling bertentangan tanpa alasan.
    timestamp: new Date(p.times?.queued ?? (t0 + (n - 1) * 60000)).toISOString(),
    ...(p.times ? { statusTimes: p.times } : {}),
  });
}

// Pesan terakhir harus benar-benar menyerupai pesan lama: buang statusTimes.
const row = db.prepare('SELECT payload FROM messages WHERE id = ?').get('msg_uji_bcast_6');
const obj = JSON.parse(row.payload);
delete obj.statusTimes;
db.prepare('UPDATE messages SET payload = ? WHERE id = ?').run(JSON.stringify(obj), 'msg_uji_bcast_6');

updateMessageStatus('msg_uji_bcast_4', 'failed', 'Nomor tidak terdaftar di WhatsApp');

console.log('  batch   :', BATCH);
console.log('  sesi    :', SID);
console.log('  pesan   :');
for (const r of db.prepare('SELECT id, status, recipient, payload FROM messages WHERE batch_id = ?').all(BATCH)) {
  const st = JSON.parse(r.payload).statusTimes;
  const tahap = st ? Object.keys(st).join(',') : 'TIDAK ADA (pesan lama)';
  console.log(`    ${r.id.padEnd(20)} ${String(r.status).padEnd(10)} ${r.recipient}  -> ${tahap}`);
}
