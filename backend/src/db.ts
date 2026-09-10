import { hashPassword, generateApiKey } from './security.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import type { SessionInfo, UserRecord, OutboundMessage, WebhookRecord } from './types.js';

// Node 22+ node:sqlite (stdlib, nol dependency). Warning experimental bisa di-silence
// dengan --no-warnings di production.

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

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

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
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
`);


// Production Indexes: Optimalkan query pencarian pesan, status antrean, dan receipt WA
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

// ---------- Users ----------
export function createUser(u: Omit<UserRecord, 'id' | 'usedToday' | 'usedThisWeek' | 'quotaPerWeek'> & { quotaPerWeek?: number; quotaLimit?: number; quotaPeriod?: 'daily' | 'weekly' | 'monthly' }): UserRecord {
  const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
  const quotaDay = u.quotaPerDay ?? 100;
  const quotaWeek = u.quotaPerWeek ?? (quotaDay * 7);
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, api_key, quota_per_day, quota_per_week, used_this_week, quota_reset_at, status, assigned_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(id, u.name, u.email, u.passwordHash, u.role, u.apiKey, quotaDay, quotaWeek, nextWeek, u.status, u.assignedSessionId ?? null);
  return getUserById(id)!;
}

export function getUserByEmail(email: string): UserRecord | null {
  const normalized = (email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalized) as any;
  return row ? mapUser(row) : null;
}

export function getUserById(id: string): UserRecord | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
  return row ? mapUser(row) : null;
}

export function getUserByApiKey(apiKey: string): UserRecord | null {
  const row = db.prepare('SELECT * FROM users WHERE api_key = ?').get(apiKey) as any;
  return row ? mapUser(row) : null;
}

export function listUsers(): UserRecord[] {
  const rows = db.prepare('SELECT * FROM users ORDER BY name').all() as any[];
  return rows.map(mapUser);
}

export function updateUser(
  id: string,
  patch: {
    name?: string;
    role?: string;
    quotaPerDay?: number;
    quotaPerWeek?: number;
    quotaLimit?: number;
    quotaPeriod?: 'daily' | 'weekly' | 'monthly';
    status?: string;
    assignedSessionId?: string | null;
  }
): UserRecord | null {
  const cur = getUserById(id);
  if (!cur) return null;

  const targetPeriod = patch.quotaPeriod ?? cur.quotaPeriod ?? 'weekly';
  let targetLimit = patch.quotaLimit ?? patch.quotaPerWeek ?? cur.quotaLimit;
  let targetDaily = patch.quotaPerDay ?? cur.quotaPerDay ?? 100;
  if (!targetLimit) {
    targetLimit = targetDaily * (targetPeriod === 'daily' ? 1 : targetPeriod === 'monthly' ? 30 : 7);
  }

  // Jika periode berubah, reset tanggal reset
  let resetAt = cur.quotaResetAt;
  let usedInPeriod = cur.usedInPeriod ?? 0;
  if (patch.quotaPeriod && patch.quotaPeriod !== cur.quotaPeriod) {
    usedInPeriod = 0;
    const dur = patch.quotaPeriod === 'daily' ? 86400000 : patch.quotaPeriod === 'monthly' ? 30 * 86400000 : 7 * 86400000;
    resetAt = new Date(Date.now() + dur).toISOString();
  }

  db.prepare(
    `UPDATE users SET
       name = ?, role = ?, quota_per_day = ?, quota_per_week = ?, quota_limit = ?, quota_period = ?,
       used_in_period = ?, quota_reset_at = ?, status = ?, assigned_session_id = ?
     WHERE id = ?`
  ).run(
    patch.name ?? cur.name,
    patch.role ?? cur.role,
    patch.quotaPerDay ?? cur.quotaPerDay,
    targetLimit,
    targetLimit,
    targetPeriod,
    usedInPeriod,
    resetAt ?? null,
    patch.status ?? cur.status,
    (patch.assignedSessionId === undefined ? cur.assignedSessionId : patch.assignedSessionId) ?? null,
    id
  );
  return getUserById(id);
}

export function deleteUser(id: string): boolean {
  const res = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return (res as any).changes > 0;
}

export function setUserPassword(id: string, passwordHash: string): boolean {
  const res = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  return (res as any).changes > 0;
}

export function setUserApiKey(id: string, apiKey: string): boolean {
  const res = db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(apiKey, id);
  return (res as any).changes > 0;
}

function mapUser(row: any): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    apiKey: row.api_key,
    quotaPerDay: row.quota_per_day ?? 100,
    usedToday: row.used_today ?? 0,
    quotaPerWeek: row.quota_per_week ?? 100,
    usedThisWeek: row.used_this_week ?? 0,
    quotaLimit: row.quota_limit ?? row.quota_per_week ?? 100,
    usedInPeriod: row.used_in_period ?? row.used_this_week ?? 0,
    quotaPeriod: row.quota_period || 'weekly',
    quotaResetAt: row.quota_reset_at || undefined,
    status: row.status,
    assignedSessionId: row.assigned_session_id,
    googleId: row.google_id || undefined,
    authProvider: row.auth_provider || 'local',
    avatarUrl: row.avatar_url || undefined,
  };
}


/** Validasi & increment kuota dinamis (harian / mingguan / bulanan; default 100/minggu untuk user biasa; admin unlimited) */
export function checkAndIncrementWeeklyQuota(userId: string): { allowed: boolean; used: number; limit: number; resetAt?: string; reason?: string } {
  const user = getUserById(userId);
  if (!user) return { allowed: false, used: 0, limit: 0, reason: 'User tidak ditemukan' };

  const quotaLimit: number = user.quotaLimit ?? user.quotaPerWeek ?? 100;
  let currentUsed: number = user.usedInPeriod ?? user.usedThisWeek ?? 0;

  if (user.role === 'admin') return { allowed: true, used: currentUsed, limit: quotaLimit };

  const now = new Date();
  let resetAt = user.quotaResetAt ? new Date(user.quotaResetAt) : null;
  const period = user.quotaPeriod || 'weekly';

  const getResetDuration = (p: string): number => {
    if (p === 'daily') return 1 * 86400000;
    if (p === 'monthly') return 30 * 86400000;
    return 7 * 86400000;
  };

  const periodLabel = period === 'daily' ? 'harian' : period === 'monthly' ? 'bulanan' : 'mingguan';
  const periodUnit = period === 'daily' ? 'hari' : period === 'monthly' ? 'bulan' : 'minggu';

  // Cek apakah sudah melewati siklus reset
  if (!resetAt || now > resetAt) {
    const nextReset = new Date(now.getTime() + getResetDuration(period));
    db.prepare('UPDATE users SET used_in_period = 0, used_this_week = 0, quota_reset_at = ? WHERE id = ?').run(nextReset.toISOString(), userId);
    currentUsed = 0;
    resetAt = nextReset;
  }

  // Cek apakah mencapai batas kuota
  if (currentUsed >= quotaLimit) {
    return {
      allowed: false,
      used: currentUsed,
      limit: quotaLimit,
      resetAt: resetAt.toISOString(),
      reason: `Batas kuota ${periodLabel} (${quotaLimit} pesan/${periodUnit}) tercapai. Reset pada ${resetAt.toLocaleDateString('id-ID')}.`,
    };
  }

  // Increment penggunaan
  db.prepare('UPDATE users SET used_in_period = used_in_period + 1, used_this_week = used_this_week + 1, used_today = used_today + 1 WHERE id = ?').run(userId);
  return { allowed: true, used: currentUsed + 1, limit: quotaLimit, resetAt: resetAt.toISOString() };
}

export function incrementUsage(userId: string): void {
  db.prepare('UPDATE users SET used_today = used_today + 1 WHERE id = ?').run(userId);
}

// ---------- Sessions ----------
export function upsertSession(s: SessionInfo, defaultUserId = 'usr_c26f74d6'): void {
  const uid = s.userId || defaultUserId;
  db.prepare(
    `INSERT INTO sessions (id, name, phone, status, risk_score, warmup_day, messages_sent_today, delivery_rate, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, phone=excluded.phone, status=excluded.status,
       risk_score=excluded.risk_score, warmup_day=excluded.warmup_day,
       messages_sent_today=excluded.messages_sent_today, delivery_rate=excluded.delivery_rate, user_id=COALESCE(sessions.user_id, excluded.user_id)`
  ).run(s.id, s.name, s.phone, s.status, s.riskScore, s.warmupDay, s.messagesSentToday, s.deliveryRate, uid);
}

export function listSessions(filterUserId?: string): SessionInfo[] {
  const rows = (filterUserId
    ? db.prepare('SELECT s.*, u.name as owner_name, u.email as owner_email FROM sessions s LEFT JOIN users u ON s.user_id = u.id WHERE s.user_id = ? ORDER BY s.created_at').all(filterUserId)
    : db.prepare('SELECT s.*, u.name as owner_name, u.email as owner_email FROM sessions s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.created_at').all()
  ) as any[];
  return rows.map((r) => {
    // 1. Hourly stats hari ini
    const stats = db.prepare(
      `SELECT CAST(strftime('%H', datetime(created_at, 'localtime')) AS INTEGER) as h,
              COUNT(*) as total,
              SUM(CASE WHEN status IN ('failed', 'invalid_number', 'not_registered') THEN 1 ELSE 0 END) as failed
       FROM messages WHERE session_id = ? AND date(datetime(created_at, 'localtime')) = date('now', 'localtime')
       GROUP BY h ORDER BY h`
    ).all(r.id) as any[];
    const hourlyStats = stats.map((s: any) => ({
      hour: `${String(s.h).padStart(2, '0')}:00`,
      sent: Number(s.total),
      failed: Number(s.failed) || 0,
    }));
    const slots = Array.from({ length: 24 }, (_, i) => ({
      hour: `${String(i).padStart(2, '0')}:00`,
      sent: 0,
      failed: 0,
    }));
    const byHour = new Map(hourlyStats.map((s: any) => [s.hour, s]));
    const merged = slots.map((slot) => byHour.get(slot.hour) || slot);

    // 2. Agregasi metrik riil dari tabel messages
    const summary = db.prepare(
      `SELECT 
         COUNT(*) as total_sent,
         SUM(CASE WHEN status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END) as total_delivered,
         SUM(CASE WHEN status IN ('failed', 'invalid_number', 'not_registered') THEN 1 ELSE 0 END) as total_failed,
         ROUND(AVG(jitter_delay_ms) / 1000.0, 1) as avg_delay_sec,
         SUM(CASE WHEN date(datetime(created_at, 'localtime')) = date('now', 'localtime') THEN 1 ELSE 0 END) as today_sent
       FROM messages WHERE session_id = ?`
    ).get(r.id) as any;

    const totalSent = Number(summary?.total_sent) || 0;
    const totalDelivered = Number(summary?.total_delivered) || 0;
    const totalFailed = Number(summary?.total_failed) || 0;
    const avgPacingDelaySec = Number(summary?.avg_delay_sec) || 0;
    const messagesSentToday = Number(summary?.today_sent) || 0;
    const deliveryRate = totalSent > 0 ? Math.round((totalDelivered / totalSent) * 100) : 100;

    return {
      id: r.id,
      name: r.name,
      userId: r.user_id || undefined,
      owner: r.owner_name ? { id: r.user_id, name: r.owner_name, email: r.owner_email } : undefined,
      phone: r.phone,
      status: r.status,
      riskScore: r.risk_score || 0,
      warmupDay: r.warmup_day || 1,
      messagesSentToday,
      deliveryRate,
      metrics: {
        totalSent,
        totalDelivered,
        totalFailed,
        avgPacingDelaySec,
        uptimeHours: 0,
        disconnectCountToday: 0,
        hourlyStats: merged,
      },
    };
  });
}

// ---------- Messages ----------
export function insertMessage(m: OutboundMessage, defaultUserId = 'usr_c26f74d6'): void {
  const uid = m.userId || defaultUserId;
  const priority = m.priority || 'normal';
  db.prepare(
    `INSERT INTO messages (id, session_id, user_id, mode, recipient, payload, status, jitter_delay_ms, batch_id, created_at, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(m.id, m.sessionId, uid, m.mode, m.to, JSON.stringify(m), m.status, m.jitterDelayMs, m.batchId ?? null, m.timestamp, priority);
}

export function updateMessageStatus(id: string, status: OutboundMessage['status'], errorDetail?: string): void {
  const row = db.prepare('SELECT payload FROM messages WHERE id = ?').get(id) as any;
  if (row) {
    try {
      const obj = JSON.parse(row.payload);
      obj.status = status;
      if (errorDetail !== undefined) {
        obj.errorDetail = errorDetail;
      }
      db.prepare('UPDATE messages SET status = ?, payload = ? WHERE id = ?').run(status, JSON.stringify(obj), id);
      return;
    } catch {}
  }
  db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id);
}


export function resetStuckMessages(): number {
  const res = db.prepare("UPDATE messages SET status = 'pending' WHERE status IN ('pacing', 'sending')").run() as any;
  return (res && res.changes) ? res.changes : 0;
}

export function getPendingMessages(sessionId?: string): OutboundMessage[] {
  let query = "SELECT payload FROM messages WHERE status = 'pending'";
  const params: any[] = [];
  if (sessionId) {
    query += " AND session_id = ?";
    params.push(sessionId);
  }
  query += " ORDER BY CASE WHEN priority = 'high' THEN 0 ELSE 1 END, created_at ASC";
  const rows = db.prepare(query).all(...params) as any[];
  const list: OutboundMessage[] = [];
  for (const r of rows) {
    try {
      list.push(JSON.parse(r.payload));
    } catch {}
  }
  return list;
}


/** Production Database Maintenance (Jalankan berkala / idle) */
export function optimizeDatabase(): void {
  try {
    db.exec(`
      PRAGMA wal_checkpoint(PASSIVE);
      PRAGMA optimize;
    `);
  } catch (e) {
    console.warn('[db] optimizeDatabase warning:', e);
  }
}

export function updateMessageWaId(id: string, waMessageId: string): void {
  db.prepare('UPDATE messages SET wa_message_id = ? WHERE id = ?').run(waMessageId, id);
}

export function getMessageById(id: string): OutboundMessage | null {
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as any;
  return row ? JSON.parse(row.payload) : null;
}

export function getMessageByWaId(waMessageId: string): OutboundMessage | null {
  const row = db.prepare('SELECT * FROM messages WHERE wa_message_id = ?').get(waMessageId) as any;
  return row ? JSON.parse(row.payload) : null;
}

export function listMessages(sessionId?: string, filterUserId?: string, limit = 50): OutboundMessage[] {
  let rows: any[];
  if (sessionId && filterUserId) {
    rows = db.prepare('SELECT * FROM messages WHERE session_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, filterUserId, limit);
  } else if (sessionId) {
    rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?').all(sessionId, limit);
  } else if (filterUserId) {
    rows = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(filterUserId, limit);
  } else {
    rows = db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?').all(limit);
  }
  return rows.map((r) => {
    try {
      const p = JSON.parse(r.payload);
      p.id = r.id || p.id;
      p.sessionId = r.session_id || p.sessionId;
      p.userId = r.user_id || p.userId || undefined;
      p.to = r.recipient || p.to;
      p.mode = r.mode || p.mode;
      p.status = r.status || p.status;
      p.timestamp = r.created_at || p.timestamp;
      return p;
    } catch {
      return {
        id: r.id,
        sessionId: r.session_id,
        userId: r.user_id,
        mode: r.mode,
        to: r.recipient,
        text: r.payload,
        status: r.status,
        timestamp: r.created_at,
      };
    }
  });
}

/** Ambil log aktivitas, sesi, dan pesan lengkap untuk admin melihat riwayat user */
export function getUserLogs(userId: string): { user: UserRecord | null; sessions: SessionInfo[]; messages: OutboundMessage[] } {
  const user = getUserById(userId);
  const sessions = listSessions(userId);
  const messages = listMessages(undefined, userId, 100);
  return { user, sessions, messages };
}

// ---------- Webhooks ----------
export function upsertWebhook(w: WebhookRecord): void {
  db.prepare(
    `INSERT INTO webhooks (id, user_id, url, events, secret, status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET url=excluded.url, events=excluded.events, status=excluded.status`
  ).run(w.id, w.userId, w.url, JSON.stringify(w.events), w.secret, w.status);
}

export function listWebhooks(userId: string): WebhookRecord[] {
  const rows = db.prepare('SELECT * FROM webhooks WHERE user_id = ?').all(userId) as any[];
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    url: r.url,
    events: JSON.parse(r.events),
    secret: r.secret,
    status: r.status,
  }));
}
export function getAntiBanState(sessionId: string): string | null {
  const row = db.prepare('SELECT antiban_state FROM sessions WHERE id = ?').get(sessionId) as any;
  return row?.antiban_state ?? null;
}

export function saveAntiBanState(sessionId: string, state: string): void {
  db.prepare('UPDATE sessions SET antiban_state = ? WHERE id = ?').run(state, sessionId);
}

export function deleteSession(id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

// ---------- Settings ----------
export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row ? row.value : null;
}

export function getAllSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

export function setSettings(settings: Record<string, string>): void {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const [k, v] of Object.entries(settings)) {
    stmt.run(k, v);
  }
}

export function getUserSetting(userId: string, key: string): string | null {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(userId, key) as any;
  if (row) return row.value;
  return getSetting(key);
}

export function getAllUserSettings(userId: string): Record<string, string> {
  const global = getAllSettings();
  const rows = db.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId) as any[];
  const userMap: Record<string, string> = { ...global };
  for (const r of rows) {
    userMap[r.key] = r.value;
  }
  return userMap;
}

export function setUserSetting(userId: string, key: string, value: string): void {
  db.prepare(`
    INSERT INTO user_settings (user_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value
  `).run(userId, key, value);
}

export function setUserSettings(userId: string, settings: Record<string, string>): void {
  const stmt = db.prepare(`
    INSERT INTO user_settings (user_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value
  `);
  for (const [k, v] of Object.entries(settings)) {
    stmt.run(userId, k, v);
  }
}

// Upsert user dari Google OAuth
export function upsertGoogleUser(data: { googleId: string; email: string; name: string; avatarUrl?: string }): UserRecord {
  // Cek by googleId atau by email
  let existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(data.googleId) as any;
  if (!existing) {
    existing = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email) as any;
  }

  if (existing) {
    // Hubungkan google_id jika sebelumnya daftar lokal
    db.prepare('UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url), auth_provider = ? WHERE id = ?')
      .run(data.googleId, data.avatarUrl ?? null, 'google', existing.id);
    return getUserById(existing.id)!;
  }

  // Buat user baru via Google
  const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const apiKey = `wa_live_${crypto.randomUUID().replace(/-/g, '')}`;
  const randomPass = `gauth_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;

  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, api_key, quota_per_day, quota_per_week, used_this_week, quota_reset_at, status, google_id, auth_provider, avatar_url)
     VALUES (?, ?, ?, ?, 'user', ?, 100, 700, 0, ?, 'active', ?, 'google', ?)`
  ).run(id, data.name, data.email, randomPass, apiKey, nextWeek, data.googleId, data.avatarUrl ?? null);

  return getUserById(id)!;
}

export function getLastSessionForRecipient(recipient: string): string | null {
  try {
    const row = db.prepare(
      "SELECT session_id FROM messages WHERE recipient = ? AND status IN ('sent', 'delivered', 'read') ORDER BY created_at DESC LIMIT 1"
    ).get(recipient) as any;
    return row ? row.session_id : null;
  } catch {
    return null;
  }
}

// ============ API Request Logs ============
export interface ApiLogRecord {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  method: string;
  endpoint: string;
  statusCode: number;
  ip: string;
  durationMs: number;
  errorMessage?: string | null;
  createdAt: string;
}

export function insertApiLog(log: {
  id: string;
  userId: string;
  method: string;
  endpoint: string;
  statusCode: number;
  ip: string;
  durationMs: number;
  errorMessage?: string | null;
}): void {
  try {
    db.prepare(`
      INSERT INTO api_logs (id, user_id, method, endpoint, status_code, ip, duration_ms, error_message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      log.id,
      log.userId,
      log.method,
      log.endpoint,
      log.statusCode,
      log.ip,
      log.durationMs,
      log.errorMessage ?? null
    );
  } catch (err) {
    console.error('[db:api_logs] Gagal mencatat log API:', err);
  }
}

export function listApiLogs(params: {
  userId?: string;
  limit?: number;
  offset?: number;
  statusFilter?: 'all' | 'success' | 'error';
}): { logs: ApiLogRecord[]; total: number } {
  const limit = Math.max(1, Math.min(params.limit ?? 25, 100));
  const offset = Math.max(0, params.offset ?? 0);

  const conditions: string[] = [];
  const args: any[] = [];

  if (params.userId) {
    conditions.push('l.user_id = ?');
    args.push(params.userId);
  }

  if (params.statusFilter === 'success') {
    conditions.push('l.status_code >= 200 AND l.status_code < 400');
  } else if (params.statusFilter === 'error') {
    conditions.push('l.status_code >= 400');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Hitung total baris
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM api_logs l ${whereClause}`).get(...args) as any;
  const total = countRow?.total ?? 0;

  // Ambil list log dengan join nama user
  const query = `
    SELECT 
      l.id, l.user_id, l.method, l.endpoint, l.status_code, l.ip, l.duration_ms, l.error_message, l.created_at,
      u.name as user_name, u.email as user_email
    FROM api_logs l
    LEFT JOIN users u ON u.id = l.user_id
    ${whereClause}
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...args, limit, offset) as any[];

  const logs: ApiLogRecord[] = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    userName: r.user_name || 'System / Anonymous',
    userEmail: r.user_email || '',
    method: r.method,
    endpoint: r.endpoint,
    statusCode: r.status_code,
    ip: r.ip,
    durationMs: r.duration_ms,
    errorMessage: r.error_message,
    createdAt: r.created_at,
  }));

  return { logs, total };
}

export function deleteApiLogs(ids: string[], userId?: string): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  let query = `DELETE FROM api_logs WHERE id IN (${placeholders})`;
  const args: any[] = [...ids];

  if (userId) {
    query += ' AND user_id = ?';
    args.push(userId);
  }

  const res = db.prepare(query).run(...args);
  return (res as any).changes || 0;
}

export function clearApiLogs(userId?: string, olderThanDays?: number): number {
  let query = 'DELETE FROM api_logs';
  const conditions: string[] = [];
  const args: any[] = [];

  if (userId) {
    conditions.push('user_id = ?');
    args.push(userId);
  }

  if (olderThanDays && olderThanDays > 0) {
    conditions.push(`created_at < datetime('now', '-${Math.floor(olderThanDays)} days')`);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }

  const res = db.prepare(query).run(...args);
  return (res as any).changes || 0;
}


// Otomatis seed Super Admin pertama jika database baru/kosong (Fresh Install)
export function seedDefaultAdmin(): void {
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    if (row && row.count === 0) {
      const email = process.env.ADMIN_EMAIL || 'admin@example.com';
      const rawPassword = process.env.ADMIN_PASSWORD || 'admin123';
      const name = process.env.ADMIN_NAME || 'Super Admin';

      const admin = createUser({
        name,
        email,
        passwordHash: hashPassword(rawPassword),
        role: 'admin',
        apiKey: generateApiKey('wa_live'),
        quotaPerDay: 100000,
        quotaPerWeek: 700000,
        status: 'active',
      });

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(' [BOOTSTRAP] Fresh installation detected!');
      console.log(' Default Super Admin account successfully created:');
      console.log(`   Email   : ${admin.email}`);
      console.log(`   Password: ${rawPassword}`);
      console.log(`   API Key : ${admin.apiKey}`);
      console.log('   PENTING : Segera ganti password ini di panel admin!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }
  } catch (err: any) {
    console.error('[BOOTSTRAP ERROR] Failed to auto-seed default admin:', err.message);
  }
}

seedDefaultAdmin();
