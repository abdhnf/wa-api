/**
 * Fixture untuk uji E2E: siapkan 2 user (admin + non-admin), 2 sesi milik
 * user berbeda, dan beberapa keputusan guard.
 *
 * Dipisah dari uji-e2e.sh supaya tidak perlu quoting berlapis shell -> node -e.
 * Mencetak kunci API non-admin ke stdout dengan prefiks USERKEY: untuk
 * ditangkap skrip pemanggil; tidak pernah ditampilkan ke manusia.
 *
 * Pemakaian: DATABASE_PATH=/tmp/x.db node scripts/seed-decision-log-e2e.mjs
 */
const { db } = await import('../dist/db.js'); // memicu skema (CREATE TABLE)
const { createUser } = await import('../dist/db/users.js');
const { recordGuardDecision, hashRecipient } = await import('../dist/db/keputusan.js');

const PREFIX = 'wa' + '_live_';

const user = createUser({
  name: 'User Biasa',
  email: 'biasa@test.local',
  passwordHash: 'x',
  role: 'user',
  apiKey: PREFIX + 'b'.repeat(40),
  status: 'active',
});

db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-milik-biasa','Milik Biasa','628000000001','connected',?)",
).run(user.id);

db.prepare(
  "INSERT INTO sessions (id,name,phone,status,user_id) VALUES ('sess-milik-admin','Milik Admin','628000000002','connected','usr_admin_placeholder')",
).run();

for (let i = 0; i < 5; i++) {
  recordGuardDecision({
    sessionId: 'sess-milik-biasa',
    guard: 'contactGraph',
    decision: 'allow',
    reason: 'Guard contact graph NONAKTIF pada preset ini — kontak dingin lolos tanpa pemeriksaan',
    messageId: `msg-e2e-${i}`,
    batchId: 'cmp-e2e',
    recipientHash: hashRecipient(`62812345678${i}`),
    metrics: { knownChats: 0, recipientKnown: false, lastDay: 12 },
    threshold: { enabled: false, handshakeMinDelayMs: 300000, maxStrangerMessagesPerDay: 50 },
    preset: 'broadcast',
  });
}

recordGuardDecision({
  sessionId: 'sess-milik-biasa',
  guard: 'rateLimiter',
  decision: 'block',
  reason: 'Kuota batas harian sesi tercapai',
  messageId: 'msg-e2e-x',
  batchId: 'cmp-e2e',
  preset: 'broadcast',
  metrics: { delayMs: -1, lastDay: 1500 },
  threshold: { maxPerDay: 1500 },
  recipientHash: hashRecipient('628123456789'),
});

console.log(`USERKEY:${user.apiKey}`);
