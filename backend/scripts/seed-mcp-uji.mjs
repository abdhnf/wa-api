/**
 * Fixture uji MCP: dua user, dua sesi, beberapa pesan.
 *
 * Sesi B milik user lain dipakai untuk membuktikan isolasi tenant masih berlaku
 * ketika permintaan datang lewat MCP, bukan hanya lewat HTTP langsung.
 */
const PREFIX = 'wa' + '_live_';

const { db } = await import('../dist/db.js');
const { createUser } = await import('../dist/db/users.js');

const a = createUser({
  name: 'MCP A',
  email: 'mcp-a@test.local',
  passwordHash: 'x',
  role: 'user',
  apiKey: PREFIX + 'f'.repeat(40),
  status: 'active',
});

const b = createUser({
  name: 'MCP B',
  email: 'mcp-b@test.local',
  passwordHash: 'x',
  role: 'user',
  apiKey: PREFIX + 'g'.repeat(40),
  status: 'active',
});

db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-mcp-a','Sesi MCP A','628000000101','disconnected',?)",
).run(a.id);
db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-mcp-b','Sesi MCP B','628000000102','disconnected',?)",
).run(b.id);

const ins = db.prepare(
  `INSERT INTO messages (id, session_id, user_id, batch_id, recipient, mode, status, payload, created_at)
   VALUES (?, 'sess-mcp-a', ?, 'batch-mcp', ?, 'text', ?, ?, datetime('now'))`,
);
for (let i = 0; i < 25; i++) {
  const status = i % 5 === 0 ? 'failed' : 'delivered';
  ins.run(
    `mcp-msg-${i}`,
    a.id,
    `6280000002${String(i).padStart(2, '0')}`,
    status,
    JSON.stringify({
      text: `Pesan uji MCP nomor ${i}`,
      to: `6280000002${i}`,
      ...(status === 'failed' ? { errorDetail: 'err463: reachout restriction' } : {}),
    }),
  );
}

console.log(`KEYA:${a.apiKey}`);
console.log(`KEYB:${b.apiKey}`);
console.log('SESSA:sess-mcp-a');
console.log('SESSB:sess-mcp-b');
