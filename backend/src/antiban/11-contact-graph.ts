import type { AntiBanConfig } from './01-tipe.js';

// ================= CONTACTGRAPH (dari baileys-antiban, MIT) =================
// ContactGraphWarmer — handshake wajib sebelum bulk/group, lurk period 12 jam
export class ContactGraphWarmer {
  private config: Required<ContactGraphConfig>;
  private contacts = new Map<string, GraphContactRecord>();
  private groups = new Map<string, GroupRecord>();
  /**
   * Penerima kampanye yang di-approve. Key = `${batchId}::${jid}` supaya approval
   * terikat pada satu kampanye: nomor yang lolos di blast A tetap 'stranger' di
   * pengiriman lain dan tetap wajib handshake.
   */
  private batchApprovals = new Map<string, { jid: string; batchId: string; addedAt: number }>();
  private strangerMessagesToday = 0;
  private lastStrangerResetDay = this.getCurrentDay();

  constructor(config: ContactGraphConfig | AntiBanConfig = {}) {
    this.config = { ...DEFAULT_CONTACT_GRAPH_CONFIG, ...config };
  }

  canMessage(jid: string, batchId?: string | null): { allowed: boolean; reason?: string; needsHandshake?: boolean } {
    if (!this.config.enabled) return { allowed: true };

    // Penerima kampanye yang di-approve boleh lewat. Dicek SEBELUM handshake dan
    // hanya untuk batchId yang cocok — nomor yang pernah masuk blast lain tetap
    // wajib handshake di luar konteks kampanye itu.
    if (this.isBatchApproved(jid, batchId)) return { allowed: true };

    this.pruneExpiredApprovals();

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

  private approvalKey(batchId: string, jid: string): string {
    return `${batchId}::${jid}`;
  }

  /** Buang entri whitelist yang sudah melewati TTL agar tidak menumpuk. */
  private pruneExpiredApprovals(): void {
    const ttl = this.config.batchApprovalTtlMs;
    if (!ttl || ttl <= 0) return;
    const cutoff = Date.now() - ttl;
    for (const [key, rec] of this.batchApprovals) {
      if (rec.addedAt < cutoff) this.batchApprovals.delete(key);
    }
  }

  /**
   * Daftarkan penerima sebuah kampanye agar boleh melewati handshake.
   * Dipanggil otomatis dari enqueue() memakai batchId yang dikirim dashboard.
   */
  approveBatchRecipients(jids: string[], batchId: string): number {
    if (!this.config.batchWhitelist) return 0;
    let added = 0;
    const now = Date.now();
    for (const jid of jids) {
      if (!jid) continue;
      const key = this.approvalKey(batchId, jid);
      if (!this.batchApprovals.has(key)) {
        this.batchApprovals.set(key, { jid, batchId, addedAt: now });
        added++;
      }
    }
    return added;
  }

  /** Apakah jid di-approve untuk batchId tertentu (bukan untuk semua batch). */
  isBatchApproved(jid: string, batchId?: string | null): boolean {
    if (!this.config.batchWhitelist) return false;
    if (!batchId) return false;
    return this.batchApprovals.has(this.approvalKey(batchId, jid));
  }

  /** Cabut approval satu nomor pada satu batch (override manual dari operator). */
  revokeBatchRecipient(jid: string, batchId: string): boolean {
    return this.batchApprovals.delete(this.approvalKey(batchId, jid));
  }

  /** Cabut seluruh approval milik satu kampanye. */
  revokeBatch(batchId: string): number {
    let removed = 0;
    for (const [key, rec] of this.batchApprovals) {
      if (rec.batchId === batchId) { this.batchApprovals.delete(key); removed++; }
    }
    return removed;
  }

  /** Daftar approval, dikelompokkan per batch (untuk panel). */
  getBatchApprovals(): { batchId: string; count: number; addedAt: number }[] {
    const grouped = new Map<string, { batchId: string; count: number; addedAt: number }>();
    for (const rec of this.batchApprovals.values()) {
      const g = grouped.get(rec.batchId);
      if (g) { g.count++; g.addedAt = Math.min(g.addedAt, rec.addedAt); }
      else grouped.set(rec.batchId, { batchId: rec.batchId, count: 1, addedAt: rec.addedAt });
    }
    return [...grouped.values()];
  }

  /** Semua jid yang di-approve pada satu batch. */
  getBatchRecipients(batchId: string): string[] {
    const out: string[] = [];
    for (const rec of this.batchApprovals.values()) {
      if (rec.batchId === batchId) out.push(rec.jid);
    }
    return out;
  }

  /**
   * Terapkan konfigurasi baru tanpa membuang state kontak yang sudah terkumpul.
   * Dipakai saat operator mengganti preset anti-ban.
   */
  updateConfig(config: Partial<ContactGraphConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Konfigurasi yang sedang aktif (untuk ditampilkan di panel). */
  getConfig(): Required<ContactGraphConfig> {
    return { ...this.config };
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
      batchApprovals: Array.from(this.batchApprovals.entries()),
    };
  }

  restoreState(state: any) {
    if (!state) return;
    if (state.contacts && Array.isArray(state.contacts)) this.contacts = new Map(state.contacts);
    if (state.groups && Array.isArray(state.groups)) this.groups = new Map(state.groups);
    this.strangerMessagesToday = state.strangerMessagesToday ?? 0;
    this.lastStrangerResetDay = state.lastStrangerResetDay ?? this.getCurrentDay();
    if (state.batchApprovals && Array.isArray(state.batchApprovals)) {
      this.batchApprovals = new Map(state.batchApprovals);
      this.pruneExpiredApprovals();
    }
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

export interface ContactGraphConfig {
  enabled?: boolean;
  requireHandshakeBeforeGroupSend?: boolean;
  handshakeMinDelayMs?: number;
  groupLurkPeriodMs?: number;
  maxStrangerMessagesPerDay?: number;
  autoRegisterOnIncoming?: boolean;
  /**
   * Penerima kampanye yang didaftarkan eksplisit (nomor + batchId) boleh melewati
   * handshake. Tanpa ini, blast selalu diblokir karena seluruh penerimanya adalah
   * kontak baru. Kuncinya pasangan (batchId, jid) — bukan jid saja — supaya nomor
   * yang pernah masuk satu blast tidak otomatis lolos di pengiriman lain.
   */
  batchWhitelist?: boolean;
  /** Umur entri whitelist sebelum dibuang (default 7 hari). */
  batchApprovalTtlMs?: number;
}
type ContactState = 'stranger' | 'handshake_sent' | 'handshake_complete' | 'known';
interface GraphContactRecord {
  state: ContactState;
  handshakeSentAt?: number;
}
interface GroupRecord {
  joinedAt: number;
}
export const DEFAULT_CONTACT_GRAPH_CONFIG: Required<ContactGraphConfig> = {
  enabled: false, // opt-in: kalau true, pesan pertama ke kontak baru diblokir sampai handshake
  requireHandshakeBeforeGroupSend: true,
  handshakeMinDelayMs: 3600000, // 1 jam
  groupLurkPeriodMs: 43200000, // 12 jam
  maxStrangerMessagesPerDay: 5,
  autoRegisterOnIncoming: true,
  batchWhitelist: true,
  batchApprovalTtlMs: 7 * 24 * 3600 * 1000, // 7 hari
};
