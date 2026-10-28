/**
 * Fixture uji QR/JWT: 2 user dengan password diketahui + 1 sesi masing-masing.
 * Mencetak kredensial uji ke stdout dengan prefiks; skrip pemanggil menangkapnya
 * dan tidak menampilkannya.
 */
const PREFIX = 'wa' + '_live_';

const { db } = await import('../dist/db.js');
const { createUser } = await import('../dist/db/users.js');
const { hashPassword } = await import('../dist/security.js');

const pass = 'uji-' + Math.random().toString(36).slice(2, 10);
const hash = hashPassword(pass);

const userA = createUser({
  name: 'QR A',
  email: 'qr-a@test.local',
  passwordHash: hash,
  role: 'user',
  apiKey: PREFIX + 'c'.repeat(40),
  status: 'active',
});

const userB = createUser({
  name: 'QR B',
  email: 'qr-b@test.local',
  passwordHash: hash,
  role: 'user',
  apiKey: PREFIX + 'd'.repeat(40),
  status: 'active',
});

db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-qr-a','QR A','628000000033','disconnected',?)",
).run(userA.id);
db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-qr-b','QR B','628000000044','disconnected',?)",
).run(userB.id);

console.log(`AEMAIL:${userA.email}`);
console.log(`BEMAIL:${userB.email}`);
console.log(`APASS:${pass}`);
console.log('SESSA:sess-qr-a');
console.log('SESSB:sess-qr-b');
