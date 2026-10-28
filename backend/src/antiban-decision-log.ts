/**
 * Penghubung decision log untuk SessionManager.
 *
 * Kenapa berkas ini terpisah dari `db/decision-log.ts`: `db/decision-log.ts` sengaja
 * hanya tahu soal penyimpanan (murni SQL, tanpa impor domain lain). Berkas ini
 * yang boleh tahu soal konteks sesi — nama preset aktif, dan bagaimana sebuah
 * guard dipanggil. Pemisahan itu menjaga `db/` tetap bisa diuji tanpa memuat
 * seluruh SessionManager.
 *
 * Yang diekspor:
 * - `recordGuardDecision`, `hashRecipient`  — diteruskan dari db/decision-log.ts
 * - `evaluateGuard`                          — diteruskan dari db/decision-log.ts
 * - `getSessionAntiBanPreset`                — nama preset aktif sebuah sesi
 */
export { recordGuardDecision, evaluateGuard, hashRecipient } from './db/decision-log.js';
export type { GuardName, GuardDecision, DecisionRecord } from './db/decision-log.js';

import { getSessionAntiBanSettings } from './db.js';
import { ANTIBAN_PRESETS } from './antiban.js';

/**
 * Nama preset anti-ban yang benar-benar berlaku untuk sebuah sesi.
 *
 * Mengembalikan id preset (`strict` / `balanced` / `broadcast` / `custom`),
 * atau null kalau pengaturan tidak terbaca. Preset ikut dicatat karena
 * keputusan guard tidak bisa ditafsirkan tanpa itu: 'allow' pada preset
 * `broadcast` berarti hal yang sama sekali berbeda dari 'allow' pada `strict`.
 */
export function getSessionAntiBanPreset(sessionId: string): string | null {
  try {
    const settings = getSessionAntiBanSettings(sessionId);
    const presetId = settings.preset;
    if (!presetId) return null;
    // Kalau preset tidak dikenal, tetap laporkan nilai mentahnya — justru itu
    // yang perlu terlihat saat ada salah konfigurasi.
    return ANTIBAN_PRESETS[presetId] ? presetId : `${presetId}(unknown)`;
  } catch {
    return null;
  }
}
