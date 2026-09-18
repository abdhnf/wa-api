// Audit dampak uji bulk: berapa pesan uji yang benar-benar TERKIRIM ke nomor acak.
// Dijalankan di VM207: node scripts/audit-test-damage.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/wa.db');
const batches = ['camp_e2e_verify', 'camp_chunk_600', 'camp_bound_500', 'camp_bound_501', 'camp_media_chk'];

console.log('=== status akhir batch uji ===\n');
for (const b of batches) {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS n FROM messages WHERE batch_id = ? GROUP BY status ORDER BY n DESC`
  ).all(b);
  const total = rows.reduce((a, r) => a + r.n, 0);
  const breakdown = rows.map((r) => `${r.status}=${r.n}`).join(' ');
  console.log(`  ${b.padEnd(18)} total=${String(total).padEnd(5)} ${breakdown || '(kosong)'}`);
}

// Berapa pesan yang benar-benar keluar ke WhatsApp (punya wa_message_id / status maju)
const sent = db.prepare(
  `SELECT batch_id, COUNT(*) AS n FROM messages
   WHERE batch_id IN (${batches.map(() => '?').join(',')})
     AND (wa_message_id IS NOT NULL OR status IN ('sent','delivered','read'))
   GROUP BY batch_id`
).all(...batches);

console.log('\n=== pesan yang benar-benar terkirim ke WhatsApp ===');
if (!sent.length) console.log('  TIDAK ADA — tidak ada pesan uji yang keluar');
else sent.forEach((r) => console.log(`  ${r.batch_id}: ${r.n} pesan`));

// Semua pesan yang pernah dibuat ke nomor dummy 628000000xxxx
const dummy = db.prepare(
  `SELECT status, COUNT(*) AS n FROM messages WHERE recipient LIKE '628000000%' GROUP BY status`
).all();
console.log('\n=== seluruh pesan ke nomor dummy 628000000xxxx ===');
dummy.forEach((r) => console.log(`  ${r.status}: ${r.n}`));

db.close();
