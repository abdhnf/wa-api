import type { AntiBanConfig } from './01-tipe.js';

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
