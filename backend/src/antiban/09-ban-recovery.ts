import type { AntiBanConfig } from './01-tipe.js';

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
