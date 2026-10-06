/**
 * Verifikasi produksi: apakah `statusTimes` benar-benar terisi pada pesan nyata.
 *
 * HANYA BACA. Tidak mengirim pesan, tidak mengubah baris apa pun.
 *
 * Kenapa tidak mengirim pesan sendiri: mengirim dari nomor produksi adalah efek
 * samping nyata, dan pernah ada insiden pesan uji terkirim ke nomor acak
 * (lihat scripts/audit-test-damage.mjs). Pengiriman diserahkan ke operator.
 *
 * Jalankan di VM207: node scripts-pecah/verifikasi-waktu-produksi.mjs
 * Argumen opsional: jumlah pesan terbaru yang ditampilkan (default 5).
 */
import { DatabaseSync } from 'node:sqlite';

const JUMLAH = Number(process.argv[2] || 5);

const db = new DatabaseSync('data/wa.db', { readOnly: true });

const LABEL = {
  queued: 'Masuk antrean',
  pacing: 'Jeda anti-ban',
  sending: 'Mulai dikirim',
  sent: 'Sampai server WhatsApp',
  delivered: 'Sampai perangkat penerima',
  read: 'Dibaca penerima',
  failed: 'Gagal',
};

const jam = (ms) => {
  if (!ms) return '-';
  return new Date(ms).toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
};

const selisih = (a, b) => {
  if (!a || !b) return '';
  const d = Math.round((b - a) / 100) / 10;
  return d > 0 ? `+${String(d).replace('.', ',')} dtk` : '';
};

const rows = db.prepare(
  'SELECT id, status, created_at, payload FROM messages ORDER BY rowid DESC LIMIT ?'
).all(JUMLAH);

let adaYangPunya = 0;

for (const r of rows) {
  let p = {};
  try { p = JSON.parse(r.payload || '{}'); } catch { /* payload rusak: perlakukan kosong */ }
  const st = p.statusTimes || {};
  const kunci = Object.keys(st);

  console.log(`  ${r.id}`);
  console.log(`    status   : ${r.status}`);
  console.log(`    ke nomor : ${p.to || '-'}`);
  console.log(`    dibuat   : ${r.created_at}`);

  if (kunci.length === 0) {
    console.log('    statusTimes: (kosong — pesan lama, dibuat sebelum fitur ini)');
    console.log('');
    continue;
  }

  adaYangPunya++;
  console.log('    statusTimes:');
  let sebelumnya = null;
  for (const k of ['queued', 'pacing', 'sending', 'sent', 'delivered', 'read', 'failed']) {
    if (st[k] === undefined) continue;
    console.log(`      ${LABEL[k].padEnd(24)} ${jam(st[k])}  ${selisih(sebelumnya, st[k])}`);
    sebelumnya = st[k];
  }
  console.log('');
}

console.log(`  --- ringkasan ---`);
console.log(`    ${adaYangPunya} dari ${rows.length} pesan terbaru punya statusTimes`);

const total = db.prepare(
  "SELECT COUNT(*) AS n FROM messages WHERE payload LIKE '%statusTimes%'"
).get();
console.log(`    total di seluruh DB: ${total.n} pesan`);

db.close();

if (adaYangPunya === 0) {
  console.log('');
  console.log('  CATATAN: belum ada pesan baru sejak deploy. Kirim 1 pesan dari panel,');
  console.log('  lalu jalankan ulang skrip ini.');
}
