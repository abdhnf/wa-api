#!/usr/bin/env node
/**
 * Uji: apakah penolakan guard TERCATAT ketika SEMUA sesi kandidat ditolak?
 *
 * Ini kasus terpenting untuk audit — pesan benar-benar tertahan — dan justru
 * kasus yang dulu paling kosong: tiap penolakan terjadi di dalam checkHealth()
 * yang tidak mencatat apa pun, lalu resolveSession() mengembalikan sesi dengan
 * alasan "semua sesi sedang limit" tanpa jejak guard mana yang menahan.
 *
 * Dulu ini probe sementara; dijadikan uji permanen karena menemukan cacat nyata
 * yang tidak tertangkap uji regex mana pun.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'probe-tolak-'));
process.env.DATABASE_PATH = join(TMP, 'probe.db');
process.env.JWT_SECRET = 'probe-secret-tidak-dipakai';

const { db } = await import('../dist/db.js');
const { createUser } = await import('../dist/db/users.js');
const { listDecisions } = await import('../dist/db/decision-log.js');

const user = createUser({
  name: 'Probe', email: 'probe@uji.local', passwordHash: 'x', role: 'admin',
  apiKey: 'wa' + '_live_' + 'd'.repeat(40), status: 'active',
});

// Dua sesi 'connected' tetapi kuota warm-up hariannya sudah habis -> checkHealth
// menolak keduanya lewat guard warmup.
const sesiIds = ['s-tolak-1', 's-tolak-2'];
for (const id of sesiIds) {
  db.prepare(
    `INSERT INTO sessions (id, name, phone, status, user_id) VALUES (?, ?, ?, 'connected', ?)`
  ).run(id, id, '62800000000' + sesiIds.indexOf(id), user.id);
}

const { manager } = await import('../dist/routes/konteks.js');

// Habiskan kuota warm-up kedua sesi lewat API internal.
for (const id of sesiIds) {
  const ab = manager.getAntiBan(id);
  // Default adalah 'graduated' (kuota tanpa batas), jadi turunkan dulu ke fase
  // warming agar ada batas harian yang bisa dihabiskan.
  ab.warmup.setGraduated(false);
  const ws = ab.warmup.getStatus();
  for (let i = 0; i < (ws.todayLimit === -1 ? 0 : ws.todayLimit) + 2; i++) {
    try { ab.warmup.record(true); } catch { /* abaikan */ }
  }
  const setelah = ab.warmup.getStatus();
  console.log(`  ${id}: todaySent=${setelah.todaySent}/${setelah.todayLimit} phase=${setelah.phase}`);
}

const hasil = await manager.resolveSession('auto', '6281234567890', user.id, 'admin');
console.log(`  resolveSession -> sessionId=${hasil.sessionId} reason=${hasil.reason ?? '-'}`);

const { rows: semua } = listDecisions({ limit: 50 });
const blokir = semua.filter((d) => d.decision === 'block');

console.log('');
console.log('=== Hasil ===');
console.log(`  total baris     : ${semua.length}`);
console.log(`  baris 'block'   : ${blokir.length}`);
for (const b of blokir) {
  console.log(`    guard=${b.guard} reason=${String(b.reason).slice(0, 120)}`);
  const m = b.metrics ? JSON.parse(b.metrics) : null;
  if (m?.penolakan) {
    console.log(`    rincian: ${m.penolakan.map((p) => `${p.sessionId}=${p.reason}`).join(' | ').slice(0, 160)}`);
  }
}

const lulus = blokir.length === 1 && blokir[0].guard === 'sessionHealth';
console.log('');
console.log(lulus
  ? '  LULUS: penolakan seluruh sesi tercatat tepat 1 baris (guard sessionHealth).'
  : '  GAGAL: penolakan seluruh sesi TIDAK tercatat sebagaimana mestinya.');

db.close();
rmSync(TMP, { recursive: true, force: true });
process.exit(lulus ? 0 : 1);
