/**
 * Verifikasi pasca-deploy: tembak SEMUA route ke backend VM yang sedang melayani.
 *
 * Yang dibuktikan: tidak ada satu pun route yang menjawab 404. Route publik
 * menjawab 200/400, route berproteksi menjawab 401. 404 berarti route tidak
 * terdaftar — itu kegagalan deploy.
 *
 * Tanpa token: cukup untuk membuktikan route TERDAFTAR. Isi handler-nya sudah
 * dibandingkan lokal (74/74 identik), dan menembaknya dengan kredensial produksi
 * akan mengubah data nyata.
 *
 * Jalankan: node scripts-pecah/verifikasi-vm.mjs
 */
import { readFileSync } from 'node:fs';

const BASE = 'http://172.30.30.229:3100/api/v1';
const ROUTES = JSON.parse(readFileSync('/tmp/route-list.json', 'utf8'));

const isiParam = (p) =>
  p.replace(/:batchId/g, 'bat_uji')
   .replace(/^\/admin\/users\/:id/, '/admin/users/usr_uji')
   .replace(/^\/users\/:id/, '/users/usr_uji')
   .replace(/:id/g, 'sess_uji');

const hasil = {};
for (const [metode, pola] of ROUTES) {
  const jalur = isiParam(pola);
  try {
    const r = await fetch(BASE + jalur, {
      method: metode,
      headers: { 'content-type': 'application/json' },
      body: metode === 'GET' || metode === 'DELETE' ? undefined : '{}',
    });
    hasil[`${metode} ${pola}`] = r.status;
  } catch (e) {
    hasil[`${metode} ${pola}`] = `ERR:${e.message}`;
  }
}

const n404 = Object.entries(hasil).filter(([, s]) => s === 404);
const err = Object.entries(hasil).filter(([, s]) => typeof s === 'string');
const ok = Object.entries(hasil).filter(([, s]) => s !== 404 && typeof s !== 'string');

console.log(`  ${ROUTES.length} route ditembak ke ${BASE}`);
console.log();
console.log('  ringkasan status:');
const hitung = {};
for (const [, s] of Object.entries(hasil)) hitung[s] = (hitung[s] || 0) + 1;
for (const [k, v] of Object.entries(hitung).sort()) {
  console.log(`    ${String(k).padEnd(10)} ${v} route`);
}

console.log();
if (n404.length) {
  console.log(`  GAGAL: ${n404.length} route menjawab 404 (tidak terdaftar):`);
  for (const [k] of n404) console.log(`    ${k}`);
} else {
  console.log(`  OK: tidak ada route 404 — ${ok.length} route terdaftar dan merespons.`);
}
if (err.length) {
  console.log(`  PERHATIAN: ${err.length} route gagal dihubungi:`);
  for (const [k, s] of err) console.log(`    ${k} -> ${s}`);
}

process.exit(n404.length || err.length ? 1 : 0);
