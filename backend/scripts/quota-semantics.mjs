// Uji satuan semantik kuota per-pesan (Task 2).
//
// Dijalankan di VM207 di dalam direktori backend, memakai modul db.ts yang sudah
// dikompilasi ke dist/, sehingga menguji kode yang benar-benar berjalan — bukan
// salinan logika.
//
// Memverifikasi:
//   1. checkAndIncrementQuota(id, 3) menambah kuota 3, bukan 1
//   2. pemanggilan beruntun mengakumulasi
//   3. permintaan yang melebihi sisa kuota ditolak SEBELUM increment (tanpa side effect)
//   4. refundQuota mengembalikan kuota untuk pesan yang gagal masuk antrean
//   5. checkAndIncrementWeeklyQuota (pembungkus) tetap berperilaku 1 pesan
//
// Pemakaian: node scripts/quota-semantics.mjs
// Exit code 0 = semua lulus.

import { db, createUser, getUserById, deleteUser, checkAndIncrementQuota, checkAndIncrementWeeklyQuota, refundQuota } from '../dist/db.js';
import crypto from 'node:crypto';

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  PASS  ${m}`); pass++; };
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };
const head = (m) => console.log(`\n== ${m}`);

const uid = `usr_qtest_${crypto.randomUUID().slice(0, 6)}`;
const email = `${uid}@test.local`;

// Kuota kecil supaya batasnya mudah diuji; role 'user' agar jalur kuota aktif.
createUser({
  name: 'Quota Test',
  email,
  passwordHash: 'x',
  role: 'user',
  apiKey: `wa_test_${crypto.randomUUID()}`,
  quotaPerDay: 10,
  quotaPerWeek: 10,
  quotaLimit: 10,
  quotaPeriod: 'weekly',
  status: 'active',
});

const user = getUserById(uid) || db.prepare('SELECT id FROM users WHERE email = ?').get(email);
const id = user?.id;
if (!id) { console.log('GAGAL membuat user uji'); process.exit(1); }

const used = () => getUserById(id).usedInPeriod ?? 0;

try {
  head('1. checkAndIncrementQuota(id, 3) menambah 3, bukan 1');
  const before = used();
  const r1 = checkAndIncrementQuota(id, 3);
  console.log(`  used: ${before} -> ${used()} (allowed=${r1.allowed})`);
  used() - before === 3 ? ok('delta = 3') : bad(`delta = ${used() - before}, harap 3`);
  r1.used === 3 ? ok('r1.used = 3') : bad(`r1.used = ${r1.used}`);

  head('2. akumulasi pemanggilan beruntun');
  checkAndIncrementQuota(id, 2);
  used() === 5 ? ok('used = 5 setelah +2') : bad(`used = ${used()}, harap 5`);

  head('3. permintaan melebihi sisa kuota ditolak TANPA side effect');
  const beforeReject = used();
  const r3 = checkAndIncrementQuota(id, 100);
  console.log(`  allowed=${r3.allowed} used tetap ${used()} reason="${r3.reason}"`);
  r3.allowed === false ? ok('ditolak') : bad('seharusnya ditolak');
  used() === beforeReject ? ok('kuota tidak berubah saat ditolak') : bad(`kuota berubah ${beforeReject} -> ${used()}`);
  typeof r3.reason === 'string' && r3.reason.includes('tidak cukup')
    ? ok('alasan menyebut sisa kuota') : bad(`alasan tidak informatif: ${r3.reason}`);

  head('4. refundQuota mengembalikan kuota');
  const beforeRefund = used();
  refundQuota(id, 2);
  used() === beforeRefund - 2 ? ok(`used ${beforeRefund} -> ${used()} (-2)`) : bad(`refund salah: ${beforeRefund} -> ${used()}`);

  head('5. refundQuota tidak pernah negatif');
  refundQuota(id, 9999);
  used() === 0 ? ok('diklem ke 0') : bad(`used = ${used()}, harap 0`);

  head('6. pembungkus checkAndIncrementWeeklyQuota tetap 1 pesan');
  const beforeWrap = used();
  checkAndIncrementWeeklyQuota(id);
  used() - beforeWrap === 1 ? ok('delta = 1') : bad(`delta = ${used() - beforeWrap}, harap 1`);

  head('7. admin unlimited (tidak terpengaruh kuota)');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(id);
  const r7 = checkAndIncrementQuota(id, 100000);
  r7.allowed === true ? ok('admin selalu allowed') : bad('admin malah ditolak');

} finally {
  deleteUser(id);
  console.log(`\n  (user uji ${id} dihapus)`);
}

console.log('\n===================================');
console.log(`  PASS: ${pass}    FAIL: ${fail}`);
console.log('===================================');
process.exit(fail === 0 ? 0 : 1);
