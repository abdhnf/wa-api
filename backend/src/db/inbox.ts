import { db } from './client.js';

// ============ Pesan masuk (inbox) ============

export type InboundChatType = 'private' | 'group' | 'broadcast';
export type InboundType = 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'other';

export interface InboundMessage {
  id: string;
  sessionId: string;
  userId: string;
  waMessageId?: string | null;
  fromJid: string;
  fromPhone?: string | null;
  pushName?: string | null;
  chatType: InboundChatType;
  type: InboundType;
  text?: string | null;
  mediaMime?: string | null;
  mediaCaption?: string | null;
  raw?: string | null;
  receivedAt: string;
  botHandled: boolean;
}

export interface InsertInboundInput {
  id: string;
  sessionId: string;
  userId: string;
  waMessageId?: string | null;
  fromJid: string;
  fromPhone?: string | null;
  pushName?: string | null;
  chatType: InboundChatType;
  type: InboundType;
  text?: string | null;
  mediaMime?: string | null;
  mediaCaption?: string | null;
  raw?: string | null;
  receivedAt: string;
}

/**
 * Simpan satu pesan masuk.
 *
 * Mengembalikan `false` bila baris dilewati karena duplikat. Baileys mengirim
 * ulang pesan yang sama setelah reconnect, dan inbox yang berisi pesan ganda
 * membuat chatbot membalas dua kali — jadi duplikat ditolak di tingkat database
 * (index unik parsial), bukan diperiksa lebih dulu dengan SELECT yang bisa
 * balapan antar event.
 */
export function insertInboundMessage(m: InsertInboundInput): boolean {
  try {
    const res = db.prepare(
      `INSERT OR IGNORE INTO inbound_messages
         (id, session_id, user_id, wa_message_id, from_jid, from_phone, push_name,
          chat_type, type, text, media_mime, media_caption, raw, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      m.id,
      m.sessionId,
      m.userId,
      m.waMessageId ?? null,
      m.fromJid,
      m.fromPhone ?? null,
      m.pushName ?? null,
      m.chatType,
      m.type,
      m.text ?? null,
      m.mediaMime ?? null,
      m.mediaCaption ?? null,
      m.raw ?? null,
      m.receivedAt,
    );
    return Number((res as any)?.changes ?? 0) > 0;
  } catch (err) {
    console.warn('[inbox] Gagal menyimpan pesan masuk:', err);
    return false;
  }
}

export interface ListInboundOptions {
  /** `undefined` = semua tenant (hanya untuk admin). */
  userId?: string;
  sessionId?: string;
  fromPhone?: string;
  chatType?: InboundChatType;
  limit?: number;
  offset?: number;
}

function mapRow(r: any): InboundMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    userId: r.user_id,
    waMessageId: r.wa_message_id,
    fromJid: r.from_jid,
    fromPhone: r.from_phone,
    pushName: r.push_name,
    chatType: r.chat_type,
    type: r.type,
    text: r.text,
    mediaMime: r.media_mime,
    mediaCaption: r.media_caption,
    raw: r.raw,
    receivedAt: r.received_at,
    botHandled: Boolean(r.bot_handled),
  };
}

export function listInboundMessages(options: ListInboundOptions = {}): { messages: InboundMessage[]; total: number } {
  const where: string[] = [];
  const params: any[] = [];

  if (options.userId) {
    where.push('user_id = ?');
    params.push(options.userId);
  }
  if (options.sessionId) {
    where.push('session_id = ?');
    params.push(options.sessionId);
  }
  if (options.fromPhone) {
    where.push('from_phone = ?');
    params.push(options.fromPhone);
  }
  if (options.chatType) {
    where.push('chat_type = ?');
    params.push(options.chatType);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM inbound_messages ${clause}`).get(...params) as any).c as number;

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM inbound_messages ${clause} ORDER BY received_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[];

  return { messages: rows.map(mapRow), total };
}

/** Satu percakapan: seluruh pesan masuk dari satu nomor pada satu sesi. */
export function listConversation(sessionId: string, fromPhone: string, limit = 100): InboundMessage[] {
  const rows = db
    .prepare(
      `SELECT * FROM inbound_messages
       WHERE session_id = ? AND from_phone = ?
       ORDER BY received_at DESC, rowid DESC LIMIT ?`
    )
    .all(sessionId, fromPhone, Math.min(Math.max(limit, 1), 500)) as any[];
  return rows.map(mapRow).reverse();
}

/** Ringkasan percakapan terakhir per nomor — untuk daftar inbox di panel. */
export function listConversations(userId: string, limit = 50): Array<{
  sessionId: string;
  fromPhone: string;
  pushName: string | null;
  lastText: string | null;
  lastAt: string;
  total: number;
}> {
  const rows = db
    .prepare(
      `SELECT session_id, from_phone, push_name, text, received_at,
              (SELECT COUNT(*) FROM inbound_messages b
                WHERE b.session_id = a.session_id AND b.from_phone = a.from_phone) AS total
       FROM inbound_messages a
       WHERE user_id = ? AND from_phone IS NOT NULL
         AND rowid = (
           SELECT rowid FROM inbound_messages c
           WHERE c.session_id = a.session_id AND c.from_phone = a.from_phone
           ORDER BY c.received_at DESC, c.rowid DESC LIMIT 1
         )
       ORDER BY received_at DESC
       LIMIT ?`
    )
    .all(userId, Math.min(Math.max(limit, 1), 200)) as any[];

  return rows.map((r) => ({
    sessionId: r.session_id,
    fromPhone: r.from_phone,
    pushName: r.push_name ?? null,
    lastText: r.text ?? null,
    lastAt: r.received_at,
    total: Number(r.total) || 0,
  }));
}

export function markInboundBotHandled(id: string): void {
  try {
    db.prepare('UPDATE inbound_messages SET bot_handled = 1 WHERE id = ?').run(id);
  } catch {}
}

/**
 * Pemilik sebuah sesi.
 *
 * Dibaca dari DB, bukan dari objek sesi di memori: pemilik adalah fakta
 * penyimpanan, dan sesi yang sedang reconnect tetap punya pemilik yang sama.
 * Sesi lama tanpa `user_id` jatuh ke pemilik default yang dipakai seluruh
 * skema ini, supaya pesan masuknya tidak hilang.
 */
export function getSessionOwnerId(sessionId: string, fallback = 'usr_c26f74d6'): string {
  try {
    const row = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(sessionId) as
      | { user_id?: string | null }
      | undefined;
    return row?.user_id || fallback;
  } catch {
    return fallback;
  }
}
