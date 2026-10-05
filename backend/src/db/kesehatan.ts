import { db } from './client.js';

// ============ Health Monitor persistence ============

/** Simpan skor risiko + ringkasan state kesehatan sesi. */
export function setSessionHealth(sessionId: string, score: number, healthState: string | null): void {
  try {
    db.prepare('UPDATE sessions SET risk_score = ?, health_state = ? WHERE id = ?')
      .run(score, healthState, sessionId);
  } catch (e) {
    console.warn(`[db] Gagal menyimpan health state ${sessionId}:`, e);
  }
}

export function getSessionAntiBanSettings(sessionId: string): { preset: string; config: any | null } {
  const row = db.prepare('SELECT antiban_preset, antiban_config FROM sessions WHERE id = ?').get(sessionId) as any;
  let parsedConfig = null;
  if (row?.antiban_config) {
    try {
      parsedConfig = JSON.parse(row.antiban_config);
    } catch {}
  }
  return {
    preset: row?.antiban_preset || 'balanced',
    config: parsedConfig,
  };
}

export function saveSessionAntiBanSettings(sessionId: string, preset: string, config: any): void {
  const configJson = config ? JSON.stringify(config) : null;
  db.prepare('UPDATE sessions SET antiban_preset = ?, antiban_config = ? WHERE id = ?').run(preset, configJson, sessionId);
}

export function deleteSession(id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

// ---------- Settings ----------
export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any;
  return row ? row.value : null;
}

export function getAllSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as any[];
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}
