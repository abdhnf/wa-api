
function validatePhoneFormat(phone: string): { valid: boolean; normalized: string; reason?: string } {
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
import { upsertSession, insertMessage, updateMessageStatus, getMessageById, listSessions as dbListSessions, getAntiBanState, saveAntiBanState, getSessionAntiBanSettings, saveSessionAntiBanSettings, getSetting, getUserSetting, getLastSessionForRecipient, resetStuckMessages, getPendingMessages } from './db.js';
import { RateLimiter, WarmUp, TimelockGuard, PresenceChoreographer, ReconnectThrottle, BanRecoveryOrchestrator, ReplyRatioGuard, ContactGraphWarmer, DEFAULT_ANTIBAN_CONFIG, ANTIBAN_PRESETS, type AntiBanPreset, type AntiBanState } from './antiban.js';
import type { OutboundMessage, SessionInfo, QueueSessionStatus } from './types.js';
import type { WhatsAppEngine } from './engine/WhatsAppEngine.js';

/**
 * SessionManager: orchestrator tiap session WhatsApp.
 * - Queue per session (FIFO) + anti-ban engine (RateLimiter, WarmUp, TimelockGuard, PresenceChoreographer)
 * - State anti-ban persist ke SQLite per session
 */
export class SessionManager {
  private engine: WhatsAppEngine;
  private vipQueues = new Map<string, OutboundMessage[]>();
  private normalQueues = new Map<string, OutboundMessage[]>();
  private pausedSessions = new Map<string, { isPaused: boolean; reason?: string }>();
  private pausedBatches = new Map<string, { isPaused: boolean; reason?: string }>();
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

    let replyRatioConfig = activePreset ? activePreset.replyRatio : {};
    if (sessionSettings.config?.replyRatio) {
      replyRatioConfig = { ...replyRatioConfig, ...sessionSettings.config.replyRatio };
    }

    ab = {
      rateLimiter: new RateLimiter(cfg),
      warmup: new WarmUp(cfg, state?.warmup),
      timelock: new TimelockGuard(cfg, state?.timelock),
      presence: new PresenceChoreographer(cfg),
      reconnect: new ReconnectThrottle(cfg),
      recovery: new BanRecoveryOrchestrator(cfg),
      replyRatio: new ReplyRatioGuard(replyRatioConfig),
      contactGraph: new ContactGraphWarmer(cfg),
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
      status: 'pending',
      errorDetail: undefined,
      timestamp: new Date().toISOString(),
      jitterDelayMs: 0,
    };
    updateMessageStatus(messageId, 'pending', '', 0);

    const q = refreshed.priority === 'high' ? this.vipQueues : this.normalQueues;
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
      status: 'pending',
      priority,
      jitterDelayMs: 0,
      timestamp: new Date().toISOString(),
    };
    insertMessage(full);

    if (priority === 'high') {
      if (!this.vipQueues.has(full.sessionId)) this.vipQueues.set(full.sessionId, []);
      this.vipQueues.get(full.sessionId)!.push(full);
      console.log(`[session:${full.sessionId}] 🚀 Pesan VIP (OTP) masuk ke Jalur Cepat: ${full.id}`);
    } else {
      if (!this.normalQueues.has(full.sessionId)) this.normalQueues.set(full.sessionId, []);
      this.normalQueues.get(full.sessionId)!.push(full);
    }

    void this.processQueue(full.sessionId);
    return full;
  }

  /** Memulihkan pesan 'pending' dari SQLite ke antrean memori saat startup / restart */
  async recoverPendingMessages(): Promise<number> {
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
        if (!this.vipQueues.has(msg.sessionId)) this.vipQueues.set(msg.sessionId, []);
        this.vipQueues.get(msg.sessionId)!.push(msg);
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

  /** Pause antrean normal (blast) per sesi secara manual / otomatis */
  pauseQueue(sessionId: string, reason = 'Dijeda oleh pengguna'): { success: boolean; status: QueueSessionStatus } {
    this.pausedSessions.set(sessionId, { isPaused: true, reason });
    console.log(`[session:${sessionId}] ⏸️ Antrean blast di-pause: ${reason}`);
    return { success: true, status: this.getQueueStatus(sessionId) };
  }

  /** Resume antrean blast yang tertahan */
  resumeQueue(sessionId: string): { success: boolean; status: QueueSessionStatus } {
    this.pausedSessions.set(sessionId, { isPaused: false, reason: undefined });
    console.log(`[session:${sessionId}] ▶️ Antrean blast di-resume`);
    void this.processQueue(sessionId);
    return { success: true, status: this.getQueueStatus(sessionId) };
  }

  /** Pause antrean per batch/kampanye tertentu (tidak mempengaruhi batch lain di sesi yang sama) */
  pauseBatch(batchId: string, reason = 'Kampanye dijeda oleh pengguna'): { success: boolean; batchId: string; isPaused: boolean; reason?: string } {
    this.pausedBatches.set(batchId, { isPaused: true, reason });
    console.log(`[batch:${batchId}] ⏸️ Antrean batch di-pause: ${reason}`);
    return { success: true, batchId, isPaused: true, reason };
  }

  /** Resume antrean per batch/kampanye tertentu */
  resumeBatch(batchId: string): { success: boolean; batchId: string; isPaused: boolean } {
    this.pausedBatches.delete(batchId);
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
    for (const q of this.vipQueues.values()) {
      activeCount += q.filter((m) => m.batchId === batchId).length;
    }
    return { isPaused: Boolean(p?.isPaused), reason: p?.reason, activeCount };
  }

  /** Cek status antrean per sesi */
  getQueueStatus(sessionId: string): QueueSessionStatus {
    const pauseInfo = this.pausedSessions.get(sessionId);
    const pendingCount = (this.normalQueues.get(sessionId) || []).length;
    const vipPendingCount = (this.vipQueues.get(sessionId) || []).length;
    return {
      sessionId,
      isPaused: Boolean(pauseInfo?.isPaused),
      pauseReason: pauseInfo?.reason,
      pendingCount,
      vipPendingCount,
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
          updateMessageStatus(msg.id, 'failed', reason);
          cleared++;
        } else {
          remaining.push(msg);
        }
      }
      this.normalQueues.set(sessionId, remaining);
      this.pausedBatches.delete(targetBatchId);
      console.log(`[session:${sessionId}][batch:${targetBatchId}] 🛑 Antrean batch dibersihkan (${cleared} pesan dibatalkan, sisa ${remaining.length} pesan di sesi)`);
      return { success: true, clearedCount: cleared, batchId: targetBatchId };
    }

    const count = queue.length;
    for (const msg of queue) {
      updateMessageStatus(msg.id, 'failed', reason);
    }
    this.normalQueues.set(sessionId, []);
    this.pausedSessions.delete(sessionId);
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
          updateMessageStatus(msg.id, 'failed', reason);
          totalCleared++;
        } else {
          remaining.push(msg);
        }
      }
      this.normalQueues.set(sid, remaining);
    }
    this.pausedBatches.delete(batchId);
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

  /** Record error 463 (reachout restricted) → timelock guard */
  async record463(sessionId: string): Promise<void> {
    try {
      const ab = this.getAntiBan(sessionId);
      ab.timelock.record463Error();
      this.persistAntiBan(sessionId);
    } catch {}
  }

  /** Ambil status anti-ban session untuk panel */
  
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
      if (warmupStatus.todaySent >= warmupStatus.todayLimit) {
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
      return {
        preset: settings.preset,
        presets: ANTIBAN_PRESETS,
        currentConfig: {
          rateLimiter: ab.rateLimiter.getConfig(),
          replyRatio: ab.replyRatio.getConfig(),
        },
        warmup: ab.warmup.getStatus(),
        rateLimiter: ab.rateLimiter.getStats(),
        timelock: ab.timelock.getState(),
        circadianMultiplier: ab.presence.getCircadianMultiplier(),
        reconnectMultiplier: ab.reconnect.multiplier,
        recovery: ab.recovery.exportState(),
        replyRatio: ab.replyRatio.getStats(),
        contactGraph: ab.contactGraph.getStats(),
      };
    } catch (e) {
      return null;
    }
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

    // Jika preset broadcast atau dinonaktifkan, bersihkan cooldown lama yang tersangkut
    if (preset === 'broadcast' || mergedReplyRatio.enabled === false) {
      ab.replyRatio.resetCooldown();
    }

    return this.getAntiBanStatus(sessionId);
  }

  resetReplyRatioCooldown(sessionId: string, jid?: string) {
    const ab = this.getAntiBan(sessionId);
    ab.replyRatio.resetCooldown(jid);
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

        // 1. Prioritaskan pesan VIP (OTP) terlebih dahulu
        let msg: OutboundMessage | undefined;
        let isVip = false;

        const vipQueue = this.vipQueues.get(sessionId);
        if (vipQueue && vipQueue.length > 0) {
          msg = vipQueue.shift();
          isVip = true;
        } else {
          // 2. Jika tidak ada pesan VIP, ambil dari antrean blast reguler
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

          // Cari pesan pertama yang batch-nya TIDAK sedang di-pause
          let targetIdx = -1;
          for (let i = 0; i < normalQueue.length; i++) {
            const bId = normalQueue[i].batchId;
            if (!bId || !this.pausedBatches.get(bId)?.isPaused) {
              targetIdx = i;
              break;
            }
          }

          if (targetIdx === -1) {
            // Semua pesan yang tersisa di antrean normal saat ini sedang dalam batch yang di-pause!
            console.log(`[session:${sessionId}] ⏸️ Seluruh pesan tersisa di antrean (${normalQueue.length}) berasal dari batch yang sedang dijeda. Menunggu resume batch.`);
            break;
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

        // 4. Pengecekan Anti-Ban
        if (!isVip) {
          // Jalur Blast Normal: wajib patuhi cooldown ban recovery & timelock 463
          const recoveryDecision = ab.recovery.beforeSend();
          if (!recoveryDecision.allowed) {
            console.warn(`[session:${sessionId}] 🚑 ${recoveryDecision.reason}`);
            updateMessageStatus(msg.id, 'failed', recoveryDecision.reason);
            msg.status = 'failed';
            continue;
          }

          const timelockDecision = ab.timelock.canSend(jid);
          if (!timelockDecision.allowed) {
            console.warn(`[session:${sessionId}] ⛔ ${timelockDecision.reason}`);
            updateMessageStatus(msg.id, 'failed', timelockDecision.reason);
            msg.status = 'failed';
            continue;
          }

          const rr = ab.replyRatio.beforeSend(jid);
          if (!rr.allowed) {
            console.warn(`[session:${sessionId}] 📉 ${rr.reason}`);
            updateMessageStatus(msg.id, 'failed', rr.reason);
            msg.status = 'failed';
            continue;
          }

          const cg = ab.contactGraph.canMessage(jid);
          if (!cg.allowed) {
            console.warn(`[session:${sessionId}] 🕸️ ${cg.reason}`);
            updateMessageStatus(msg.id, 'failed', cg.reason);
            msg.status = 'failed';
            continue;
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
        if (isVip) {
          // Jalur Cepat (VIP/OTP): Pacing minimal 1 detik agar natural di socket WA, bypass cooldown blast
          msg.jitterDelayMs = 1000;
          updateMessageStatus(msg.id, 'pacing', undefined, 1000);
          await new Promise((r) => setTimeout(r, 1000));
        } else {
          // Jalur Blast Normal: Cek delay & batasan
          const delayCheck = ab.rateLimiter.getDelayReason(msg.to, content);
          if (!delayCheck.allowed) {
            console.warn(`[session:${sessionId}] ⏸️ Batas blast tercapai (${delayCheck.reason}). Auto-pause antrean.`);
            // Kembalikan pesan ke depan antrean normal agar TIDAK GAGAL dan TIDAK HILANG!
            if (!this.normalQueues.has(sessionId)) this.normalQueues.set(sessionId, []);
            this.normalQueues.get(sessionId)!.unshift(msg);

            // Set status sesi ke auto-pause
            this.pauseQueue(sessionId, delayCheck.reason || 'Batas blast harian tercapai');
            break;
          }

          let totalDelay = delayCheck.delayMs;
          const distraction = ab.presence.shouldPauseForDistraction();
          const reconnectMult = ab.reconnect.multiplier;
          totalDelay = Math.round((totalDelay + distraction.durationMs) / reconnectMult);

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
          ab.rateLimiter.record(msg.to, content);
          ab.warmup.record();
          ab.replyRatio.recordSent(jid);
          ab.contactGraph.recordSent(jid);
          ab.reconnect.onReconnect();
          this.persistAntiBan(sessionId);
          console.log(`[session:${sessionId}] ✉️ [${isVip ? 'VIP-OTP' : 'BLAST'}] Pesan ${msg.id} terkirim (messageId: ${messageId})`);
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          updateMessageStatus(msg.id, 'failed', errMsg);
          msg.status = 'failed';
          if (/463|reachout|restricted/i.test(errMsg)) {
            ab.timelock.record463Error();
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
    return dbListSessions(filterUserId);
  }

  async startPairing(id: string, name: string, phone: string, userId?: string) {
    const { qr } = await this.engine.startPairing(id, name, phone);
    const s = await this.engine.getSessionInfo(id);
    if (userId) s.userId = userId;
    upsertSession(s);
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