// Types shared — TANPA data dummy. Semua data diambil dari backend (SQLite).

export interface SessionMetrics {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  avgPacingDelaySec: number;
  uptimeHours: number;
  disconnectCountToday: number;
  hourlyStats: { hour: string; sent: number; failed: number }[];
}

export interface Session {
  id: string;
  name: string;
  phone: string;
  status: 'connected' | 'connecting' | 'disconnected';
  riskScore: number; // 0-100 (baileys-antiban)
  warmupDay: number; // 1-7
  numberProfile?: 'fresh' | 'mature';
  messagesSentToday: number;
  deliveryRate: number; // e.g. 98.5%
  metrics: SessionMetrics;
}

export interface User {
  id: string;
  name: string;
  email: string;
  apiKey: string;
  quotaPerDay: number;
  usedToday: number;
  status: 'active' | 'suspended';
  role: 'admin' | 'subscription' | 'user';
  assignedSessionId: string | null;
}

export interface QueueItem {
  id: string;
  sessionId: string;
  recipient: string;
  text: string;
  mode: 'text' | 'media' | 'location';
  status: 'pending' | 'pacing' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'invalid_number' | 'not_registered' | 'cancelled';
  errorDetail?: string;
  jitterDelayMs: number;
  remainingDelayMs?: number;
  timestamp: string;
  isBulk?: boolean;
}

export interface AntiBanConfig {
  preset: 'conservative' | 'moderate' | 'aggressive';
  minDelaySec: number;
  maxDelaySec: number;
  warmupActive: boolean;
  adaptiveThrottle: boolean;
  groupGuard: boolean;
  autoPauseOnFailure: boolean;
}

// Fallback kosong (bukan dummy) — dipakai kalau API belum siap
export const EMPTY_SESSIONS: Session[] = [];
export const EMPTY_USERS: User[] = [];
export const EMPTY_QUEUE: QueueItem[] = [];