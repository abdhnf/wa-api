import { db } from './client.js';

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -20000;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  api_key TEXT UNIQUE NOT NULL,
  quota_per_day INTEGER NOT NULL DEFAULT 100,
  used_today INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  assigned_session_id TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  risk_score REAL NOT NULL DEFAULT 0,
  warmup_day INTEGER NOT NULL DEFAULT 1,
  messages_sent_today INTEGER NOT NULL DEFAULT 0,
  delivery_rate REAL NOT NULL DEFAULT 100,
  antiban_state TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lid_mappings (
  lid TEXT PRIMARY KEY,
  pn TEXT NOT NULL,
  phone TEXT,
  learned_at INTEGER NOT NULL,
  seen_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_lid_mappings_pn ON lid_mappings(pn);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  jitter_delay_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS api_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  method TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  ip TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS blast_launch_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);


// Migrasi ringan: tambah kolom kalau belum ada (SQLite ALTER TABLE ... ADD COLUMN)
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}
ensureColumn('messages', 'wa_message_id', 'TEXT');
ensureColumn('messages', 'batch_id', 'TEXT');
ensureColumn('sessions', 'antiban_state', 'TEXT');
ensureColumn('sessions', 'antiban_preset', "TEXT DEFAULT 'balanced'");
ensureColumn('sessions', 'antiban_config', 'TEXT');
ensureColumn('sessions', 'number_profile', "TEXT DEFAULT 'mature'");
ensureColumn('users', 'google_id', 'TEXT');
ensureColumn('users', 'auth_provider', "TEXT DEFAULT 'local'");
ensureColumn('users', 'avatar_url', 'TEXT');
ensureColumn('sessions', 'user_id', "TEXT DEFAULT 'usr_c26f74d6'");
ensureColumn('messages', 'user_id', "TEXT DEFAULT 'usr_c26f74d6'");
ensureColumn('users', 'quota_per_week', 'INTEGER NOT NULL DEFAULT 100');
ensureColumn('users', 'used_this_week', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'quota_reset_at', 'TEXT');
ensureColumn('users', 'quota_limit', 'INTEGER NOT NULL DEFAULT 100');
ensureColumn('users', 'used_in_period', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'quota_period', "TEXT NOT NULL DEFAULT 'weekly'");
ensureColumn('messages', 'priority', "TEXT DEFAULT 'normal'");
ensureColumn('sessions', 'health_state', 'TEXT');
ensureColumn('users', 'blast_pin_hash', 'TEXT');
ensureColumn('users', 'blast_access_token', 'TEXT');
// Nomor telepon user. Kanonik: digit saja, awalan 628. Opsional supaya user lama
// tidak rusak. Keunikannya dijaga index parsial di bawah, bukan NOT NULL UNIQUE,
// karena banyak user boleh belum punya nomor.
ensureColumn('users', 'phone', 'TEXT');

// Kolom audit pada `api_logs`.
//
// Latar: `api_logs` dipakai sebagai bukti audit untuk permintaan yang datang dari
// agen (MCP), bukan hanya untuk mencatat galat. Tiga hal belum bisa dijawab
// dengan kolom lama:
//
//   - `actor`      siapa agennya. `ip` tidak menolong karena agen berjalan di
//                  mesin yang sama, jadi IP-nya 127.0.0.1 — sama dengan siapa
//                  pun yang menjalankan curl di sana.
//   - `target_*`   apa sasarannya. Id sesi sebenarnya tersimpan di dalam string
//                  `endpoint`, tetapi mengekstraknya dengan pencocokan teks
//                  rapuh; lebih baik disimpan sebagai kolom.
//   - `params`     nilai apa yang dikirim. Tanpa ini audit hanya bisa bilang
//                  "seseorang memanggil PUT /antiban", bukan "preset diubah
//                  menjadi broadcast" — padahal nilai barunya yang ingin
//                  diketahui.
//
// Semuanya diisi server dari permintaan yang sedang ditangani, bukan dilaporkan
// pemanggil. `params` disaring sebelum disimpan (nomor -> hash, kredensial
// dibuang, ukuran dibatasi); lihat `audit-params.ts`.
ensureColumn('api_logs', 'actor', 'TEXT');
ensureColumn('api_logs', 'target_type', 'TEXT');
ensureColumn('api_logs', 'target_id', 'TEXT');
ensureColumn('api_logs', 'params', 'TEXT');

// `params_before` — nilai SEBELUM aksi.
//
// `params` hanya memuat nilai baru, sehingga audit bisa menjawab "preset diubah
// ke broadcast" tetapi tidak "dari apa". Untuk aksi yang bisa dibalik, pertanyaan
// keduanya justru yang menentukan: tanpa nilai lama, pembalikan harus ditebak.
//
// Sengaja TIDAK diisi otomatis oleh hook `onResponse`: server tidak tahu keadaan
// sebelum handler berjalan, dan menebaknya berarti mencatat sesuatu yang belum
// terjadi. Yang mengisinya adalah handler yang memang sudah membaca nilai lama
// (mis. `PUT /sessions/:id/antiban` membaca preset sebelum menulis).
ensureColumn('api_logs', 'params_before', 'TEXT');

// `audit` — penanda bahwa baris ini bukti audit, bukan catatan galat biasa.
//
// Alasannya: `DELETE /api-logs` dan `POST /api-logs/clear` memakai `requireAuth`,
// sehingga pemilik log bisa menghapus jejaknya sendiri. Sebagai catatan galat itu
// wajar; sebagai bukti audit itu cacat — pihak yang diaudit menjadi penentu
// apakah buktinya tetap ada.
//
// Memperketat seluruh endpoint menjadi admin-only akan memunculkan 403 di panel
// yang sekarang menampilkan tombol hapus untuk semua peran. Karena itu yang
// dipisahkan adalah BARISNYA, bukan endpointnya: baris bertanda `audit = 1` hanya
// bisa dihapus admin, sementara log galat biasa tetap bisa dibersihkan pemiliknya.
ensureColumn('api_logs', 'audit', 'INTEGER NOT NULL DEFAULT 0');

// Production Indexes: Optimalkan query pencarian pesan, status antrean, dan receipt WA.
//
// WAJIB dijalankan SETELAH ensureColumn di atas: sebagian besar index menyentuh
// kolom yang baru ditambahkan lewat migrasi ringan (priority, batch_id, user_id,
// wa_message_id). Kalau diletakkan sebelum ensureColumn, instalasi pada database
// baru langsung gagal dengan "no such column" karena kolomnya belum ada.
db.exec(`
CREATE INDEX IF NOT EXISTS idx_messages_status_prio ON messages (status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_session_time ON messages (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user_time ON messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_batch ON messages (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_user_time ON api_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_created_at ON api_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_api_logs_actor_time ON api_logs (actor, created_at DESC) WHERE actor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_logs_target ON api_logs (target_id) WHERE target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_logs_audit ON api_logs (audit, created_at DESC) WHERE audit = 1;
`);

// Index unik parsial untuk nomor telepon. WAJIB dijalankan setelah ensureColumn
// di atas, karena kolomnya baru ditambahkan di situ.
//
// Kenapa parsial (WHERE phone IS NOT NULL): index unik biasa akan menganggap
// semua NULL sebagai nilai yang sama, sehingga user kedua yang belum punya nomor
// langsung ditolak. Dengan klausa WHERE, hanya nomor yang benar-benar terisi yang
// dijaga keunikannya — banyak user boleh kosong, tapi satu nomor hanya satu akun.
//
// Tabel token reset password mengikuti pola blast_launch_tokens, dengan tambahan
// kolom audit (used_at, destination, requested_ip) dan `channel` yang disiapkan
// untuk OTP via WhatsApp nanti tanpa perlu migrasi ulang.
db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  channel      TEXT NOT NULL DEFAULT 'email',
  destination  TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  requested_ip TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_prt_expires ON password_reset_tokens (expires_at);
`);

// Tabel keputusan guard anti-ban (audit trail).
//
// Kenapa tabel terpisah, bukan menumpang `messages`: satu pesan bisa dievaluasi
// berkali-kali (setiap kali antrean bangun, guard dinilai ulang). Menyimpannya
// di baris pesan akan menimpa riwayat dan menghilangkan justru bagian yang
// paling dibutuhkan — urutan percobaan dan alasan tiap penolakan.
//
// Yang dicatat SENGAJA bukan isi pesan: hanya hash penerima + metrik. Tujuannya
// menjawab "kenapa pesan ini lolos/ditahan" tanpa menggandakan PII ke tabel
// baru yang masa simpannya lebih panjang dari pesan aslinya.
db.exec(`
CREATE TABLE IF NOT EXISTS antiban_decisions (
  id             TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  guard          TEXT NOT NULL,
  decision       TEXT NOT NULL,
  reason         TEXT,
  message_id     TEXT,
  batch_id       TEXT,
  recipient_hash TEXT,
  metrics        TEXT,
  threshold      TEXT,
  preset         TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_antiban_dec_session_time ON antiban_decisions (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_antiban_dec_guard_time   ON antiban_decisions (guard, decision, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_antiban_dec_message      ON antiban_decisions (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_antiban_dec_batch        ON antiban_decisions (batch_id) WHERE batch_id IS NOT NULL;
`);

// Pesan MASUK dari WhatsApp.
//
// Sebelum tabel ini ada, `messages.upsert` hanya dipakai untuk mencatat metrik
// anti-ban (`onIncomingCallback`), lalu isi pesannya dibuang. Akibatnya gateway
// bisa mengirim tapi tidak bisa menerima: tidak ada inbox, tidak ada bahan untuk
// chatbot, dan tidak ada yang bisa dipancarkan sebagai event webhook.
//
// `user_id` diambil dari `sessions.user_id` saat pesan disimpan, BUKAN dari
// pesan itu sendiri. Pengirim tidak boleh menentukan tenant mana yang memiliki
// pesannya.
//
// `wa_message_id` unik per sesi: Baileys bisa mengirim ulang pesan yang sama
// setelah reconnect, dan tanpa penjagaan ini inbox akan berisi duplikat.
db.exec(`
CREATE TABLE IF NOT EXISTS inbound_messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  wa_message_id TEXT,
  from_jid      TEXT NOT NULL,
  from_phone    TEXT,
  push_name     TEXT,
  chat_type     TEXT NOT NULL DEFAULT 'private',
  type          TEXT NOT NULL,
  text          TEXT,
  media_mime    TEXT,
  media_caption TEXT,
  raw           TEXT,
  received_at   TEXT NOT NULL,
  bot_handled   INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_wa_id
  ON inbound_messages (session_id, wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbound_user_time
  ON inbound_messages (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_session_phone
  ON inbound_messages (session_id, from_phone, received_at DESC);
`);

// Antrean pengiriman webhook.
//
// Tabel `webhooks` hanya menyimpan KONFIGURASI; sebelum tabel ini ada, tidak ada
// satu pun baris kode yang mengirim HTTP ke URL terdaftar. Dokumentasi panel
// sudah menjanjikan event `message.received` padahal event itu tidak pernah
// terjadi.
//
// Pengiriman lewat tabel, bukan langsung dari jalur permintaan: penerima yang
// mati atau lambat tidak boleh menahan pemrosesan pesan WhatsApp. Worker membaca
// baris `pending` dan mencoba ulang dengan backoff.
//
// `next_attempt_at` epoch milidetik supaya perbandingan waktu tidak bergantung
// pada zona waktu SQLite.
db.exec(`
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               TEXT PRIMARY KEY,
  webhook_id       TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  event            TEXT NOT NULL,
  payload          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  INTEGER NOT NULL,
  last_status_code INTEGER,
  last_error       TEXT,
  delivery_id      TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_wh_del_pending
  ON webhook_deliveries (status, next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wh_del_webhook_time
  ON webhook_deliveries (webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wh_del_user_time
  ON webhook_deliveries (user_id, created_at DESC);
`);

// Kunci idempotensi per pengiriman.
//
// `delivery_id` sudah stabil antar percobaan ulang, tetapi ia dibuat acak per
// pemancaran: dua pemancaran untuk kejadian yang SAMA (pesan yang sama dikirim
// ulang Baileys setelah reconnect, atau status yang berubah bolak-balik) akan
// menghasilkan dua nilai berbeda. Penerima yang melakukan dedupe berdasarkan
// nilai itu tidak bisa mengenali keduanya sebagai satu kejadian.
//
// Kuncinya dihitung sekali saat masuk antrean lalu DISIMPAN, bukan dihitung
// ulang saat kirim: percobaan ulang harus memakai kunci yang sama persis dengan
// percobaan pertama, dan payload yang disimpan tidak berubah.
ensureColumn('webhook_deliveries', 'idempotency_key', 'TEXT');

// Kolom tambahan pada `webhooks` untuk status kesehatan tiap endpoint.
//
// `last_success_at` dan `failure_count` dipakai panel untuk menandai endpoint
// yang sudah lama tidak pernah menerima kiriman — kondisi yang sebelumnya tidak
// terlihat sama sekali, karena tidak ada riwayat pengiriman yang disimpan.
// `created_at` sengaja tanpa DEFAULT ekspresi: SQLite menolak
// `ALTER TABLE ... ADD COLUMN` dengan default non-konstan, dan tabel `webhooks`
// sudah ada di instalasi lama. Nilainya diisi di bawah untuk baris lama.
ensureColumn('webhooks', 'created_at', 'TEXT');
ensureColumn('webhooks', 'last_success_at', 'TEXT');
ensureColumn('webhooks', 'failure_count', 'INTEGER NOT NULL DEFAULT 0');
// Cakupan webhook: sesi mana dan jenis chat apa.
//
// Sebelumnya satu webhook menerima SEMUA pesan dari SEMUA sesi milik akun.
// Untuk operasi dengan beberapa nomor itu berarti dashboard untuk nomor A ikut
// menerima pesan nomor B, tanpa cara memisahkannya selain memakai akun lain.
// `session_id` NULL = semua sesi (perilaku lama, tetap sah).
//
// `chat_types` berisi daftar JSON dari `private`/`group`/`broadcast`. Tanpa
// kolom ini pesan grup ikut terkirim ke penerima yang tidak menanganinya.
ensureColumn('webhooks', 'session_id', 'TEXT');
ensureColumn('webhooks', 'chat_types', 'TEXT');
// Filter isi pesan: hanya pesan yang cocok yang diteruskan.
//
// `session_id` dan `chat_types` menjawab "dari nomor mana", bukan "pesan apa".
// Tanpa kolom ini, webhook ke dashboard tiket tetap menerima setiap sapaan,
// setiap balasan "terima kasih", dan setiap pesan grup — penerima harus
// menyaring sendiri, dan penyaringan di sana berjalan setelah kuota jaringan
// terpakai.
//
// `match_type` NULL berarti tanpa filter (perilaku lama, tetap sah). Nilainya
// memakai arti yang sama persis dengan aturan chatbot (`exact`, `contains`,
// `keyword`, `regex`) supaya aturan yang sudah terbukti di chatbot bisa
// disalin apa adanya ke sini.
ensureColumn('webhooks', 'match_type', 'TEXT');
ensureColumn('webhooks', 'match_value', 'TEXT');
try {
  db.exec("UPDATE webhooks SET created_at = datetime('now') WHERE created_at IS NULL");
  db.exec("UPDATE webhooks SET chat_types = '[\"private\"]' WHERE chat_types IS NULL");
} catch {}

// Chatbot rule-based.
//
// `chatbot_flows` menyimpan ATURAN, `chatbot_sessions` menyimpan POSISI
// percakapan. Dipisah karena satu aturan dipakai banyak kontak sekaligus,
// sementara posisi tiap kontak berbeda dan harus bertahan melewati restart.
//
// `session_id` pada flow boleh NULL, artinya berlaku untuk semua sesi milik
// user. Ini yang paling sering dipakai: operator biasanya ingin satu menu
// berlaku di semua nomor, bukan menduplikasinya per sesi.
db.exec(`
CREATE TABLE IF NOT EXISTS chatbot_flows (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  session_id       TEXT,
  name             TEXT NOT NULL,
  enabled          INTEGER NOT NULL DEFAULT 1,
  priority         INTEGER NOT NULL DEFAULT 100,
  match_type       TEXT NOT NULL DEFAULT 'contains',
  match_value      TEXT NOT NULL,
  reply_text       TEXT,
  reply_media_url  TEXT,
  steps            TEXT,
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chatbot_flows_user
  ON chatbot_flows (user_id, enabled, priority);

CREATE TABLE IF NOT EXISTS chatbot_sessions (
  session_id       TEXT NOT NULL,
  contact_phone    TEXT NOT NULL,
  current_flow_id  TEXT,
  current_step     TEXT,
  context          TEXT,
  bot_paused_until INTEGER,
  last_activity_at TEXT NOT NULL,
  PRIMARY KEY (session_id, contact_phone)
);
CREATE INDEX IF NOT EXISTS idx_chatbot_sessions_flow
  ON chatbot_sessions (current_flow_id) WHERE current_flow_id IS NOT NULL;

-- Kontak yang meminta berhenti. Tabel terpisah, bukan kolom di
-- chatbot_sessions, karena opt-out harus tetap berlaku walau state
-- percakapannya dibersihkan — dan karena blast perlu bisa memeriksanya
-- tanpa menyentuh state chatbot.
CREATE TABLE IF NOT EXISTS chatbot_optouts (
  session_id    TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  reason        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, contact_phone)
);
`);

try {
  db.exec(`UPDATE users SET quota_limit = quota_per_week WHERE quota_limit IS NULL OR quota_limit = 100`);
  db.exec(`UPDATE users SET used_in_period = used_this_week WHERE used_in_period IS NULL`);
  db.exec(`UPDATE users SET quota_period = 'weekly' WHERE quota_period IS NULL`);
} catch {}

// Set default quota_reset_at untuk existing users jika belum ada
try {
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
  db.prepare("UPDATE users SET quota_reset_at = ? WHERE quota_reset_at IS NULL").run(nextWeek);
} catch {}

// Seed default settings jika belum ada
function seedDefaultSettings(): void {
  const defaults: Record<string, string> = {
    google_auth_enabled: 'false',
    google_client_id: '',
    google_client_secret: '',
    registration_enabled: 'true',
    autorotate_enabled: 'false',
    autorotate_strategy: 'least_loaded',
    autorotate_rotate_on_limit: 'true',
    autorotate_rotate_on_disconnect: 'true',
    autorotate_rotate_on_463: 'true',
    autorotate_sticky_session: 'true',
    autorotate_pool_sessions: '[]',
  };
  const stmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    stmt.run(k, v);
  }
}
seedDefaultSettings();
