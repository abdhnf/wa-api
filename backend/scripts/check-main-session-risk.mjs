// Cek dampak 10 pesan uji ke sesi utama "Nomor Bisnis" (profil fresh, warmup day 1).
// Dijalankan di VM207: node scripts/check-main-session-risk.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/wa.db');

const s = db.prepare(
  `SELECT id, name, phone, status, risk_score, warmup_day, messages_sent_today,
          delivery_rate, antiban_preset, number_profile, antiban_state, created_at
   FROM sessions WHERE id = 'sess-mtts0woz'`
).get();

console.log('=== sesi utama "Nomor Bisnis" ===');
console.log(`  status        : ${s.status}`);
console.log(`  risk_score    : ${s.risk_score}`);
console.log(`  warmup_day    : ${s.warmup_day}`);
console.log(`  profile       : ${s.number_profile}`);
console.log(`  preset        : ${s.antiban_preset}`);
console.log(`  sent_today    : ${s.messages_sent_today}`);
console.log(`  delivery_rate : ${s.delivery_rate}`);
console.log(`  dibuat        : ${s.created_at}`);

let st = {};
try { st = JSON.parse(s.antiban_state || '{}'); } catch { /* bukan JSON */ }
console.log('\n=== antiban_state (ringkas) ===');
if (st.warmup) {
  const started = st.warmup.startedAt ? new Date(st.warmup.startedAt).toISOString() : '?';
  console.log(`  warmup.startedAt = ${started}`);
  console.log(`  warmup keys      = ${Object.keys(st.warmup).join(', ')}`);
  if (st.warmup.dailyLimit) console.log(`  warmup.dailyLimit= ${JSON.stringify(st.warmup.dailyLimit)}`);
}
console.log(`  top-level keys   = ${Object.keys(st).join(', ')}`);

// Berapa kiriman HARI INI (waktu lokal) ke sesi ini, termasuk uji saya
console.log('\n=== kiriman hari ini via sesi ini, per batch ===');
const today = db.prepare(
  `SELECT batch_id,
          COUNT(*) AS total,
          SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS terkirim,
          SUM(CASE WHEN status = 'not_registered' THEN 1 ELSE 0 END) AS notreg
   FROM messages
   WHERE session_id = 'sess-mtts0woz' AND date(created_at) = date('now')
   GROUP BY batch_id ORDER BY total DESC`
).all();
for (const t of today) {
  const tag = String(t.batch_id).startsWith('camp_smoke') || String(t.batch_id).startsWith('batch_')
    ? '  <- UJI SAYA' : '';
  console.log(`  ${String(t.batch_id).padEnd(24)} total=${String(t.total).padEnd(4)} terkirim=${String(t.terkirim).padEnd(4)} notreg=${t.notreg}${tag}`);
}

db.close();
