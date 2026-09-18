// Telusuri sesi mana yang menangani 13 pesan uji yang terkirim,
// untuk memastikan apakah uji saya ikut membebani sesi "byu".
// Dijalankan di VM207: node scripts/attribute-test-sends.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/wa.db');

console.log('=== 13 pesan uji terkirim: sesi mana yang menanganinya? ===\n');
const rows = db.prepare(
  `SELECT recipient, status, batch_id, session_id, created_at
   FROM messages
   WHERE recipient LIKE '628111111%' AND status IN ('sent','delivered','read')
   ORDER BY created_at`
).all();

for (const r of rows) {
  console.log(`  ${r.created_at}  ${r.recipient}  ${r.status.padEnd(10)} sesi=${r.session_id}  ${r.batch_id}`);
}

const bySession = {};
for (const r of rows) bySession[r.session_id] = (bySession[r.session_id] || 0) + 1;
console.log('\n  pengelompokan per sesi:');
for (const [k, v] of Object.entries(bySession)) console.log(`    ${k}: ${v} pesan`);

// Semua sesi yang pernah muncul di tabel messages (termasuk yang sudah dihapus)
console.log('\n=== semua session_id yang pernah dipakai (dari tabel messages) ===');
const used = db.prepare(
  `SELECT session_id, COUNT(*) AS n,
          SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS terkirim,
          MIN(created_at) AS mulai, MAX(created_at) AS akhir
   FROM messages GROUP BY session_id ORDER BY n DESC`
).all();
for (const u of used) {
  console.log(`  ${String(u.session_id).padEnd(20)} total=${String(u.n).padEnd(5)} terkirim=${String(u.terkirim).padEnd(4)} ${u.mulai} .. ${u.akhir}`);
}

// Sesi yang masih ada sekarang
console.log('\n=== sesi yang masih terdaftar ===');
for (const s of db.prepare(`SELECT id, name, phone, status, created_at FROM sessions`).all()) {
  console.log(`  ${s.id} | ${s.name} | ${s.phone} | ${s.status} | dibuat ${s.created_at}`);
}

db.close();
