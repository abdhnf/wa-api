import type { AntiBanConfig } from './01-tipe.js';
import type { ReplyRatioConfig } from './10-reply-ratio.js';
import type { ContactGraphConfig } from './11-contact-graph.js';

export const DEFAULT_ANTIBAN_CONFIG: AntiBanConfig = {
  minDelayMs: 1500,
  maxDelayMs: 5000,
  maxPerMinute: 8,
  maxPerHour: 200,
  maxPerDay: 1500,
  newChatDelayMs: 3000,
  maxIdenticalMessages: 3,
  burstAllowance: 3,
  distraction: true,
  // Contact graph default: NONAKTIF. Mengaktifkannya memblokir pesan pertama ke
  // setiap kontak baru selama handshakeMinDelayMs — mematikan blast. Hanya boleh
  // dinyalakan untuk sesi chat interaktif, bukan sesi blast.
  contactGraph: { enabled: false },
  warmupDays: 7,
  day1Limit: 20,
  growthFactor: 1.8,
  inactivityThresholdHours: 72,
  resumeBufferMs: 10_000,
  typingWPM: 45,
  typingWPMStdDev: 15,
};

export interface AntiBanPreset {
  id: 'strict' | 'balanced' | 'broadcast' | 'custom';
  name: string;
  description: string;
  rateLimiter: Partial<AntiBanConfig>;
  replyRatio: Partial<ReplyRatioConfig>;
  /** Konfigurasi contact graph per preset. Wajib dideklarasikan eksplisit. */
  contactGraph?: Partial<ContactGraphConfig>;
}

export const ANTIBAN_PRESETS: Record<string, AntiBanPreset> = {
  strict: {
    id: 'strict',
    name: 'Strict / High Security',
    description: 'Keamanan maksimum untuk nomor baru atau akun pribadi penting. Delay panjang, kuota ketat, Reply Ratio 10%.',
    rateLimiter: {
      minDelayMs: 3000,
      maxDelayMs: 8000,
      maxPerMinute: 5,
      maxPerHour: 100,
      maxIdenticalMessages: 2,
      distraction: false,
    },
    replyRatio: {
      enabled: true,
      minRatio: 0.1,
      minMessagesBeforeEnforce: 5,
      cooldownHoursOnViolation: 24,
    },
    // Nomor penting / pribadi: wajib handshake ke kontak baru.
    contactGraph: { enabled: true, handshakeMinDelayMs: 3_600_000, maxStrangerMessagesPerDay: 5 },
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced / Standard',
    description: 'Profil standar operasional CRM interaktif. Delay manusiawi 1.5 - 5s, Reply Ratio aktif 10%.',
    rateLimiter: {
      minDelayMs: 1500,
      maxDelayMs: 5000,
      maxPerMinute: 8,
      maxPerHour: 200,
      maxIdenticalMessages: 3,
      distraction: true,
    },
    replyRatio: {
      enabled: true,
      minRatio: 0.1,
      minMessagesBeforeEnforce: 5,
      cooldownHoursOnViolation: 24,
    },
    // SENGAJA NONAKTIF. Ketiga sesi produksi berjalan pada preset ini; menyalakan
    // contactGraph di sini akan langsung memblokir blast ke kontak baru begitu
    // di-deploy, tanpa peringatan. Nilai handshake 5 menit disiapkan agar tinggal
    // diaktifkan setelah ada keputusan eksplisit + uji blast kecil.
    contactGraph: { enabled: false, handshakeMinDelayMs: 300_000, maxStrangerMessagesPerDay: 50 },
  },
  broadcast: {
    id: 'broadcast',
    name: 'Broadcast / Notification',
    description: 'Khusus blast pengumuman & notifikasi satu arah. Reply Ratio dinonaktifkan agar tidak terkena cooldown, delay 2 - 5s.',
    rateLimiter: {
      minDelayMs: 2000,
      maxDelayMs: 5000,
      maxPerMinute: 10,
      maxPerHour: 300,
      maxIdenticalMessages: 10,
      distraction: false,
    },
    replyRatio: {
      enabled: false,
      minRatio: 0.0,
      minMessagesBeforeEnforce: 999999,
      cooldownHoursOnViolation: 0,
    },
    // Blast memang mengirim ke kontak baru — handshake akan memacetkannya total.
    contactGraph: { enabled: false },
  },
};
