import { db } from './client.js';
import { getUserById } from './users.js';

/**
 * Validasi & increment kuota dinamis (harian / mingguan / bulanan; default 100/minggu
 * untuk user biasa; admin unlimited).
 *
 * `count` = jumlah pesan yang akan dikirim dalam satu operasi. Endpoint bulk harus
 * memakai `count > 1`, karena memanggil fungsi ini sekali per request membuat
 * kampanye 500 nomor hanya terhitung 1 pesan kuota.
 *
 * Kuota di-increment HANYA setelah lolos validasi, sehingga request yang ditolak
 * tidak mengurangi kuota.
 */
export function checkAndIncrementQuota(userId: string, count = 1): { allowed: boolean; used: number; limit: number; resetAt?: string; reason?: string } {
  const amount = Math.max(1, Math.floor(count));
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

  // Tolak sebelum ada side effect bila sisa kuota tidak cukup untuk seluruh operasi
  if (currentUsed + amount > quotaLimit) {
    const remaining = Math.max(0, quotaLimit - currentUsed);
    const reason = amount === 1
      ? `Batas kuota ${periodLabel} (${quotaLimit} pesan/${periodUnit}) tercapai. Reset pada ${resetAt.toLocaleDateString('id-ID')}.`
      : `Kuota ${periodLabel} tidak cukup: butuh ${amount} pesan, sisa ${remaining} dari ${quotaLimit}. Reset pada ${resetAt.toLocaleDateString('id-ID')}.`;
    return {
      allowed: false,
      used: currentUsed,
      limit: quotaLimit,
      resetAt: resetAt.toISOString(),
      reason,
    };
  }

  // Increment penggunaan
  db.prepare('UPDATE users SET used_in_period = used_in_period + ?, used_this_week = used_this_week + ?, used_today = used_today + ? WHERE id = ?')
    .run(amount, amount, amount, userId);
  return { allowed: true, used: currentUsed + amount, limit: quotaLimit, resetAt: resetAt.toISOString() };
}

/** Pembungkus kompatibilitas: satu pesan per pemanggilan. */
export function checkAndIncrementWeeklyQuota(userId: string): { allowed: boolean; used: number; limit: number; resetAt?: string; reason?: string } {
  return checkAndIncrementQuota(userId, 1);
}

/**
 * Kembalikan kuota yang sudah di-increment tetapi pesannya gagal masuk antrean.
 * Dipakai endpoint bulk saat sebagian item gagal, supaya kuota hanya mencerminkan
 * pesan yang benar-benar diserahkan ke gateway.
 */
export function refundQuota(userId: string, count: number): void {
  const amount = Math.max(0, Math.floor(count));
  if (amount === 0) return;
  db.prepare(
    'UPDATE users SET used_in_period = MAX(0, used_in_period - ?), used_this_week = MAX(0, used_this_week - ?), used_today = MAX(0, used_today - ?) WHERE id = ?'
  ).run(amount, amount, amount, userId);
}

export function incrementUsage(userId: string): void {
  db.prepare('UPDATE users SET used_today = used_today + 1 WHERE id = ?').run(userId);
}
