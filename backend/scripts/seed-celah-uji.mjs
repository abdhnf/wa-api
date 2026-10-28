/**
 * Fixture uji celah audit: 2 user + 1 sesi milik A.
 *
 * Sesi sengaja `disconnected` agar engine tidak mencoba menyambung; uji ini hanya
 * menyentuh lapisan audit, bukan koneksi WhatsApp.
 */
const PREFIX = 'wa' + '_live_';

const { db } = await import('../dist/db.js');
const { createUser } = await import('../dist/db/users.js');

const a = createUser({
  name: 'Celah A',
  email: 'celah-a@test.local',
  passwordHash: 'x',
  role: 'user',
  apiKey: PREFIX + 'h'.repeat(40),
  status: 'active',
});

const b = createUser({
  name: 'Celah B',
  email: 'celah-b@test.local',
  passwordHash: 'x',
  role: 'user',
  apiKey: PREFIX + 'i'.repeat(40),
  status: 'active',
});

db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-celah-a','Sesi Celah A','628000000301','disconnected',?)",
).run(a.id);

console.log(`KEYA:${a.apiKey}`);
console.log(`KEYB:${b.apiKey}`);
console.log('SESSA:sess-celah-a');
