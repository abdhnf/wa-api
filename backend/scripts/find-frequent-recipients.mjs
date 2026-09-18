// Cari nomor yang memang SERING dikirimi pesan (bukan nomor acak),
// untuk dipakai sebagai target uji aman.
// Dijalankan di VM207: node scripts/find-frequent-recipients.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/wa.db');

console.log('=== nomor dengan pengiriman BERHASIL terbanyak ===');
const rows = db.prepare(
  `SELECT recipient,
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS sukses,
          SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
          MAX(created_at) AS terakhir
   FROM messages
   WHERE recipient NOT LIKE '628000000%'
   GROUP BY recipient
   HAVING sukses > 0
   ORDER BY sukses DESC
   LIMIT 15`
).all();

if (!rows.length) console.log('  (tidak ada)');
rows.forEach((r) =>
  console.log(
    `  ${r.recipient} | sukses=${String(r.sukses).padEnd(4)} delivered=${String(r.delivered).padEnd(4)} total=${String(r.total).padEnd(5)} terakhir=${r.terakhir}`
  )
);

// Nomor yang paling sering muncul sebagai penerima kampanye nyata (dari MySQL queue
// tidak bisa diakses dari sini), jadi pakai distribusi status sebagai proksi.
console.log('\n=== ringkasan status seluruh pesan (semua waktu) ===');
for (const r of db.prepare(
  `SELECT status, COUNT(*) AS n FROM messages GROUP BY status ORDER BY n DESC`
).all()) {
  console.log(`  ${r.status.padEnd(16)} ${r.n}`);
}

db.close();
