import type { AntiBanConfig, AntiBanState } from './01-tipe.js';

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
      // Dipulihkan agar tipe sanksi (BIZ_QUALITY, WEB_COMPANION_ONLY, dst) tidak
      // hilang dari pesan reason setelah service restart.
      this.enforcementType = state.enforcementType ?? null;
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
