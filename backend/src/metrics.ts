/**
 * Metrik kesehatan pengiriman per sesi — dasar untuk monitoring report-rate (#8)
 * dan pengukuran baseline (#9).
 *
 * Tujuan: sistem sebelumnya hanya mengukur proksi (jitter, timelock, reply ratio)
 * tetapi tidak pernah mengukur sinyal yang benar-benar menentukan reputasi nomor:
 * berapa penerima yang mem-block nomor, dan berapa error resmi dari WhatsApp
 * (463 reachout timelock, 429 rate overlimit, not_registered).
 *
 * Semua penghitungan disimpan per sesi dan dapat diambil sebagai laju per 100
 * pesan terkirim, sehingga perbandingan antar-periode (baseline vs sesudah
 * perubahan) bisa dilakukan dengan angka nyata, bukan asumsi.
 */

export type DeliveryErrorType = 'err_463' | 'err_429' | 'err_not_registered' | 'err_other';

export interface SessionMetricsSnapshot {
  sessionId: string;
  /** Total pesan yang berhasil dikirim (diterima gateway WA). */
  sent: number;
  /** Error 463 — reachout timelock. */
  err463: number;
  /** Error 429 — rate overlimit. */
  err429: number;
  /** Nomor tujuan tidak terdaftar di WhatsApp. */
  errNotRegistered: number;
  /** Error lain (disconnect, media gagal, dsb). */
  errOther: number;
  /** Jumlah kontak yang mem-block nomor ini (dari fetchBlocklist). */
  blockedContacts: number;
  /** Kapan snapshot terakhir diperbarui. */
  updatedAt: string;
}

export interface MetricRate {
  /** Jumlah kejadian. */
  count: number;
  /** Laju per 100 pesan terkirim. null bila belum ada pesan terkirim. */
  per100: number | null;
}

export interface SessionMetricsReport extends SessionMetricsSnapshot {
  totalErrors: number;
  rates: {
    err463: MetricRate;
    err429: MetricRate;
    errNotRegistered: MetricRate;
    errOther: MetricRate;
    blockedContacts: MetricRate;
  };
  /** Penilaian kasar kesehatan nomor berdasarkan laju error resmi. */
  health: 'sehat' | 'perhatian' | 'berisiko' | 'belum-ada-data';
}

/** Ambang penilaian — dipakai untuk health indicator, bukan untuk memblokir kirim. */
const THRESHOLD_ATTENTION_PER100 = 2;   // >= 2% pesan error resmi → perhatian
const THRESHOLD_RISK_PER100 = 5;        // >= 5% pesan error resmi → berisiko

export class DeliveryMetrics {
  private data = new Map<string, SessionMetricsSnapshot>();

  private ensure(sessionId: string): SessionMetricsSnapshot {
    let s = this.data.get(sessionId);
    if (!s) {
      s = {
        sessionId,
        sent: 0,
        err463: 0,
        err429: 0,
        errNotRegistered: 0,
        errOther: 0,
        blockedContacts: 0,
        updatedAt: new Date().toISOString(),
      };
      this.data.set(sessionId, s);
    }
    return s;
  }

  /** Catat satu pesan berhasil terkirim. */
  recordSent(sessionId: string): void {
    const s = this.ensure(sessionId);
    s.sent += 1;
    s.updatedAt = new Date().toISOString();
  }

  /**
   * Catat error pengiriman. Menerima pesan error mentah dari WhatsApp dan
   * mengklasifikasikannya sendiri agar pemanggil tidak perlu tahu detail.
   */
  recordError(sessionId: string, rawError: string): DeliveryErrorType {
    const s = this.ensure(sessionId);
    const type = classifyError(rawError);
    if (type === 'err_463') s.err463 += 1;
    else if (type === 'err_429') s.err429 += 1;
    else if (type === 'err_not_registered') s.errNotRegistered += 1;
    else s.errOther += 1;
    s.updatedAt = new Date().toISOString();
    return type;
  }

  /** Perbarui jumlah kontak yang mem-block nomor (hasil fetchBlocklist). */
  setBlockedContacts(sessionId: string, count: number): void {
    const s = this.ensure(sessionId);
    s.blockedContacts = count;
    s.updatedAt = new Date().toISOString();
  }

  /** Naikkan jumlah kontak ter-block (bila engine hanya memberi daftar, bukan angka). */
  addBlockedContacts(sessionId: string, delta: number): void {
    const s = this.ensure(sessionId);
    s.blockedContacts += delta;
    s.updatedAt = new Date().toISOString();
  }

  getSnapshot(sessionId: string): SessionMetricsSnapshot {
    return { ...this.ensure(sessionId) };
  }

  /** Laporan lengkap dengan laju per 100 pesan dan penilaian kesehatan. */
  getReport(sessionId: string): SessionMetricsReport {
    const s = this.ensure(sessionId);
    const per100 = (n: number): number | null =>
      s.sent === 0 ? null : Math.round((n / s.sent) * 100 * 100) / 100;

    const totalErrors = s.err463 + s.err429 + s.errNotRegistered + s.errOther;
    const officialErrors = s.err463 + s.err429;

    let health: SessionMetricsReport['health'] = 'belum-ada-data';
    if (s.sent > 0) {
      const officialPer100 = (officialErrors / s.sent) * 100;
      if (officialPer100 >= THRESHOLD_RISK_PER100) health = 'berisiko';
      else if (officialPer100 >= THRESHOLD_ATTENTION_PER100) health = 'perhatian';
      else health = 'sehat';
    }

    return {
      ...s,
      totalErrors,
      rates: {
        err463: { count: s.err463, per100: per100(s.err463) },
        err429: { count: s.err429, per100: per100(s.err429) },
        errNotRegistered: { count: s.errNotRegistered, per100: per100(s.errNotRegistered) },
        errOther: { count: s.errOther, per100: per100(s.errOther) },
        blockedContacts: { count: s.blockedContacts, per100: per100(s.blockedContacts) },
      },
      health,
    };
  }

  /** Laporan semua sesi yang pernah tercatat. */
  getAllReports(): SessionMetricsReport[] {
    return [...this.data.keys()].map((sid) => this.getReport(sid));
  }

  /** Buang sesi yang tidak lagi dipakai (mis. sesi dihapus operator). */
  forget(sessionId: string): void {
    this.data.delete(sessionId);
  }

  exportState(): Record<string, SessionMetricsSnapshot> {
    return Object.fromEntries([...this.data.entries()].map(([k, v]) => [k, { ...v }]));
  }

  importState(state?: Record<string, SessionMetricsSnapshot> | null): void {
    if (!state) return;
    for (const [sid, snap] of Object.entries(state)) {
      if (!snap || typeof snap !== 'object') continue;
      this.data.set(sid, {
        sessionId: sid,
        sent: Number(snap.sent) || 0,
        err463: Number(snap.err463) || 0,
        err429: Number(snap.err429) || 0,
        errNotRegistered: Number(snap.errNotRegistered) || 0,
        errOther: Number(snap.errOther) || 0,
        blockedContacts: Number(snap.blockedContacts) || 0,
        updatedAt: snap.updatedAt || new Date().toISOString(),
      });
    }
  }
}

/** Klasifikasi pesan error WhatsApp ke tipe metrik. */
export function classifyError(rawError: string): DeliveryErrorType {
  const e = (rawError || '').toLowerCase();
  if (/463|reachout|timelock|restricted/.test(e)) return 'err_463';
  if (/429|rate.?overlimit|too many|slow down/.test(e)) return 'err_429';
  if (/not.?registered|not.?on.?whatsapp|invalid.?number|no.?account/.test(e)) return 'err_not_registered';
  return 'err_other';
}
