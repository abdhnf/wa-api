import { db } from './client.js';
import { cocokTeks, type MatchType } from '../matcher.js';
import type { WebhookRecord } from '../types.js';

// ============ Webhook: konfigurasi & antrean pengiriman ============
//
// Dua hal berbeda ditangani di sini:
//
//   1. KONFIGURASI (`webhooks`) — URL, event yang dilanggan, secret.
//   2. ANTREAN (`webhook_deliveries`) — satu baris per percobaan kirim.
//
// Pemisahan ini disengaja. Kalau status pengiriman disimpan di baris webhook,
// riwayat percobaan akan saling menimpa dan justru bagian yang paling dibutuhkan
// saat integrasi gagal — urutan percobaan dan alasan tiap kegagalan — hilang.

/** Event yang bisa dilanggan. Divalidasi saat pendaftaran, bukan saat kirim. */
export const WEBHOOK_EVENTS = ['message.received', 'message.status', 'session.status'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  userId: string;
  event: string;
  payload: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  lastStatusCode: number | null;
  lastError: string | null;
  /** ID yang dikirim sebagai `X-WA-Delivery`, untuk dedupe di penerima. */
  deliveryId: string;
  /**
   * Kunci idempotensi stabil untuk kejadian ini, dikirim sebagai
   * `X-WA-Idempotency-Key`. Berbeda dari `deliveryId`: nilainya sama untuk dua
   * pemancaran kejadian yang sama, sehingga penerima bisa mengenali kiriman
   * ganda — bukan hanya percobaan ulang dari satu baris antrean.
   */
  idempotencyKey: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

function mapWebhook(r: any): WebhookRecord & {
  createdAt?: string;
  lastSuccessAt?: string | null;
  failureCount?: number;
} {
  let events: string[] = [];
  try {
    events = JSON.parse(r.events);
    if (!Array.isArray(events)) events = [];
  } catch {
    events = [];
  }
  let chatTypes: string[] | null = null;
  try {
    const parsed = r.chat_types ? JSON.parse(r.chat_types) : null;
    chatTypes = Array.isArray(parsed) ? parsed : null;
  } catch {
    chatTypes = null;
  }
  return {
    id: r.id,
    userId: r.user_id,
    url: r.url,
    events,
    secret: r.secret,
    status: r.status === 'disabled' ? 'disabled' : 'active',
    sessionId: r.session_id ?? null,
    chatTypes,
    matchType: (r.match_type as MatchType) ?? null,
    matchValue: r.match_value ?? null,
    createdAt: r.created_at ?? undefined,
    lastSuccessAt: r.last_success_at ?? null,
    failureCount: Number(r.failure_count) || 0,
  };
}

export function upsertWebhook(w: WebhookRecord): void {
  db.prepare(
    `INSERT INTO webhooks (id, user_id, url, events, secret, status, session_id, chat_types, match_type, match_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       url=excluded.url, events=excluded.events, status=excluded.status,
       session_id=excluded.session_id, chat_types=excluded.chat_types,
       match_type=excluded.match_type, match_value=excluded.match_value`
  ).run(
    w.id,
    w.userId,
    w.url,
    JSON.stringify(w.events),
    w.secret,
    w.status,
    w.sessionId ?? null,
    w.chatTypes ? JSON.stringify(w.chatTypes) : null,
    w.matchType ?? null,
    w.matchValue ?? null,
  );
}

export function getWebhook(id: string): (WebhookRecord & { createdAt?: string }) | null {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as any;
  return row ? mapWebhook(row) : null;
}

/**
 * Daftar webhook milik satu akun.
 *
 * `secret` disamarkan secara default. Sebelumnya nilai mentahnya ikut terkirim
 * ke panel pada setiap pembacaan, padahal rahasia itu hanya perlu diketahui
 * sekali — saat dibuat — dan setelah itu cukup dipakai server untuk menandatangani.
 * Membiarkannya terbaca berarti siapa pun yang bisa membuka panel (atau melihat
 * tangkapan layar panel) bisa memalsukan tanda tangan ke penerima.
 */
export function listWebhooks(userId: string, options: { revealSecret?: boolean } = {}): WebhookRecord[] {
  const rows = db.prepare('SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at').all(userId) as any[];
  return rows.map((r) => {
    const hook = mapWebhook(r);
    if (!options.revealSecret && hook.secret) {
      hook.secret = topengSecret(hook.secret);
    }
    return hook;
  });
}

/**
 * Jumlah webhook milik satu akun.
 *
 * Dipakai untuk menegakkan batas pendaftaran. Satu event masuk dipancarkan ke
 * SETIAP webhook yang cocok, jadi jumlah yang tidak dibatasi melipatgandakan
 * salinan payload, koneksi keluar, dan baris antrean per event.
 */
export function hitungWebhookUser(userId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM webhooks WHERE user_id = ?').get(userId) as any;
  return Number(row?.c) || 0;
}

/** Bentuk tampilan secret: cukup untuk dikenali, tidak untuk dipakai. */
export function topengSecret(secret: string): string {
  if (!secret) return '';
  if (secret.length <= 6) return '••••';
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

/**
 * Webhook aktif milik user yang melanggan event tertentu, DAN mencakup
 * sesi/jenis chat/isi pesan dari pesan yang sedang diproses.
 *
 * `scope` opsional karena tidak semua event punya semuanya: `message.status`
 * membawa `sessionId` tapi bukan `chatType`, sementara `session.status` hanya
 * membawa `sessionId`. Event tanpa `scope` tetap dikirim ke semua pelanggan
 * event tersebut — sama seperti perilaku sebelum penyaringan ini ada.
 *
 * `scope.message` menandai bahwa event ini MEMBAWA pesan, sekaligus isinya.
 * Pembedaan itu perlu: filter isi pesan hanya boleh dinilai untuk event yang
 * memang punya pesan. Kalau `message.status` ikut dinilai, webhook berfilter
 * akan diam-diam berhenti menerima perubahan status — kerusakan yang tidak
 * terlihat sampai ada operator bertanya kenapa status tidak pernah masuk.
 * Sebaliknya, `message.received` tanpa teks (gambar tanpa caption) tetap harus
 * dinilai: filter yang tidak punya bahan untuk dicocokkan berarti TIDAK cocok,
 * bukan "lolos".
 */
export function listActiveWebhooksForEvent(
  userId: string,
  event: string,
  scope?: {
    sessionId?: string | null;
    chatType?: string | null;
    message?: { text: string | null } | null;
  },
): WebhookRecord[] {
  const rows = db
    .prepare("SELECT * FROM webhooks WHERE user_id = ? AND status = 'active'")
    .all(userId) as any[];
  return rows
    .map(mapWebhook)
    .filter((w) => {
      if (!w.events.includes(event) && !w.events.includes('*')) return false;

      // Sesi: NULL pada webhook berarti semua sesi. Kalau webhook dibatasi ke
      // satu sesi, hanya event dari sesi itu yang boleh dikirim.
      if (w.sessionId && (!scope?.sessionId || w.sessionId !== scope.sessionId)) return false;

      // Jenis chat: hanya berlaku untuk event yang memang membawanya.
      if (w.chatTypes && w.chatTypes.length > 0 && scope?.chatType) {
        if (!w.chatTypes.includes(scope.chatType)) return false;
      }

      // Isi pesan: dinilai hanya untuk event yang membawa pesan, dan hanya oleh
      // webhook yang memasang filter.
      if (w.matchType && w.matchValue && scope?.message) {
        if (!cocokTeks(w.matchType, w.matchValue, scope.message.text ?? '')) return false;
      }

      return true;
    });
}

export function updateWebhook(
  id: string,
  userId: string,
  patch: {
    url?: string;
    events?: string[];
    status?: 'active' | 'disabled';
    sessionId?: string | null;
    chatTypes?: string[] | null;
    matchType?: MatchType | null;
    matchValue?: string | null;
    secret?: string;
  },
): boolean {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!row) return false;

  const next = {
    url: patch.url ?? row.url,
    events: patch.events ? JSON.stringify(patch.events) : row.events,
    status: patch.status ?? row.status,
    session_id: patch.sessionId !== undefined ? patch.sessionId : row.session_id,
    chat_types: patch.chatTypes !== undefined
      ? (patch.chatTypes ? JSON.stringify(patch.chatTypes) : null)
      : row.chat_types,
    // `null` eksplisit berarti "hapus filter", berbeda dari "tidak dikirim".
    // Tanpa pembedaan ini, filter yang sudah dipasang tidak bisa dilepas lagi.
    match_type: patch.matchType !== undefined ? patch.matchType : row.match_type,
    match_value: patch.matchValue !== undefined ? patch.matchValue : row.match_value,
    secret: patch.secret ?? row.secret,
  };
  db.prepare(
    `UPDATE webhooks
     SET url = ?, events = ?, status = ?, session_id = ?, chat_types = ?,
         match_type = ?, match_value = ?, secret = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    next.url,
    next.events,
    next.status,
    next.session_id ?? null,
    next.chat_types ?? null,
    next.match_type ?? null,
    next.match_value ?? null,
    next.secret,
    id,
    userId,
  );
  return true;
}

/**
 * Hapus webhook beserta riwayat pengirimannya.
 *
 * Riwayat ikut dihapus supaya tidak ada baris `pending` yang tertinggal dan
 * terus dicoba oleh worker untuk webhook yang sudah tidak ada.
 */
export function deleteWebhook(id: string, userId: string): boolean {
  const row = db.prepare('SELECT id FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId) as any;
  if (!row) return false;
  db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').run(id);
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
  return true;
}

export function catatKeberhasilanWebhook(id: string): void {
  try {
    db.prepare(
      "UPDATE webhooks SET last_success_at = datetime('now'), failure_count = 0 WHERE id = ?"
    ).run(id);
  } catch {}
}

export function catatKegagalanWebhook(id: string): void {
  try {
    db.prepare('UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?').run(id);
  } catch {}
}

// ---------- Antrean pengiriman ----------

/** Masukkan satu pengiriman ke antrean. Tidak melakukan HTTP apa pun. */
export function enqueueWebhookDelivery(input: {
  id: string;
  webhookId: string;
  userId: string;
  event: string;
  payload: string;
  deliveryId: string;
  idempotencyKey: string;
  nextAttemptAt: number;
}): void {
  db.prepare(
    `INSERT INTO webhook_deliveries
       (id, webhook_id, user_id, event, payload, status, attempts, next_attempt_at, delivery_id, idempotency_key)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`
  ).run(
    input.id,
    input.webhookId,
    input.userId,
    input.event,
    input.payload,
    input.nextAttemptAt,
    input.deliveryId,
    input.idempotencyKey,
  );
}

function mapDelivery(r: any): WebhookDelivery {
  return {
    id: r.id,
    webhookId: r.webhook_id,
    userId: r.user_id,
    event: r.event,
    payload: r.payload,
    status: r.status,
    attempts: Number(r.attempts) || 0,
    nextAttemptAt: Number(r.next_attempt_at) || 0,
    lastStatusCode: r.last_status_code ?? null,
    lastError: r.last_error ?? null,
    deliveryId: r.delivery_id,
    idempotencyKey: r.idempotency_key ?? null,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at ?? null,
  };
}

/** Baris yang siap dicoba sekarang, urut terlama dulu. */
export function ambilPengirimanSiap(limit = 20): WebhookDelivery[] {
  const rows = db
    .prepare(
      `SELECT * FROM webhook_deliveries
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY next_attempt_at ASC LIMIT ?`
    )
    .all(Date.now(), limit) as any[];
  return rows.map(mapDelivery);
}

/**
 * Tandai percobaan berhasil.
 *
 * `attempts` tetap dinaikkan supaya jumlah percobaan yang tertulis di riwayat
 * mencerminkan kenyataan, bukan hanya percobaan yang gagal.
 */
export function tandaiPengirimanBerhasil(id: string, statusCode: number): void {
  db.prepare(
    `UPDATE webhook_deliveries
     SET status = 'success', attempts = attempts + 1, last_status_code = ?,
         last_error = NULL, delivered_at = datetime('now')
     WHERE id = ?`
  ).run(statusCode, id);
}

/** Tandai percobaan gagal; `final` menentukan apakah dicoba lagi atau menyerah. */
export function tandaiPengirimanGagal(
  id: string,
  statusCode: number | null,
  error: string,
  final: boolean,
  nextAttemptAt: number,
): void {
  db.prepare(
    `UPDATE webhook_deliveries
     SET status = ?, attempts = attempts + 1, last_status_code = ?, last_error = ?, next_attempt_at = ?
     WHERE id = ?`
  ).run(final ? 'failed' : 'pending', statusCode, error.slice(0, 500), nextAttemptAt, id);
}

export function listWebhookDeliveries(options: {
  webhookId?: string;
  userId?: string;
  status?: 'pending' | 'success' | 'failed';
  limit?: number;
  offset?: number;
}): { deliveries: WebhookDelivery[]; total: number } {
  const where: string[] = [];
  const params: any[] = [];
  if (options.webhookId) {
    where.push('webhook_id = ?');
    params.push(options.webhookId);
  }
  if (options.userId) {
    where.push('user_id = ?');
    params.push(options.userId);
  }
  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM webhook_deliveries ${clause}`).get(...params) as any).c as number;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = db
    .prepare(`SELECT * FROM webhook_deliveries ${clause} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as any[];

  return { deliveries: rows.map(mapDelivery), total };
}

/**
 * Kembalikan satu pengiriman ke antrean (tombol "coba lagi" di panel).
 *
 * Mengembalikan alasan kegagalan, bukan `boolean`, karena dua kegagalan itu
 * butuh jawaban berbeda bagi operator: "tidak ditemukan" berarti id-nya salah,
 * sedangkan "payload sudah dibersihkan" berarti barisnya ada tetapi body-nya
 * sudah tidak disimpan lagi — mengulang tidak mungkin, dan pesan galat yang
 * menyebutkan hal itu jauh lebih berguna daripada 404 yang menyesatkan.
 */
export function antrekanUlangPengiriman(
  id: string,
  userId: string,
): 'ok' | 'not_found' | 'payload_cleared' {
  const row = db
    .prepare('SELECT id, payload FROM webhook_deliveries WHERE id = ? AND user_id = ?')
    .get(id, userId) as any;
  if (!row) return 'not_found';
  // Body yang sudah dibersihkan tidak bisa dikirim ulang: yang akan terkirim
  // adalah string kosong, dan penerima menerimanya sebagai payload rusak.
  if (!row.payload) return 'payload_cleared';
  db.prepare(
    "UPDATE webhook_deliveries SET status = 'pending', next_attempt_at = ?, last_error = NULL WHERE id = ?"
  ).run(Date.now(), id);
  return 'ok';
}

/**
 * Kosongkan body pengiriman yang sudah selesai, sisakan metadatanya.
 *
 * Body berisi isi pesan pelanggan. Setelah pengiriman selesai (sukses maupun
 * gagal permanen), nilainya hanya berguna untuk menelusuri masalah dalam
 * hitungan jam — bukan sebulan. Tanpa pembersihan ini, pesan pribadi orang
 * duduk di SQLite sampai `pruneWebhookDeliveries` membuang barisnya.
 *
 * Baris `pending` TIDAK disentuh: body-nya masih dibutuhkan worker untuk
 * mengirim. Baris yang sudah selesai tetap ada sebagai jejak audit — yang
 * hilang hanya isinya.
 *
 * `jam <= 0` mematikan pembersihan (body disimpan sampai barisnya dipangkas).
 */
export function kosongkanPayloadLama(jam = 24): number {
  if (!Number.isFinite(jam) || jam <= 0) return 0;
  const batas = new Date(Date.now() - jam * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  const res = db
    .prepare(
      `UPDATE webhook_deliveries
       SET payload = ''
       WHERE status != 'pending' AND payload != '' AND created_at < ?`
    )
    .run(batas) as any;
  return Number(res?.changes ?? 0);
}

/**
 * Bersihkan riwayat pengiriman lama.
 *
 * Hanya baris yang sudah selesai (success/failed) — baris `pending` tidak
 * disentuh berapa pun umurnya, karena masih mewakili pekerjaan yang belum
 * dilakukan.
 */
export function pruneWebhookDeliveries(hari = 30): number {
  const batas = new Date(Date.now() - hari * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const res = db
    .prepare("DELETE FROM webhook_deliveries WHERE status != 'pending' AND created_at < ?")
    .run(batas) as any;
  return Number(res?.changes ?? 0);
}
