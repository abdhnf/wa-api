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

// Sinkronisasi data kuota existing
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
