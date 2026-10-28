/**
 * Probe: berapa baris decision log yang tercatat untuk SATU percobaan kirim?
 *
 * Dua kecurigaan yang diuji di sini:
 *
 * 1. Guard `warmup` dicatat di dalam `checkHealth()`, yang sebenarnya fungsi
 *    SELEKSI SESI — dipanggil untuk tiap kandidat sesi, lalu untuk sticky check,
 *    lalu untuk sesi terpilih. Kalau benar, satu pengiriman menghasilkan
 *    beberapa baris `warmup` tanpa `messageId`.
 *
 * 2. `checkHealth()` hanya dipanggil bila autorotate aktif. Artinya pada
 *    instalasi satu-sesi (autorotate mati), guard warm-up TIDAK PERNAH dicatat
 *    sama sekali — padahal warm-up-lah yang paling mungkin menahan pengiriman
 *    di sesi baru.
 *
 * Probe ini membuktikan atau membantah keduanya dengan angka.
 *
 * Jalankan dari backend/: node scripts/probe-rasio-keputusan.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'probe-rasio-'));
process.env.DATABASE_PATH = join(TMP, 'probe.db');
process.env.JWT_SECRET = 'probe-secret';

const { db } = await import('../dist/db.js');
const { createUser } = await import('../dist/db/users.js');
const { setUserSetting, setSettings } = await import('../dist/db.js');

const PREFIX = 'wa' + '_live_';
const user = createUser({
  name: 'Probe', email: 'probe@test.local', passwordHash: 'x',
  role: 'admin', apiKey: PREFIX + 'c'.repeat(40), status: 'active',
});

// Tiga sesi connected — cukup untuk memaksa checkHealth dievaluasi berkali-kali.
for (const n of [1, 2, 3]) {
  db.prepare(
    "INSERT INTO sessions (id,name,phone,status,user_id) VALUES (?,?,?,'connected',?)",
  ).run(`sess-probe-${n}`, `Probe ${n}`, `62800000000${n}`, user.id);
}

const hitung = () => db.prepare(
  'SELECT guard, decision, COUNT(*) AS n, SUM(CASE WHEN message_id IS NULL THEN 1 ELSE 0 END) AS tanpa FROM antiban_decisions GROUP BY guard, decision ORDER BY guard',
).all();

const total = () => db.prepare('SELECT COUNT(*) AS n FROM antiban_decisions').get().n;

const { manager } = await import('../dist/routes/konteks.js');

// ---------------------------------------------------------------- Skenario A
console.log('=== A. Autorotate MATI (instalasi satu sesi biasa) ===');
setSettings({ autorotate_enabled: 'false' });
const a0 = total();
for (let i = 0; i < 3; i++) {
  try { await manager.resolveSession('sess-probe-1', '6281234567890', user.id, 'admin'); } catch {}
}
const a1 = total();
console.log(`  3 panggilan -> ${a1 - a0} baris tercatat`);
console.log(a1 - a0 === 0
  ? '  KONFIRMASI: guard warm-up tidak pernah dicatat saat autorotate mati'
  : '  guard tercatat meski autorotate mati');

// ---------------------------------------------------------------- Skenario B
console.log('\n=== B. Autorotate AKTIF, 3 sesi kandidat ===');
setSettings({ autorotate_enabled: 'true', autorotate_strategy: 'least_loaded' });
const b0 = total();
try { await manager.resolveSession('auto', '6281234567890', user.id, 'admin'); } catch (e) {
  console.log('  (melempar:', e.message, ')');
}
const b1 = total();
console.log(`  1 panggilan resolveSession('auto') -> ${b1 - b0} baris`);
for (const r of hitung()) {
  console.log(`    ${r.guard}/${r.decision}: ${r.n} (tanpa messageId: ${r.tanpa})`);
}

console.log('\n=== C. Tiga panggilan berturut-turut (simulasi 3 pesan) ===');
const c0 = total();
for (let i = 0; i < 3; i++) {
  try { await manager.resolveSession('auto', '6281234567890', user.id, 'admin'); } catch {}
}
const c1 = total();
console.log(`  3 panggilan -> ${c1 - c0} baris (${((c1 - c0) / 3).toFixed(1)} per panggilan)`);

console.log('\n=== Ringkasan seluruh tabel ===');
for (const r of hitung()) {
  console.log(`  ${r.guard}/${r.decision}: ${r.n} baris, ${r.tanpa} tanpa messageId`);
}
const semua = total();
const tanpaPesan = db.prepare('SELECT COUNT(*) AS n FROM antiban_decisions WHERE message_id IS NULL').get().n;
console.log(`  TOTAL ${semua} baris, ${tanpaPesan} di antaranya tanpa messageId`);

console.log('\n=== Arti angka ini ===');
console.log('  Baris tanpa messageId TIDAK muncul saat menjawab "kenapa pesan ini tertahan",');
console.log('  karena index idx_antiban_dec_message memakai WHERE message_id IS NOT NULL.');
console.log('  Kalau rasionya >1 per pengiriman, tabel membengkak oleh baris yang tidak');
console.log('  bisa dipakai untuk pertanyaan utamanya.');

db.close();
rmSync(TMP, { recursive: true, force: true });

// Probe mengimpor routes/konteks.js yang membuat koneksi WhatsApp. Tanpa exit
// eksplisit, proses menunggu socket itu dan baru mati setelah timeout.
process.exit(0);
