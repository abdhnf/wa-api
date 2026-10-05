import { db } from './client.js';

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
