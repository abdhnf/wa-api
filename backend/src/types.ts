// Tipe shared untuk seluruh backend

export type SessionStatus = 'connected' | 'connecting' | 'disconnected';

export interface SessionMetrics {
  totalSent: number;
  totalDelivered: number;
  totalFailed: number;
  avgPacingDelaySec: number;
  uptimeHours: number;
  disconnectCountToday: number;
  hourlyStats: { hour: string; sent: number; failed: number }[];
}

export interface SessionInfo {
  id: string;
  name: string;
  phone: string;
  status: SessionStatus;
  riskScore: number;
  warmupDay: number;
  messagesSentToday: number;
  deliveryRate: number;
  metrics: SessionMetrics;
  userId?: string;
  owner?: { id: string; name: string; email: string };
}

export type MessageMode = 'text' | 'media' | 'location';
export type MessageStatus = 'pending' | 'pacing' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'invalid_number' | 'not_registered';

export interface OutboundMessage {
  id: string;
  sessionId: string;
  userId?: string;
  mode: MessageMode;
  to: string;
  batchId?: string;
  text?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimeType?: string;
  mediaType?: 'image' | 'document' | 'audio' | 'video';
  fileName?: string;
  caption?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
  status: MessageStatus;
  errorDetail?: string;
  jitterDelayMs: number;
  timestamp: string;
  waMessageId?: string;
  priority?: 'high' | 'normal';
}

export interface QueueSessionStatus {
  sessionId: string;
  isPaused: boolean;
  pauseReason?: string;
  pendingCount: number;
  vipPendingCount: number;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'subscription' | 'user';
  apiKey: string;
  quotaPerDay: number;
  usedToday: number;
  quotaPerWeek: number;
  usedThisWeek: number;
  quotaLimit?: number;
  usedInPeriod?: number;
  quotaPeriod?: 'daily' | 'weekly' | 'monthly';
  quotaResetAt?: string;
  assignedSessionId?: string;
  status: 'active' | 'suspended';
  googleId?: string;
  authProvider?: 'local' | 'google';
  avatarUrl?: string;
}

export interface WebhookRecord {
  id: string;
  userId: string;
  url: string;
  events: string[];
  secret: string;
  status: 'active' | 'disabled';
}
