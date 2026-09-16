/**
 * AntiBan Engine — arsitektur terinspirasi baileys-antiban (kobie3717, MIT).
 * Modul: RateLimiter (sliding window per m/h/d + identical spam guard),
 * WarmUp (kuota bertahap 7 hari), TimelockGuard (463), PresenceChoreographer (circadian).
 * Pure TS, tanpa dependency. State persist ke SQLite via adapter.
 */

export interface AntiBanState {
  warmup: {
    startedAt: number;
    lastActiveAt: number;
    dailyCounts: number[];
    graduated: boolean;
  };
  rateLimiter: {
    messages: { timestamp: number; recipient: string; contentHash: string }[];
    identicalCount: Record<string, { count: number; firstSeen: number; lastSeen: number }>;
    knownChats: string[];
    burstCount: number;
    lastMessageTime: number;
  };
  timelock: {
    isActive: boolean;
    expiresAt: number | null;
    errorCount: number;
    knownChats: string[];
  };
  reconnect?: any;
  recovery?: any;
  replyRatio?: any;
  contactGraph?: any;
}

export interface AntiBanConfig {
  minDelayMs: number;
  maxDelayMs: number;
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
  newChatDelayMs: number;
  maxIdenticalMessages: number;
  burstAllowance: number;
  /** Jeda distraksi manusiawi 5-20 menit. Wajib false untuk jalur blast/broadcast. */
  distraction: boolean;
  warmupDays: number;
  day1Limit: number;
  growthFactor: number;
  inactivityThresholdHours: number;
  resumeBufferMs: number;
  typingWPM: number;
  typingWPMStdDev: number;
}

export const DEFAULT_ANTIBAN_CONFIG: AntiBanConfig = {
  minDelayMs: 1500,
  maxDelayMs: 5000,
  maxPerMinute: 8,
  maxPerHour: 200,
  maxPerDay: 1500,
  newChatDelayMs: 3000,
  maxIdenticalMessages: 3,
  burstAllowance: 3,
  distraction: true,
  warmupDays: 7,
  day1Limit: 20,
  growthFactor: 1.8,
  inactivityThresholdHours: 72,
  resumeBufferMs: 10_000,
  typingWPM: 45,
  typingWPMStdDev: 15,
};

export interface AntiBanPreset {
  id: 'strict' | 'balanced' | 'broadcast' | 'custom';
  name: string;
  description: string;
  rateLimiter: Partial<AntiBanConfig>;
  replyRatio: Partial<ReplyRatioConfig>;
}

export const ANTIBAN_PRESETS: Record<string, AntiBanPreset> = {
  strict: {
    id: 'strict',
    name: 'Strict / High Security',
    description: 'Keamanan maksimum untuk nomor baru atau akun pribadi penting. Delay panjang, kuota ketat, Reply Ratio 10%.',
    rateLimiter: {
      minDelayMs: 3000,
      maxDelayMs: 8000,
      maxPerMinute: 5,
      maxPerHour: 100,
      maxIdenticalMessages: 2,
      distraction: false,
    },
    replyRatio: {
      enabled: true,
      minRatio: 0.1,
      minMessagesBeforeEnforce: 5,
      cooldownHoursOnViolation: 24,
    },
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced / Standard',
    description: 'Profil standar operasional CRM interaktif. Delay manusiawi 1.5 - 5s, Reply Ratio aktif 10%.',
    rateLimiter: {
      minDelayMs: 1500,
      maxDelayMs: 5000,
      maxPerMinute: 8,
      maxPerHour: 200,
      maxIdenticalMessages: 3,
      distraction: true,
    },
    replyRatio: {
      enabled: true,
      minRatio: 0.1,
      minMessagesBeforeEnforce: 5,
      cooldownHoursOnViolation: 24,
    },
  },
  broadcast: {
    id: 'broadcast',
    name: 'Broadcast / Notification',
    description: 'Khusus blast pengumuman & notifikasi satu arah. Reply Ratio dinonaktifkan agar tidak terkena cooldown, delay 2 - 5s.',
    rateLimiter: {
      minDelayMs: 2000,
      maxDelayMs: 5000,
      maxPerMinute: 10,
      maxPerHour: 300,
      maxIdenticalMessages: 10,
      distraction: false,
    },
    replyRatio: {
      enabled: false,
      minRatio: 0.0,
      minMessagesBeforeEnforce: 999999,
      cooldownHoursOnViolation: 0,
    },
  },
};

const MS = { MIN: 60_000, HOUR: 3_600_000, DAY: 86_400_000 };

/** Gaussian (Box-Muller) jitter in [min,max], clustered around middle */
export function gaussianJitter(min: number, max: number): number {
  const u1 = Math.max(Math.random(), 1e-9);
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const normalized = Math.max(0, Math.min(1, (normal + 3) / 6));
  return Math.round(min + normalized * (max - min));
}

function hashContent(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/**
 * Normalisasi konten sebelum hashing untuk guard anti-spam konten identik.
 *
 * Tanpa ini guard `maxIdenticalMessages` praktis tidak pernah aktif pada blast:
 * dashboard me-render variabel per kontak (mis. baris sapaan "Yth. <nama>"),
 * sehingga setiap pesan menghasilkan hash berbeda walau isi pesannya sama.
 * Hasilnya 52 pesan identik lolos tanpa terdeteksi.
 *
 * Heuristik ini menyamarkan baris personalisasi yang bervariasi per penerima.
 * Pesan tanpa baris sapaan tidak terpengaruh (hash tidak berubah).
 */
/**
 * Kunci pelacak pesan identik: kombinasi penerima + hash konten.
 *
 * Kenapa per penerima, bukan global: mengirim satu pengumuman yang sama ke 52
 * orang adalah broadcast yang sah, bukan spam. Yang benar-benar berisiko adalah
 * mengirim pesan yang sama berulang kali ke ORANG YANG SAMA.
 */
function identicalKey(recipient: string, contentHash: string): string {
  return `${recipient}|${contentHash}`;
}

export function normalizeContentForHash(content: string): string {
  return content
    .replace(/^[ \t]*(Yth|Kepada|Dear|Halo|Hai|Hi)[^\n]*/gim, '$1 <PENERIMA>')
    .replace(/\s+/g, ' ')
    .trim();
}

export class RateLimiter {
  private messages: { timestamp: number; recipient: string; contentHash: string }[] = [];
  private identicalCount = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();
  private knownChats = new Set<string>();
  private burstCount = 0;
  private lastMessageTime = 0;
  constructor(private cfg: AntiBanConfig) {}

  /** Returns delay in ms, 0 = kirim sekarang, -1 = hard block */
  getDelay(recipient: string, content: string): number {
    const now = Date.now();
    this.cleanup(now);
    const contentHash = hashContent(normalizeContentForHash(content));

    if (this.messages.filter(m => now - m.timestamp < MS.DAY).length >= this.cfg.maxPerDay) return -1;

    const hourMessages = this.messages.filter(m => now - m.timestamp < MS.HOUR);
    if (hourMessages.length >= this.cfg.maxPerHour) {
      const oldest = hourMessages.sort((a, b) => a.timestamp - b.timestamp)[0];
      return Math.max((oldest.timestamp + MS.HOUR) - now, MS.MIN);
    }

    const minuteMessages = this.messages.filter(m => now - m.timestamp < MS.MIN);
    if (minuteMessages.length >= this.cfg.maxPerMinute) {
      const oldest = minuteMessages.sort((a, b) => a.timestamp - b.timestamp)[0];
      return Math.max((oldest.timestamp + MS.MIN) - now, 1000);
    }

    const tracker = this.identicalCount.get(identicalKey(recipient, contentHash));
    if (tracker && now - tracker.firstSeen < 3_600_000 && tracker.count >= this.cfg.maxIdenticalMessages) {
      return -1; // pesan identik berulang ke penerima yang sama
    }

    let delay: number;
    if (this.burstCount < this.cfg.burstAllowance) {
      this.burstCount++;
      delay = gaussianJitter(this.cfg.minDelayMs * 0.5, this.cfg.minDelayMs);
    } else {
      delay = gaussianJitter(this.cfg.minDelayMs, this.cfg.maxDelayMs);
    }

    if (!this.knownChats.has(recipient)) {
      delay += gaussianJitter(this.cfg.newChatDelayMs * 0.5, this.cfg.newChatDelayMs);
    }

    const sinceLast = now - this.lastMessageTime;
    if (sinceLast < this.cfg.minDelayMs) delay = Math.max(delay, this.cfg.minDelayMs - sinceLast);

    const typingDelay = Math.min(content.length * 30, 3000);
    delay += gaussianJitter(typingDelay * 0.5, typingDelay);
    return Math.round(delay);
  }

  record(recipient: string, content: string): void {
    const now = Date.now();
    if (now - this.lastMessageTime > 30_000) this.burstCount = 0;
    // Wajib sama dengan hash di getDelay()/getDelayReason(), kalau tidak
    // kunci pelacak tidak akan pernah cocok dan guard identik tidak menyala.
    const contentHash = hashContent(normalizeContentForHash(content));
    this.messages.push({ timestamp: now, recipient, contentHash });
    this.knownChats.add(recipient);
    this.lastMessageTime = now;

    // Dihitung per penerima: pengumuman yang sama ke banyak orang adalah
    // broadcast normal, sedangkan pesan sama berulang ke satu orang adalah spam.
    const key = identicalKey(recipient, contentHash);
    const tracker = this.identicalCount.get(key);
    if (tracker && now - tracker.firstSeen < 3_600_000) {
      tracker.count++;
      tracker.lastSeen = now;
    } else {
      this.identicalCount.set(key, { count: 1, firstSeen: now, lastSeen: now });
    }
  }

  getDelayReason(recipient: string, content: string): { allowed: boolean; delayMs: number; reason?: string } {
    const now = Date.now();
    this.cleanup(now);
    const contentHash = hashContent(normalizeContentForHash(content));

    if (this.messages.filter(m => now - m.timestamp < MS.DAY).length >= this.cfg.maxPerDay) {
      return { allowed: false, delayMs: -1, reason: 'Kuota batas harian sesi tercapai' };
    }

    const tracker = this.identicalCount.get(identicalKey(recipient, contentHash));
    if (tracker && now - tracker.firstSeen < 3_600_000 && tracker.count >= this.cfg.maxIdenticalMessages) {
      return { allowed: false, delayMs: -1, reason: 'Pesan identik berulang ke penerima yang sama (anti-spam)' };
    }

    const d = this.getDelay(recipient, content);
    return { allowed: d >= 0, delayMs: Math.max(0, d) };
  }

  getStats() {
    const now = Date.now();
    return {
      lastMinute: this.messages.filter(m => now - m.timestamp < MS.MIN).length,
      lastHour: this.messages.filter(m => now - m.timestamp < MS.HOUR).length,
      lastDay: this.messages.filter(m => now - m.timestamp < MS.DAY).length,
      knownChats: this.knownChats.size,
    };
  }

  isKnownChat(recipient: string): boolean {
    return this.knownChats.has(recipient);
  }

  markKnownChat(jid: string): void {
    this.knownChats.add(jid);
  }

  exportState(): AntiBanState['rateLimiter'] {
    return {
      messages: [...this.messages],
      identicalCount: Object.fromEntries(this.identicalCount),
      knownChats: [...this.knownChats],
      burstCount: this.burstCount,
      lastMessageTime: this.lastMessageTime,
    };
  }

  updateConfig(cfg: Partial<AntiBanConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
  }

  getConfig(): AntiBanConfig {
    return { ...this.cfg };
  }

  restore(state: AntiBanState['rateLimiter']): void {
    this.messages = state.messages || [];
    this.identicalCount = new Map(Object.entries(state.identicalCount || {}));
    this.knownChats = new Set(state.knownChats || []);
    this.burstCount = state.burstCount || 0;
    this.lastMessageTime = state.lastMessageTime || 0;
  }

  private cleanup(now: number): void {
    this.messages = this.messages.filter(m => now - m.timestamp < MS.DAY);
    for (const [hash, t] of this.identicalCount.entries()) {
      if (now - t.lastSeen > 3_600_000) this.identicalCount.delete(hash);
    }
    if (this.identicalCount.size > 10_000) {
      const sorted = [...this.identicalCount.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      const excess = this.identicalCount.size - 10_000;
      for (let i = 0; i < excess; i++) this.identicalCount.delete(sorted[i][0]);
    }
  }
}

export class WarmUp {
  private startedAt: number;
  private lastActiveAt: number;
  private dailyCounts: number[];
  private graduated: boolean;
  constructor(private cfg: AntiBanConfig, state?: AntiBanState['warmup'], initialGraduated = false) {
    if (state) {
      this.startedAt = state.startedAt;
      this.lastActiveAt = state.lastActiveAt;
      this.dailyCounts = state.dailyCounts;
      this.graduated = state.graduated;
    } else {
      this.startedAt = Date.now();
      this.lastActiveAt = Date.now();
      this.dailyCounts = [];
      this.graduated = initialGraduated;
    }
  }

  setGraduated(graduated: boolean): void {
    this.graduated = graduated;
  }

  private getCurrentDay(): number {
    return Math.floor((Date.now() - this.startedAt) / MS.DAY);
  }

  getDailyLimit(): number {
    if (this.graduated) return Infinity;
    const day = this.getCurrentDay();
    if (day >= this.cfg.warmupDays) {
      this.graduated = true;
      return Infinity;
    }
    return Math.round(this.cfg.day1Limit * Math.pow(this.cfg.growthFactor, day));
  }

  canSend(): boolean {
    this.checkInactivity();
    if (this.graduated) return true;
    const day = this.getCurrentDay();
    const todayCount = this.dailyCounts[day] || 0;
    return todayCount < this.getDailyLimit();
  }

  record(): void {
    const day = this.getCurrentDay();
    while (this.dailyCounts.length <= day) this.dailyCounts.push(0);
    this.dailyCounts[day]++;
    this.lastActiveAt = Date.now();
  }

  getStatus() {
    const day = this.getCurrentDay();
    const todaySent = this.dailyCounts[day] || 0;
    const limit = this.getDailyLimit();
    return {
      phase: this.graduated ? 'graduated' : 'warming',
      day: Math.min(day + 1, this.cfg.warmupDays),
      totalDays: this.cfg.warmupDays,
      todayLimit: limit === Infinity ? -1 : limit,
      todaySent,
      progress: this.graduated ? 100 : Math.round((day / this.cfg.warmupDays) * 100),
    };
  }

  private checkInactivity(): void {
    const hoursSinceActive = (Date.now() - this.lastActiveAt) / 3_600_000;
    if (hoursSinceActive > this.cfg.inactivityThresholdHours && this.graduated) {
      this.startedAt = Date.now();
      this.lastActiveAt = Date.now();
      this.dailyCounts = [];
      this.graduated = false;
    }
  }

  exportState(): AntiBanState['warmup'] {
    return {
      startedAt: this.startedAt,
      lastActiveAt: this.lastActiveAt,
      dailyCounts: this.dailyCounts,
      graduated: this.graduated,
    };
  }
}

export class TimelockGuard {
  private isActive = false;
  private expiresAt: number | null = null;
  private errorCount = 0;
  private enforcementType: string | null = null;
  private knownChats = new Set<string>();
  constructor(private cfg: AntiBanConfig, state?: AntiBanState['timelock']) {
    if (state) {
      this.isActive = state.isActive;
      this.expiresAt = state.expiresAt;
      this.errorCount = state.errorCount;
      state.knownChats.forEach(jid => this.knownChats.add(jid));
    }
  }

  /** Record error 463. Gunakan timeEnforcementEnds resmi dari WA bila ada, atau fallback 60s. */
  record463Error(timeEnforcementEnds?: Date | null): void {
    this.errorCount++;
    this.isActive = true;
    if (timeEnforcementEnds) {
      this.expiresAt = timeEnforcementEnds.getTime();
    } else if (!this.expiresAt || this.expiresAt <= Date.now()) {
      this.expiresAt = Date.now() + 60_000;
    }
  }

  onTimelockUpdate(data: { isActive?: boolean; timeEnforcementEnds?: Date | null; enforcementType?: string }): void {
    if (data.isActive === false) {
      this.lift();
      return;
    }
    this.isActive = true;
    if (data.enforcementType) {
      this.enforcementType = data.enforcementType;
    }
    if (data.timeEnforcementEnds) {
      this.expiresAt = data.timeEnforcementEnds.getTime();
    } else if (!this.expiresAt || this.expiresAt <= Date.now()) {
      this.expiresAt = Date.now() + 60_000;
    }
  }

  registerKnownChat(jid: string): void {
    this.knownChats.add(jid);
  }

  isTimelocked(): boolean {
    if (!this.isActive) return false;
    if (this.expiresAt && Date.now() >= this.expiresAt + this.cfg.resumeBufferMs) {
      this.lift();
      return false;
    }
    return true;
  }

  canSend(jid: string): { allowed: boolean; reason?: string } {
    if (!this.isTimelocked()) return { allowed: true };
    if (jid.endsWith('@g.us') || jid.endsWith('@newsletter')) return { allowed: true };
    if (this.knownChats.has(jid)) return { allowed: true };
    const expiresIn = this.expiresAt ? Math.max(0, this.expiresAt - Date.now()) : 60_000;
    return {
      allowed: false,
      reason: `Reachout timelocked (463). Kontak baru diblokir. Resume dalam ${Math.ceil(expiresIn / 1000)}s.${this.enforcementType ? ` Tipe: ${this.enforcementType}` : ''}`,
    };
  }

  lift(): void {
    this.isActive = false;
    this.expiresAt = null;
    this.enforcementType = null;
  }

  /** Sisa waktu timelock dalam ms — dipakai penjadwal auto-resume antrean. */
  remainingMs(): number {
    if (!this.isActive) return 0;
    if (!this.expiresAt) return 60_000;
    return Math.max(0, this.expiresAt + this.cfg.resumeBufferMs - Date.now());
  }

  getState() {
    return {
      isActive: this.isActive,
      expiresAt: this.expiresAt,
      errorCount: this.errorCount,
      enforcementType: this.enforcementType,
      knownChats: [...this.knownChats]
    };
  }
}

/** WPM-based typing plan with circadian multiplier (modeled on PresenceChoreographer) */
export class PresenceChoreographer {
  constructor(private cfg: AntiBanConfig) {}

  /** Circadian multiplier: malam lebih lambat, siang cepat */
  getCircadianMultiplier(): number {
    const hour = new Date().getHours();
    if (hour >= 9 && hour < 22) return 1.0 + 0.2 * Math.cos(2 * Math.PI * ((hour - 9) / 13));
    if (hour >= 22 && hour < 24) return 1.2 + 1.3 * ((hour - 22) / 2);
    if (hour >= 0 && hour < 2) return 2.5 + 1.5 * (hour / 2);
    if (hour >= 2 && hour < 6) return 5.0 + 1.0 * Math.cos(Math.PI * ((hour - 2) / 4));
    return 4.0 - 3.0 * ((hour - 6) / 3);
  }

  /** Plan: array {state, durationMs} — caller executes via sendPresenceUpdate */
  computeTypingPlan(messageLength: number): { state: 'composing' | 'paused'; durationMs: number }[] {
    if (messageLength === 0) return [{ state: 'composing', durationMs: 600 }];
    const wpm = Math.max(10, Math.min(120, gaussianJitter(this.cfg.typingWPM, this.cfg.typingWPMStdDev * 2 + this.cfg.typingWPM)));
    const cps = (wpm * 5) / 60;
    let targetMs = Math.min((messageLength / cps) * 1000 * this.getCircadianMultiplier(), 90_000);
    targetMs = Math.max(targetMs, 600);

    const plan: { state: 'composing' | 'paused'; durationMs: number }[] = [];
    const chunks = Math.max(1, Math.ceil(messageLength / 10));
    let remaining = targetMs;
    for (let i = 0; i < chunks && remaining > 0; i++) {
      const chunkMs = Math.floor(remaining / (chunks - i));
      if (chunkMs <= 0) break;
      const isLast = i === chunks - 1;
      if (!isLast && Math.random() < 0.08) {
        plan.push({ state: 'composing', durationMs: chunkMs });
        remaining -= chunkMs;
        const pause = gaussianJitter(800, 3500) * this.getCircadianMultiplier();
        plan.push({ state: 'paused', durationMs: Math.floor(pause) });
      } else {
        if (plan.length === 0 || plan[plan.length - 1].state === 'paused') {
          plan.push({ state: 'composing', durationMs: chunkMs });
        } else {
          plan[plan.length - 1].durationMs += chunkMs;
        }
        remaining -= chunkMs;
      }
    }
    if (Math.random() < 0.4) {
      plan.push({ state: 'paused', durationMs: gaussianJitter(200, 800) });
    }
    return plan;
  }

  /** 5% chance distraction pause 5-20 min. Dimatikan bila cfg.distraction = false. */
  shouldPauseForDistraction(): { pause: boolean; durationMs: number } {
    if (this.cfg.distraction === false) return { pause: false, durationMs: 0 };
    if (Math.random() < 0.05) {
      return { pause: true, durationMs: gaussianJitter(300_000, 1_200_000) };
    }
    return { pause: false, durationMs: 0 };
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }
}

// ================= RECONNECTTHROTTLE (dari baileys-antiban, MIT) =================
// ReconnectThrottle — ramp kecepatan 10%→100% selama 60 detik setelah reconnect
export class ReconnectThrottle {
  private config: Required<ReconnectThrottleConfig>;
  private reconnectAt: number | null = null;
  private lastDisconnectAt: number | null = null;
  private disconnectCount = 0;

  constructor(config: ReconnectThrottleConfig | AntiBanConfig = {}) {
    this.config = { ...DEFAULT_RECONNECT_CONFIG, ...config };
  }

  get multiplier(): number {
    if (!this.reconnectAt) return 1;
    const elapsed = Date.now() - this.reconnectAt;
    if (elapsed >= this.config.rampDurationMs) {
      this.reconnectAt = null;
      return 1;
    }
    // 10% → 100% linear selama ramp window
    const progress = Math.min(1, elapsed / this.config.rampDurationMs);
    return this.config.minMultiplier + (1 - this.config.minMultiplier) * progress;
  }

  onDisconnect() {
    this.lastDisconnectAt = Date.now();
    this.disconnectCount++;
  }

  onReconnect() {
    this.reconnectAt = Date.now();
    this.disconnectCount = 0;
  }

  exportState() {
    return { reconnectAt: this.reconnectAt, lastDisconnectAt: this.lastDisconnectAt, disconnectCount: this.disconnectCount };
  }

  restoreState(state: any) {
    if (!state) return;
    this.reconnectAt = state.reconnectAt ?? null;
    this.lastDisconnectAt = state.lastDisconnectAt ?? null;
    this.disconnectCount = state.disconnectCount ?? 0;
  }
}
interface ReconnectThrottleConfig {
  minMultiplier?: number;
  rampDurationMs?: number;
}
const DEFAULT_RECONNECT_CONFIG: Required<ReconnectThrottleConfig> = {
  minMultiplier: 0.1,
  rampDurationMs: 60000,
};

// ================= BANRECOVERYORCHESTRATOR (dari baileys-antiban, MIT) =================
// BanRecoveryOrchestrator — rencana pemulihan berjenjang setelah ban/restriction
export class BanRecoveryOrchestrator {
  private config: Required<BanRecoveryConfig>;
  private state: BanRecoveryState = {
    currentPhase: 'normal',
    recoveryStartedAt: null,
    phaseStartAt: null,
    banType: null,
    violations: 0,
  };

  constructor(config: BanRecoveryConfig | AntiBanConfig = {}) {
    this.config = { ...DEFAULT_BAN_RECOVERY_CONFIG, ...config };
  }

  /** Laporkan error dari Baileys; klasifikasi ban + aktifkan recovery */
  reportError(errorType: string, errorDetail?: string) {
    if (this.state.currentPhase !== 'normal') {
      // sudah dalam recovery — tambah violation count
      this.state.violations++;
      return { action: 'in_recovery', phase: this.state.currentPhase };
    }

    let banType: 'timelock' | 'rate_overlimit' | 'soft_ban' | 'hard_ban' | null = null;
    let cooldownMs = 0;
    let speedPct = 0;
    let weeklyIncrease = 0;

    if (errorType.includes('463') || errorType === 'timelock') {
      banType = 'timelock';
      cooldownMs = this.config.timelockCooldownMs;
      speedPct = this.config.timelockSpeedPct;
      weeklyIncrease = this.config.timelockWeeklyIncreasePct;
    } else if (errorType.includes('429') || errorType === 'rate_overlimit') {
      banType = 'rate_overlimit';
      cooldownMs = this.config.rateOverlimitCooldownMs;
      speedPct = this.config.rateOverlimitSpeedPct;
      weeklyIncrease = this.config.rateOverlimitWeeklyIncreasePct;
    } else if (errorType.includes('blocked') || errorType === 'soft_ban') {
      banType = 'soft_ban';
      cooldownMs = this.config.softBanCooldownMs;
      speedPct = this.config.softBanSpeedPct;
      weeklyIncrease = this.config.softBanWeeklyIncreasePct;
    } else if (errorType === 'hard_ban' || errorType === 'logout') {
      banType = 'hard_ban';
      cooldownMs = this.config.hardBanCooldownMs;
      speedPct = 0;
      weeklyIncrease = 0;
    }

    if (!banType) return { action: 'ignore', phase: this.state.currentPhase };

    const now = Date.now();
    this.state = {
      currentPhase: 'recovering',
      recoveryStartedAt: now,
      phaseStartAt: now,
      banType,
      violations: 1,
    };
    return { action: 'recovery_started', banType, cooldownMs, speedPct, weeklyIncrease };
  }

  /** Cek apakah boleh kirim sekarang; beri multiplier kecepatan + sisa cooldown */
  beforeSend(): { allowed: boolean; speedMultiplier: number; reason?: string } {
    if (this.state.currentPhase === 'normal') return { allowed: true, speedMultiplier: 1 };

    const now = Date.now();
    const cooldownMs = this.cooldownFor(this.state.banType);
    const elapsed = now - (this.state.phaseStartAt ?? 0);

    // Masih dalam cooldown → blok
    if (elapsed < cooldownMs) {
      const hoursLeft = Math.ceil((cooldownMs - elapsed) / 3600000);
      return { allowed: false, speedMultiplier: 0, reason: `Ban recovery cooldown (${this.state.banType}) — ${hoursLeft}h left` };
    }

    // Cooldown selesai → tahap ramping
    const rampPct = this.rampPctFor(this.state.banType);
    const weeksSinceStart = Math.floor((now - (this.state.recoveryStartedAt ?? 0)) / (7 * 86400000));
    const speedMultiplier = Math.min(1, (rampPct + weeksSinceStart * this.weeklyIncFor(this.state.banType)) / 100);
    return { allowed: true, speedMultiplier: Math.max(0.02, speedMultiplier) };
  }

  /** Sisa cooldown ban recovery (ms). 0 = tidak dalam cooldown. */
  remainingMs(): number {
    if (this.state.currentPhase === 'normal') return 0;
    const cooldownMs = this.cooldownFor(this.state.banType);
    const elapsed = Date.now() - (this.state.phaseStartAt ?? 0);
    return Math.max(0, cooldownMs - elapsed);
  }

  /** Sembuh total — reset ke normal */
  markRecovered() {
    this.state = { currentPhase: 'normal', recoveryStartedAt: null, phaseStartAt: null, banType: null, violations: 0 };
  }

  exportState() {
    return this.state;
  }

  restoreState(state: any) {
    if (!state) return;
    this.state = { ...this.state, ...state };
  }

  private cooldownFor(banType: string | null): number {
    switch (banType) {
      case 'timelock': return this.config.timelockCooldownMs;
      case 'rate_overlimit': return this.config.rateOverlimitCooldownMs;
      case 'soft_ban': return this.config.softBanCooldownMs;
      case 'hard_ban': return this.config.hardBanCooldownMs;
      default: return 0;
    }
  }
  private rampPctFor(banType: string | null): number {
    switch (banType) {
      case 'timelock': return this.config.timelockSpeedPct;
      case 'rate_overlimit': return this.config.rateOverlimitSpeedPct;
      case 'soft_ban': return this.config.softBanSpeedPct;
      case 'hard_ban': return 0;
      default: return 100;
    }
  }
  private weeklyIncFor(banType: string | null): number {
    switch (banType) {
      case 'timelock': return this.config.timelockWeeklyIncreasePct;
      case 'rate_overlimit': return this.config.rateOverlimitWeeklyIncreasePct;
      case 'soft_ban': return this.config.softBanWeeklyIncreasePct;
      default: return 0;
    }
  }
}

interface BanRecoveryConfig {
  timelockCooldownMs?: number;
  timelockSpeedPct?: number;
  timelockWeeklyIncreasePct?: number;
  rateOverlimitCooldownMs?: number;
  rateOverlimitSpeedPct?: number;
  rateOverlimitWeeklyIncreasePct?: number;
  softBanCooldownMs?: number;
  softBanSpeedPct?: number;
  softBanWeeklyIncreasePct?: number;
  hardBanCooldownMs?: number;
}
interface BanRecoveryState {
  currentPhase: 'normal' | 'recovering';
  recoveryStartedAt: number | null;
  phaseStartAt: number | null;
  banType: string | null;
  violations: number;
}
const DEFAULT_BAN_RECOVERY_CONFIG: Required<BanRecoveryConfig> = {
  timelockCooldownMs: 24 * 3600000, // 24 jam
  timelockSpeedPct: 10,
  timelockWeeklyIncreasePct: 15,
  rateOverlimitCooldownMs: 4 * 3600000, // 4 jam
  rateOverlimitSpeedPct: 25,
  rateOverlimitWeeklyIncreasePct: 25,
  softBanCooldownMs: 48 * 3600000, // 48 jam
  softBanSpeedPct: 5,
  softBanWeeklyIncreasePct: 10,
  hardBanCooldownMs: 7 * 86400000, // 7 hari
};

// ================= REPLYRATIO (dari baileys-antiban, MIT) =================
// ReplyRatioGuard — blokir kirim ke kontak yang nggak pernah balas (rasio < 10%)
export class ReplyRatioGuard {
  private config: Required<ReplyRatioConfig>;
  private contacts = new Map<string, ReplyContactRecord>();
  private globalSent = 0;
  private globalReceived = 0;

  constructor(config: ReplyRatioConfig | AntiBanConfig = {}) {
    this.config = { ...DEFAULT_REPLY_RATIO_CONFIG, ...config };
  }

  beforeSend(jid: string): { allowed: boolean; reason?: string } {
    if (!this.config.enabled) return { allowed: true };
    if (this.isGroup(jid) && this.config.scope === 'individual') return { allowed: true };

    const record = this.contacts.get(jid);
    if (!record) return { allowed: true }; // kontak baru — izinkan dulu

    // Cek cooldown
    if (record.cooledUntil) {
      if (Date.now() < record.cooledUntil) {
        const hoursLeft = Math.ceil((record.cooledUntil - Date.now()) / 3600000);
        return {
          allowed: false,
          reason: `Reply ratio cooldown — ${record.sent} sent, ${record.received} received. Retry in ${hoursLeft}h`,
        };
      } else {
        // Masa cooldown telah selesai! Beri kesempatan (grace period) untuk kirim pesan lagi.
        // Hapus cooledUntil dan turunkan counter sent di bawah threshold enforce agar tidak langsung loop cooldown.
        delete record.cooledUntil;
        record.sent = Math.max(0, this.config.minMessagesBeforeEnforce - 1);
        this.contacts.set(jid, record);
        return { allowed: true };
      }
    }

    // Cek rasio kalau sudah kirim cukup banyak
    if (record.sent >= this.config.minMessagesBeforeEnforce) {
      const ratio = record.sent === 0 ? 1 : record.received / record.sent;
      if (ratio < this.config.minRatio) {
        record.cooledUntil = Date.now() + this.config.cooldownHoursOnViolation * 3600000;
        return {
          allowed: false,
          reason: `Reply ratio too low (${(ratio * 100).toFixed(1)}% < ${(this.config.minRatio * 100).toFixed(1)}%). Cooldown ${this.config.cooldownHoursOnViolation}h`,
        };
      }
    }

    return { allowed: true };
  }

  /** Sisa cooldown reply-ratio untuk sebuah kontak (ms). 0 = tidak diblokir. */
  remainingMs(jid: string): number {
    const record = this.contacts.get(jid);
    if (!record?.cooledUntil) return 0;
    return Math.max(0, record.cooledUntil - Date.now());
  }

  recordSent(jid: string): void {
    this.globalSent++;
    const record = this.contacts.get(jid) || { sent: 0, received: 0 };
    record.sent++;
    this.contacts.set(jid, record as ReplyContactRecord);
  }

  recordReceived(jid: string): void {
    this.globalReceived++;
    const record = this.contacts.get(jid) || { sent: 0, received: 0 };
    record.received++;
    delete (record as ReplyContactRecord).cooledUntil; // mereka balas! clear cooldown
    this.contacts.set(jid, record);
  }

  suggestReply(jid: string): { shouldReply: boolean; suggestedText?: string } {
    if (!this.config.enabled) return { shouldReply: false };
    if (this.isGroup(jid) && this.config.scope === 'individual') return { shouldReply: false };
    if (Math.random() < this.config.inboundAutoReplyProbability) {
      const templates = this.config.autoReplyTemplates;
      return { shouldReply: true, suggestedText: templates[Math.floor(Math.random() * templates.length)] };
    }
    return { shouldReply: false };
  }

  getStats() {
    const perContact = Array.from(this.contacts.entries()).map(([jid, r]) => ({
      jid,
      sent: r.sent,
      received: r.received,
      ratio: r.sent === 0 ? 0 : r.received / r.sent,
      cooledUntil: r.cooledUntil ?? null,
    }));
    return {
      perContact,
      globalSent: this.globalSent,
      globalReceived: this.globalReceived,
      globalRatio: this.globalSent === 0 ? 0 : this.globalReceived / this.globalSent,
      contactsOnCooldown: perContact.filter((c) => c.cooledUntil && Date.now() < c.cooledUntil).length,
    };
  }

  exportState() {
    return { contacts: Array.from(this.contacts.entries()), globalSent: this.globalSent, globalReceived: this.globalReceived };
  }

  restoreState(state: any) {
    if (!state) return;
    if (state.contacts && Array.isArray(state.contacts)) this.contacts = new Map(state.contacts);
    this.globalSent = state.globalSent ?? 0;
    this.globalReceived = state.globalReceived ?? 0;
  }

  resetCooldown(jid?: string): void {
    if (jid) {
      // Hapus kontak agar statusnya bersih seperti kontak baru
      this.contacts.delete(jid);
    } else {
      // Jika reset global, hapus seluruh kontak yang terkena cooldown atau di atas batas enforce
      for (const [key, record] of this.contacts.entries()) {
        if (record.cooledUntil || record.sent >= this.config.minMessagesBeforeEnforce) {
          this.contacts.delete(key);
        }
      }
    }
  }

  updateConfig(cfg: Partial<ReplyRatioConfig>): void {
    this.config = { ...this.config, ...cfg };
  }

  getConfig(): Required<ReplyRatioConfig> {
    return { ...this.config };
  }

  private isGroup(jid: string): boolean {
    return jid.endsWith('@g.us');
  }
}

interface ReplyRatioConfig {
  enabled?: boolean;
  minRatio?: number;
  minMessagesBeforeEnforce?: number;
  inboundAutoReplyProbability?: number;
  autoReplyTemplates?: string[];
  cooldownHoursOnViolation?: number;
  scope?: 'individual' | 'all';
}
interface ReplyContactRecord {
  sent: number;
  received: number;
  cooledUntil?: number;
}
const DEFAULT_REPLY_RATIO_CONFIG: Required<ReplyRatioConfig> = {
  enabled: true,
  minRatio: 0.1,
  minMessagesBeforeEnforce: 5,
  inboundAutoReplyProbability: 0.25,
  autoReplyTemplates: ['👍', '👌', 'ok', 'noted', 'thanks', '🙏', 'got it'],
  cooldownHoursOnViolation: 24,
  scope: 'individual',
};

// ================= CONTACTGRAPH (dari baileys-antiban, MIT) =================
// ContactGraphWarmer — handshake wajib sebelum bulk/group, lurk period 12 jam
export class ContactGraphWarmer {
  private config: Required<ContactGraphConfig>;
  private contacts = new Map<string, GraphContactRecord>();
  private groups = new Map<string, GroupRecord>();
  private strangerMessagesToday = 0;
  private lastStrangerResetDay = this.getCurrentDay();

  constructor(config: ContactGraphConfig | AntiBanConfig = {}) {
    this.config = { ...DEFAULT_CONTACT_GRAPH_CONFIG, ...config };
  }

  canMessage(jid: string): { allowed: boolean; reason?: string; needsHandshake?: boolean } {
    if (!this.config.enabled) return { allowed: true };

    const currentDay = this.getCurrentDay();
    if (currentDay !== this.lastStrangerResetDay) {
      this.strangerMessagesToday = 0;
      this.lastStrangerResetDay = currentDay;
    }

    if (this.isGroup(jid)) return this.checkGroupMessage(jid);
    return this.checkIndividualMessage(jid);
  }

  /** Catat pengirim pesan masuk sebagai kontak yang dikenal / lengkapi handshake */
  recordIncoming(jid: string): void {
    if (this.isGroup(jid)) return;
    const record = this.contacts.get(jid);
    if (!record) {
      // Kontak baru yang menghubungi kita = langsung 'known' (mereka yang mulai)
      this.contacts.set(jid, { state: 'known' } as GraphContactRecord);
      return;
    }
    if (record.state === 'stranger' || record.state === 'handshake_sent') {
      record.state = 'known';
      this.contacts.set(jid, record);
    }
  }

  markGroupJoined(groupJid: string): void {
    this.groups.set(groupJid, { joinedAt: Date.now() });
  }

  /** Sisa jeda handshake/lurk untuk sebuah kontak (ms). 0 = boleh kirim. */
  remainingMs(jid: string): number {
    // Guard dimatikan -> tidak pernah memblokir, jangan jadwalkan auto-resume.
    if (!this.config.enabled) return 0;

    if (this.isGroup(jid)) {
      const group = this.groups.get(jid);
      if (!group) return this.config.groupLurkPeriodMs;
      return Math.max(0, group.joinedAt + this.config.groupLurkPeriodMs - Date.now());
    }
    const record = this.contacts.get(jid);
    // Belum ada record: canMessage() belum sempat mendaftarkannya sebagai
    // 'handshake_sent'. Tetap laporkan jeda handshake penuh supaya pemanggil
    // tidak salah menjadwalkan auto-resume 5 detik untuk blokir 1 jam.
    if (!record) return this.config.handshakeMinDelayMs;
    if (record.state === 'known') return 0;
    if (record.state === 'stranger') return this.config.handshakeMinDelayMs;
    return Math.max(0, (record.handshakeSentAt ?? 0) + this.config.handshakeMinDelayMs - Date.now());
  }

  recordSent(jid: string): void {
    if (this.isGroup(jid)) return;
    const record = this.contacts.get(jid);
    if (record?.state === 'stranger') this.strangerMessagesToday++;
  }

  getStats() {
    return {
      knownContacts: Array.from(this.contacts.values()).filter((c) => c.state === 'known').length,
      pendingHandshakes: Array.from(this.contacts.values()).filter((c) => c.state === 'handshake_sent').length,
      strangersToday: this.strangerMessagesToday,
      groupsJoined: Array.from(this.groups.entries()).map(([g, rec]) => ({
        groupJid: g,
        joinedAt: rec.joinedAt,
        firstSendUnlocksAt: rec.joinedAt + this.config.groupLurkPeriodMs,
      })),
    };
  }

  exportState() {
    return {
      contacts: Array.from(this.contacts.entries()),
      groups: Array.from(this.groups.entries()),
      strangerMessagesToday: this.strangerMessagesToday,
      lastStrangerResetDay: this.lastStrangerResetDay,
    };
  }

  restoreState(state: any) {
    if (!state) return;
    if (state.contacts && Array.isArray(state.contacts)) this.contacts = new Map(state.contacts);
    if (state.groups && Array.isArray(state.groups)) this.groups = new Map(state.groups);
    this.strangerMessagesToday = state.strangerMessagesToday ?? 0;
    this.lastStrangerResetDay = state.lastStrangerResetDay ?? this.getCurrentDay();
  }

  private checkIndividualMessage(jid: string): { allowed: boolean; reason?: string; needsHandshake?: boolean } {
    const record = this.contacts.get(jid);
    if (!record) {
      // Kontak baru — wajib handshake dulu
      this.contacts.set(jid, { state: 'handshake_sent', handshakeSentAt: Date.now() } as GraphContactRecord);
      return { allowed: false, reason: 'Handshake required — first message to stranger', needsHandshake: true };
    }

    if (record.state === 'stranger') {
      return { allowed: false, reason: 'Contact is stranger — handshake required', needsHandshake: true };
    }

    if (record.state === 'handshake_sent') {
      const waitMs = (record.handshakeSentAt ?? 0) + this.config.handshakeMinDelayMs - Date.now();
      if (waitMs > 0) {
        const mins = Math.ceil(waitMs / 60000);
        return { allowed: false, reason: `Handshake cooldown — ${mins}m left`, needsHandshake: true };
      }
      return { allowed: true };
    }

    // known
    if (this.strangerMessagesToday >= this.config.maxStrangerMessagesPerDay) {
      return { allowed: false, reason: `Daily stranger message cap reached (${this.config.maxStrangerMessagesPerDay})` };
    }

    return { allowed: true };
  }

  private checkGroupMessage(jid: string): { allowed: boolean; reason?: string } {
    if (!this.config.requireHandshakeBeforeGroupSend) return { allowed: true };

    const group = this.groups.get(jid);
    if (!group) {
      return { allowed: false, reason: 'Group not registered — must mark joined first' };
    }

    const lurkLeft = group.joinedAt + this.config.groupLurkPeriodMs - Date.now();
    if (lurkLeft > 0) {
      const hours = Math.ceil(lurkLeft / 3600000);
      return { allowed: false, reason: `Group lurk period — ${hours}h left before first send` };
    }

    return { allowed: true };
  }

  private isGroup(jid: string): boolean {
    return jid.endsWith('@g.us');
  }

  private getCurrentDay(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

interface ContactGraphConfig {
  enabled?: boolean;
  requireHandshakeBeforeGroupSend?: boolean;
  handshakeMinDelayMs?: number;
  groupLurkPeriodMs?: number;
  maxStrangerMessagesPerDay?: number;
  autoRegisterOnIncoming?: boolean;
}
type ContactState = 'stranger' | 'handshake_sent' | 'handshake_complete' | 'known';
interface GraphContactRecord {
  state: ContactState;
  handshakeSentAt?: number;
}
interface GroupRecord {
  joinedAt: number;
}
const DEFAULT_CONTACT_GRAPH_CONFIG: Required<ContactGraphConfig> = {
  enabled: false, // opt-in: kalau true, pesan pertama ke kontak baru diblokir sampai handshake
  requireHandshakeBeforeGroupSend: true,
  handshakeMinDelayMs: 3600000, // 1 jam
  groupLurkPeriodMs: 43200000, // 12 jam
  maxStrangerMessagesPerDay: 5,
  autoRegisterOnIncoming: true,
};