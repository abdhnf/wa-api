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
  /** Label agen (header `X-MCP-Actor`), `null` untuk permintaan manusia. */
  actor?: string | null;
  /** Jenis sasaran: 'session' | 'batch' | 'message' | 'user'. */
  targetType?: string | null;
  targetId?: string | null;
  /** JSON parameter yang sudah disaring; lihat `audit-params.ts`. */
  params?: string | null;
  /** Nilai SEBELUM aksi, diisi handler yang membaca keadaan lama. */
  paramsBefore?: string | null;
  /** `true` bila baris ini bukti audit — tidak bisa dihapus non-admin. */
  audit: boolean;
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
  actor?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  params?: string | null;
  paramsBefore?: string | null;
  audit?: boolean;
}): void {
  try {
    db.prepare(`
      INSERT INTO api_logs (id, user_id, method, endpoint, status_code, ip, duration_ms, error_message, actor, target_type, target_id, params, params_before, audit, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      log.id,
      log.userId,
      log.method,
      log.endpoint,
      log.statusCode,
      log.ip,
      log.durationMs,
      log.errorMessage ?? null,
      log.actor ?? null,
      log.targetType ?? null,
      log.targetId ?? null,
      log.params ?? null,
      log.paramsBefore ?? null,
      log.audit ? 1 : 0
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
      l.id, l.user_id, l.method, l.endpoint, l.status_code, l.ip, l.duration_ms, l.error_message,
      l.actor, l.target_type, l.target_id, l.params, l.params_before, l.audit, l.created_at,
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
    actor: r.actor ?? null,
    targetType: r.target_type ?? null,
    targetId: r.target_id ?? null,
    params: r.params ?? null,
    paramsBefore: r.params_before ?? null,
    audit: Number(r.audit) === 1,
    createdAt: r.created_at,
  }));

  return { logs, total };
}

/**
 * Hapus baris log berdasarkan id.
 *
 * `userId` diisi untuk pemanggil non-admin, dan itu membatasi ke baris miliknya
 * sendiri. Selain itu baris bertanda `audit = 1` SELALU dikecualikan untuk
 * pemanggil non-admin: tanpa pengecualian ini, pihak yang diaudit bisa menghapus
 * bukti perbuatannya sendiri — yang membuat `api_logs` tidak layak disebut audit.
 *
 * Pemanggil admin mengosongkan `userId` dan boleh menghapus apa saja.
 */
export function deleteApiLogs(ids: string[], userId?: string): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  let query = `DELETE FROM api_logs WHERE id IN (${placeholders})`;
  const args: any[] = [...ids];

  if (userId) {
    query += ' AND user_id = ? AND audit = 0';
    args.push(userId);
  }

  const res = db.prepare(query).run(...args);
  return (res as any).changes || 0;
}

/**
 * Bersihkan log lama.
 *
 * Aturan yang sama dengan `deleteApiLogs`: pemanggil non-admin tidak bisa
 * menyentuh baris bertanda `audit = 1`. Perhatikan konsekuensinya — pembersihan
 * rutin oleh non-admin tidak akan menyusutkan baris audit, jadi retensi otomatis
 * (lihat `jalankanRetensi`) memang harus dijalankan oleh server, bukan
 * diserahkan pada pemilik log.
 */
export function clearApiLogs(userId?: string, olderThanDays?: number): number {
  let query = 'DELETE FROM api_logs';
  const conditions: string[] = [];
  const args: any[] = [];

  if (userId) {
    conditions.push('user_id = ?');
    conditions.push('audit = 0');
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

/** Bawaan retensi. Audit request disimpan lebih lama daripada decision log (30 hari). */
export const RETENSI_AUDIT_HARI = 90;
export const RETENSI_GALAT_HARI = 30;

/**
 * Retensi otomatis, dijalankan server secara berkala.
 *
 * Kenapa harus di server dan bukan lewat `POST /api-logs/clear`: baris bertanda
 * `audit = 1` sengaja tidak bisa dihapus pemiliknya (lihat `clearApiLogs`). Kalau
 * retensi diserahkan ke endpoint itu, baris audit tidak akan pernah menyusut —
 * dan tabelnya tumbuh tanpa batas, karena GET agen ikut tercatat.
 *
 * Dua ambang dipakai, bukan satu:
 *   - baris audit disimpan `RETENSI_AUDIT_HARI` (90) — pertanyaan "siapa melakukan
 *     apa bulan lalu" biasanya baru muncul setelah beberapa minggu.
 *   - catatan galat biasa cukup `RETENSI_GALAT_HARI` (30), sama seperti
 *     `antiban_decisions`.
 *
 * Mengembalikan jumlah yang dihapus per kategori supaya bisa dicatat di log dan
 * tidak menjadi penghapusan senyap.
 */
export function jalankanRetensi(
  hariAudit = RETENSI_AUDIT_HARI,
  hariGalat = RETENSI_GALAT_HARI,
): { audit: number; galat: number } {
  const hapusAudit = db
    .prepare(`DELETE FROM api_logs WHERE audit = 1 AND created_at < datetime('now', ?)`)
    .run(`-${Math.floor(hariAudit)} days`);
  const hapusGalat = db
    .prepare(`DELETE FROM api_logs WHERE audit = 0 AND created_at < datetime('now', ?)`)
    .run(`-${Math.floor(hariGalat)} days`);
  return {
    audit: Number((hapusAudit as any).changes) || 0,
    galat: Number((hapusGalat as any).changes) || 0,
  };
}
