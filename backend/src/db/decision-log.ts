/**
 * Decision log guard anti-ban.
 *
 * MASALAH yang diselesaikan berkas ini: seluruh guard anti-ban sudah punya
 * alasan (`reason`) saat menahan pesan, tetapi alasan itu hanya pernah
 * berakhir di `console.warn` — hilang begitu log berotasi. Akibatnya
 * pertanyaan "KENAPA 50 pesan lolos / tertahan" tidak bisa dijawab dari data,
 * dan rekomendasi anti-ban hanya bisa ditebak. Journal produksi 30 hari
 * terakhir berisi nol baris warning guard, jadi tidak ada bukti apa pun.
 *
 * Berkas ini mencatat SETIAP evaluasi guard — yang menahan maupun yang
 * MELOLOSKAN — beserta nilai terukur saat itu. Yang meloloskan justru sama
 * pentingnya: tanpa itu kita tidak tahu berapa dekat sebuah pengiriman ke
 * ambang batasnya.
 *
 * Prinsip yang dijaga:
 * - Tidak pernah melempar error. Pencatatan audit tidak boleh menggagalkan
 *   pengiriman pesan; kegagalan tulis cukup jadi satu baris di stderr.
 * - Tidak menyimpan isi pesan. Hanya hash penerima, metrik, dan ambang — supaya
 *   log bisa dibaca agen/analis tanpa membocorkan PII ke tempat lain.
 * - Tanpa dependency baru. Memakai `node:crypto` dan `node:sqlite` yang sudah
 *   jadi tulang punggung proyek ini.
 */
import { createHash, randomUUID } from 'node:crypto';
import { db } from './client.js';
import { normalisasiNomor } from '../phone.js';

/** Guard yang keputusannya dicatat. Sengaja string bebas, bukan enum, supaya
 *  penambahan guard baru tidak butuh migrasi skema. */
export type GuardName =
  | 'recovery'
  | 'timelock'
  | 'replyRatio'
  | 'contactGraph'
  | 'warmup'
  | 'rateLimiter'
  | 'identicalContent'
  | 'sessionHealth';

export type GuardDecision = 'allow' | 'block' | 'warn';

export interface DecisionRecord {
  sessionId: string;
  guard: GuardName;
  decision: GuardDecision;
  /** Pesan manusia dari guard. Untuk 'allow' diisi ringkasan terukur. */
  reason?: string | null;
  messageId?: string | null;
  batchId?: string | null;
  /** Nomor tujuan yang SUDAH di-hash. Tidak pernah nomor mentah. */
  recipientHash?: string | null;
  /** Nilai terukur saat guard dievaluasi (dipakai, batas, rasio, dst). */
  metrics?: Record<string, unknown> | null;
  /** Ambang batas yang berlaku saat itu, supaya keputusan bisa direproduksi. */
  threshold?: Record<string, unknown> | null;
  /** Preset yang aktif — perubahan preset mengubah arti sebuah keputusan. */
  preset?: string | null;
}

const MAX_TEXT = 500;
const MAX_JSON = 2000;

/**
 * Hash nomor tujuan. Dipakai agar log bisa mengelompokkan penerima yang sama
 * tanpa menyimpan nomor telepon. Salt tetap (bukan acak) supaya hash bisa
 * dibandingkan antar baris; ini bukan pengamanan kriptografis, hanya
 * penghilangan PII.
 *
 * Normalisasi WAJIB, bukan kenyamanan: `0812...`, `62812...`, `+62 812-...`,
 * dan `62812...@s.whatsapp.net` adalah nomor yang sama. Tanpa penyeragaman
 * semuanya menghasilkan hash berbeda, dan pengelompokan "berapa pesan ke satu
 * penerima" pecah tanpa memunculkan error apa pun.
 *
 * Bentuk kanonik ditentukan di satu tempat: `normalisasiNomor()` pada
 * `phone.ts`, yang juga dipakai jalur pengiriman. Dulu fungsi ini punya aturan
 * sendiri (hanya mengubah awalan `0` -> `62`) dan karena itu menyimpang dari
 * jalur kirim untuk nomor berawalan `00` atau tanpa awalan sama sekali.
 */
export function hashRecipient(recipient: string | null | undefined): string | null {
  if (!recipient) return null;
  // Buang bagian JID (`@s.whatsapp.net`, `:12`) sebelum normalisasi.
  const mentah = String(recipient).split('@')[0].split(':')[0];
  const kanonik = normalisasiNomor(mentah);
  if (!kanonik) return null;
  return createHash('sha256').update(`wa-api:recipient:${kanonik}`).digest('hex').slice(0, 16);
}

function clampText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
}

function clampJson(v: Record<string, unknown> | null | undefined): string | null {
  if (!v) return null;
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    return null;
  }
  if (s.length > MAX_JSON) s = `${s.slice(0, MAX_JSON)}…`;
  return s;
}

/**
 * Catat satu keputusan guard.
 *
 * Kegagalan di sini TIDAK BOLEH merambat ke jalur kirim: seluruh badan
 * dibungkus try/catch dan hanya mencetak ke stderr.
 */
export function recordGuardDecision(rec: DecisionRecord): void {
  try {
    db.prepare(`
      INSERT INTO antiban_decisions
        (id, session_id, guard, decision, reason, message_id, batch_id,
         recipient_hash, metrics, threshold, preset, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      randomUUID(),
      rec.sessionId,
      rec.guard,
      rec.decision,
      clampText(rec.reason),
      rec.messageId ?? null,
      rec.batchId ?? null,
      rec.recipientHash ?? null,
      clampJson(rec.metrics),
      clampJson(rec.threshold),
      rec.preset ?? null,
    );
    maybePrune();
  } catch (err) {
    // Sengaja tidak memakai console.error berulang: kalau tabel belum ada
    // (mis. DB lama sebelum migrasi), satu baris per pengiriman sudah cukup
    // berisik. Pesan menyebut penyebab paling mungkin.
    console.warn('[antiban:decision-log] Gagal mencatat keputusan guard:', (err as Error)?.message || err);
  }
}

/**
 * Retensi: buang keputusan yang lebih tua dari `keepDays`.
 *
 * Tabel ini bertambah pada SETIAP evaluasi guard — kira-kira 4-6 baris per
 * pesan. Tanpa batas, satu blast 5.000 pesan menyisipkan ~25.000 baris, dan
 * dalam hitungan minggu tabelnya melebihi `messages` itu sendiri. Karena itu
 * pemangkasan dilakukan dari dalam modul ini, bukan menunggu cron: audit yang
 * menenggelamkan DB justru menjadi masalah baru.
 *
 * Dijalankan tiap 500 penyisipan (bukan tiap kali) supaya biayanya teramortisasi.
 */
const PRUNE_EVERY = 500;
const KEEP_DAYS = 30;
let insertCounter = 0;

function maybePrune(): void {
  insertCounter++;
  if (insertCounter % PRUNE_EVERY !== 0) return;
  pruneDecisions(KEEP_DAYS);
}

/** Hapus keputusan lebih tua dari `keepDays`. Mengembalikan jumlah baris terhapus. */
export function pruneDecisions(keepDays = KEEP_DAYS): number {
  try {
    const days = Math.max(1, Math.min(Math.floor(keepDays), 3650));
    const res = db.prepare(
      `DELETE FROM antiban_decisions WHERE created_at < datetime('now', ?)`,
    ).run(`-${days} days`);
    return Number(res.changes ?? 0);
  } catch (err) {
    console.warn('[antiban:decision-log] Gagal memangkas keputusan lama:', (err as Error)?.message || err);
    return 0;
  }
}

/**
 * Jalankan `fn` dan catat keputusannya dalam satu langkah.
 *
 * Dipakai supaya pemanggil tidak perlu menulis dua kali (evaluate + record)
 * dan supaya 'allow' tetap tercatat — kesalahan paling mudah terjadi kalau
 * pencatatan hanya ditulis di cabang blokir.
 */
export function evaluateGuard<T extends { allowed: boolean; reason?: string }>(
  base: Omit<DecisionRecord, 'decision' | 'reason'>,
  fn: () => T,
  extra?: { metrics?: Record<string, unknown>; threshold?: Record<string, unknown>; allowReason?: string },
): T {
  const result = fn();
  recordGuardDecision({
    ...base,
    decision: result.allowed ? 'allow' : 'block',
    reason: result.allowed ? (extra?.allowReason ?? null) : (result.reason ?? null),
    metrics: extra?.metrics ?? null,
    threshold: extra?.threshold ?? null,
  });
  return result;
}

/** Ringkasan jumlah keputusan per guard — dipakai endpoint audit & probe. */
export function summarizeDecisions(params: {
  sessionId?: string;
  sinceHours?: number;
}): { guard: string; decision: string; n: number }[] {
  const sinceHours = Math.max(1, Math.min(params.sinceHours ?? 24, 24 * 90));
  const since = `-${sinceHours} hours`;
  const rows = params.sessionId
    ? db.prepare(`
        SELECT guard, decision, COUNT(*) AS n
        FROM antiban_decisions
        WHERE session_id = ? AND created_at >= datetime('now', ?)
        GROUP BY guard, decision ORDER BY guard, decision
      `).all(params.sessionId, since)
    : db.prepare(`
        SELECT guard, decision, COUNT(*) AS n
        FROM antiban_decisions
        WHERE created_at >= datetime('now', ?)
        GROUP BY guard, decision ORDER BY guard, decision
      `).all(since);
  return rows as { guard: string; decision: string; n: number }[];
}

export interface DecisionRow {
  id: string;
  session_id: string;
  guard: string;
  decision: string;
  reason: string | null;
  message_id: string | null;
  batch_id: string | null;
  recipient_hash: string | null;
  metrics: string | null;
  threshold: string | null;
  preset: string | null;
  created_at: string;
}

/** Daftar keputusan terbaru dengan filter opsional. Read-only. */
export function listDecisions(params: {
  sessionId?: string;
  guard?: string;
  decision?: string;
  batchId?: string;
  limit?: number;
  offset?: number;
}): { rows: DecisionRow[]; total: number } {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (params.sessionId) { where.push('session_id = ?'); args.push(params.sessionId); }
  if (params.guard) { where.push('guard = ?'); args.push(params.guard); }
  if (params.decision) { where.push('decision = ?'); args.push(params.decision); }
  if (params.batchId) { where.push('batch_id = ?'); args.push(params.batchId); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
  const offset = Math.max(0, params.offset ?? 0);

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM antiban_decisions ${clause}`).get(...args) as { n: number }).n;
  const rows = db.prepare(`
    SELECT * FROM antiban_decisions ${clause}
    ORDER BY created_at DESC, rowid DESC
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset);
  // `node:sqlite` mengetik hasil query sebagai Record<string, SQLOutputValue>,
  // bukan bentuk baris yang kita tahu. Cast lewat `unknown` karena TypeScript
  // benar menolak cast langsung (tidak ada irisan tipe yang cukup).
  return { rows: rows as unknown as DecisionRow[], total };
}
