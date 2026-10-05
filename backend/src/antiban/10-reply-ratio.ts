import type { AntiBanConfig } from './01-tipe.js';

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

export interface ReplyRatioConfig {
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
