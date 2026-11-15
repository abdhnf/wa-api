import { db } from './client.js';
import type { MatchType } from '../matcher.js';

// ============ Chatbot: aturan & state percakapan ============

// Diambil dari modul pencocokan bersama supaya arti "cocok" pada aturan chatbot
// dan filter webhook tidak pernah berbeda. Diekspor ulang agar pemakai lama
// (`import type { MatchType } from './db.js'`) tetap bekerja.
export type { MatchType } from '../matcher.js';

export interface ChatbotStep {
  /** Kunci langkah, dirujuk oleh `next` pada langkah lain. */
  id: string;
  /** Balasan untuk langkah ini. */
  reply: string;
  /**
   * Peta jawaban pengguna -> id langkah berikutnya.
   * Kunci dicocokkan tanpa membedakan huruf besar/kecil.
   */
  next?: Record<string, string>;
  /** Langkah akhir: state percakapan dibersihkan setelah balasan ini. */
  end?: boolean;
}

export interface ChatbotFlow {
  id: string;
  userId: string;
  sessionId: string | null;
  name: string;
  enabled: boolean;
  priority: number;
  matchType: MatchType;
  matchValue: string;
  replyText: string | null;
  replyMediaUrl: string | null;
  steps: ChatbotStep[] | null;
  cooldownSeconds: number;
  createdAt: string;
}

export interface ChatbotSessionState {
  sessionId: string;
  contactPhone: string;
  currentFlowId: string | null;
  currentStep: string | null;
  context: Record<string, unknown> | null;
  botPausedUntil: number | null;
  lastActivityAt: string;
}

function parseSteps(raw: unknown): ChatbotStep[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((s) => s && typeof s.id === 'string' && typeof s.reply === 'string');
  } catch {
    return null;
  }
}

function mapFlow(r: any): ChatbotFlow {
  return {
    id: r.id,
    userId: r.user_id,
    sessionId: r.session_id ?? null,
    name: r.name,
    enabled: Boolean(r.enabled),
    priority: Number(r.priority) || 100,
    matchType: (r.match_type as MatchType) || 'contains',
    matchValue: r.match_value,
    replyText: r.reply_text ?? null,
    replyMediaUrl: r.reply_media_url ?? null,
    steps: parseSteps(r.steps),
    cooldownSeconds: Number(r.cooldown_seconds) || 0,
    createdAt: r.created_at,
  };
}

export function insertChatbotFlow(f: Omit<ChatbotFlow, 'createdAt'>): void {
  db.prepare(
    `INSERT INTO chatbot_flows
       (id, user_id, session_id, name, enabled, priority, match_type, match_value,
        reply_text, reply_media_url, steps, cooldown_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    f.id,
    f.userId,
    f.sessionId,
    f.name,
    f.enabled ? 1 : 0,
    f.priority,
    f.matchType,
    f.matchValue,
    f.replyText,
    f.replyMediaUrl,
    f.steps ? JSON.stringify(f.steps) : null,
    f.cooldownSeconds,
  );
}

export function updateChatbotFlow(
  id: string,
  userId: string,
  patch: Partial<Omit<ChatbotFlow, 'id' | 'userId' | 'createdAt'>>,
): boolean {
  const row = db.prepare('SELECT * FROM chatbot_flows WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!row) return false;

  const cur = mapFlow(row);
  const next = { ...cur, ...patch };
  db.prepare(
    `UPDATE chatbot_flows SET
       session_id = ?, name = ?, enabled = ?, priority = ?, match_type = ?,
       match_value = ?, reply_text = ?, reply_media_url = ?, steps = ?, cooldown_seconds = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    next.sessionId,
    next.name,
    next.enabled ? 1 : 0,
    next.priority,
    next.matchType,
    next.matchValue,
    next.replyText,
    next.replyMediaUrl,
    next.steps ? JSON.stringify(next.steps) : null,
    next.cooldownSeconds,
    id,
    userId,
  );
  return true;
}

export function deleteChatbotFlow(id: string, userId: string): boolean {
  const res = db.prepare('DELETE FROM chatbot_flows WHERE id = ? AND user_id = ?').run(id, userId) as any;
  if (Number(res?.changes ?? 0) === 0) return false;
  // State yang menunjuk flow ini akan mengarah ke aturan yang sudah tidak ada.
  // Dibersihkan sekarang supaya percakapan tidak menggantung di langkah hantu.
  db.prepare('UPDATE chatbot_sessions SET current_flow_id = NULL, current_step = NULL WHERE current_flow_id = ?').run(id);
  return true;
}

export function listChatbotFlows(userId: string): ChatbotFlow[] {
  const rows = db
    .prepare('SELECT * FROM chatbot_flows WHERE user_id = ? ORDER BY priority ASC, created_at ASC')
    .all(userId) as any[];
  return rows.map(mapFlow);
}

export function getChatbotFlow(id: string): ChatbotFlow | null {
  const row = db.prepare('SELECT * FROM chatbot_flows WHERE id = ?').get(id) as any;
  return row ? mapFlow(row) : null;
}

/**
 * Aturan yang berlaku untuk satu sesi, urut prioritas.
 *
 * Aturan khusus sesi diperiksa lebih dulu daripada aturan global milik user:
 * operator yang menulis aturan untuk satu nomor jelas menginginkan aturan itu
 * menang atas aturan umum. Urutan ini diwujudkan dengan mengurutkan
 * `session_id IS NULL` lebih dulu (0 untuk khusus sesi, 1 untuk global).
 */
export function listApplicableFlows(userId: string, sessionId: string): ChatbotFlow[] {
  const rows = db
    .prepare(
      `SELECT * FROM chatbot_flows
       WHERE user_id = ? AND enabled = 1 AND (session_id IS NULL OR session_id = ?)
       ORDER BY (session_id IS NULL) ASC, priority ASC, created_at ASC`
    )
    .all(userId, sessionId) as any[];
  return rows.map(mapFlow);
}

// ---------- State percakapan ----------

function mapState(r: any): ChatbotSessionState {
  let context: Record<string, unknown> | null = null;
  try {
    context = r.context ? JSON.parse(r.context) : null;
  } catch {
    context = null;
  }
  return {
    sessionId: r.session_id,
    contactPhone: r.contact_phone,
    currentFlowId: r.current_flow_id ?? null,
    currentStep: r.current_step ?? null,
    context,
    botPausedUntil: r.bot_paused_until ?? null,
    lastActivityAt: r.last_activity_at,
  };
}

export function getChatbotSession(sessionId: string, contactPhone: string): ChatbotSessionState | null {
  const row = db
    .prepare('SELECT * FROM chatbot_sessions WHERE session_id = ? AND contact_phone = ?')
    .get(sessionId, contactPhone) as any;
  return row ? mapState(row) : null;
}

export function saveChatbotSession(s: {
  sessionId: string;
  contactPhone: string;
  currentFlowId: string | null;
  currentStep: string | null;
  context?: Record<string, unknown> | null;
  botPausedUntil?: number | null;
}): void {
  db.prepare(
    `INSERT INTO chatbot_sessions
       (session_id, contact_phone, current_flow_id, current_step, context, bot_paused_until, last_activity_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(session_id, contact_phone) DO UPDATE SET
       current_flow_id = excluded.current_flow_id,
       current_step = excluded.current_step,
       context = excluded.context,
       bot_paused_until = excluded.bot_paused_until,
       last_activity_at = datetime('now')`
  ).run(
    s.sessionId,
    s.contactPhone,
    s.currentFlowId,
    s.currentStep,
    s.context ? JSON.stringify(s.context) : null,
    s.botPausedUntil ?? null,
  );
}

/** Hentikan bot untuk satu kontak sampai waktu tertentu (human takeover). */
export function pauseBotForContact(sessionId: string, contactPhone: string, untilMs: number): void {
  const existing = getChatbotSession(sessionId, contactPhone);
  saveChatbotSession({
    sessionId,
    contactPhone,
    currentFlowId: existing?.currentFlowId ?? null,
    currentStep: existing?.currentStep ?? null,
    context: existing?.context ?? null,
    botPausedUntil: untilMs,
  });
}

export function resumeBotForContact(sessionId: string, contactPhone: string): void {
  const existing = getChatbotSession(sessionId, contactPhone);
  if (!existing) return;
  saveChatbotSession({
    sessionId,
    contactPhone,
    currentFlowId: null,
    currentStep: null,
    context: null,
    botPausedUntil: null,
  });
}

export function listChatbotSessions(userId: string, limit = 50): Array<ChatbotSessionState & { flowName: string | null }> {
  const rows = db
    .prepare(
      `SELECT cs.*, cf.name AS flow_name
       FROM chatbot_sessions cs
       JOIN sessions s ON s.id = cs.session_id
       LEFT JOIN chatbot_flows cf ON cf.id = cs.current_flow_id
       WHERE s.user_id = ?
       ORDER BY cs.last_activity_at DESC
       LIMIT ?`
    )
    .all(userId, Math.min(Math.max(limit, 1), 200)) as any[];
  return rows.map((r) => ({ ...mapState(r), flowName: r.flow_name ?? null }));
}

// ---------- Opt-out ----------

export function addOptout(sessionId: string, contactPhone: string, reason?: string): void {
  db.prepare(
    `INSERT INTO chatbot_optouts (session_id, contact_phone, reason)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id, contact_phone) DO NOTHING`
  ).run(sessionId, contactPhone, reason ?? null);
}

export function removeOptout(sessionId: string, contactPhone: string): boolean {
  const res = db
    .prepare('DELETE FROM chatbot_optouts WHERE session_id = ? AND contact_phone = ?')
    .run(sessionId, contactPhone) as any;
  return Number(res?.changes ?? 0) > 0;
}

export function isOptedOut(sessionId: string, contactPhone: string): boolean {
  const row = db
    .prepare('SELECT 1 AS ada FROM chatbot_optouts WHERE session_id = ? AND contact_phone = ?')
    .get(sessionId, contactPhone) as any;
  return Boolean(row);
}

export function listOptouts(userId: string, limit = 200): Array<{
  sessionId: string;
  contactPhone: string;
  reason: string | null;
  createdAt: string;
}> {
  const rows = db
    .prepare(
      `SELECT o.* FROM chatbot_optouts o
       JOIN sessions s ON s.id = o.session_id
       WHERE s.user_id = ?
       ORDER BY o.created_at DESC LIMIT ?`
    )
    .all(userId, Math.min(Math.max(limit, 1), 500)) as any[];
  return rows.map((r) => ({
    sessionId: r.session_id,
    contactPhone: r.contact_phone,
    reason: r.reason ?? null,
    createdAt: r.created_at,
  }));
}
