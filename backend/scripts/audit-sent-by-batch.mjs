// Audit menyeluruh: pesan apa saja yang BENAR-BENAR keluar ke WhatsApp, per batch.
// Fokus: membedakan uji saya vs kampanye operator vs kiriman normal.
// Dijalankan di VM207: node scripts/audit-sent-by-batch.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/wa.db');

console.log('=== semua batch yang punya pesan BENAR-BENAR terkirim ===\n');
const batches = db.prepare(
  `SELECT batch_id,
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS terkirim,
          SUM(CASE WHEN status IN ('failed','invalid_number','not_registered') THEN 1 ELSE 0 END) AS gagal,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
          MIN(created_at) AS mulai
   FROM messages
   GROUP BY batch_id
   HAVING terkirim > 0
   ORDER BY mulai DESC`
).all();

for (const b of batches) {
  console.log(
    `  ${String(b.batch_id).padEnd(26)} terkirim=${String(b.terkirim).padEnd(4)} gagal=${String(b.gagal).padEnd(3)} cancelled=${String(b.cancelled).padEnd(5)} ${b.mulai}`
  );
}

// Rincian penerima untuk batch yang mencurigakan sebagai uji (pola nama camp_smoke_*)
console.log('\n=== rincian penerima batch uji (camp_smoke_*, camp_e2e_*, camp_bound_*) ===\n');
const testBatches = db.prepare(
  `SELECT batch_id, recipient, status, created_at FROM messages
   WHERE batch_id LIKE 'camp_smoke%' OR batch_id LIKE 'camp_e2e%' OR batch_id LIKE 'camp_bound%'
      OR batch_id LIKE 'camp_media%' OR batch_id LIKE 'camp_chunk%'
   ORDER BY batch_id, recipient`
).all();
let cur = null;
for (const r of testBatches) {
  if (r.batch_id !== cur) { cur = r.batch_id; console.log(`\n  [${cur}]`); }
  console.log(`     ${r.recipient} -> ${r.status}  ${r.created_at}`);
}

db.close();
