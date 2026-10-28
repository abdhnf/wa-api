/**
 * Fixture uji isolasi tenant: 2 user non-admin, masing-masing 1 sesi.
 *
 * Mencetak kunci dan id sesi ke stdout dengan prefiks supaya skrip pemanggil bisa
 * menangkapnya tanpa menampilkan nilainya ke manusia.
 *
 * Pemakaian: DATABASE_PATH=/tmp/x.db node scripts/seed-tenant-uji.mjs
 */
const PREFIX = 'wa' + '_live_';

const { db } = await import('../dist/db.js'); // memicu skema (CREATE TABLE)
const { createUser } = await import('../dist/db/users.js');

const userA = createUser({
  name: 'Tenant A',
  email: 'tenant-a@test.local',
  passwordHash: 'x',
  role: 'user',
  apiKey: PREFIX + 'a'.repeat(40),
  status: 'active',
});

const userB = createUser({
  name: 'Tenant B',
  email: 'tenant-b@test.local',
  passwordHash: 'x',
  role: 'user',
  apiKey: PREFIX + 'b'.repeat(40),
  status: 'active',
});

// Sesi tanpa nomor WA sungguhan: uji ini hanya menyentuh lapisan otorisasi,
// bukan koneksi WhatsApp. Status 'disconnected' supaya engine tidak mencoba
// menyambung saat server start.
db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-tenant-a','Sesi A','628000000011','disconnected',?)",
).run(userA.id);

db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-tenant-b','Sesi B','628000000022','disconnected',?)",
).run(userB.id);

console.log(`KEYA:${userA.apiKey}`);
console.log(`KEYB:${userB.apiKey}`);
console.log('SESSA:sess-tenant-a');
console.log('SESSB:sess-tenant-b');
