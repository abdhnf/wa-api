// Hitung presisi: pesan ke nomor uji 628111111xxx yang BENAR-BENAR terkirim,
// dan bedakan mana yang berasal dari uji saya vs aktivitas lain.
// Dijalankan di VM207: node scripts/count-test-sends.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/wa.db');

console.log('=== semua pesan ke nomor uji 628111111xxx yang TERKIRIM ===\n');
const rows = db.prepare(
  `SELECT recipient, status, batch_id, created_at, user_id
   FROM messages
   WHERE recipient LIKE '628111111%'
     AND status IN ('sent','delivered','read')
   ORDER BY created_at`
).all();

for (const r of rows) {
  console.log(`  ${r.created_at}  ${r.recipient}  ${r.status.padEnd(10)} ${r.batch_id}`);
}
console.log(`\n  TOTAL: ${rows.length} pesan terkirim ke nomor uji`);

// Pecah per batch: mana yang batchId-nya dari smoke test saya (camp_smoke_*)
// vs batch_* (fallback server = juga dari smoke test step 5 v1 legacy).
console.log('\n=== pengelompokan ===');
const byPrefix = {};
for (const r of rows) {
  const b = String(r.batch_id || 'null');
  const key = b.startsWith('camp_smoke') ? 'camp_smoke_* (smoke test saya, bulk v2)'
    : b.startsWith('batch_') ? 'batch_* (smoke test saya, v1 legacy fallback)'
    : b.startsWith('cmp_') ? 'cmp_* (kampanye operator)'
    : b.startsWith('camp_') ? 'camp_* lainnya'
    : 'lainnya';
  byPrefix[key] = (byPrefix[key] || 0) + 1;
}
for (const [k, v] of Object.entries(byPrefix)) console.log(`  ${k.padEnd(48)} ${v}`);

// Batch yang berasal dari uji saya saja
const mine = rows.filter((r) => /^(camp_smoke|batch_)/.test(String(r.batch_id || '')));
console.log(`\n  -> atribusi ke uji saya: ${mine.length} pesan terkirim ke 628111111xxx`);
console.log(`     nomor unik: ${[...new Set(mine.map((r) => r.recipient))].join(', ')}`);

// Berapa yang sampai benar-benar delivered (dibaca perangkat nyata)
const delivered = mine.filter((r) => r.status === 'delivered' || r.status === 'read');
console.log(`     di antaranya DELIVERED ke perangkat: ${delivered.length}`);

db.close();
