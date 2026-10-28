/**
 * Uji migrasi pada SALINAN database produksi.
 *
 * Kenapa salinan, bukan DB kosong: DB kosong membuktikan skema terbentuk, tapi
 * tidak membuktikan migrasi aman pada tabel yang SUDAH berisi data. Yang ingin
 * dipastikan di sini: `CREATE TABLE IF NOT EXISTS` tidak menyentuh tabel lama,
 * jumlah baris `messages`/`users`/`sessions` tidak berubah, dan tidak ada kolom
 * yang hilang.
 *
 * PENTING: berkas ini harus dijalankan pada SALINAN, bukan DB hidup. Setelah
 * selesai, salinan WAJIB di-shred — ia memuat kredensial sesi WhatsApp hidup.
 *
 * Pemakaian: node uji-migrasi-salinan.mjs /path/ke/salinan.db
 */
import { copyFileSync, statSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const asli = process.argv[2];
if (!asli) { console.error('pakai: node scripts/uji-decision-log-migrasi.mjs <db>'); process.exit(1); }

const salinan = `/tmp/uji-migrasi-${Date.now()}.db`;
copyFileSync(asli, salinan);

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
};

/** Potret struktur + jumlah baris, untuk dibandingkan sebelum/sesudah. */
function potret(db) {
  const tabel = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  ).all().map(r => r.name);
  const kolom = {};
  for (const t of tabel) {
    kolom[t] = db.prepare(`SELECT name FROM pragma_table_info('${t}')`).all().map(r => r.name);
  }
  const baris = {};
  for (const t of tabel) {
    try { baris[t] = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n; } catch { baris[t] = -1; }
  }
  return { tabel, kolom, baris };
}

console.log('=== 1. Potret SEBELUM migrasi (salinan) ===');
const db1 = new DatabaseSync(salinan);
const sebelum = potret(db1);
console.log(`  tabel: ${sebelum.tabel.length}`);
console.log(`  messages=${sebelum.baris.messages} sessions=${sebelum.baris.sessions} users=${sebelum.baris.users}`);
db1.close();

console.log('\n=== 2. Jalankan migrasi (impor dist/db.js pada salinan) ===');
process.env.DATABASE_PATH = salinan;
await import('../dist/db.js');

console.log('\n=== 3. Potret SESUDAH ===');
const db2 = new DatabaseSync(salinan);
const sesudah = potret(db2);
console.log(`  tabel: ${sesudah.tabel.length}`);

console.log('\n=== 4. Perbandingan ===');
check('tabel antiban_decisions DITAMBAHKAN', sesudah.tabel.includes('antiban_decisions'));

const tabelBaru = sesudah.tabel.filter(t => !sebelum.tabel.includes(t));
check('hanya 1 tabel baru', tabelBaru.length === 1, `baru: ${tabelBaru.join(', ')}`);

const tabelHilang = sebelum.tabel.filter(t => !sesudah.tabel.includes(t));
check('tidak ada tabel hilang', tabelHilang.length === 0, `hilang: ${tabelHilang.join(', ')}`);

for (const t of sebelum.tabel) {
  check(`baris ${t} tidak berubah (${sebelum.baris[t]})`, sebelum.baris[t] === sesudah.baris[t],
    `${sebelum.baris[t]} -> ${sesudah.baris[t]}`);
}

for (const t of sebelum.tabel) {
  const hilang = sebelum.kolom[t].filter(c => !sesudah.kolom[t].includes(c));
  if (hilang.length) check(`kolom ${t} utuh`, false, `hilang: ${hilang.join(', ')}`);
}
check('semua kolom tabel lama utuh', sebelum.tabel.every(t => sebelum.kolom[t].every(c => sesudah.kolom[t].includes(c))));

console.log('\n=== 5. Data nyata bisa dibaca ulang ===');
const m = db2.prepare('SELECT COUNT(*) AS n FROM messages').get().n;
const s = db2.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
check('messages terbaca', m === sebelum.baris.messages, `${m}`);
check('sessions terbaca', s === sebelum.baris.sessions, `${s}`);

// Query yang akan dipakai endpoint audit pada data nyata.
const sesiAda = db2.prepare("SELECT id, status FROM sessions LIMIT 3").all();
check('sesi bisa di-query', sesiAda.length > 0, JSON.stringify(sesiAda.slice(0, 2)));
db2.close();

console.log('\n=== 6. Bersihkan salinan (shred) ===');
unlinkSync(salinan);
check('salinan terhapus', statSync(salinan, { throwIfNoEntry: false }) === undefined);

console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
process.exit(fail === 0 ? 0 : 1);
