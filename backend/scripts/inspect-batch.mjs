// Baca kembali pesan hasil bulk v2 untuk membuktikan payload per-penerima tersimpan.
// Dijalankan di VM207: node scripts/inspect-batch.mjs <batchId>
import { DatabaseSync } from 'node:sqlite';

const batchId = process.argv[2] || 'camp_e2e_verify';
const db = new DatabaseSync('data/wa.db');

const rows = db.prepare(
  `SELECT id, recipient, mode, status, payload FROM messages WHERE batch_id = ? ORDER BY recipient`
).all(batchId);

console.log(`batch_id=${batchId} -> ${rows.length} baris\n`);

const texts = [];
for (const r of rows) {
  let p = {};
  try { p = JSON.parse(r.payload); } catch { /* payload bukan JSON */ }
  const body = p.text ?? p.caption ?? '';
  if (body) texts.push(body);
  console.log(`  ${r.recipient} | ${r.status.padEnd(8)} | ${r.mode.padEnd(8)} | ${JSON.stringify(String(body).slice(0, 55))}`);
  if (p.mediaUrl) console.log(`      mediaUrl=${p.mediaUrl}`);
  if (p.latitude) console.log(`      loc=${p.latitude},${p.longitude}`);
}

const unique = new Set(texts);
console.log(`\nteks unik: ${unique.size}/${texts.length}`);
console.log(unique.size > 1 ? 'OK: payload per-penerima dipertahankan' : 'GAGAL: teks seragam');
db.close();
