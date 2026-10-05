import type { SessionInfo } from '../types.js';
import { db } from './client.js';

// ---------- Sessions ----------
export function upsertSession(s: SessionInfo, defaultUserId = 'usr_c26f74d6'): void {
  const uid = s.userId || defaultUserId;
  const profile = s.numberProfile || 'mature';
  db.prepare(
    `INSERT INTO sessions (id, name, phone, status, risk_score, warmup_day, messages_sent_today, delivery_rate, user_id, number_profile)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, phone=excluded.phone, status=excluded.status,
       risk_score=excluded.risk_score, warmup_day=excluded.warmup_day,
       messages_sent_today=excluded.messages_sent_today, delivery_rate=excluded.delivery_rate,
       number_profile=COALESCE(excluded.number_profile, sessions.number_profile, 'mature'),
       user_id=COALESCE(sessions.user_id, excluded.user_id)`
  ).run(s.id, s.name, s.phone, s.status, s.riskScore, s.warmupDay, s.messagesSentToday, s.deliveryRate, uid, profile);
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

    // 2. Agregasi metrik riil dari tabel messages (pesan cancelled tidak dihitung sebagai total kirim)
    const summary = db.prepare(
      `SELECT 
         COUNT(CASE WHEN status != 'cancelled' THEN 1 END) as total_sent,
         SUM(CASE WHEN status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END) as total_delivered,
         SUM(CASE WHEN status IN ('failed', 'invalid_number', 'not_registered') THEN 1 ELSE 0 END) as total_failed,
         ROUND(AVG(jitter_delay_ms) / 1000.0, 1) as avg_delay_sec,
         SUM(CASE WHEN date(datetime(created_at, 'localtime')) = date('now', 'localtime') AND status != 'cancelled' THEN 1 ELSE 0 END) as today_sent
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
      numberProfile: (r.number_profile === 'fresh' ? 'fresh' : 'mature') as 'fresh' | 'mature',
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

export function updateSessionProfile(id: string, profile: 'fresh' | 'mature'): void {
  db.prepare('UPDATE sessions SET number_profile = ? WHERE id = ?').run(profile, id);
}

// ---------- Messages ----------
