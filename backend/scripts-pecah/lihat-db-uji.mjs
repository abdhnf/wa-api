/**
 * Tampilkan sesi dan pesan di DB uji — untuk memastikan verifikasi browser
 * membuka sesi yang benar. Tanpa ini, tabel riwayat tampil kosong dan
 * kegagalan verifikasi mudah disalahartikan sebagai fitur yang tidak jalan.
 *
 * Jalankan: node scripts-pecah/lihat-db-uji.mjs <path-db>
 */
import { existsSync } from 'node:fs';

const path = process.argv[2];
if (!path || !existsSync(path)) {
  console.error('  pakai: node lihat-db-uji.mjs <path-db>');
  process.exit(1);
}
process.env.DATABASE_PATH = path;

const { db } = await import('../dist/db/client.js');

console.log('  SESI:');
for (const s of db.prepare('SELECT id, name, user_id, status FROM sessions').all()) {
  const n = db.prepare('SELECT COUNT(*) c FROM messages WHERE session_id = ?').get(s.id).c;
  console.log(`    ${String(s.id).padEnd(22)} ${String(s.name ?? '').padEnd(18)} user=${s.user_id} pesan=${n}`);
}

console.log('\n  PESAN:');
const rows = db.prepare('SELECT id, session_id, status, created_at, payload FROM messages ORDER BY created_at').all();
for (const r of rows) {
  const p = JSON.parse(r.payload);
  const tahap = Object.keys(p.statusTimes ?? {});
  console.log(`    ${String(r.id).padEnd(24)} ${String(r.status).padEnd(16)} sesi=${r.session_id}  tahap=${tahap.join(',') || 'TIDAK ADA'}`);
}
console.log(`\n  total pesan: ${rows.length}`);
