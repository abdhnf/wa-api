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
  numberProfile?: 'fresh' | 'mature';
  metrics: SessionMetrics;
  userId?: string;
  owner?: { id: string; name: string; email: string };
  queue?: {
    pendingCount: number;
    priorityPendingCount: number;
    isPaused: boolean;
    estimatedWaitSeconds: number;
  };
}

export type MessageMode = 'text' | 'media' | 'location';
export type MessageStatus = 'pending' | 'queued' | 'pacing' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'invalid_number' | 'not_registered' | 'cancelled';

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
  /**
   * Waktu kejadian per status, epoch milidetik.
   *
   * Diisi saat status BENAR-BENAR berubah — bukan saat kampanye dibuat. Untuk
   * `sent`/`delivered`/`read`, nilainya berasal dari timestamp asli WhatsApp
   * (event `messages.update` / `message-receipt.update`), bukan jam server.
   *
   * Hanya ditulis sekali per status. Pesan yang dibuat sebelum fitur ini tidak
   * punya field ini — dan sengaja tidak diisi ulang, karena waktu aslinya tidak
   * pernah tersimpan sehingga nilai apa pun hanya akan jadi tebakan.
   */
  statusTimes?: Partial<Record<MessageStatus, number>>;
}

export interface QueueSessionStatus {
  sessionId: string;
  isPaused: boolean;
  pauseReason?: string;
  pendingCount: number;
  priorityPendingCount: number;
  vipPendingCount?: number; // Deprecated alias untuk backward compatibility
  /** Sisa waktu (ms) sampai antrean dijeda otomatis dibuka kembali. null = tidak ada jadwal. */
  autoResumeInMs?: number | null;
  /**
   * Jumlah pesan per status untuk SELURUH riwayat sesi ini, bukan hanya
   * halaman yang sedang tampil di panel. Dipakai kartu statistik supaya
   * angkanya tidak berubah saat operator pindah halaman atau mengubah
   * jumlah baris per halaman.
   */
  byStatus?: Record<string, number>;
  /** Total seluruh pesan sesi ini, termasuk status yang tidak dikenal panel. */
  totalMessages?: number;
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
  blastPinHash?: string;
  blastAccessToken?: string;
  /**
   * Nomor telepon dalam bentuk kanonik: digit saja, awalan 628.
   * Opsional karena user lama belum punya nomor, dan unik parsial di DB —
   * jadi nomor tidak boleh dipakai dua akun, tapi banyak user boleh kosong.
   */
  phone?: string;
}

export interface WebhookRecord {
  id: string;
  userId: string;
  url: string;
  events: string[];
  secret: string;
  status: 'active' | 'disabled';
}
