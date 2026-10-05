import type { UserRecord } from '../types.js';
import { db } from './client.js';

// ---------- Users ----------
export function createUser(u: Omit<UserRecord, 'id' | 'usedToday' | 'usedThisWeek' | 'quotaPerWeek'> & { quotaPerWeek?: number; quotaLimit?: number; quotaPeriod?: 'daily' | 'weekly' | 'monthly' }): UserRecord {
  const id = `usr_${crypto.randomUUID().slice(0, 8)}`;
  const quotaDay = u.quotaPerDay ?? 100;
  const quotaWeek = u.quotaPerWeek ?? (quotaDay * 7);

  // Kuota periode ikut disimpan saat pembuatan. Sebelumnya kolom quota_limit /
  // quota_period / quota_reset_at dibiarkan default ('weekly', 100, +7 hari),
  // sehingga pilihan periode dari form tambah user hilang dan langsung tereset
  // ke mingguan pada siklus pertama.
  const period = u.quotaPeriod ?? 'weekly';
  const durasi = period === 'daily' ? 86400000 : period === 'monthly' ? 30 * 86400000 : 7 * 86400000;
  const limit = u.quotaLimit ?? (period === 'daily' ? quotaDay : period === 'monthly' ? quotaDay * 30 : quotaWeek);
  const resetAt = new Date(Date.now() + durasi).toISOString();

  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, api_key, quota_per_day, quota_per_week, quota_limit, quota_period, used_this_week, used_in_period, quota_reset_at, status, assigned_session_id, phone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
  ).run(id, u.name, u.email, u.passwordHash, u.role, u.apiKey, quotaDay, quotaWeek, limit, period, resetAt, u.status, u.assignedSessionId ?? null, u.phone ?? null);
  return getUserById(id)!;
}

export function getUserByEmail(email: string): UserRecord | null {
  const normalized = (email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(normalized) as any;
  return row ? mapUser(row) : null;
}

/** Cari user dari nomor telepon kanonik (628xxx). */
export function getUserByPhone(phone: string): UserRecord | null {
  const row = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as any;
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
    phone?: string | null;
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
       used_in_period = ?, quota_reset_at = ?, status = ?, assigned_session_id = ?, phone = ?
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
    // undefined = jangan sentuh; null/kosong = hapus nomor.
    patch.phone === undefined ? (cur.phone ?? null) : (patch.phone || null),
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

export function setUserBlastPin(id: string, pinHash: string): boolean {
  const res = db.prepare('UPDATE users SET blast_pin_hash = ? WHERE id = ?').run(pinHash, id);
  return (res as any).changes > 0;
}

/**
 * Hapus PIN Blast Dashboard milik user (admin-only via endpoint).
 * Mengosongkan blast_pin_hash -> user wajib memasang PIN baru sebelum bisa
 * membuka Blast Dashboard. Token akses blast tidak diubah di sini.
 */
export function clearUserBlastPin(id: string): boolean {
  const res = db.prepare('UPDATE users SET blast_pin_hash = NULL WHERE id = ?').run(id);
  return (res as any).changes > 0;
}

export function getOrCreateUserBlastAccessToken(userId: string): string {
  const user = getUserById(userId);
  if (user?.blastAccessToken) {
    return user.blastAccessToken;
  }
  // Tanpa prefix di depannya sesuai instruksi user
  const token = crypto.randomUUID().replace(/-/g, '');
  db.prepare('UPDATE users SET blast_access_token = ? WHERE id = ?').run(token, userId);
  return token;
}

export function rotateUserBlastAccessToken(userId: string): string {
  // Tanpa prefix di depannya sesuai instruksi user
  const token = crypto.randomUUID().replace(/-/g, '');
  db.prepare('UPDATE users SET blast_access_token = ? WHERE id = ?').run(token, userId);
  return token;
}

/**
 * Baca token akses blast TANPA membuatnya (read-only).
 *
 * Jangan pakai getOrCreateUserBlastAccessToken() untuk keperluan tampil/inspeksi:
 * fungsi itu MENULIS token baru kalau belum ada. Endpoint admin yang hanya ingin
 * MENAMPILKAN link user lain tidak boleh diam-diam menerbitkan token — itu
 * memperluas akses tanpa persetujuan pemilik akun.
 *
 * Balas null kalau user belum punya token.
 */
export function getUserBlastAccessToken(userId: string): string | null {
  const row = db.prepare('SELECT blast_access_token FROM users WHERE id = ?').get(userId) as any;
  return row?.blast_access_token || null;
}

export function getUserByBlastAccessToken(token: string): UserRecord | null {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM users WHERE blast_access_token = ?').get(token) as any;
  return row ? mapUser(row) : null;
}

export function createBlastLaunchToken(userId: string, ttlSeconds = 600): string {
  const token = `blst_${crypto.randomUUID().replace(/-/g, '')}`;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  db.prepare('INSERT INTO blast_launch_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)').run(token, userId, expiresAt);
  return token;
}

export function verifyAndBurnBlastLaunchToken(token: string): { valid: boolean; userId?: string; reason?: string } {
  const row = db.prepare('SELECT * FROM blast_launch_tokens WHERE token = ?').get(token) as any;
  if (!row) {
    return { valid: false, reason: 'Token peluncuran blast tidak valid atau tidak ditemukan.' };
  }
  if (row.used === 1) {
    return { valid: false, reason: 'Token ini sudah pernah digunakan (single-use burned).' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: 'Token peluncuran blast telah kedaluwarsa.' };
  }

  // Burn token (tandai sudah dipakai)
  db.prepare('UPDATE blast_launch_tokens SET used = 1 WHERE token = ?').run(token);
  return { valid: true, userId: row.user_id };
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
    blastPinHash: row.blast_pin_hash || undefined,
    blastAccessToken: row.blast_access_token || undefined,
    phone: row.phone || undefined,
  };
}
