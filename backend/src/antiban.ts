/**
 * AntiBan Engine — arsitektur terinspirasi baileys-antiban (kobie3717, MIT).
 *
 * Berkas ini sengaja hanya meneruskan (re-export): isinya sudah dipisah per
 * guard di `antiban/`. Pemakai lama tidak perlu berubah — impor dari
 * './antiban.js' tetap bekerja seperti sebelumnya.
 *
 * Daftar nama di bawah SENGAJA eksplisit, bukan `export *`. Sebagian simbol
 * harus diekspor antar modul hasil (MS, hashContent, identicalKey,
 * ReplyRatioConfig) padahal dulu privat di berkas ini; `export *` akan ikut
 * membocorkannya ke API publik. Daftar ini diturunkan otomatis dari
 * deklarasi `export` berkas asli, jadi permukaan API-nya persis sama.
 *
 * Urutan impor mengikuti graf dependensi, bukan urutan asli berkas:
 * `AntiBanConfig` merujuk `ContactGraphConfig` yang dulu dideklarasikan jauh
 * di bawahnya.
 *
 * - antiban/01-tipe.ts          AntiBanState, AntiBanConfig
 * - antiban/02-preset.ts        preset strict/balanced/broadcast
 * - antiban/03-util.ts          jitter, hash konten, normalisasi
 * - antiban/04-rate-limiter.ts  sliding window + identical spam guard
 * - antiban/05-warmup.ts        kuota bertahap 7 hari
 * - antiban/06-timelock.ts      penanganan error 463
 * - antiban/07-presence.ts      circadian + rencana mengetik
 * - antiban/08-reconnect.ts     ramp kecepatan setelah reconnect
 * - antiban/09-ban-recovery.ts  pemulihan berjenjang setelah ban
 * - antiban/10-reply-ratio.ts   rasio balasan
 * - antiban/11-contact-graph.ts handshake + lurk period
 */
export type { AntiBanConfig, AntiBanState } from './antiban/01-tipe.js';
export { ANTIBAN_PRESETS, DEFAULT_ANTIBAN_CONFIG } from './antiban/02-preset.js';
export type { AntiBanPreset } from './antiban/02-preset.js';
export { gaussianJitter, normalizeContentForHash } from './antiban/03-util.js';
export { RateLimiter } from './antiban/04-rate-limiter.js';
export { WarmUp } from './antiban/05-warmup.js';
export { TimelockGuard } from './antiban/06-timelock.js';
export { PresenceChoreographer } from './antiban/07-presence.js';
export { ReconnectThrottle } from './antiban/08-reconnect.js';
export { BanRecoveryOrchestrator } from './antiban/09-ban-recovery.js';
export { ReplyRatioGuard } from './antiban/10-reply-ratio.js';
export { ContactGraphWarmer, DEFAULT_CONTACT_GRAPH_CONFIG } from './antiban/11-contact-graph.js';
export type { ContactGraphConfig } from './antiban/11-contact-graph.js';
