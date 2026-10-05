/**
 * Buktikan efek samping saat impor db.js TIDAK berubah setelah pemecahan.
 *
 * Ini bagian paling berisiko dari pemecahan db.ts. Isinya bukan sekadar
 * deklarasi fungsi: begitu modul dimuat ia menjalankan PRAGMA, CREATE TABLE,
 * migrasi kolom, pembuatan index, seed settings, dan seed Super Admin. Kalau
 * urutannya salah atau ada modul yang tidak termuat, tabel tidak pernah dibuat
 * dan aplikasi gagal start.
 *
 * Dua skenario diuji:
 *   A. DATABASE BARU  — versi lama vs versi baru harus menghasilkan skema,
 *      index, settings, dan user yang identik.
 *   B. DATABASE LAMA  — database yang dibuat versi lama lalu dibuka versi baru
 *      harus tetap utuh (migrasi idempoten, tidak ada kolom/index hilang).
 *
 * Pemakaian:
 *   node scripts-pecah/uji-skema-db.mjs <dirDist> <berkasDb>
 */
import { pathToFileURL } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';

const dirDist = process.argv[2];
const berkasDb = process.argv[3];

if (!dirDist || !berkasDb) {
  console.error('pemakaian: node uji-skema-db.mjs <dirDist> <berkasDb>');
  process.exit(2);
}

// Mulai dari database kosong supaya jalur "fresh install" yang diuji.
for (const sufiks of ['', '-wal', '-shm']) {
  const f = berkasDb + sufiks;
  if (existsSync(f)) unlinkSync(f);
}

// Kredensial bootstrap dibuat deterministik supaya bisa dibandingkan.
process.env.DATABASE_PATH = berkasDb;
process.env.ADMIN_EMAIL = 'admin@contoh.id';
process.env.ADMIN_PASSWORD = 'rahasia-uji-123';
process.env.ADMIN_NAME = 'Super Admin';

const mod = await import(pathToFileURL(`${dirDist}/db.js`).href);
const db = mod.db;

const objek = db
  .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name")
  .all()
  .filter((o) => !String(o.name).startsWith('sqlite_'));

const kolom = {};
for (const o of objek.filter((o) => o.type === 'table')) {
  kolom[o.name] = db
    .prepare(`PRAGMA table_info(${o.name})`)
    .all()
    .map((c) => `${c.name}|${c.type}|${c.notnull}|${c.dflt_value}|${c.pk}`)
    .sort();
}

const indexSql = {};
for (const o of objek.filter((o) => o.type === 'index')) {
  const r = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(o.name);
  indexSql[o.name] = (r?.sql || '').replace(/\s+/g, ' ').trim();
}

const settings = db.prepare('SELECT key, value FROM settings ORDER BY key').all();
const users = db.prepare('SELECT email, role, status FROM users ORDER BY email').all();
const pragma = {
  journal_mode: db.prepare('PRAGMA journal_mode').get(),
  foreign_keys: db.prepare('PRAGMA foreign_keys').get(),
};

console.log(JSON.stringify({ objek, kolom, indexSql, settings, users, pragma }, null, 0));
