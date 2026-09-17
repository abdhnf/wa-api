
export function validatePhoneFormat(phone: string): { valid: boolean; normalized: string; reason?: string } {
  if (!phone) return { valid: false, normalized: '', reason: 'Nomor telepon tujuan kosong' };
  let clean = phone.replace(/\D/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.slice(1);
  }
  if (clean.length < 10 || clean.length > 16) {
    return { valid: false, normalized: clean, reason: `Panjang nomor tidak valid (${clean.length} digit, syarat: 10-16 digit)` };
  }
  return { valid: true, normalized: clean };
}

import { config } from './config.js';
import { upsertSession, insertMessage, updateMessageStatus, getMessageById, listSessions as dbListSessions, getAntiBanState, saveAntiBanState, getSessionAntiBanSettings, saveSessionAntiBanSettings, getSetting, getUserSetting, getLastSessionForRecipient, resetStuckMessages, getPendingMessages, updateSessionProfile, loadQueuePauseState, saveQueuePauseState } from './db.js';
import { RateLimiter, WarmUp, TimelockGuard, PresenceChoreographer, ReconnectThrottle, BanRecoveryOrchestrator, ReplyRatioGuard, ContactGraphWarmer, DEFAULT_ANTIBAN_CONFIG, DEFAULT_CONTACT_GRAPH_CONFIG, ANTIBAN_PRESETS, type AntiBanPreset, type AntiBanState } from './antiban.js';
import type { OutboundMessage, SessionInfo, QueueSessionStatus } from './types.js';
import type { WhatsAppEngine } from './engine/WhatsAppEngine.js';
import { DeliveryMetrics, type SessionMetricsReport } from './metrics.js';

/**
 * SessionManager: orchestrator tiap session WhatsApp.
 * - Queue per session (FIFO) + anti-ban engine (RateLimiter, WarmUp, TimelockGuard, PresenceChoreographer)
 * - State anti-ban persist ke SQLite per session
 */
export class SessionManager {
  private engine: WhatsAppEngine;
  private priorityQueues = new Map<string, OutboundMessage[]>();
  private normalQueues = new Map<string, OutboundMessage[]>();
  private pausedSessions = new Map<string, { isPaused: boolean; reason?: string }>();
  private pausedBatches = new Map<string, { isPaused: boolean; reason?: string }>();
  private lastServedBatchPerSession = new Map<string, string>();
  /** Timer auto-resume per sesi: antrean yang dijeda otomatis dibuka lagi saat blokir lewat. */
  private autoResumeTimers = new Map<string, NodeJS.Timeout>();
  private autoResumeWaitMs = new Map<string, number>();
  private processing = new Set<string>();
  private antiban = new Map<string, {
    rateLimiter: RateLimiter;
    warmup: WarmUp;
    timelock: TimelockGuard;
    presence: PresenceChoreographer;
    reconnect: ReconnectThrottle;
    recovery: BanRecoveryOrchestrator;
    replyRatio: ReplyRatioGuard;
    contactGraph: ContactGraphWarmer;
  }>();

  constructor(engine: WhatsAppEngine) {
    this.engine = engine;
  }

  /** Load / init anti-ban state per session dari SQLite */
  private getAntiBan(sessionId: string) {
    let ab = this.antiban.get(sessionId);
    if (ab) return ab;

    let cfg = { ...DEFAULT_ANTIBAN_CONFIG, ...config.antiBan };
    const sessionSettings = getSessionAntiBanSettings(sessionId);
    const activePreset = ANTIBAN_PRESETS[sessionSettings.preset] || ANTIBAN_PRESETS.balanced;

    // Cek profil nomor dari database
    const dbSession = dbListSessions().find((s: SessionInfo) => s.id === sessionId);
    const isMature = dbSession ? dbSession.numberProfile !== 'fresh' : true;

    if (activePreset && activePreset.rateLimiter) {
      cfg = { ...cfg, ...activePreset.rateLimiter };
    }
    if (sessionSettings.config?.rateLimiter) {
      cfg = { ...cfg, ...sessionSettings.config.rateLimiter };
    }

    let state: AntiBanState | null = null;
    try {
      const raw = getAntiBanState(sessionId);
      if (raw) state = JSON.parse(raw) as AntiBanState;
    } catch (e) {
      console.warn(`[session:${sessionId}] antiban_state korup, reset:`, e);
    }

    // Preset + override custom untuk contact graph. Sebelumnya guard ini selalu
    // menerima `cfg` (AntiBanConfig) yang tidak punya field contactGraph sama
    // sekali, sehingga isinya selalu jatuh ke default dan perubahan dibuang.
    let contactGraphConfig = activePreset?.contactGraph || {};
    if (sessionSettings.config?.contactGraph) {
      contactGraphConfig = { ...contactGraphConfig, ...sessionSettings.config.contactGraph };
    }

    let replyRatioConfig = activePreset ? activePreset.replyRatio : {};
    if (sessionSettings.config?.replyRatio) {
      replyRatioConfig = { ...replyRatioConfig, ...sessionSettings.config.replyRatio };
    }

    ab = {
      rateLimiter: new RateLimiter(cfg),
      warmup: new WarmUp(cfg, state?.warmup, isMature),
      timelock: new TimelockGuard(cfg, state?.timelock),
      presence: new PresenceChoreographer(cfg),
      reconnect: new ReconnectThrottle(cfg),
      recovery: new BanRecoveryOrchestrator(cfg),
      replyRatio: new ReplyRatioGuard(replyRatioConfig),
      contactGraph: new ContactGraphWarmer(contactGraphConfig),
    };
    if (state?.rateLimiter) {
      // restore sliding window & known chats
      try {
        ab.rateLimiter.restore(state.rateLimiter);
      } catch {}
    }
    if (state?.reconnect) {
      try { ab.reconnect.restoreState(state.reconnect); } catch {}
    }
    if (state?.recovery) {
      try { ab.recovery.restoreState(state.recovery); } catch {}
    }
    if (state?.replyRatio) {
      try { ab.replyRatio.restoreState(state.replyRatio); } catch {}
    }
    if (state?.contactGraph) {
      try { ab.contactGraph.restoreState(state.contactGraph); } catch {}
    }
    this.antiban.set(sessionId, ab);
    return ab;
  }

  private persistAntiBan(sessionId: string): void {
    const ab = this.antiban.get(sessionId);
    if (!ab) return;
    const state: AntiBanState = {
      warmup: ab.warmup.exportState(),
      rateLimiter: ab.rateLimiter.exportState(),
      timelock: ab.timelock.getState(),
      reconnect: ab.reconnect.exportState(),
      recovery: ab.recovery.exportState(),
      replyRatio: ab.replyRatio.exportState(),
      contactGraph: ab.contactGraph.exportState(),
    };
    try {
      saveAntiBanState(sessionId, JSON.stringify(state));
    } catch (e) {
      console.warn(`[session:${sessionId}] Gagal persist antiban state:`, e);
    }
  }

  async retryMessage(messageId: string): Promise<OutboundMessage> {
    const raw = getMessageById(messageId);
    if (!raw) throw new Error('Pesan tidak ditemukan');

    // Kembalikan status menjadi pending, hapus error lama, dan enqueue kembali
    const refreshed: OutboundMessage = {
      ...raw,
      status: 'queued',
      errorDetail: undefined,
      timestamp: new Date().toISOString(),
      jitterDelayMs: 0,
    };
    updateMessageStatus(messageId, 'queued', '', 0);

    const q = refreshed.priority === 'high' ? this.priorityQueues : this.normalQueues;
    if (!q.has(refreshed.sessionId)) q.set(refreshed.sessionId, []);
    q.get(refreshed.sessionId)!.push(refreshed);

    void this.processQueue(refreshed.sessionId);
    return refreshed;
  }
  async enqueue(msg: Omit<OutboundMessage, 'id' | 'status' | 'jitterDelayMs' | 'timestamp'>): Promise<OutboundMessage> {
    const priority = msg.priority === 'high' ? 'high' : 'normal';
    const full: OutboundMessage = {
      ...msg,
      id: `msg_${crypto.randomUUID().slice(0, 12)}`,
      status: 'queued',
      priority,
      jitterDelayMs: 0,
      timestamp: new Date().toISOString(),
    };
    insertMessage(full);

    if (priority === 'high') {
      if (!this.priorityQueues.has(full.sessionId)) this.priorityQueues.set(full.sessionId, []);
      this.priorityQueues.get(full.sessionId)!.push(full);
      console.log(`[session:${full.sessionId}] 🚀 Pesan Priority (High) masuk ke Antrean Prioritas: ${full.id}`);
    } else {
      if (!this.normalQueues.has(full.sessionId)) this.normalQueues.set(full.sessionId, []);
      this.normalQueues.get(full.sessionId)!.push(full);
    }

    void this.processQueue(full.sessionId);
    return full;
  }

  /** Memulihkan pesan 'pending' dari SQLite ke antrean memori saat startup / restart */
  async recoverPendingMessages(): Promise<number> {
    // Pulihkan status jeda lebih dulu supaya antrean yang sengaja dijeda
    // tidak langsung tumpah keluar sebelum operator sempat memeriksanya.
    this.restoreQueuePauseState();

    const resetCount = resetStuckMessages();
    if (resetCount > 0) {
      console.log(`[queue-recovery] Reset ${resetCount} pesan macet ('pacing'/'sending') kembali ke 'pending'`);
    }

    const pending = getPendingMessages();
    if (pending.length === 0) return 0;

    console.log(`[queue-recovery] Memulihkan ${pending.length} pesan pending dari database ke antrean memori...`);
    const sids = new Set<string>();

    for (const msg of pending) {
      sids.add(msg.sessionId);
      if (msg.priority === 'high') {
        if (!this.priorityQueues.has(msg.sessionId)) this.priorityQueues.set(msg.sessionId, []);
        this.priorityQueues.get(msg.sessionId)!.push(msg);
      } else {
        if (!this.normalQueues.has(msg.sessionId)) this.normalQueues.set(msg.sessionId, []);
        this.normalQueues.get(msg.sessionId)!.push(msg);
      }
    }

    for (const sid of sids) {
      void this.processQueue(sid);
    }
    return pending.length;
  }

  /** Simpan status jeda (sesi + batch) ke SQLite agar bertahan melewati restart. */
  private persistQueuePauseState(): void {
    saveQueuePauseState({
      sessions: Object.fromEntries(this.pausedSessions),
      batches: Object.fromEntries(this.pausedBatches),
    });
  }

  /**
   * Pulihkan status jeda dari SQLite. Dipanggil saat startup bersama
   * recoverPendingMessages() agar jeda yang diset operator tidak hilang
   * ketika service di-restart.
   */
  restoreQueuePauseState(): number {
    const state = loadQueuePauseState();
    let restored = 0;
    for (const [sid, v] of Object.entries(state.sessions)) {
      if (v?.isPaused) {
        this.pausedSessions.set(sid, { isPaused: true, reason: v.reason });
        restored++;
      }
    }
    for (const [bid, v] of Object.entries(state.batches)) {
      if (v?.isPaused) {
        this.pausedBatches.set(bid, { isPaused: true, reason: v.reason });
        restored++;
      }
    }
    if (restored > 0) {
      console.log(`[queue-pause] Memulihkan ${restored} status jeda antrean dari database.`);
    }
    return restored;
  }

  /**
   * Kembalikan pesan ke depan antrean normal supaya tidak hilang dan tidak diulang.
   * Dipakai semua jalur guard yang memblokir sementara (rate limit, timelock, dll).
   */
  private holdMessageAtFront(sessionId: string, msg: OutboundMessage): void {
    if (!this.normalQueues.has(sessionId)) this.normalQueues.set(sessionId, []);
    this.normalQueues.get(sessionId)!.unshift(msg);
  }

  /**
   * Jadwalkan pembukaan kembali antrean sesi setelah masa blokir lewat.
   *
   * Tanpa ini, `pauseQueue()` bersifat permanen: satu-satunya pemanggil `resumeQueue()`
   * adalah endpoint manual, sehingga antrean berhenti sampai ada manusia yang klik Resume.
   * Itu membuat guard yang "menahan pesan" (bukan membuang) justru memacetkan blast.
   *
   * @param retryInMs sisa waktu blokir; dijepit ke [5s, 1 jam] dan diberi margin 5%.
   */
  private scheduleAutoResume(sessionId: string, retryInMs: number): void {
    const MIN_WAIT = 5_000;
    const MAX_WAIT = 60 * 60 * 1000; // 1 jam
    const raw = Number.isFinite(retryInMs) && retryInMs > 0 ? retryInMs : MIN_WAIT;
    const waitMs = Math.min(MAX_WAIT, Math.max(MIN_WAIT, Math.ceil(raw * 1.05)));

    const existing = this.autoResumeTimers.get(sessionId);
    // Jangan tunda resume yang sudah terjadwal lebih cepat.
    if (existing && this.autoResumeWaitMs.get(sessionId)! <= waitMs) return;
    if (existing) clearTimeout(existing);

    this.autoResumeWaitMs.set(sessionId, waitMs);
    const timer = setTimeout(() => {
      this.autoResumeTimers.delete(sessionId);
      this.autoResumeWaitMs.delete(sessionId);
      const pauseInfo = this.pausedSessions.get(sessionId);
      if (!pauseInfo?.isPaused) return;
      console.log(`[session:${sessionId}] ⏱️ Auto-resume: masa blokir selesai (${Math.round(waitMs / 1000)}s), antrean dilanjutkan.`);
      this.resumeQueue(sessionId);
    }, waitMs);

    // Jangan menahan proses Node tetap hidup hanya karena timer ini.
    if (typeof timer.unref === 'function') timer.unref();
    this.autoResumeTimers.set(sessionId, timer);
    console.log(`[session:${sessionId}] ⏱️ Auto-resume dijadwalkan dalam ${Math.round(waitMs / 1000)}s.`);
  }

  /** Pause antrean normal (blast) per sesi secara manual / otomatis */
  pauseQueue(sessionId: string, reason = 'Dijeda oleh pengguna'): { success: boolean; status: QueueSessionStatus } {
    this.pausedSessions.set(sessionId, { isPaused: true, reason });
    this.persistQueuePauseState();
    console.log(`[session:${sessionId}] ⏸️ Antrean blast di-pause: ${reason}`);
    return { success: true, status: this.getQueueStatus(sessionId) };
  }

  /** Resume antrean blast yang tertahan */
  resumeQueue(sessionId: string): { success: boolean; status: QueueSessionStatus } {
    const timer = this.autoResumeTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.autoResumeTimers.delete(sessionId);
      this.autoResumeWaitMs.delete(sessionId);
    }
    this.pausedSessions.set(sessionId, { isPaused: false, reason: undefined });
    this.persistQueuePauseState();
    console.log(`[session:${sessionId}] ▶️ Antrean blast di-resume`);
    void this.processQueue(sessionId);
    return { success: true, status: this.getQueueStatus(sessionId) };
  }

  /** Pause antrean per batch/kampanye tertentu (tidak mempengaruhi batch lain di sesi yang sama) */
  pauseBatch(batchId: string, reason = 'Kampanye dijeda oleh pengguna'): { success: boolean; batchId: string; isPaused: boolean; reason?: string } {
    this.pausedBatches.set(batchId, { isPaused: true, reason });
    this.persistQueuePauseState();
    console.log(`[batch:${batchId}] ⏸️ Antrean batch di-pause: ${reason}`);
    return { success: true, batchId, isPaused: true, reason };
  }

  /** Resume antrean per batch/kampanye tertentu */
  resumeBatch(batchId: string): { success: boolean; batchId: string; isPaused: boolean } {
    this.pausedBatches.delete(batchId);
    this.persistQueuePauseState();
    console.log(`[batch:${batchId}] ▶️ Antrean batch di-resume`);
    // Picu processQueue pada seluruh sesi yang menyimpan pesan dari batch ini
    for (const [sid, queue] of this.normalQueues.entries()) {
      if (queue.some((m) => m.batchId === batchId)) {
        void this.processQueue(sid);
      }
    }
    return { success: true, batchId, isPaused: false };
  }

  /** Cek apakah sebuah batch sedang dijeda dan berapa sisa antreannya */
  isBatchPaused(batchId?: string): { isPaused: boolean; reason?: string; activeCount: number } {
    if (!batchId) return { isPaused: false, activeCount: 0 };
    const p = this.pausedBatches.get(batchId);
    let activeCount = 0;
    for (const q of this.normalQueues.values()) {
      activeCount += q.filter((m) => m.batchId === batchId).length;
    }
    for (const q of this.priorityQueues.values()) {
      activeCount += q.filter((m) => m.batchId === batchId).length;
    }
    return { isPaused: Boolean(p?.isPaused), reason: p?.reason, activeCount };
  }

  /** Cek status antrean per sesi */
  getQueueStatus(sessionId: string): QueueSessionStatus {
    const pauseInfo = this.pausedSessions.get(sessionId);
    const pendingCount = (this.normalQueues.get(sessionId) || []).length;
    const priorityPendingCount = (this.priorityQueues.get(sessionId) || []).length;
    return {
      sessionId,
      isPaused: Boolean(pauseInfo?.isPaused),
      pauseReason: pauseInfo?.reason,
      pendingCount,
      priorityPendingCount,
      vipPendingCount: priorityPendingCount,
      autoResumeInMs: this.autoResumeWaitMs.get(sessionId) ?? null,
    };
  }

  /** Bersihkan / batalkan antrean normal (blast) per sesi atau spesifik per batchId */
  clearQueue(sessionId: string, reason = 'Dibatalkan oleh pengguna', targetBatchId?: string): { success: boolean; clearedCount: number; batchId?: string } {
    const queue = this.normalQueues.get(sessionId) || [];
    if (targetBatchId) {
      // Hanya batalkan pesan yang cocok dengan batchId ini
      const remaining: OutboundMessage[] = [];
      let cleared = 0;
      for (const msg of queue) {
        if (msg.batchId === targetBatchId) {
          updateMessageStatus(msg.id, 'cancelled', reason);
          cleared++;
        } else {
          remaining.push(msg);
        }
      }
      this.normalQueues.set(sessionId, remaining);
      this.pausedBatches.delete(targetBatchId);
      this.persistQueuePauseState();
      console.log(`[session:${sessionId}][batch:${targetBatchId}] 🛑 Antrean batch dibersihkan (${cleared} pesan dibatalkan, sisa ${remaining.length} pesan di sesi)`);
      return { success: true, clearedCount: cleared, batchId: targetBatchId };
    }

    const count = queue.length;
    for (const msg of queue) {
      updateMessageStatus(msg.id, 'cancelled', reason);
    }
    this.normalQueues.set(sessionId, []);
    this.pausedSessions.delete(sessionId);
    this.persistQueuePauseState();
    console.log(`[session:${sessionId}] 🛑 Seluruh antrean blast sesi dibersihkan (${count} pesan dibatalkan)`);
    return { success: true, clearedCount: count };
  }

  /** Bersihkan / batalkan antrean batch lintas semua sesi yang memprosesnya */
  clearBatch(batchId: string, reason = 'Kampanye dibatalkan oleh pengguna'): { success: boolean; batchId: string; clearedCount: number } {
    let totalCleared = 0;
    for (const [sid, queue] of this.normalQueues.entries()) {
      const remaining: OutboundMessage[] = [];
      for (const msg of queue) {
        if (msg.batchId === batchId) {
          updateMessageStatus(msg.id, 'cancelled', reason);
          totalCleared++;
        } else {
          remaining.push(msg);
        }
      }
      this.normalQueues.set(sid, remaining);
    }
    this.pausedBatches.delete(batchId);
    this.persistQueuePauseState();
    console.log(`[batch:${batchId}] 🛑 Antrean batch dibatalkan lintas seluruh sesi (${totalCleared} pesan dibatalkan)`);
    return { success: true, batchId, clearedCount: totalCleared };
  }

  /** Daftarkan kontak yang pernah chat (dari engine/listSessions) */
  registerKnownChat(sessionId: string, jid: string): void {
    try {
      const ab = this.getAntiBan(sessionId);
      ab.rateLimiter.markKnownChat(jid);
      ab.timelock.registerKnownChat(jid);
    } catch {}
  }

  /** Socket disconnect — beri tahu reconnectThrottle */
  onDisconnect(sessionId: string): void {
    const ab = this.getAntiBan(sessionId);
    ab.reconnect.onDisconnect();
    this.persistAntiBan(sessionId);
  }

  /** Socket reconnect — mulai ramping kecepatan */
  onReconnect(sessionId: string): void {
    const ab = this.getAntiBan(sessionId);
    ab.reconnect.onReconnect();
    this.persistAntiBan(sessionId);
  }

  /** Pesan masuk — catat replyRatio + contactGraph (mereka responsif = sehat) */
  onIncoming(sessionId: string, jid: string): void {
    const ab = this.getAntiBan(sessionId);
    ab.replyRatio.recordReceived(jid);
    ab.contactGraph.recordIncoming(jid);
    this.persistAntiBan(sessionId);
  }

  /** Record error 463 (reachout restricted) → timelock guard & query durasi pasti dari WA */
  async record463(sessionId: string): Promise<void> {
    try {
      const ab = this.getAntiBan(sessionId);
      ab.timelock.record463Error();
      this.persistAntiBan(sessionId);

      // Query langsung durasi sanksi resmi dari WhatsApp server
      if (typeof this.engine.fetchReachoutTimelock === 'function') {
        this.engine.fetchReachoutTimelock(sessionId).then((lockData) => {
          if (lockData) {
            this.handleTimelockUpdate(sessionId, lockData);
          }
        }).catch(() => {});
      }
    } catch {}
  }

  /** Handle update timelock reachout resmi dari server WhatsApp (durasi asli) */
  handleTimelockUpdate(sessionId: string, data: { isActive?: boolean; timeEnforcementEnds?: Date | null; enforcementType?: string }): void {
    try {
      const ab = this.getAntiBan(sessionId);
      ab.timelock.onTimelockUpdate(data);
      if (data.isActive) {
        const timeStr = data.timeEnforcementEnds ? data.timeEnforcementEnds.toLocaleString('id-ID') : 'durasi default';
        console.warn(`[AntiBan] Sesi ${sessionId} terkena timelock 463 resmi WA s/d ${timeStr} (${data.enforcementType || 'DEFAULT'})`);
        ab.recovery.reportError('timelock', `Reachout timelock 463 aktif s/d ${timeStr}`);
      } else {
        console.log(`[AntiBan] Timelock 463 untuk sesi ${sessionId} telah dicabut oleh WhatsApp`);
      }
      this.persistAntiBan(sessionId);
    } catch (err) {
      console.error(`[SessionManager] Gagal update timelock ${sessionId}:`, err);
    }
  }

  /** Ambil status anti-ban session untuk panel */
  
  /** Metrik kesehatan pengiriman per sesi (#8 report-rate & #9 baseline). */
  readonly metrics = new DeliveryMetrics();

  private roundRobinIdx = 0;

  /**
   * Resolver cerdas untuk memilih nomor WA:
   * - Mendukung failover saat limit warm-up, socket disconnect, atau timelock 463.
   * - Mendukung sticky session agar balasan/percakapan tetap konsisten di 1 nomor jika memungkinkan.
   * - Mendukung rotasi 'least_loaded', 'round_robin', dan 'warmup_priority'.
   */
  async resolveSession(
    requestedId: string,
    recipient: string,
    userId?: string,
    userRole?: string
  ): Promise<{ sessionId: string; rotated: boolean; reason?: string }> {
    // Baca setting terisolasi per user (fallback ke global)
    const readCfg = (k: string) => (userId ? getUserSetting(userId, k) : getSetting(k));
    const enabled = readCfg('autorotate_enabled') === 'true';
    const rotateOnLimit = readCfg('autorotate_rotate_on_limit') !== 'false';
    const rotateOnDisconnect = readCfg('autorotate_rotate_on_disconnect') !== 'false';
    const rotateOn463 = readCfg('autorotate_rotate_on_463') !== 'false';
    const stickySession = readCfg('autorotate_sticky_session') !== 'false';
    const strategy = readCfg('autorotate_strategy') || 'least_loaded';

    // Dapatkan daftar sesi terisolasi sesuai hak akses pengguna
    const isAdmin = userRole === 'admin';
    const accessibleSessions = await this.listSessions(isAdmin ? undefined : userId);

    // Proteksi IDOR: Pastikan sesi yang diminta memang milik user yang bersangkutan (jika bukan auto & bukan admin)
    if (requestedId !== 'auto' && !isAdmin && userId) {
      const ownsSession = accessibleSessions.some((s) => s.id === requestedId);
      if (!ownsSession) {
        throw new Error(`Sesi WhatsApp '${requestedId}' tidak ditemukan atau bukan milik akun Anda.`);
      }
    }

    // Helper mengecek kesehatan session untuk pengiriman tertentu
    const checkHealth = (sessId: string) => {
      const sess = accessibleSessions.find((s) => s.id === sessId);
      if (!sess) return { healthy: false, reason: 'Sesi tidak ditemukan di akun Anda' };
      if (sess.status !== 'connected') return { healthy: false, reason: `Status socket ${sess.status}` };

      const ab = this.getAntiBan(sessId);
      const warmupStatus = ab.warmup.getStatus();
      if (warmupStatus.todayLimit !== -1 && warmupStatus.todaySent >= warmupStatus.todayLimit) {
        return { healthy: false, reason: `Batas harian warm-up (${warmupStatus.todaySent}/${warmupStatus.todayLimit}) tercapai` };
      }

      const jid = `${recipient}@s.whatsapp.net`;
      const timelockCheck = ab.timelock.canSend(jid);
      if (!timelockCheck.allowed) {
        return { healthy: false, reason: `Terkena Timelock 463 (${timelockCheck.reason})` };
      }

      return { healthy: true, sess, ab };
    };

    // 1. Jika auto-rotate TIDAK aktif (atau user hanya punya < 2 sesi) dan requestedId bukan 'auto':
    if ((!enabled || accessibleSessions.length < 2) && requestedId !== 'auto') {
      return { sessionId: requestedId, rotated: false };
    }

    // 2. Jika requestedId spesifik, cek apakah sehat
    if (requestedId !== 'auto') {
      const currentHealth = checkHealth(requestedId);
      if (currentHealth.healthy) {
        return { sessionId: requestedId, rotated: false };
      }

      // Cek apakah kondisi trigger failover diizinkan
      const isLimitIssue = currentHealth.reason?.includes('warm-up');
      const isDisconnectIssue = currentHealth.reason?.includes('socket');
      const is463Issue = currentHealth.reason?.includes('Timelock 463');

      let shouldRotate = false;
      if (isLimitIssue && rotateOnLimit) shouldRotate = true;
      if (isDisconnectIssue && rotateOnDisconnect) shouldRotate = true;
      if (is463Issue && rotateOn463) shouldRotate = true;

      if (!shouldRotate || accessibleSessions.length < 2) {
        // Jangan rotate jika trigger tidak diizinkan atau user tidak punya sesi cadangan
        return { sessionId: requestedId, rotated: false };
      }
    }

    // 3. Tentukan kandidat dalam Pool (HANYA DARI SESI MILIK USER TERSEBUT)
    let candidateIds = accessibleSessions.map((s) => s.id);

    // Filter jika ada pool filter yang diset untuk user ini
    let poolIds: string[] = [];
    try {
      const rawPool = readCfg('autorotate_pool_sessions');
      if (rawPool) poolIds = JSON.parse(rawPool);
      if (poolIds.length > 0) {
        candidateIds = candidateIds.filter((id) => poolIds.includes(id));
      }
    } catch {}

    // Jika requestedId ada tapi gagal, jangan sertakan lagi
    if (requestedId !== 'auto') {
      candidateIds = candidateIds.filter((id) => id !== requestedId);
    }

    // 4. Cek Sticky Session jika diaktifkan
    if (stickySession && recipient) {
      const lastSessId = getLastSessionForRecipient(recipient);
      if (lastSessId && candidateIds.includes(lastSessId)) {
        const stickyHealth = checkHealth(lastSessId);
        if (stickyHealth.healthy) {
          return {
            sessionId: lastSessId,
            rotated: lastSessId !== requestedId,
            reason: `Mempertahankan riwayat chat kontak (Sticky Session: ${lastSessId})`,
          };
        }
      }
    }

    // 5. Filter kandidat yang benar-benar sehat
    const healthyCandidates = candidateIds
      .map((id) => ({ id, ...checkHealth(id) }))
      .filter((c) => c.healthy) as Array<{ id: string; healthy: true; sess: SessionInfo; ab: any }>;

    if (healthyCandidates.length === 0) {
      if (requestedId === 'auto') {
        const fallbackId = accessibleSessions.find((s) => s.status === 'connected')?.id || accessibleSessions[0]?.id;
        if (!fallbackId) {
          throw new Error('Tidak ada sesi WhatsApp yang terhubung di akun Anda.');
        }
        return { sessionId: fallbackId, rotated: false, reason: 'Semua sesi di akun Anda sedang limit atau offline' };
      }
      return { sessionId: requestedId, rotated: false, reason: 'Tidak ada nomor cadangan yang sehat di akun Anda' };
    }

    // 6. Pilih berdasarkan Strategi
    let chosenId = healthyCandidates[0].id;

    if (strategy === 'least_loaded') {
      healthyCandidates.sort((a, b) => (a.sess.messagesSentToday || 0) - (b.sess.messagesSentToday || 0));
      chosenId = healthyCandidates[0].id;
    } else if (strategy === 'warmup_priority') {
      healthyCandidates.sort((a, b) => (b.sess.warmupDay || 1) - (a.sess.warmupDay || 1));
      chosenId = healthyCandidates[0].id;
    } else if (strategy === 'round_robin') {
      this.roundRobinIdx = (this.roundRobinIdx + 1) % healthyCandidates.length;
      chosenId = healthyCandidates[this.roundRobinIdx].id;
    }

    const isRotated = chosenId !== requestedId;
    return {
      sessionId: chosenId,
      rotated: isRotated,
      reason: isRotated ? `Auto-rotate aktif (${strategy}) dialihkan ke ${chosenId}` : undefined,
    };
  }

  getAntiBanStatus(sessionId: string) {
    try {
      const ab = this.getAntiBan(sessionId);
      const settings = getSessionAntiBanSettings(sessionId);
      const dbSession = dbListSessions().find((s: SessionInfo) => s.id === sessionId);
      return {
        numberProfile: dbSession?.numberProfile || 'mature',
        preset: settings.preset,
        presets: ANTIBAN_PRESETS,
        currentConfig: {
          rateLimiter: ab.rateLimiter.getConfig(),
          replyRatio: ab.replyRatio.getConfig(),
          contactGraph: ab.contactGraph.getConfig(),
        },
        warmup: ab.warmup.getStatus(),
        rateLimiter: ab.rateLimiter.getStats(),
        timelock: ab.timelock.getState(),
        circadianMultiplier: ab.presence.getCircadianMultiplier(),
        reconnectMultiplier: ab.reconnect.multiplier,
        recovery: ab.recovery.exportState(),
        replyRatio: ab.replyRatio.getStats(),
        contactGraph: {
          ...ab.contactGraph.getStats(),
          batchApprovals: ab.contactGraph.getBatchApprovals(),
        },
      };
    } catch (e) {
      return null;
    }
  }

  /** Daftarkan penerima sebuah kampanye (dipakai dashboard sebelum blast). */
  approveBatchRecipients(sessionId: string, batchId: string, jids: string[]): { added: number; total: number } {
    const ab = this.getAntiBan(sessionId);
    const added = ab.contactGraph.approveBatchRecipients(jids, batchId);
    return { added, total: ab.contactGraph.getBatchRecipients(batchId).length };
  }

  /** Cabut approval: satu nomor pada satu batch, atau seluruh batch. */
  revokeBatchApproval(sessionId: string, batchId: string, jid?: string): { removed: number; total: number } {
    const ab = this.getAntiBan(sessionId);
    const removed = jid
      ? (ab.contactGraph.revokeBatchRecipient(jid, batchId) ? 1 : 0)
      : ab.contactGraph.revokeBatch(batchId);
    return { removed, total: ab.contactGraph.getBatchRecipients(batchId).length };
  }

  /** Status whitelist satu batch (untuk kolom per-nomor di dashboard). */
  getBatchApprovalStatus(sessionId: string, batchId: string): { batchId: string; count: number; recipients: string[] } {
    const ab = this.getAntiBan(sessionId);
    return {
      batchId,
      count: ab.contactGraph.getBatchRecipients(batchId).length,
      recipients: ab.contactGraph.getBatchRecipients(batchId),
    };
  }

  updateAntiBanSettings(sessionId: string, preset: string, customConfig?: any) {
    saveSessionAntiBanSettings(sessionId, preset, customConfig || null);
    // Reload / re-apply ke memory
    const ab = this.getAntiBan(sessionId);
    const targetPreset = ANTIBAN_PRESETS[preset] || ANTIBAN_PRESETS.balanced;

    let mergedRateLimiter = { ...DEFAULT_ANTIBAN_CONFIG, ...config.antiBan };
    if (targetPreset && targetPreset.rateLimiter) {
      mergedRateLimiter = { ...mergedRateLimiter, ...targetPreset.rateLimiter };
    }
    if (customConfig?.rateLimiter) {
      mergedRateLimiter = { ...mergedRateLimiter, ...customConfig.rateLimiter };
    }
    ab.rateLimiter.updateConfig(mergedRateLimiter);

    let mergedReplyRatio = targetPreset ? { ...targetPreset.replyRatio } : {};
    if (customConfig?.replyRatio) {
      mergedReplyRatio = { ...mergedReplyRatio, ...customConfig.replyRatio };
    }
    ab.replyRatio.updateConfig(mergedReplyRatio);

    // Terapkan contact graph agar perubahan preset benar-benar sampai ke guard.
    // Tanpa ini, memilih preset 'broadcast' tidak akan mematikan handshake dan
    // memilih 'strict' tidak akan menyalakannya.
    let mergedContactGraph = {
      ...DEFAULT_CONTACT_GRAPH_CONFIG,
      ...(targetPreset?.contactGraph || {}),
    };
    if (customConfig?.contactGraph) {
      mergedContactGraph = { ...mergedContactGraph, ...customConfig.contactGraph };
    }
    ab.contactGraph.updateConfig(mergedContactGraph);

    // Jika preset broadcast atau dinonaktifkan, bersihkan cooldown lama yang tersangkut
    if (preset === 'broadcast' || mergedReplyRatio.enabled === false) {
      ab.replyRatio.resetCooldown();
      this.persistAntiBan(sessionId);
    }

    return this.getAntiBanStatus(sessionId);
  }

  resetReplyRatioCooldown(sessionId: string, jid?: string) {
    const ab = this.getAntiBan(sessionId);
    ab.replyRatio.resetCooldown(jid);
    this.persistAntiBan(sessionId);
    return ab.replyRatio.getStats();
  }

  // Map untuk melacak kegagalan beruntun (Circuit Breaker)
  private consecutiveFailures = new Map<string, number>();

  private async processQueue(sessionId: string) {
    if (this.processing.has(sessionId)) return;
    this.processing.add(sessionId);

    try {
      const ab = this.getAntiBan(sessionId);

      while (true) {
        // Cek status koneksi session sebelum mengirim
        let isConnected = true;
        try {
          const sInfo = await this.engine.getSessionInfo(sessionId);
          if (sInfo && sInfo.status !== 'connected') {
            isConnected = false;
          }
        } catch {}

        if (!isConnected) {
          console.warn(`[session:${sessionId}] Sesi belum terhubung (status offline/disconnected). Antrean ditahan sementara.`);
          break;
        }

        // 1. Prioritaskan pesan Priority (High) terlebih dahulu
        let msg: OutboundMessage | undefined;
        let isHighPriority = false;

        const priorityQueue = this.priorityQueues.get(sessionId);
        if (priorityQueue && priorityQueue.length > 0) {
          msg = priorityQueue.shift();
          isHighPriority = true;
        } else {
          // 2. Jika tidak ada pesan Priority, ambil dari antrean blast reguler
          const normalQueue = this.normalQueues.get(sessionId);
          if (!normalQueue || normalQueue.length === 0) {
            break; // Kedua antrean kosong, selesai!
          }

          // Cek apakah antrean normal sedang di-pause per sesi
          const pauseInfo = this.pausedSessions.get(sessionId);
          if (pauseInfo?.isPaused) {
            console.log(`[session:${sessionId}] ⏸️ Antrean blast sedang dijeda (${pauseInfo.reason}). Menunggu resume.`);
            break; // Keluar loop, pesan tetap tersimpan di normalQueue
          }

          // Fair-Queueing / Interleaving per-batch:
          // Agar kampanye baru tidak tertahan berjam-jam di belakang kampanye besar yang sedang berjalan.
          const candidateIndices: number[] = [];
          for (let i = 0; i < normalQueue.length; i++) {
            const bId = normalQueue[i].batchId;
            if (!bId || !this.pausedBatches.get(bId)?.isPaused) {
              candidateIndices.push(i);
            }
          }

          if (candidateIndices.length === 0) {
            // Semua pesan yang tersisa di antrean normal saat ini sedang dalam batch yang di-pause!
            console.log(`[session:${sessionId}] ⏸️ Seluruh pesan tersisa di antrean (${normalQueue.length}) berasal dari batch yang sedang dijeda. Menunggu resume batch.`);
            break;
          }

          // Kumpulkan batchId unik dari pesan-pesan yang aktif
          const activeBatches = Array.from(new Set(candidateIndices.map((i) => normalQueue[i].batchId || 'standalone')));
          let targetIdx = candidateIndices[0];

          if (activeBatches.length > 1) {
            const lastBatch = this.lastServedBatchPerSession.get(sessionId);
            const lastIdx = lastBatch ? activeBatches.indexOf(lastBatch) : -1;
            const nextBatch = activeBatches[(lastIdx + 1) % activeBatches.length];
            const foundIdx = candidateIndices.find((i) => (normalQueue[i].batchId || 'standalone') === nextBatch);
            if (foundIdx !== undefined) {
              targetIdx = foundIdx;
              this.lastServedBatchPerSession.set(sessionId, nextBatch);
            }
          } else if (activeBatches.length === 1) {
            this.lastServedBatchPerSession.set(sessionId, activeBatches[0]);
          }

          msg = normalQueue.splice(targetIdx, 1)[0];
        }

        if (!msg) break;

        // 3. Validasi format nomor
        const formatCheck = validatePhoneFormat(msg.to);
        if (!formatCheck.valid) {
          console.warn(`[session:${sessionId}] Format nomor tidak valid: ${msg.to} (${formatCheck.reason})`);
          updateMessageStatus(msg.id, 'invalid_number', formatCheck.reason);
          msg.status = 'invalid_number';
          continue;
        }
        msg.to = formatCheck.normalized;

        const jid = `${msg.to}@s.whatsapp.net`;
        const content = msg.text || msg.caption || '';

        // 3b. Whitelist penerima kampanye.
        //
        // Didaftarkan DI SINI, bukan di enqueue(): saat enqueue() nomor masih mentah
        // (mis. '0811...') sedangkan jid sudah dinormalisasi ('62811...@s.whatsapp.net'),
        // jadi approval tidak akan pernah cocok. Titik ini menjamin jid identik dengan
        // yang dipakai canMessage() di bawah.
        //
        // Kuncinya pasangan (batchId, jid): nomor yang lolos di satu kampanye tetap
        // 'stranger' di pengiriman lain dan tetap wajib handshake.
        if (msg.batchId) {
          ab.contactGraph.approveBatchRecipients([jid], msg.batchId);
        }

        // 4. Pengecekan Anti-Ban
        //
        // Guard di bawah ini bersifat SEMENTARA: pemblokirannya akan hilang sendiri
        // (timelock expired, cooldown reply-ratio habis, handshake selesai). Karena itu
        // pesan TIDAK ditandai 'failed' (itu permanen dan menghilangkan pesan dari
        // antrean), melainkan dikembalikan ke depan antrean lalu antrean dijeda
        // sampai waktu blokirnya lewat — lihat scheduleAutoResume().
        if (!isHighPriority) {
          let blocked: { reason: string; retryInMs: number } | null = null;

          const recoveryDecision = ab.recovery.beforeSend();
          if (!recoveryDecision.allowed) {
            blocked = { reason: `🚑 ${recoveryDecision.reason}`, retryInMs: ab.recovery.remainingMs() };
          }

          if (!blocked) {
            const timelockDecision = ab.timelock.canSend(jid);
            if (!timelockDecision.allowed) {
              blocked = { reason: `⛔ ${timelockDecision.reason}`, retryInMs: ab.timelock.remainingMs() };
            }
          }

          if (!blocked) {
            const rr = ab.replyRatio.beforeSend(jid);
            if (!rr.allowed) {
              blocked = { reason: `📉 ${rr.reason}`, retryInMs: ab.replyRatio.remainingMs(jid) };
            }
          }

          if (!blocked) {
            const cg = ab.contactGraph.canMessage(jid, msg.batchId);
            if (!cg.allowed) {
              blocked = { reason: `🕸️ ${cg.reason}`, retryInMs: ab.contactGraph.remainingMs(jid) };
            }
          }

          if (blocked) {
            console.warn(`[session:${sessionId}] ${blocked.reason} — pesan ditahan, antrean dijeda sementara.`);
            this.holdMessageAtFront(sessionId, msg);
            this.pauseQueue(sessionId, blocked.reason);
            this.scheduleAutoResume(sessionId, blocked.retryInMs);
            break;
          }
        }

        // 5. Cek eksistensi nomor di WhatsApp
        if (typeof this.engine.checkOnWhatsApp === 'function') {
          try {
            const check = await this.engine.checkOnWhatsApp(sessionId, msg.to);
            if (!check.exists) {
              console.warn(`[session:${sessionId}] Nomor ${msg.to} TIDAK terdaftar di WhatsApp`);
              updateMessageStatus(msg.id, 'not_registered', 'Nomor tidak terdaftar di WhatsApp');
              msg.status = 'not_registered';
              continue;
            }
          } catch (err: any) {
            console.warn(`[session:${sessionId}] Gagal verifikasi WhatsApp untuk ${msg.to}:`, err?.message || err);
          }
        }

        // 6. Rate Limiter & Delay Pacing
        if (isHighPriority) {
          // Jalur Prioritas Tinggi: Pacing minimal 1 detik agar natural di socket WA, bypass cooldown blast
          msg.jitterDelayMs = 1000;
          updateMessageStatus(msg.id, 'pacing', undefined, 1000);
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          // Jalur Blast Normal: Cek delay & batasan
          const delayCheck = ab.rateLimiter.getDelayReason(msg.to, content);
          if (!delayCheck.allowed) {
            console.warn(`[session:${sessionId}] ⏸️ Batas blast tercapai (${delayCheck.reason}). Auto-pause antrean.`);
            // Kembalikan pesan ke depan antrean normal agar TIDAK GAGAL dan TIDAK HILANG!
            this.holdMessageAtFront(sessionId, msg);

            // Set status sesi ke auto-pause, lalu jadwalkan resume otomatis
            this.pauseQueue(sessionId, delayCheck.reason || 'Batas blast harian tercapai');
            this.scheduleAutoResume(sessionId, delayCheck.delayMs > 0 ? delayCheck.delayMs : 60_000);
            break;
          }

          let totalDelay = delayCheck.delayMs;
          const distraction = ab.presence.shouldPauseForDistraction();
          const reconnectMult = Math.max(0.2, ab.reconnect.multiplier || 1);
          // Distraksi manusiawi tidak boleh dibagi dengan faktor reconnect agar tidak meledak menjadi jam-jaman
          totalDelay = Math.round(totalDelay / reconnectMult) + (distraction.pause ? distraction.durationMs : 0);
          // Safety Cap: pacing blast per pesan dibatasi maksimal 60 detik agar antrean tidak tersendat berjam-jam
          totalDelay = Math.min(totalDelay, 60_000);

          msg.jitterDelayMs = totalDelay;
          if (totalDelay > 0) {
            updateMessageStatus(msg.id, 'pacing', undefined, totalDelay);
            if (totalDelay > 3000) {
              console.log(`[session:${sessionId}] ⏳ Pacing jeda aman ${Math.round(totalDelay / 1000)}s sebelum mengirim pesan ${msg.id}...`);
            }
            await new Promise((r) => setTimeout(r, totalDelay));
          } else {
            updateMessageStatus(msg.id, 'pacing', undefined, 0);
          }

          // Human Typing Presence
          const plan = ab.presence.computeTypingPlan(content.length);
          if (typeof this.engine.sendPresence === 'function') {
            try {
              for (const step of plan) {
                await this.engine.sendPresence(sessionId, jid, step.state);
                if (step.durationMs > 0) await new Promise((r) => setTimeout(r, step.durationMs));
              }
            } catch {}
          }
        }

        // 7. Kirim ke WhatsApp Socket
        updateMessageStatus(msg.id, 'sending');
        try {
          const { messageId } = await this.engine.sendMessage(msg);
          updateMessageStatus(msg.id, 'sent');
          msg.status = 'sent';
          this.metrics.recordSent(sessionId);
          ab.rateLimiter.record(msg.to, content);
          ab.warmup.record();
          ab.replyRatio.recordSent(jid);
          ab.contactGraph.recordSent(jid);
          // CATATAN: jangan panggil ab.reconnect.onReconnect() di sini.
          // ReconnectThrottle menurunkan kecepatan ke 10% selama 60s setelah reconnect;
          // memanggilnya tiap pesan sukses membuat multiplier selalu ~0.1 sehingga
          // SETIAP delay pacing terkalikan 10x. Throttle hanya boleh dipicu oleh
          // socket reconnect sungguhan (server.ts -> engine.onReconnectCallback).
          this.persistAntiBan(sessionId);
          console.log(`[session:${sessionId}] ✉️ [${isHighPriority ? 'PRIORITY-HIGH' : 'BLAST'}] Pesan ${msg.id} terkirim (messageId: ${messageId})`);
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          updateMessageStatus(msg.id, 'failed', errMsg);
          msg.status = 'failed';
          this.metrics.recordError(sessionId, errMsg);
          if (/463|reachout|restricted/i.test(errMsg)) {
            await this.record463(sessionId);
            ab.recovery.reportError('timelock', errMsg);
            this.persistAntiBan(sessionId);
          } else if (/429|rate.overlimit|too many/i.test(errMsg)) {
            ab.recovery.reportError('rate_overlimit', errMsg);
            this.persistAntiBan(sessionId);
          }
          console.error(`[session:${sessionId}] Kirim pesan ${msg.id} GAGAL:`, errMsg);
        }
      }
    } finally {
      this.processing.delete(sessionId);
    }
  }

  async getSession(id: string): Promise<SessionInfo> {
    const s = await this.engine.getSessionInfo(id);
    upsertSession(s);
    return s;
  }

  async listSessions(filterUserId?: string): Promise<SessionInfo[]> {
    const sessions = await this.engine.listSessions();
    for (const s of sessions) upsertSession(s);
    const list = dbListSessions(filterUserId);
    return list.map((s) => {
      const q = this.getQueueStatus(s.id);
      const estSeconds = Math.round(q.pendingCount * 3.5);
      return {
        ...s,
        queue: {
          pendingCount: q.pendingCount,
          priorityPendingCount: q.priorityPendingCount,
          isPaused: q.isPaused,
          estimatedWaitSeconds: estSeconds,
        },
      };
    });
  }

  async updateSessionProfile(sessionId: string, profile: 'fresh' | 'mature') {
    updateSessionProfile(sessionId, profile);
    const ab = this.getAntiBan(sessionId);
    if (profile === 'mature') {
      ab.warmup.setGraduated(true);
    } else {
      ab.warmup.setGraduated(false);
    }
    this.persistAntiBan(sessionId);
    const active = (this.engine as any)['active']?.get(sessionId);
    if (active) {
      active.info.numberProfile = profile;
    }
    const s = await this.getSession(sessionId);
    s.numberProfile = profile;
    upsertSession(s);
    return s;
  }

  async startPairing(id: string, name: string, phone: string, userId?: string, numberProfile?: 'fresh' | 'mature') {
    const { qr } = await this.engine.startPairing(id, name, phone);
    const s = await this.engine.getSessionInfo(id);
    if (userId) s.userId = userId;
    s.numberProfile = numberProfile || 'mature';
    upsertSession(s);
    if (s.numberProfile === 'fresh') {
      const ab = this.getAntiBan(id);
      ab.warmup.setGraduated(false);
      this.persistAntiBan(id);
    }
    return { qr, session: s };
  }

  async logout(id: string) {
    await this.engine.logout(id);
    const s = await this.engine.getSessionInfo(id);
    upsertSession(s);
  }

  async reconnect(id: string): Promise<SessionInfo> {
    const engineAny = this.engine as any;
    if (typeof engineAny.reconnectSession === 'function') {
      const s = await engineAny.reconnectSession(id);
      upsertSession(s);
      return s;
    }
    return this.getSession(id);
  }

  async delete(id: string): Promise<void> {
    const engineAny = this.engine as any;
    if (typeof engineAny.deleteSession === 'function') {
      await engineAny.deleteSession(id);
    } else {
      await this.engine.logout(id);
    }
  }

  async renameSession(id: string, newName: string): Promise<SessionInfo> {
    const s = await this.engine.renameSession(id, newName);
    upsertSession(s);
    return s;
  }
}

export { dbListSessions as dbListSessionsForRoutes };