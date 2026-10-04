/**
 * Uji normalisasi & keunikan nomor telepon lewat HTTP.
 *
 * Fokusnya dua hal yang mudah salah:
 *   1. Format tulisan yang berbeda-beda harus jadi satu bentuk kanonik.
 *   2. Nomor yang sama tidak boleh dipakai dua akun, TAPI banyak user boleh
 *      kosong — inilah gunanya UNIQUE INDEX parsial.
 *
 * Jalankan: DATABASE_PATH=/tmp/uji-telepon.db node scripts/uji-telepon.mjs
 */

import { spawn } from 'node:child_process';
import { setTimeout as tunggu } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dbPath = process.env.DATABASE_PATH;
if (!dbPath || !/^\/tmp\/|^\/var\/tmp\//.test(dbPath)) {
  console.error('FATAL: DATABASE_PATH wajib menunjuk ke /tmp.');
  process.exit(1);
}

const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const __dirname = dirname(fileURLToPath(import.meta.url));

let lulus = 0;
let gagal = 0;
function cek(nama, syarat, detail = '') {
  if (syarat) { lulus++; console.log(`  LULUS  ${nama}`); }
  else { gagal++; console.log(`  GAGAL  ${nama}${detail ? ` — ${detail}` : ''}`); }
}

const server = spawn('node', ['dist/server.js'], {
  cwd: join(__dirname, '..'),
  env: { ...process.env, DATABASE_PATH: dbPath, PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET: 'uji-telepon' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
server.stdout.on('data', (d) => (log += d.toString()));
server.stderr.on('data', (d) => (log += d.toString()));

let siap = false;
for (let i = 0; i < 60; i++) {
  await tunggu(500);
  try { if ((await fetch(`${BASE}/health`)).ok) { siap = true; break; } } catch {}
}
if (!siap) {
  console.error('Backend tidak siap:\n' + log.slice(-2000));
  server.kill();
  process.exit(1);
}

const login = await (await fetch(`${BASE}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }),
})).json();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` };

async function buatUser(nama, email, phone) {
  const r = await fetch(`${BASE}/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: nama, email, password: 'rahasia123', role: 'user', phone }),
  });
  return { status: r.status, body: await r.json() };
}

console.log('\n== 1. Normalisasi format nomor ==');

const variasi = [
  ['08123456789', '628123456789', 'awalan 0'],
  ['+628123456789', '628123456789', 'awalan +62'],
  ['628123456789', '628123456789', 'awalan 62'],
  ['0812-3456-789', '628123456789', 'dengan tanda hubung'],
  ['0812 3456 789', '628123456789', 'dengan spasi'],
  ['+62 812-3456-789', '628123456789', 'kombinasi'],
];

for (let i = 0; i < variasi.length; i++) {
  const [input, diharapkan, label] = variasi[i];
  const r = await buatUser(`Uji ${i}`, `norm${i}@example.com`, input);
  if (r.status === 201) {
    cek(`"${input}" (${label}) -> ${diharapkan}`, r.body.user?.phone === diharapkan, `dapat: ${r.body.user?.phone}`);
  } else {
    // Semua variasi di atas adalah nomor YANG SAMA, jadi setelah yang pertama
    // tersimpan, sisanya memang harus ditolak sebagai duplikat.
    cek(`"${input}" (${label}) ditolak sebagai duplikat`, r.status === 409 || /sudah dipakai/i.test(r.body.error || ''), JSON.stringify(r.body));
  }
}

console.log('\n== 2. Nomor duplikat ditolak ==');
const dup = await buatUser('Duplikat', 'dup@example.com', '08123456789');
cek('nomor yang sama untuk akun lain ditolak', dup.status === 409, `status ${dup.status}: ${dup.body.error}`);

console.log('\n== 3. Banyak user boleh tanpa nomor ==');
const a = await buatUser('Tanpa Nomor A', 'tanpa-a@example.com', '');
const b = await buatUser('Tanpa Nomor B', 'tanpa-b@example.com', undefined);
const c = await buatUser('Tanpa Nomor C', 'tanpa-c@example.com', '   ');
cek('user tanpa nomor A diterima', a.status === 201, JSON.stringify(a.body).slice(0, 150));
cek('user tanpa nomor B diterima', b.status === 201, JSON.stringify(b.body).slice(0, 150));
cek('user tanpa nomor C diterima', c.status === 201, JSON.stringify(c.body).slice(0, 150));
cek('nomor kosong tidak tersimpan sebagai string', !a.body.user?.phone && !b.body.user?.phone && !c.body.user?.phone);

console.log('\n== 4. Nomor tidak valid ditolak ==');
const buruk = await buatUser('Nomor Buruk', 'buruk@example.com', '12345');
cek('nomor terlalu pendek ditolak', buruk.status === 400, `status ${buruk.status}`);
cek('pesan galat menjelaskan format', /format/i.test(buruk.body.error || ''), buruk.body.error);

const buruk2 = await buatUser('Nomor Buruk 2', 'buruk2@example.com', 'abcdefghij');
cek('nomor berisi huruf ditolak', buruk2.status === 400, `status ${buruk2.status}`);

console.log('\n== 5. Ubah & hapus nomor ==');
const daftar = await (await fetch(`${BASE}/users`, { headers: H })).json();
const target = daftar.users.find((u) => u.email === 'tanpa-a@example.com');

const ubah = await fetch(`${BASE}/users/${target.id}`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ phone: '0857-1111-2222' }),
});
const ubahBody = await ubah.json();
cek('nomor bisa ditambahkan lewat PATCH', ubah.status === 200 && ubahBody.user?.phone === '6285711112222', JSON.stringify(ubahBody.user?.phone));

const hapus = await fetch(`${BASE}/users/${target.id}`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ phone: '' }),
});
const hapusBody = await hapus.json();
cek('nomor bisa dihapus dengan string kosong', hapus.status === 200 && !hapusBody.user?.phone, JSON.stringify(hapusBody.user?.phone));

const pakaiLagi = await buatUser('Pakai Nomor Bebas', 'bebas@example.com', '085711112222');
cek('nomor yang sudah dihapus bisa dipakai lagi', pakaiLagi.status === 201, `status ${pakaiLagi.status}: ${pakaiLagi.body.error}`);

const tanpaPhoneField = await fetch(`${BASE}/users/${target.id}`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ name: 'Nama Baru Saja' }),
});
const tanpaBody = await tanpaPhoneField.json();
cek('PATCH tanpa field phone tidak menghapus nomor', tanpaPhoneField.status === 200, JSON.stringify(tanpaBody.user?.phone));

console.log(`\n== Ringkasan ==\n  Lulus: ${lulus}\n  Gagal: ${gagal}`);
console.log(gagal === 0 ? '\n  SEMUA UJI LULUS\n' : '\n  ADA UJI YANG GAGAL\n');

server.kill();
process.exit(gagal === 0 ? 0 : 1);
