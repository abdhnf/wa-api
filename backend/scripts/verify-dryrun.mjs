// Verifikasi dryRun benar-benar tidak menyentuh antrean maupun kuota.
// Dijalankan di VM207: node scripts/verify-dryrun.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/wa.db');

const rows = db.prepare(
  `SELECT COUNT(*) AS n FROM messages WHERE batch_id = 'camp_dryrun_test'`
).get();
console.log(`baris DB untuk camp_dryrun_test: ${rows.n}  ${rows.n === 0 ? '(OK: tidak ada)' : '(GAGAL)'}`);

// Kuota admin: pastikan tidak berkurang karena dryRun
const u = db.prepare(
  `SELECT email, used_today, used_this_week, quota_per_day, quota_per_week FROM users WHERE email = 'admin@abdhnf.com'`
).get();
console.log('\nkuota admin@abdhnf.com:');
console.log(`  used_today=${u.used_today}  quota_per_day=${u.quota_per_day}`);
console.log(`  used_this_week=${u.used_this_week}  quota_per_week=${u.quota_per_week}`);

console.log('\n=== status DB keseluruhan ===');
for (const r of db.prepare(`SELECT status, COUNT(*) AS n FROM messages GROUP BY status ORDER BY n DESC`).all()) {
  console.log(`  ${r.status.padEnd(16)} ${r.n}`);
}
console.log('\ntotal baris messages:', db.prepare('SELECT COUNT(*) AS n FROM messages').get().n);

db.close();
