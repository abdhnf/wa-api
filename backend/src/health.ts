/**
 * Health Monitor — deteksi dini tanda-tanda peringatan ban, per session.
 *
 * Skor 0-100 berbasis event dengan peluruhan waktu. Sumber event diambil dari
 * yang SUDAH ada di wa-api: deteksi 463 di BaileysEngine, handler disconnect,
 * dan updateMessageStatus(..., 'failed').
 *
 * Arsitektur terinspirasi baileys-antiban (kobie3717, MIT), dengan dua koreksi
 * yang disengaja terhadap versi aslinya:
 *
 *  1. Ambang disconnect warning (3) dan critical (5) diberi bobot BERBEDA.
 *     Di versi asli keduanya sama-sama +30, sehingga naik dari 3 ke 5 tidak
 *     menambah skor sama sekali.
 *
 *  2. recordMessageFailed() TIDAK melembutkan peluruhan. Di versi asli, satu
 *     pesan gagal setelah 403 menurunkan status "severe" dan justru membuat
 *     skor meluruh lebih cepat — efeknya meredam peringatan serius.
 *
 *  3. Logged out (401) diberi bobot 85, bukan 60. Di versi asli, 1x logged out
 *     (skor 60) terbaca lebih ringan daripada 2x 403 (skor 80), padahal logged
 *     out berarti WhatsApp sudah mengeluarkan sesi — pengiriman mustahil dan
 *     rekomendasi "turunkan laju kirim" jadi tidak bermakna. Bobot 85 memastikan
 *     logged out langsung masuk level critical.
 *
 * Default autoPauseAt di sini 'critical', bukan 'high'. Auto-pause di gateway
 * blast bisa menghentikan kampanye sah tanpa disadari, jadi default-nya alert
 * dulu, bukan stop.
 */

export type BanRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type HealthEventType =
  | 'disconnect'
  | 'forbidden'
  | 'loggedOut'
  | 'messageFailed'
  | 'reconnect'
  | 'reachoutTimelocked';

export interface HealthStatus {
  risk: BanRiskLevel;
  score: number;
  reasons: string[];
  recommendation: string;
  stats: {
    disconnectsLastHour: number;
    failedMessagesLastHour: number;
    forbiddenErrors: number;
    timelockErrors: number;
    uptimeMs: number;
    lastDisconnectReason?: string;
  };
}

export interface HealthMonitorConfig {
  disconnectWarningThreshold: number;
  disconnectCriticalThreshold: number;
  failedMessageThreshold: number;
  onRiskChange?: (status: HealthStatus) => void;
  autoPauseAt: BanRiskLevel;
  /** Jendela retensi event di memori (ms). Default 6 jam. */
  retentionMs?: number;
}

interface HealthEvent {
  type: HealthEventType;
  timestamp: number;
  detail?: string;
}

export const DEFAULT_HEALTH_CONFIG: HealthMonitorConfig = {
  disconnectWarningThreshold: 3,
  disconnectCriticalThreshold: 5,
  failedMessageThreshold: 5,
  autoPauseAt: 'critical',
  retentionMs: 21_600_000,
};

const RISK_ORDER: BanRiskLevel[] = ['low', 'medium', 'high', 'critical'];

export class HealthMonitor {
  private config: HealthMonitorConfig;
  private events: HealthEvent[] = [];
  private startTime = Date.now();
  private paused = false;
  private lastRisk: BanRiskLevel = 'low';
  private lastBadEventTime = Date.now();
  private lastEventWasSevere = false;
  /** Skor awal dari DB (rehydrate). Meluruh sama seperti peringatan asli. */
  private seededScore = 0;
  private seededAt = 0;

  constructor(config: Partial<HealthMonitorConfig> = {}) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  recordDisconnect(reason: string | number): void {
    const reasonStr = String(reason);
    if (reasonStr === '403' || reasonStr.toLowerCase() === 'forbidden') {
      this.push({ type: 'forbidden', timestamp: Date.now(), detail: reasonStr }, true);
    } else if (reasonStr === '401' || reasonStr.toLowerCase() === 'loggedout') {
      this.push({ type: 'loggedOut', timestamp: Date.now(), detail: reasonStr }, true);
    } else {
      this.push({ type: 'disconnect', timestamp: Date.now(), detail: reasonStr }, false);
    }
    this.checkAndNotify();
  }

  recordReconnect(): void {
    this.events.push({ type: 'reconnect', timestamp: Date.now() });
  }

  recordMessageFailed(error?: string): void {
    // Sengaja TIDAK mengubah lastEventWasSevere — lihat catatan di header.
    this.events.push({ type: 'messageFailed', timestamp: Date.now(), detail: error });
    this.lastBadEventTime = Date.now();
    this.checkAndNotify();
  }

  recordReachoutTimelock(detail?: string): void {
    this.events.push({ type: 'reachoutTimelocked', timestamp: Date.now(), detail });
    this.lastBadEventTime = Date.now();
    this.checkAndNotify();
  }

  /**
   * Tanam skor awal dari nilai yang tersimpan di DB.
   * Dipakai saat rehydrate setelah restart: tanpa ini, skor risiko kembali 0
   * tiap proses dijalankan ulang, dan riwayat peringatan hilang.
   *
   * Disimpan sebagai baseline terpisah, bukan sebagai event palsu — supaya
   * tidak mengacaukan hitungan statistik per-jam (disconnectsLastHour dsb).
   * Baseline ikut meluruh dengan laju severe (2 poin/menit), sama seperti
   * peringatan asli.
   */
  seedScore(score: number): void {
    if (!Number.isFinite(score) || score <= 0) return;
    this.seededScore = Math.max(0, Math.min(100, score));
    this.seededAt = Date.now();
  }

  getStatus(): HealthStatus {
    const now = Date.now();
    this.cleanup(now);

    const hour = this.events.filter(e => now - e.timestamp < 3_600_000);
    const disconnects = hour.filter(e => e.type === 'disconnect').length;
    const forbidden = hour.filter(e => e.type === 'forbidden').length;
    const loggedOut = hour.filter(e => e.type === 'loggedOut').length;
    const failedMessages = hour.filter(e => e.type === 'messageFailed').length;
    const timelocked = hour.filter(e => e.type === 'reachoutTimelocked').length;

    let score = 0;
    const reasons: string[] = [];

    if (forbidden > 0) {
      score += 40 * forbidden;
      reasons.push(`${forbidden} error forbidden (403) dalam 1 jam terakhir`);
    }
    if (loggedOut > 0) {
      score += 85;
      reasons.push('Logged out oleh WhatsApp — sesi dikeluarkan, pengiriman mustahil');
    }
    if (timelocked > 0) {
      score += 25;
      reasons.push(`${timelocked} reachout timelock (463) dalam 1 jam terakhir`);
    }

    // Koreksi #1: bobot warning vs critical dibedakan.
    if (disconnects >= this.config.disconnectCriticalThreshold) {
      score += 45;
      reasons.push(`${disconnects} disconnect dalam 1 jam (di atas ambang kritis)`);
    } else if (disconnects >= this.config.disconnectWarningThreshold) {
      score += 25;
      reasons.push(`${disconnects} disconnect dalam 1 jam`);
    }

    if (failedMessages >= this.config.failedMessageThreshold) {
      score += 20;
      reasons.push(`${failedMessages} pesan gagal dalam 1 jam terakhir`);
    }

    score = Math.min(100, score);

    // Peluruhan: severe 2 poin/menit, normal 5 poin/menit.
    const minutesSinceLastBad = (now - this.lastBadEventTime) / 60_000;
    const decayRate = this.lastEventWasSevere ? 2 : 5;
    score = Math.max(0, score - Math.floor(minutesSinceLastBad * decayRate));

    // Baseline dari DB (kalau ada) digabung sebagai nilai lantai, bukan penambah:
    // memakai Math.max mencegah skor lama yang belum luruh menumpuk dengan
    // event baru dan menghasilkan angka di atas 100.
    if (this.seededScore > 0) {
      const seededAgeMin = (now - this.seededAt) / 60_000;
      const seededNow = Math.max(0, this.seededScore - Math.floor(seededAgeMin * 2));
      if (seededNow > score) {
        score = seededNow;
        if (reasons.length === 0) {
          reasons.push('Skor risiko terbawa dari pemantauan sebelumnya (belum luruh)');
        }
      }
    }

    let risk: BanRiskLevel;
    if (score >= 80) risk = 'critical';
    else if (score >= 40) risk = 'high';
    else if (score >= 15) risk = 'medium';
    else risk = 'low';

    let recommendation: string;
    switch (risk) {
      case 'critical':
        recommendation = 'HENTIKAN SEMUA PENGIRIMAN. Disconnect dan tunggu 24-48 jam sebelum reconnect.';
        break;
      case 'high':
        recommendation = 'Turunkan laju kirim 80%. Pertimbangkan jeda 1-2 jam.';
        break;
      case 'medium':
        recommendation = 'Turunkan laju kirim 50%. Perbesar jeda antar pesan.';
        break;
      default:
        recommendation = 'Berjalan normal. Lanjutkan pemantauan.';
    }

    const lastDisconnect = [...this.events]
      .reverse()
      .find(e => e.type === 'disconnect' || e.type === 'forbidden' || e.type === 'loggedOut');

    return {
      risk,
      score,
      reasons: reasons.length ? reasons : ['Tidak ada masalah terdeteksi'],
      recommendation,
      stats: {
        disconnectsLastHour: disconnects,
        failedMessagesLastHour: failedMessages,
        forbiddenErrors: forbidden,
        timelockErrors: timelocked,
        uptimeMs: now - this.startTime,
        lastDisconnectReason: lastDisconnect?.detail,
      },
    };
  }

  isPaused(): boolean {
    if (this.paused) return true;
    const status = this.getStatus();
    return RISK_ORDER.indexOf(status.risk) >= RISK_ORDER.indexOf(this.config.autoPauseAt);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isManuallyPaused(): boolean {
    return this.paused;
  }

  exportState(): { events: HealthEvent[]; startTime: number; paused: boolean } {
    return { events: this.events, startTime: this.startTime, paused: this.paused };
  }

  importState(state: { events?: HealthEvent[]; startTime?: number; paused?: boolean } | null): void {
    if (!state) return;
    if (Array.isArray(state.events)) this.events = state.events;
    if (typeof state.startTime === 'number') this.startTime = state.startTime;
    if (typeof state.paused === 'boolean') this.paused = state.paused;
  }

  reset(): void {
    this.events = [];
    this.startTime = Date.now();
    this.paused = false;
    this.lastRisk = 'low';
    this.lastBadEventTime = Date.now();
    this.lastEventWasSevere = false;
  }

  private push(e: HealthEvent, severe: boolean): void {
    this.events.push(e);
    this.lastBadEventTime = Date.now();
    this.lastEventWasSevere = severe;
  }

  private cleanup(now: number): void {
    const retention = this.config.retentionMs ?? 21_600_000;
    this.events = this.events.filter(e => now - e.timestamp < retention);
  }

  private checkAndNotify(): void {
    const status = this.getStatus();
    if (status.risk !== this.lastRisk) {
      this.lastRisk = status.risk;
      this.config.onRiskChange?.(status);
    }
  }
}
