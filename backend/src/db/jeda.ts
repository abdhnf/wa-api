import type { UserRecord } from '../types.js';
import { db } from './client.js';
import { getAllSettings, getSetting, setSetting } from './kesehatan.js';
import { getUserById } from './users.js';

// ============ Persistensi status jeda antrean ============
// Status jeda disimpan di tabel `settings` supaya bertahan melewati restart
// service. Sebelumnya hanya in-memory, sehingga restart menghapus semua jeda
// dan antrean langsung berjalan kembali tanpa sepengetahuan operator.

const QUEUE_PAUSE_SESSIONS_KEY = 'queue_paused_sessions';
const QUEUE_PAUSE_BATCHES_KEY = 'queue_paused_batches';

export interface PersistedPauseEntry {
  isPaused: boolean;
  reason?: string;
  /**
   * Epoch ms saat jeda boleh dibuka otomatis.
   * Kosong = jeda ini menunggu aksi manual (mis. guard handshake contactGraph
   * yang tidak punya tenggat). Tanpa field ini, jeda berjangka yang terpotong
   * restart akan berubah menjadi jeda permanen tanpa cara pulih.
   */
  needsResumeAt?: number;
}

export interface PersistedPauseState {
  sessions: Record<string, PersistedPauseEntry>;
  batches: Record<string, PersistedPauseEntry>;
}

export function loadQueuePauseState(): PersistedPauseState {
  const parse = (key: string): Record<string, PersistedPauseEntry> => {
    try {
      const raw = getSetting(key);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  };
  return { sessions: parse(QUEUE_PAUSE_SESSIONS_KEY), batches: parse(QUEUE_PAUSE_BATCHES_KEY) };
}

export function saveQueuePauseState(state: PersistedPauseState): void {
  try {
    // Hanya simpan entri yang benar-benar sedang dijeda; entri non-jeda dibuang
    // agar tabel tidak menumpuk data basi.
    const prune = (m: Record<string, PersistedPauseEntry>) =>
      Object.fromEntries(Object.entries(m).filter(([, v]) => v?.isPaused));
    setSetting(QUEUE_PAUSE_SESSIONS_KEY, JSON.stringify(prune(state.sessions)));
    setSetting(QUEUE_PAUSE_BATCHES_KEY, JSON.stringify(prune(state.batches)));
  } catch (e) {
    console.warn('[queue-pause] Gagal menyimpan status jeda antrean:', e);
  }
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
export function upsertGoogleUser(data: { googleId: string; email: string; name: string; avatarUrl?: string }): { user: UserRecord; baru: boolean } {
  // Cek by googleId atau by email
  let existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(data.googleId) as any;
  if (!existing) {
    existing = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email) as any;
  }

  if (existing) {
    // Hubungkan google_id jika sebelumnya daftar lokal
    db.prepare('UPDATE users SET google_id = ?, avatar_url = COALESCE(?, avatar_url), auth_provider = ? WHERE id = ?')
      .run(data.googleId, data.avatarUrl ?? null, 'google', existing.id);
    return { user: getUserById(existing.id)!, baru: false };
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

  return { user: getUserById(id)!, baru: true };
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
