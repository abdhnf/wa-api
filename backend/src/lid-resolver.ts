/**
 * LID Resolver — pemetaan dua arah LID <-> PN (phone number).
 *
 * Sejak 2024 WhatsApp memakai LID (Linked Identity). Satu kontak punya dua JID:
 *   - bentuk nomor : "6281234567890@s.whatsapp.net"
 *   - bentuk LID   : "123456789@lid"
 * Pesan bisa datang lewat salah satu bentuk. Kalau sesi enkripsi dibangun di
 * bentuk A lalu pesan masuk di bentuk B, dekripsi gagal -> "Bad MAC".
 *
 * Arsitektur terinspirasi baileys-antiban (kobie3717, MIT), ditulis ulang
 * pure TS tanpa dependency supaya bisa diuji terpisah dari runtime Baileys.
 *
 * Mode rollout (config.mode):
 *   'off'     -> tidak resolve apa pun, perilaku sama seperti sebelumnya
 *   'log'     -> resolve tapi HANYA catat hasilnya, tidak mengubah JID keluar
 *   'enforce' -> pakai hasil resolve sebagai JID kanonik
 * Default 'log' supaya adopsi tidak mengubah perilaku kirim diam-diam.
 */

export type LidMode = 'off' | 'log' | 'enforce';

export interface LidMapping {
  lid: string;
  pn: string;
  phone: string;
  learnedAt: number;
  seenCount: number;
}

export interface LidResolverConfig {
  /** Bentuk kanonik yang dituju. Default 'pn'. */
  canonical?: 'pn' | 'lid';
  /** Batas entri di memori (LRU). Default 10_000. */
  maxEntries?: number;
  /** Mode rollout. Default 'log'. */
  mode?: LidMode;
  /** Hook persistensi — kalau ada, mapping bertahan lintas restart. */
  persistence?: {
    load?: () => Promise<Record<string, LidMapping>> | Record<string, LidMapping>;
    save?: (map: Record<string, LidMapping>) => Promise<void> | void;
  };
  /** Dipanggil setiap resolveCanonical mengubah JID. Untuk audit di mode 'log'. */
  onResolveChange?: (from: string, to: string, context?: string) => void;
}

export interface LidResolverStats {
  totalMappings: number;
  learnedFromEvents: number;
  learnedFromGroups: number;
  lookupsServed: number;
  lookupMisses: number;
  resolveChanges: number;
  canonicalForm: 'pn' | 'lid';
  mode: LidMode;
}

const DEFAULT_CONFIG: Required<Omit<LidResolverConfig, 'persistence' | 'onResolveChange'>> = {
  canonical: 'pn',
  maxEntries: 10_000,
  mode: 'log',
};

export class LidResolver {
  private config: Required<Omit<LidResolverConfig, 'persistence' | 'onResolveChange'>>;
  private persistence?: LidResolverConfig['persistence'];
  private onResolveChange?: LidResolverConfig['onResolveChange'];

  private lidToPn = new Map<string, LidMapping>();
  private pnToLid = new Map<string, string>();

  /**
   * LID yang berubah sejak flush terakhir. Dipakai untuk persistensi inkremental
   * ke SQLite — menulis seluruh tabel tiap learn akan terlalu mahal.
   */
  private dirty = new Set<string>();

  private stats = {
    learnedFromEvents: 0,
    learnedFromGroups: 0,
    lookupsServed: 0,
    lookupMisses: 0,
    resolveChanges: 0,
  };

  constructor(config: LidResolverConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.persistence = config.persistence;
    this.onResolveChange = config.onResolveChange;
    if (this.persistence?.load) void this.hydrate();
  }

  getMode(): LidMode {
    return this.config.mode;
  }

  /**
   * Belajar dari event pesan. Idempotent.
   * Menerima mapping parsial — pakai field apa pun yang tersedia.
   */
  learn(mapping: { lid?: string; pn?: string; phone?: string }): boolean {
    let lid = mapping.lid ? this.normalizeJid(mapping.lid) : undefined;
    let pn = mapping.pn ? this.normalizeJid(mapping.pn) : undefined;

    if (!lid || (!pn && !mapping.phone)) return false;

    if (!pn && mapping.phone) pn = `${mapping.phone}@s.whatsapp.net`;

    if (!lid || !pn) return false;
    if (!lid.endsWith('@lid')) return false;
    if (!pn.endsWith('@s.whatsapp.net')) return false;

    const existing = this.lidToPn.get(lid);
    if (existing) {
      existing.seenCount++;
      existing.learnedAt = Date.now();
      this.dirty.add(lid);
      return false;
    }

    if (this.lidToPn.size >= this.config.maxEntries) this.evictLRU();

    const newMapping: LidMapping = {
      lid,
      pn,
      phone: mapping.phone || pn.split('@')[0],
      learnedAt: Date.now(),
      seenCount: 1,
    };

    this.lidToPn.set(lid, newMapping);
    this.pnToLid.set(pn, lid);
    this.stats.learnedFromEvents++;
    this.dirty.add(lid);

    if (this.persistence?.save) void this.flush();
    return true;
  }

  /**
   * Belajar dari group metadata participants.
   * Mendukung dua bentuk peserta: v6 ({id:'@s.whatsapp.net', lid}) dan
   * v7 ({id:'@lid', phoneNumber}).
   * @returns jumlah mapping BARU yang dipelajari
   */
  learnFromGroupMetadata(participants: Array<{
    id: string;
    lid?: string | null;
    phoneNumber?: string | null;
    phone?: string | null;
    number?: string | null;
  }>): number {
    let learned = 0;
    for (const p of participants) {
      if (!p?.id) continue;
      const domain = p.id.split('@')[1] || '';

      if (domain === 'lid' && (p.phoneNumber || p.phone || p.number)) {
        const raw = p.phoneNumber || p.phone || p.number;
        const pn = raw!.includes('@') ? raw! : `${raw}@s.whatsapp.net`;
        if (this.learn({ lid: p.id, pn })) learned++;
      } else if (domain === 's.whatsapp.net' && p.lid) {
        const lid = p.lid.endsWith('@lid') ? p.lid : `${p.lid}@lid`;
        if (this.learn({ lid, pn: p.id })) learned++;
      }
    }
    this.stats.learnedFromGroups += learned;
    return learned;
  }

  /**
   * Kembalikan bentuk kanonik dari JID apa pun.
   * Kalau tidak dikenal -> kembalikan input apa adanya (tidak throw).
   *
   * Di mode 'log' hasil resolve TIDAK dipakai sebagai return value; hanya
   * dilaporkan lewat onResolveChange. Di mode 'off' tidak resolve sama sekali.
   */
  resolveCanonical(jid: string, context?: string): string {
    if (this.config.mode === 'off' || !jid) return jid;

    const normalized = this.normalizeJid(jid);
    const target = this.config.canonical;
    let resolved = normalized;
    let miss = false;

    if (target === 'pn') {
      if (normalized.endsWith('@lid')) {
        const mapping = this.lidToPn.get(normalized);
        if (mapping) {
          mapping.learnedAt = Date.now();
          resolved = mapping.pn;
        } else {
          miss = true;
        }
      }
    } else {
      if (normalized.endsWith('@s.whatsapp.net')) {
        const lid = this.pnToLid.get(normalized);
        if (lid) {
          const mapping = this.lidToPn.get(lid);
          if (mapping) mapping.learnedAt = Date.now();
          resolved = lid;
        } else {
          miss = true;
        }
      }
    }

    if (miss) this.stats.lookupMisses++;
    else this.stats.lookupsServed++;

    if (resolved !== jid) {
      this.stats.resolveChanges++;
      this.onResolveChange?.(jid, resolved, context);
    }

    return this.config.mode === 'enforce' ? resolved : jid;
  }

  getLid(pn: string): string | null {
    const normalized = this.normalizeJid(pn);
    const lid = this.pnToLid.get(normalized);
    if (lid) {
      const m = this.lidToPn.get(lid);
      if (m) m.learnedAt = Date.now();
    }
    return lid || null;
  }

  getPn(lid: string): string | null {
    const normalized = this.normalizeJid(lid);
    const m = this.lidToPn.get(normalized);
    if (m) {
      m.learnedAt = Date.now();
      return m.pn;
    }
    return null;
  }

  getMapping(jid: string): LidMapping | null {
    const normalized = this.normalizeJid(jid);
    const byLid = this.lidToPn.get(normalized);
    if (byLid) {
      byLid.learnedAt = Date.now();
      return byLid;
    }
    const lid = this.pnToLid.get(normalized);
    if (lid) {
      const m = this.lidToPn.get(lid);
      if (m) {
        m.learnedAt = Date.now();
        return m;
      }
    }
    return null;
  }

  /**
   * Ekstrak mapping dari event messages.upsert Baileys.
   * Baileys kadang mengirim key.remoteJid bentuk LID dengan
   * participant/participantPn berisi bentuk nomor, dan sebaliknya.
   */
  learnFromMessageKey(key: {
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
    participant?: string | null;
    participantAlt?: string | null;
  }): number {
    let learned = 0;
    const pairs: Array<[string | null | undefined, string | null | undefined]> = [
      [key.remoteJid, key.remoteJidAlt],
      [key.participant, key.participantAlt],
    ];
    for (const [a, b] of pairs) {
      if (!a || !b) continue;
      const lid = a.endsWith('@lid') ? a : (b.endsWith('@lid') ? b : null);
      const pn = a.endsWith('@s.whatsapp.net') ? a : (b.endsWith('@s.whatsapp.net') ? b : null);
      if (lid && pn && this.learn({ lid, pn })) learned++;
    }
    return learned;
  }

  getStats(): LidResolverStats {
    return {
      totalMappings: this.lidToPn.size,
      ...this.stats,
      canonicalForm: this.config.canonical,
      mode: this.config.mode,
    };
  }

  /** Snapshot untuk persistensi. */
  exportState(): Record<string, LidMapping> {
    const out: Record<string, LidMapping> = {};
    for (const [lid, m] of this.lidToPn.entries()) out[lid] = m;
    return out;
  }

  async hydrate(): Promise<void> {
    if (!this.persistence?.load) return;
    try {
      const stored = await this.persistence.load();
      if (!stored || typeof stored !== 'object') return;
      for (const [lid, raw] of Object.entries(stored as Record<string, unknown>)) {
        if (typeof raw === 'string') {
          const pn = raw;
          const m: LidMapping = { lid, pn, phone: pn.split('@')[0], learnedAt: Date.now(), seenCount: 1 };
          this.lidToPn.set(lid, m);
          this.pnToLid.set(pn, lid);
        } else if (raw && typeof raw === 'object') {
          const m = raw as LidMapping;
          if (!m.lid || !m.pn) continue;
          this.lidToPn.set(lid, m);
          this.pnToLid.set(m.pn, lid);
        }
      }
    } catch {
      // Hydrate gagal tidak boleh menjatuhkan proses
    }
  }

  /**
   * Hydrate sinkron dari array mapping — dipakai saat boot dari SQLite.
   * Berbeda dari hydrate() yang async via persistence hook.
   */
  hydrateSync(rows: Array<{ lid: string; pn: string; phone?: string; learnedAt?: number; seenCount?: number }>): number {
    if (!Array.isArray(rows)) return 0;
    let loaded = 0;
    for (const r of rows) {
      if (!r?.lid || !r?.pn) continue;
      const lid = this.normalizeJid(r.lid);
      const pn = this.normalizeJid(r.pn);
      if (!lid.endsWith('@lid') || !pn.endsWith('@s.whatsapp.net')) continue;
      if (this.lidToPn.size >= this.config.maxEntries) this.evictLRU();
      this.lidToPn.set(lid, {
        lid,
        pn,
        phone: r.phone ?? pn.split('@')[0],
        learnedAt: r.learnedAt ?? Date.now(),
        seenCount: r.seenCount ?? 1,
      });
      this.pnToLid.set(pn, lid);
      loaded++;
    }
    // Hasil hydrate bukan perubahan baru — jangan ditulis balik ke DB.
    this.dirty.clear();
    return loaded;
  }

  /**
   * Ambil mapping yang berubah sejak flush terakhir, lalu kosongkan penandanya.
   * Dipakai worker persistensi berkala.
   */
  drainDirty(): LidMapping[] {
    const out: LidMapping[] = [];
    for (const lid of this.dirty) {
      const m = this.lidToPn.get(lid);
      if (m) out.push({ ...m });
    }
    this.dirty.clear();
    return out;
  }

  /** Jumlah mapping yang menunggu ditulis ke DB. */
  getDirtyCount(): number {
    return this.dirty.size;
  }

  async flush(): Promise<void> {
    if (!this.persistence?.save) return;
    try {
      await this.persistence.save(this.exportState());
    } catch {
      // Flush gagal tidak boleh menjatuhkan proses
    }
  }

  reset(): void {
    this.lidToPn.clear();
    this.pnToLid.clear();
    this.dirty.clear();
    this.stats = {
      learnedFromEvents: 0,
      learnedFromGroups: 0,
      lookupsServed: 0,
      lookupMisses: 0,
      resolveChanges: 0,
    };
  }

  /**
   * Buang device suffix: "123:45@s.whatsapp.net" -> "123@s.whatsapp.net"
   * Tanpa ini, JID ber-suffix device tidak akan cocok dengan mapping mana pun.
   */
  normalizeJid(jid: string): string {
    if (!jid) return jid;
    return jid.replace(/:\d+@/, '@');
  }

  private evictLRU(): void {
    let oldestLid: string | null = null;
    let oldestTime = Infinity;
    for (const [lid, m] of this.lidToPn.entries()) {
      if (m.learnedAt < oldestTime) {
        oldestTime = m.learnedAt;
        oldestLid = lid;
      }
    }
    if (oldestLid) {
      const m = this.lidToPn.get(oldestLid);
      if (m) this.pnToLid.delete(m.pn);
      this.lidToPn.delete(oldestLid);
    }
  }
}
