/** Fixture untuk mengukur ukuran respons: 1 sesi dengan beberapa pesan. */
const { db } = await import('../dist/db.js');
const { createUser } = await import('../dist/db/users.js');

const user = createUser({
  name: 'Ukur',
  email: 'ukur@test.local',
  passwordHash: 'x',
  role: 'user',
  apiKey: 'wa' + '_live_' + 'e'.repeat(40),
  status: 'active',
});

db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-ukur','Sesi Ukur','628000000077','disconnected',?)",
).run(user.id);

// 30 pesan supaya halaman riwayat berisi data, bukan array kosong.
const ins = db.prepare(
  `INSERT INTO messages (id, session_id, user_id, batch_id, recipient, mode, status, payload, created_at)
   VALUES (?, 'sess-ukur', ?, 'batch-1', ?, 'text', 'delivered', ?, datetime('now'))`,
);
for (let i = 0; i < 30; i++) {
  ins.run(
    `msg-${i}`,
    user.id,
    `6280000000${String(i).padStart(2, '0')}`,
    JSON.stringify({ text: 'Pesan uji untuk mengukur ukuran respons riwayat.', to: `6280000000${i}` }),
  );
}

console.log('SESS:sess-ukur');
