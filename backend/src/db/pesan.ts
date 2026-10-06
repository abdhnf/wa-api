import type { OutboundMessage, SessionInfo, UserRecord, WebhookRecord } from '../types.js';
import { db } from './client.js';
import { listSessions } from './sessions.js';
import { getUserById } from './users.js';

export function insertMessage(m: OutboundMessage, defaultUserId = 'usr_c26f74d6'): void {
  const uid = m.userId || defaultUserId;
  const priority = m.priority || 'normal';
  // Catat waktu status awal (biasanya 'queued') di titik pesan MASUK antrean.
  // `m.timestamp` diisi oleh pemanggil tepat sebelum ini, jadi waktunya sama
  // dengan created_at — konsisten, tidak ada dua sumber waktu yang berbeda.
  // Kalau pemanggil sudah mengisi statusTimes sendiri, itu yang dipakai.
  const statusTimes = m.statusTimes ?? { [m.status]: Date.parse(m.timestamp) || Date.now() };
  const payload = { ...m, statusTimes };
  db.prepare(
    `INSERT INTO messages (id, session_id, user_id, mode, recipient, payload, status, jitter_delay_ms, batch_id, created_at, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(m.id, m.sessionId, uid, m.mode, m.to, JSON.stringify(payload), m.status, m.jitterDelayMs, m.batchId ?? null, m.timestamp, priority);
}

/**
 * Urutan kemajuan status pesan. Status TIDAK BOLEH mundur kecuali ke 'failed'.
 *
 * Kenapa ini perlu: event `messages.update` dan `message-receipt.update` datang
 * tidak berurutan, apalagi setelah socket reconnect. Tanpa proteksi ini, satu
 * event SERVER_ACK (status 2) yang datang terlambat akan menurunkan pesan yang
 * sudah 'read' kembali ke 'sent' — dan operator melihat pesan yang sebenarnya
 * sudah dibaca sebagai belum terkirim.
 *
 * Status terminal (failed / invalid_number / not_registered / cancelled) tidak
 * ada di sini karena bukan bagian dari rantai kemajuan normal.
 */
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  queued: 0,
  pacing: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  read: 5,
};

/** Status yang selalu boleh ditulis, apa pun status sebelumnya. */
const FORCED_STATUSES = new Set(['failed', 'invalid_number', 'not_registered', 'cancelled']);

/**
 * Normalisasi waktu kejadian dari WhatsApp menjadi epoch MILIDETIK.
 *
 * WhatsApp mengirim timestamp dalam DETIK (`attrs.t`), sedangkan yang disimpan
 * dan dipakai panel dalam milidetik. Konversi sengaja hanya ada di satu tempat
 * ini supaya tidak ada dua aturan berbeda.
 *
 * Nilai yang tidak masuk akal DITOLAK, bukan ditebak: `attrs.t` bernilai 0 atau
 * kosong saat WhatsApp tidak menyertakan waktu, dan `0 * 1000` akan tersimpan
 * sebagai 1 Januari 1970 — jauh lebih buruk daripada jatuh ke jam server.
 * Ambang bawah 2001 dipilih karena WhatsApp sendiri baru ada setelah itu.
 */
const AMBANG_WAKTU_MS = 1_000_000_000_000; // 2001-09-09, jauh sebelum WhatsApp dipakai

function normalisasiWaktu(mentah: unknown): number | undefined {
  if (typeof mentah !== 'number' || !Number.isFinite(mentah) || mentah <= 0) return undefined;
  // Nilai di bawah ambang berarti masih dalam detik, bukan milidetik.
  const ms = mentah < AMBANG_WAKTU_MS ? mentah * 1000 : mentah;
  return ms >= AMBANG_WAKTU_MS ? Math.round(ms) : undefined;
}

export function updateMessageStatus(
  id: string,
  status: OutboundMessage['status'],
  errorDetail?: string,
  jitterDelayMs?: number,
  /**
   * Waktu kejadian sebenarnya. Diisi HANYA oleh pemanggil yang punya timestamp
   * asli dari WhatsApp (`BaileysEngine`); pemanggil lain dibiarkan memakai jam
   * server. Diterima dalam detik maupun milidetik — dinormalisasi di sini.
   */
  waktuKejadian?: number,
): void {
  const row = db.prepare('SELECT status, payload, jitter_delay_ms FROM messages WHERE id = ?').get(id) as any;
  if (row) {
    // Tolak kemunduran status. 'failed' dan status terminal lain selalu lolos
    // supaya kegagalan tetap tercatat walau pesan sudah pernah 'read'.
    const currentRank = STATUS_RANK[row.status];
    const nextRank = STATUS_RANK[status];
    if (
      !FORCED_STATUSES.has(status) &&
      currentRank !== undefined &&
      nextRank !== undefined &&
      nextRank < currentRank
    ) {
      return;
    }
    try {
      const obj = JSON.parse(row.payload);
      obj.status = status;
      if (errorDetail !== undefined) {
        obj.errorDetail = errorDetail;
      }
      // Catat waktu kejadian. HANYA bila status ini belum pernah tercatat:
      // `pacing` dipanggil berkali-kali untuk satu pesan (tiga titik di
      // session-manager, plus saat pesan dikembalikan ke depan antrean), dan
      // tanpa aturan ini kemunculan terakhir akan menimpa yang pertama.
      // Yang ingin dijawab operator adalah "kapan pesan ini mulai menunggu",
      // bukan "kapan pemeriksaan terakhir dilakukan".
      if (!obj.statusTimes || typeof obj.statusTimes !== 'object') {
        obj.statusTimes = {};
      }
      if (obj.statusTimes[status] === undefined) {
        const waktu = normalisasiWaktu(waktuKejadian) ?? Date.now();
        obj.statusTimes[status] = waktu;
      }
      if (jitterDelayMs !== undefined) {
        obj.jitterDelayMs = jitterDelayMs;
        db.prepare('UPDATE messages SET status = ?, jitter_delay_ms = ?, payload = ? WHERE id = ?').run(status, jitterDelayMs, JSON.stringify(obj), id);
      } else {
        db.prepare('UPDATE messages SET status = ?, payload = ? WHERE id = ?').run(status, JSON.stringify(obj), id);
      }
      return;
    } catch {}
  }
  if (jitterDelayMs !== undefined) {
    db.prepare('UPDATE messages SET status = ?, jitter_delay_ms = ? WHERE id = ?').run(status, jitterDelayMs, id);
  } else {
    db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id);
  }
}


export function resetStuckMessages(): number {
  const res = db.prepare("UPDATE messages SET status = 'queued' WHERE status IN ('pacing', 'sending')").run() as any;
  return (res && res.changes) ? res.changes : 0;
}

export function getPendingMessages(sessionId?: string): OutboundMessage[] {
  // 'pending' tetap diterima untuk baris lama dari sebelum status 'queued' diperkenalkan.
  let query = "SELECT payload FROM messages WHERE status IN ('queued', 'pending')";
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

export interface ListMessagesOptions {
  sessionId?: string;
  filterUserId?: string;
  batchId?: string;
  limit?: number;
  offset?: number;
  statuses?: string[];
  /** Daftar nomor tujuan; dipakai halaman antrean untuk mengambil status
   * hanya bagi baris yang sedang terlihat. */
  phones?: string[];
}

/**
 * Baca pesan dengan filter dan paginasi.
 * `limit`/`offset` dipakai halaman antrean dashboard; `batchId` memisahkan
 * kampanye supaya status satu kampanye tidak bocor ke kampanye lain.
 */
export function listMessages(options?: ListMessagesOptions | string, filterUserId?: string, limit = 50): OutboundMessage[] {
  const opts: ListMessagesOptions = (typeof options === 'string' || options === undefined)
    ? { sessionId: options as string | undefined, filterUserId, limit }
    : options;

  const { rows } = queryMessages(opts);
  return rows.map(mapMessageRow);
}

/** Baris pesan + total kecocokan filter, untuk paginasi halaman antrean. */
export function listMessagesPaged(options: ListMessagesOptions): { messages: OutboundMessage[]; total: number } {
  const { rows, total } = queryMessages(options);
  return { messages: rows.map(mapMessageRow), total };
}

/**
 * Jumlah pesan per status untuk satu sesi — SELURUH riwayat, bukan halaman aktif.
 *
 * Panel sebelumnya menghitung kartu statistik dari array baris yang sedang
 * tampil (`limit`/`offset`), sehingga "Masih Antrean / Delivery Sukses /
 * Pesan Gagal" berubah-ubah mengikuti halaman dan jumlah baris per halaman.
 * Agregasi ini dihitung di SQL supaya angkanya tetap benar walau riwayatnya
 * puluhan ribu pesan.
 *
 * Status yang tidak dikenal tetap dikembalikan apa adanya lewat `byStatus`,
 * sementara `total` adalah jumlah seluruh baris termasuk status tak dikenal
 * (sebelumnya baris `cancelled` hilang dari semua kartu).
 */
export function countMessagesByStatus(sessionId: string): {
  byStatus: Record<string, number>;
  total: number;
} {
  const rows = db
    .prepare('SELECT status, COUNT(*) as c FROM messages WHERE session_id = ? GROUP BY status')
    .all(sessionId) as any[];

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.c) || 0;
    byStatus[String(r.status)] = n;
    total += n;
  }
  return { byStatus, total };
}

function queryMessages(options: ListMessagesOptions): { rows: any[]; total: number } {
  const where: string[] = [];
  const params: any[] = [];

  if (options.sessionId && options.sessionId !== 'all' && options.sessionId !== 'auto') {
    where.push('session_id = ?');
    params.push(options.sessionId);
  }
  if (options.filterUserId) {
    where.push('user_id = ?');
    params.push(options.filterUserId);
  }
  if (options.batchId) {
    where.push('batch_id = ?');
    params.push(options.batchId);
  }
  if (options.statuses && options.statuses.length > 0) {
    where.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
    params.push(...options.statuses);
  }
  if (options.phones && options.phones.length > 0) {
    where.push(`recipient IN (${options.phones.map(() => '?').join(', ')})`);
    params.push(...options.phones);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM messages ${clause}`).get(...params) as any).c as number;

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM messages ${clause} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return { rows, total };
}

function mapMessageRow(r: any): OutboundMessage {
  try {
    const p = JSON.parse(r.payload);
    p.id = r.id || p.id;
    p.sessionId = r.session_id || p.sessionId;
    p.userId = r.user_id || p.userId || undefined;
    p.batchId = r.batch_id || p.batchId || undefined;
    p.to = r.recipient || p.to;
    p.mode = r.mode || p.mode;
    p.status = r.status || p.status;
    p.jitterDelayMs = typeof r.jitter_delay_ms === 'number' ? r.jitter_delay_ms : (p.jitterDelayMs || 0);
    p.timestamp = r.created_at || p.timestamp;
    return p;
  } catch {
    return {
      id: r.id,
      sessionId: r.session_id,
      userId: r.user_id,
      batchId: r.batch_id || undefined,
      mode: r.mode,
      to: r.recipient,
      text: r.payload,
      status: r.status,
      jitterDelayMs: typeof r.jitter_delay_ms === 'number' ? r.jitter_delay_ms : 0,
      timestamp: r.created_at,
    } as OutboundMessage;
  }
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
