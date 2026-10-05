import { gaussianJitter } from './03-util.js';
import type { AntiBanConfig } from './01-tipe.js';

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
