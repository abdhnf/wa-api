import { db } from './client.js';

// ---------- Reset Password ----------
//
// Token disimpan sebagai HASH SHA-256, bukan teks asli.
//
// KENAPA BUKAN hashPassword() dari security.ts: fungsi itu memakai scrypt dengan
// salt acak per pemanggilan, sehingga hash-nya tidak deterministik — dua hash dari
// token yang sama selalu berbeda. Akibatnya pencarian `WHERE token_hash = ?`
// menjadi mustahil, karena tidak ada cara menebak salt-nya.
//
// Kenapa SHA-256 tetap aman di sini: token reset adalah nilai acak 32 byte, bukan
// password buatan manusia yang bisa ditebak. Serangan brute-force tidak berlaku,
// jadi hash cepat sudah cukup. Prinsipnya memang berbeda dari password, dan
// pemisahan ini disengaja.

export interface TokenResetRecord {
  tokenHash: string;
  userId: string;
  channel: string;
  destination: string;
  expiresAt: string;
  usedAt?: string;
  requestedIp?: string;
  createdAt: string;
}

function mapTokenReset(row: any): TokenResetRecord {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    channel: row.channel,
    destination: row.destination,
    expiresAt: row.expires_at,
    usedAt: row.used_at || undefined,
    requestedIp: row.requested_ip || undefined,
    createdAt: row.created_at,
  };
}

export function simpanTokenReset(t: {
  tokenHash: string;
  userId: string;
  channel?: string;
  destination: string;
  expiresAt: string;
  requestedIp?: string | null;
}): void {
  db.prepare(
    `INSERT INTO password_reset_tokens (token_hash, user_id, channel, destination, expires_at, requested_ip)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(t.tokenHash, t.userId, t.channel || 'email', t.destination, t.expiresAt, t.requestedIp ?? null);
}

export function ambilTokenReset(tokenHash: string): TokenResetRecord | null {
  const row = db.prepare('SELECT * FROM password_reset_tokens WHERE token_hash = ?').get(tokenHash) as any;
  return row ? mapTokenReset(row) : null;
}

/**
 * Tandai token terpakai.
 *
 * Syarat `used_at IS NULL` ada di klausa WHERE supaya dua permintaan yang datang
 * hampir bersamaan tidak bisa sama-sama berhasil — hanya yang pertama mengubah
 * baris. Ini yang membuat token benar-benar sekali pakai.
 */
export function tandaiTokenResetTerpakai(tokenHash: string): boolean {
  const res = db
    .prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token_hash = ? AND used_at IS NULL")
    .run(tokenHash);
  return (res as any).changes > 0;
}

/** Batalkan semua token milik user. Dipakai setelah password berhasil diubah. */
export function batalkanTokenResetUser(userId: string): number {
  const res = db
    .prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL")
    .run(userId);
  return (res as any).changes ?? 0;
}

/** Jumlah permintaan reset oleh satu email dalam rentang waktu tertentu. */
export function hitungPermintaanReset(email: string, jendelaMenit: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM password_reset_tokens
       WHERE destination = ? AND created_at >= datetime('now', ?)`
    )
    .get(
      (email || '').trim().toLowerCase(),
      `-${Math.max(1, Math.floor(jendelaMenit))} minutes`
    ) as any;
  return Number(row?.n ?? 0);
}

/** Hapus token kedaluwarsa. Dipanggil berkala supaya tabel tidak menumpuk. */
export function bersihkanTokenResetKedaluwarsa(): number {
  const res = db
    .prepare("DELETE FROM password_reset_tokens WHERE expires_at < datetime('now') OR used_at IS NOT NULL")
    .run();
  return (res as any).changes ?? 0;
}
