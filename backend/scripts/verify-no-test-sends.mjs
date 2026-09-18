// Verifikasi akhir: pastikan tidak ada pesan uji yang benar-benar terkirim,
// dan bersihkan sisa baris uji dari DB.
// Dijalankan di VM207: node scripts/verify-no-test-sends.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/wa.db');
const testBatches = [
  'camp_verify_real', 'camp_e2e_verify', 'camp_chunk_600',
  'camp_bound_500', 'camp_bound_501', 'camp_media_chk',
];

console.log('=== pesan uji yang BENAR-BENAR terkirim ke WhatsApp ===');
let totalSent = 0;
for (const b of testBatches) {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS n FROM messages
     WHERE batch_id = ? AND (wa_message_id IS NOT NULL OR status IN ('sent','delivered','read'))
     GROUP BY status`
  ).all(b);
  const n = rows.reduce((a, r) => a + r.n, 0);
  totalSent += n;
  console.log(`  ${b.padEnd(18)} ${n === 0 ? 'TIDAK ADA terkirim' : JSON.stringify(rows)}`);
}
console.log(`\nTOTAL pesan uji yang keluar ke WhatsApp: ${totalSent}`);

// Hapus baris uji supaya DB tidak dipenuhi nomor dummy.
console.log('\n=== membersihkan baris uji dari DB ===');
let removed = 0;
for (const b of testBatches) {
  const info = db.prepare('DELETE FROM messages WHERE batch_id = ?').run(b);
  if (info.changes) console.log(`  ${b}: ${info.changes} baris dihapus`);
  removed += Number(info.changes ?? 0);
}
const leftover = db.prepare(
  `SELECT COUNT(*) AS n FROM messages WHERE recipient LIKE '628000000%'`
).get();
console.log(`\ntotal dihapus: ${removed}`);
console.log(`sisa baris nomor dummy 628000000xxxx: ${leftover.n}`);

console.log('\n=== status akhir seluruh DB (semua batch) ===');
for (const r of db.prepare(
  `SELECT status, COUNT(*) AS n FROM messages GROUP BY status ORDER BY n DESC`
).all()) {
  console.log(`  ${r.status.padEnd(16)} ${r.n}`);
}

db.close();
