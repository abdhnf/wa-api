import { db } from './client.js';

// ============ LID Resolver persistence ============

export type LidMappingRow = {
  lid: string;
  pn: string;
  phone: string | null;
  learned_at: number;
  seen_count: number;
};

/** Ambil seluruh mapping LID <-> PN untuk hydrate resolver saat boot. */
export function listLidMappings(): LidMappingRow[] {
  try {
    return db.prepare('SELECT lid, pn, phone, learned_at, seen_count FROM lid_mappings').all() as LidMappingRow[];
  } catch (e) {
    console.warn('[db] Gagal membaca lid_mappings:', e);
    return [];
  }
}

/** Simpan/perbarui batch mapping LID <-> PN. */
export function upsertLidMappings(rows: LidMappingRow[]): void {
  if (rows.length === 0) return;
  try {
    const stmt = db.prepare(
      `INSERT INTO lid_mappings (lid, pn, phone, learned_at, seen_count)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(lid) DO UPDATE SET
         pn = excluded.pn,
         phone = COALESCE(excluded.phone, lid_mappings.phone),
         learned_at = excluded.learned_at,
         seen_count = lid_mappings.seen_count + 1`,
    );
    // node:sqlite tidak punya helper .transaction() (itu API better-sqlite3),
    // jadi transaksi ditulis eksplisit.
    db.exec('BEGIN');
    try {
      for (const r of rows) stmt.run(r.lid, r.pn, r.phone, r.learned_at, r.seen_count);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (e) {
    console.warn('[db] Gagal menyimpan lid_mappings:', e);
  }
}

/** Buang mapping lama supaya tabel tidak tumbuh tanpa batas. */
export function pruneLidMappings(keep: number): number {
  try {
    const res = db.prepare(
      `DELETE FROM lid_mappings WHERE lid NOT IN (
         SELECT lid FROM lid_mappings ORDER BY learned_at DESC LIMIT ?
       )`,
    ).run(keep);
    return Number(res.changes || 0);
  } catch (e) {
    console.warn('[db] Gagal prune lid_mappings:', e);
    return 0;
  }
}
