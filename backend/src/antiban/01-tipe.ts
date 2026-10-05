import type { ContactGraphConfig } from './11-contact-graph.js';

export interface AntiBanState {
  warmup: {
    startedAt: number;
    lastActiveAt: number;
    dailyCounts: number[];
    graduated: boolean;
  };
  rateLimiter: {
    messages: { timestamp: number; recipient: string; contentHash: string }[];
    identicalCount: Record<string, { count: number; firstSeen: number; lastSeen: number }>;
    knownChats: string[];
    burstCount: number;
    lastMessageTime: number;
  };
  timelock: {
    isActive: boolean;
    expiresAt: number | null;
    errorCount: number;
    enforcementType?: string | null;
    knownChats: string[];
  };
  reconnect?: any;
  recovery?: any;
  replyRatio?: any;
  contactGraph?: any;
}

export interface AntiBanConfig {
  minDelayMs: number;
  maxDelayMs: number;
  maxPerMinute: number;
  maxPerHour: number;
  maxPerDay: number;
  newChatDelayMs: number;
  maxIdenticalMessages: number;
  burstAllowance: number;
  /** Jeda distraksi manusiawi 5-20 menit. Wajib false untuk jalur blast/broadcast. */
  distraction: boolean;
  warmupDays: number;
  day1Limit: number;
  growthFactor: number;
  inactivityThresholdHours: number;
  resumeBufferMs: number;
  typingWPM: number;
  typingWPMStdDev: number;
  /**
   * Konfigurasi ContactGraphWarmer. Dulu guard ini dibangun dengan `cfg` utuh
   * (AntiBanConfig) yang tidak punya field apa pun milik contactGraph, sehingga
   * seluruh isinya selalu jatuh ke DEFAULT_CONTACT_GRAPH_CONFIG dan setiap
   * perubahan dari preset/panel dibuang diam-diam.
   */
  contactGraph?: ContactGraphConfig;
}
