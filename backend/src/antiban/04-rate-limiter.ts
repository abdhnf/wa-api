import { MS, gaussianJitter, hashContent, identicalKey, normalizeContentForHash } from './03-util.js';
import type { AntiBanConfig, AntiBanState } from './01-tipe.js';

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
