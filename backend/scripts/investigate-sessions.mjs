// Telusuri jejak sesi "byu" (628518337173725) dan sesi lain di DB wa-api.
// Dijalankan di VM207: node scripts/investigate-sessions.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/wa.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('tabel:', tables.map((t) => t.name).join(', '));

if (tables.some((t) => t.name === 'sessions')) {
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  console.log('\nkolom sessions:', cols.join(', '));
  console.log('\n=== semua baris sessions ===');
  for (const r of db.prepare('SELECT * FROM sessions').all()) {
    const brief = Object.entries(r)
      .filter(([k]) => !/hash|secret|cred|token|key/i.test(k))
      .map(([k, v]) => `${k}=${typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '…' : v}`)
      .join(' | ');
    console.log('  ' + brief);
  }
}

// Pesan terakhir yang benar-benar keluar ke WhatsApp (bukan cancelled/not_registered)
console.log('\n=== 15 pesan terakhir yang BENAR-BENAR terkirim (sent/delivered/read) ===');
const sent = db.prepare(
  `SELECT recipient, status, batch_id, created_at FROM messages
   WHERE status IN ('sent','delivered','read') ORDER BY created_at DESC LIMIT 15`
).all();
if (!sent.length) console.log('  (tidak ada)');
sent.forEach((r) => console.log(`  ${r.created_at} ${r.recipient} ${r.status} ${r.batch_id ?? '-'}`));

db.close();
