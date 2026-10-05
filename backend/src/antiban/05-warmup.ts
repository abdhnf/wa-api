import { MS } from './03-util.js';
import type { AntiBanConfig, AntiBanState } from './01-tipe.js';

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
