import type { SessionInfo, OutboundMessage } from '../types.js';

/**
 * WhatsApp engine interface.
 *
 * Fase sekarang: `MockWhatsAppEngine` (dummy, untuk frontend + alur API).
 * Integrasi Baileys asli: implement class `BaileysEngine` yang memenuhi
 * interface ini (pairing QR, makeWASocket, kirim tiap mode) lalu tukar di
 * `SessionManager`. Frontend & endpoint TIDAK perlu berubah.
 */
export interface WhatsAppEngine {
  /** Kirim satu pesan. Return message id dari WhatsApp. */
  sendMessage(msg: OutboundMessage): Promise<{ messageId: string }>;
  /** Get info session terbaru (status, risk score, dll). */
  getSessionInfo(sessionId: string): Promise<SessionInfo>;
  listSessions(): Promise<SessionInfo[]>;
  /** Pairing: mulai/refresh QR. Nanti: makeWASocket + on QR event. */
  startPairing(sessionId: string, name: string, phone: string): Promise<{ qr: string }>;
  logout(sessionId: string): Promise<void>;
  /** Ubah nama tampilan session tanpa putus koneksi. */
  renameSession(sessionId: string, newName: string): Promise<SessionInfo>;
  /** Validasi apakah nomor terdaftar di WhatsApp */
  checkOnWhatsApp?(sessionId: string, phone: string): Promise<{ exists: boolean; jid?: string }>;
  /** Kirim sinyal typing presence (composing / paused / available) untuk human emulation */
  sendPresence?(sessionId: string, jid: string, presence: 'composing' | 'paused' | 'available'): Promise<void>;
  /** Ambil status timelock reachout akun dari WhatsApp (error 463 / W-Mex query) */
  fetchReachoutTimelock?(sessionId: string): Promise<{ isActive?: boolean; timeEnforcementEnds?: Date | null; enforcementType?: string } | null>;
}

/** Mock engine — mensimulasikan delay jitter anti-ban & status. */
export class MockWhatsAppEngine implements WhatsAppEngine {
  private sessions = new Map<string, SessionInfo>();
  private sentCount = new Map<string, number>();

  constructor(initialSessions: SessionInfo[]) {
    for (const s of initialSessions) this.sessions.set(s.id, s);
  }

  async sendMessage(msg: OutboundMessage): Promise<{ messageId: string }> {
    // Simulasi delay anti-ban + proses socket
    await new Promise((r) => setTimeout(r, msg.jitterDelayMs));
    this.sentCount.set(msg.sessionId, (this.sentCount.get(msg.sessionId) || 0) + 1);
    return { messageId: `MOCK-${Date.now().toString(36).toUpperCase()}` };
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo> {
    const s = this.sessions.get(sessionId)!;
    const sent = this.sentCount.get(sessionId) || 0;
    return { ...s, messagesSentToday: s.messagesSentToday + sent };
  }

  async listSessions(): Promise<SessionInfo[]> {
    return Promise.all([...this.sessions.keys()].map((id) => this.getSessionInfo(id)));
  }

  async startPairing(sessionId: string, name: string, phone: string): Promise<{ qr: string }> {
    this.sessions.set(sessionId, {
      id: sessionId,
      name,
      phone,
      status: 'connecting',
      riskScore: 5,
      warmupDay: 1,
      messagesSentToday: 0,
      deliveryRate: 100,
      metrics: { totalSent: 0, totalDelivered: 0, totalFailed: 0, avgPacingDelaySec: 2.1, uptimeHours: 0, disconnectCountToday: 0, hourlyStats: [] },
    });
    return { qr: `mock-qr-${Date.now()}` };
  }

  async logout(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) this.sessions.set(sessionId, { ...s, status: 'disconnected' });
  }

  async renameSession(sessionId: string, newName: string): Promise<SessionInfo> {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} tidak ditemukan`);
    const updated = { ...s, name: newName };
    this.sessions.set(sessionId, updated);
    return updated;
  }
}