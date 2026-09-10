import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
  type AnyMessageContent,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import type { SessionInfo, OutboundMessage } from '../types.js';
import { upsertSession, listSessions, updateMessageStatus, updateMessageWaId, getMessageByWaId, getMessageById } from '../db.js';

/**
 * BaileysEngine — integrasi WhatsApp asli via @whiskeysockets/baileys.
 * Memenuhi interface WhatsAppEngine (backend & frontend TIDAK berubah).
 *
 * - Satu WASocket per session (multi-session support)
 * - Credential persist per session di data/auth/<sessionId>/ (multi-file auth)
 * - QR pairing: buat socket dulu, tangkap event 'qr', balikin data URL QR
 * - Anti-ban: jitter delay dikelola SessionManager, di sini cuma kirim konten
 */
const SESSIONS_DIR = new URL('../../data/auth/', import.meta.url).pathname;
mkdirSync(SESSIONS_DIR, { recursive: true });

interface ActiveSession {
  socket: WASocket;
  info: SessionInfo;
  qrResolve?: (v: string | null) => void;
  qrData?: string | null;
  qrTimer?: ReturnType<typeof setTimeout>;
  lastSeenAt: number;
}

export class BaileysEngine {
  private active = new Map<string, ActiveSession>();

  constructor(private initialSessions: SessionInfo[]) {}

  /**
   * Restore semua session yang tersimpan di DB saat backend boot.
   * Supaya restart backend TIDAK bikin session yang sudah discan hilang!
   */
  async restoreSavedSessions(): Promise<void> {
    const saved = listSessions();
    for (const s of saved) {
      // Restore semua session yg punya kredensial di disk (status apapun
      // kecuali yg memang belum pernah pairing). Jangan skip 'disconnected'
      // karena itu status normal sesaat sebelum reconnect.
      const authDir = join(SESSIONS_DIR, s.id);
      let hasCreds = false;
      try {
        hasCreds = existsSync(authDir) && readdirSync(authDir).length > 0;
      } catch { hasCreds = false; }
      if (s.status === 'connected' || s.status === 'connecting' || s.status === 'disconnected' || hasCreds) {
        try {
          await this.connectSession(s.id);
          const act = this.active.get(s.id);
          if (act) {
            // Hanya isi nama/phone yg kosong; JANGAN timpa status live
            if (!act.info.name || act.info.name === act.info.id) act.info.name = s.name;
            if (!act.info.phone) act.info.phone = s.phone;
          }
        } catch (err) {
          console.error(`[BaileysEngine] Gagal restore session ${s.id}:`, err);
        }
      }
    }
  }

  // ---------- lifecycle socket ----------
  private async createSocket(sessionId: string): Promise<WASocket> {
    const authDir = join(SESSIONS_DIR, sessionId);
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: state,
      browser: ['Chrome (Linux)', 'Chrome', '125.0.0.0'],
      printQRInTerminal: false,
      logger: pino({ level: process.env.LOG_LEVEL || 'silent' }),
      syncFullHistory: false,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
    });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('messages.update', (updates) => {
      for (const u of updates || []) {
        if (!u.key?.id) continue;
        const waId = u.key.id;
        const msg = getMessageByWaId(waId) || getMessageById(waId);
        if (!msg) continue;
        const updateObj = (u as any).update || {};
        const statusVal = updateObj.status;
        const stubParams = updateObj.messageStubParameters;
        console.log(`[messages.update] waId: ${waId}, statusVal:`, statusVal, 'stubs:', stubParams);

        // Cek apakah ada error penolakan server (misal 463 Reachout restriction atau ERROR status)
        if (statusVal === 0 || statusVal === 'ERROR' || (Array.isArray(stubParams) && stubParams.includes('463'))) {
          const reason = Array.isArray(stubParams) ? stubParams.join(': ') : 'Gagal terkirim oleh server WhatsApp';
          updateMessageStatus(msg.id, 'failed', reason);
          if (Array.isArray(stubParams) && stubParams.includes('463')) {
            this.on463Callback?.(msg.sessionId);
          }
          continue;
        }

        // WhatsApp Baileys status:
        // 2 = SERVER_ACK (centang satu / sampai server WA) -> status 'sent'
        // 3 = DELIVERY_ACK (centang dua abu / diterima di HP penerima) -> status 'delivered'
        // 4 = READ / PLAYED (centang dua biru) -> status 'read'
        if (statusVal === 3 || statusVal === 'DELIVERY_ACK') {
          updateMessageStatus(msg.id, 'delivered');
        } else if (statusVal === 4 || statusVal === 5 || statusVal === 'READ' || statusVal === 'PLAYED') {
          updateMessageStatus(msg.id, 'read');
        } else if (statusVal === 2 || statusVal === 'SERVER_ACK') {
          updateMessageStatus(msg.id, 'sent');
        }
      }
    });
    socket.ev.on('connection.update', async (u) => {
      const s = this.active.get(sessionId);

      if (u.qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(u.qr);
          if (s) {
            s.qrData = qrDataUrl;
            if (s.qrResolve) {
              s.qrResolve(qrDataUrl);
              s.qrResolve = undefined;
            }
          }
        } catch (e) {
          console.error('[BaileysEngine] Gagal render QR toDataURL:', e);
        }
      }
      if (!s) return;
      if (u.connection === 'open') {
        s.info.status = 'connected';
        s.info.phone = this.normalizePhone(socket.user?.id || s.info.phone);
        s.info.metrics.disconnectCountToday = 0;
        upsertSession(s.info);
        this.onReconnectCallback?.(sessionId);
        if (s.qrTimer) clearTimeout(s.qrTimer);
        s.qrResolve?.(''); // Resolve QR promise if still pending
      } else if (u.connection === 'close') {
        const code = (u.lastDisconnect?.error as any)?.output?.statusCode;
        const reason = code === DisconnectReason.loggedOut ? 'logged_out' : 'disconnected';
        s.info.status = reason === 'logged_out' ? 'disconnected' : 'connecting';
        s.info.metrics.disconnectCountToday += 1;
        upsertSession(s.info);
        if (reason !== 'logged_out') {
          this.onDisconnectCallback?.(sessionId);
        }
        this.active.delete(sessionId);
        // Reconnect persisten (backoff naik) kalau bukan logout sengaja.
        // connectSession yg gagal tidak boleh memutus rantai retry.
        if (reason !== 'logged_out') {
          const attempt = (delayMs: number) => {
            setTimeout(() => {
              this.connectSession(sessionId).catch(() => {
                attempt(Math.min(delayMs * 2, 60000));
              });
            }, delayMs);
          };
          attempt(3000);
        }
      }
    });

    socket.ev.on('messages.upsert', (m) => {
      const upserted = m?.messages || [];
      for (const msg of upserted) {
        if (!msg.key?.fromMe && msg.key?.remoteJid) {
          this.onIncomingCallback?.(sessionId, msg.key.remoteJid);
        }
      }
    });

    return socket;
  }

  private async connectSession(sessionId: string): Promise<void> {
    if (this.active.has(sessionId)) return;
    const socket = await this.createSocket(sessionId);
    this.active.set(sessionId, {
      socket,
      info: this.infoFor(sessionId),
      lastSeenAt: Date.now(),
    });
  }

  private infoFor(sessionId: string): SessionInfo {
    try {
      const dbList = listSessions();
      if (Array.isArray(dbList)) {
        const saved = dbList.find((s) => s && s.id === sessionId);
        if (saved) return { ...saved, metrics: { ...saved.metrics } };
      }
    } catch {}
    const initList = this.initialSessions || [];
    const found = initList.find((s) => s && s.id === sessionId);
    return found
      ? { ...found, metrics: { ...found.metrics } }
      : {
          id: sessionId,
          name: sessionId,
          phone: '',
          status: 'connecting',
          riskScore: 0,
          warmupDay: 1,
          messagesSentToday: 0,
          deliveryRate: 100,
          metrics: { totalSent: 0, totalDelivered: 0, totalFailed: 0, avgPacingDelaySec: 0, uptimeHours: 0, disconnectCountToday: 0, hourlyStats: [] },
        };
  }

  // ---------- rename ----------
  async renameSession(sessionId: string, newName: string): Promise<SessionInfo> {
    const s = this.active.get(sessionId);
    if (s) {
      s.info.name = newName;
      upsertSession(s.info);
      return s.info;
    }
    // Session tidak aktif: update via infoFor + persist
    const info = this.infoFor(sessionId);
    info.name = newName;
    upsertSession(info);
    return info;
  }

  private normalizePhone(id: string): string {
    return id.replace(/[^0-9]/g, '').replace(/^0/, '62');
  }

  private isReady(s: ActiveSession): boolean {
    return s.socket.user !== undefined;
  }

  // ---------- WhatsAppEngine impl ----------
  async sendMessage(msg: OutboundMessage): Promise<{ messageId: string }> {
    const s = this.active.get(msg.sessionId);
    if (!s) throw new Error(`Session ${msg.sessionId} tidak aktif. Pairing dulu.`);
    if (!this.isReady(s)) throw new Error(`Session ${msg.sessionId} belum connect.`);

    let content: AnyMessageContent;
    switch (msg.mode) {
      case 'text':
        content = { text: msg.text || '' };
        break;
      case 'media': {
        // Dukung mediaUrl (URL publik) ATAU mediaBase64 (upload file dari panel)
        let buf: Buffer;
        let mime: string;
        if (msg.mediaBase64) {
          const b64 = msg.mediaBase64.replace(/^data:[^;]+;base64,/, '');
          buf = Buffer.from(b64, 'base64');
          mime = msg.mediaMimeType || 'application/octet-stream';
        } else {
          const res = await fetch(msg.mediaUrl!);
          buf = Buffer.from(await res.arrayBuffer());
          mime = res.headers.get('content-type') || 'application/octet-stream';
        }
        const ext = (msg.fileName || '').split('.').pop() || mime.split('/')[1] || 'bin';
        const mediaField = msg.mediaType || 'image';
        const mediaObj: any = {
          [mediaField]: buf,
          mimetype: mime,
          caption: msg.caption || undefined,
        };
        if (mediaField === 'document') {
          mediaObj.fileName = msg.fileName || `file.${ext}`;
        }
        content = mediaObj;
        break;
      }
      case 'location':
        content = {
          location: {
            degreesLatitude: msg.latitude || 0,
            degreesLongitude: msg.longitude || 0,
            name: msg.name,
            address: msg.address,
          },
        } as any;
        break;
      default:
        throw new Error(`Mode pesan tidak didukung: ${msg.mode}`);
    }

    const jid = `${msg.to}@s.whatsapp.net`;
    const res = await s.socket.sendMessage(jid, content);
    s.info.messagesSentToday += 1;
    s.info.metrics.totalSent += 1;
    upsertSession(s.info);
    // Simpan waMessageId untuk tracking delivery receipt
    if (res?.key?.id) {
      updateMessageWaId(msg.id, res.key.id);
    }
    return { messageId: res?.key?.id || `wa-${Date.now()}` };
  }

  async getSessionInfo(sessionId: string): Promise<SessionInfo> {
    const s = this.active.get(sessionId);
    const dbSession = listSessions().find((r) => r.id === sessionId);

    if (!s) {
      if (dbSession) return { ...dbSession, metrics: { ...dbSession.metrics } };
      return this.infoFor(sessionId);
    }

    const uptimeHours = Math.round(((Date.now() - s.lastSeenAt) / 3600000) * 10) / 10;
    const mergedMetrics = {
      ...(dbSession?.metrics || s.info.metrics),
      uptimeHours,
      disconnectCountToday: s.info.metrics?.disconnectCountToday || 0,
    };

    return {
      ...s.info,
      messagesSentToday: dbSession?.messagesSentToday ?? s.info.messagesSentToday,
      deliveryRate: dbSession?.deliveryRate ?? s.info.deliveryRate,
      metrics: mergedMetrics,
    };
  }

  async listSessions(): Promise<SessionInfo[]> {
    // Gabung DB (sumber kebenaran) + in-memory, supaya session tetap
    // terlihat di GET /sessions walau socket lagi reconnect.
    const ids = new Set<string>([
      ...this.initialSessions.map((s) => s.id),
      ...listSessions().map((s) => s.id),
      ...this.active.keys(),
    ]);
    return Promise.all([...ids].map((id) => this.getSessionInfo(id)));
  }

  async startPairing(sessionId: string, name: string, phone: string): Promise<{ qr: string }> {
    // Jika scan ulang, putuskan socket lama TAPI jangan hapus creds auth.
    // Hapus folder auth HANYA saat user eksplisit logout/delete via endpoint,
    // supaya session yang masih connected tidak hilang permanen.
    const existing = this.active.get(sessionId);
    if (existing) {
      try { await existing.socket.logout(); } catch {}
      try { existing.socket.end(undefined); } catch {}
      this.active.delete(sessionId);
    }
    // Perlu QR baru? Baileys auto-trigger QR jika creds korup/absent.
    // Biarkan creds lama di disk — session lama tetap bisa restore.

    // Siapkan promise SEBELUM socket dibuat agar event qr pertama tidak terlewat!
    let qrResolveFn: ((qr: string | null) => void) | undefined;
    const qrPromise = new Promise<string | null>((resolve) => {
      qrResolveFn = resolve;
    });

    const socket = await this.createSocket(sessionId);
    const activeSession: ActiveSession = {
      socket,
      info: this.infoFor(sessionId),
      lastSeenAt: Date.now(),
      qrResolve: qrResolveFn,
    };
    activeSession.info.name = name || activeSession.info.name;
    activeSession.info.phone = phone || activeSession.info.phone;
    activeSession.info.status = 'connecting';
    activeSession.qrTimer = setTimeout(() => {
      if (activeSession.qrResolve) {
        activeSession.qrResolve(null);
      }
    }, 60_000);

    this.active.set(sessionId, activeSession);

    // Jika sudah ada QR ter-generate saat inisialisasi socket
    if (activeSession.qrData) {
      return { qr: activeSession.qrData };
    }

    const qr = await qrPromise;
    if (!qr) {
      if (this.isReady(activeSession)) return { qr: '' };
      throw new Error('QR timeout — coba lagi');
    }
    return { qr };
  }

  /** QR polling helper untuk route GET /sessions/:id/qr */
  async getPendingQr(sessionId: string): Promise<string | null> {
    const s = this.active.get(sessionId);
    return s?.qrData ?? null;
  }

  async logout(sessionId: string): Promise<void> {
    const s = this.active.get(sessionId);
    if (s) {
      try {
        await s.socket.logout();
      } catch {}
      this.active.delete(sessionId);
    }
    const info = await this.getSessionInfo(sessionId);
    info.status = 'disconnected';
    upsertSession(info);
  }

  async reconnectSession(sessionId: string): Promise<SessionInfo> {
    const existing = this.active.get(sessionId);

    // Jika socket masih hidup dan sudah terautentikasi (connected),
    // jangan putus! Cukup refresh metrik dan laporkan status terkini.
    if (existing && existing.socket?.user && existing.info.status === 'connected') {
      return this.getSessionInfo(sessionId);
    }

    // Jika socket mati / terputus, bersihkan instance lama
    if (existing) {
      try {
        existing.socket.end(undefined);
      } catch {}
      this.active.delete(sessionId);
    }

    // Buat socket baru dan tunggu hingga event 'open' tercapai (maks 6 detik)
    await new Promise<void>((resolve) => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) { done = true; resolve(); }
      }, 6000);

      this.connectSession(sessionId).then(() => {
        const s = this.active.get(sessionId);
        if (!s) {
          if (!done) { done = true; clearTimeout(timer); resolve(); }
          return;
        }
        if (s.info.status === 'connected') {
          if (!done) { done = true; clearTimeout(timer); resolve(); }
          return;
        }
        s.socket.ev.on('connection.update', (u) => {
          if (u.connection === 'open' && !done) {
            done = true;
            clearTimeout(timer);
            resolve();
          }
        });
      }).catch(() => {
        if (!done) { done = true; clearTimeout(timer); resolve(); }
      });
    });

    return this.getSessionInfo(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const s = this.active.get(sessionId);
    if (s) {
      try {
        await s.socket.logout();
      } catch {}
      try {
        s.socket.end(undefined);
      } catch {}
      this.active.delete(sessionId);
    }
    const authDir = join(SESSIONS_DIR, sessionId);
    try {
      if (existsSync(authDir)) {
        const { rmSync } = await import('node:fs');
        rmSync(authDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error(`[BaileysEngine] Gagal hapus auth dir ${sessionId}:`, e);
    }
    const { deleteSession: dbDeleteSession } = await import('../db.js');
    dbDeleteSession(sessionId);
  }

  async checkOnWhatsApp(sessionId: string, phone: string): Promise<{ exists: boolean; jid?: string }> {
    const s = this.active.get(sessionId);
    if (!s || !this.isReady(s)) {
      throw new Error(`Session ${sessionId} tidak aktif atau belum tersambung ke WhatsApp.`);
    }
    try {
      const clean = phone.replace(/\D/g, '');
      const results = await s.socket.onWhatsApp(clean);
      if (Array.isArray(results) && results.length > 0 && results[0].exists) {
        return { exists: true, jid: results[0].jid };
      }
      return { exists: false };
    } catch (err: any) {
      console.error(`[BaileysEngine] onWhatsApp error for ${phone}:`, err?.message || err);
      return { exists: true };
    }
  }

  /** Callback saat server WA menandai reachout restricted (463) */
  on463Callback: ((sessionId: string) => void) | null = null;
  onDisconnectCallback: ((sessionId: string) => void) | null = null;
  onReconnectCallback: ((sessionId: string) => void) | null = null;
  onIncomingCallback: ((sessionId: string, jid: string) => void) | null = null;

  /** Emulasi presence manusia: composing (sedang mengetik), paused, atau available */
  async sendPresence(sessionId: string, jid: string, presence: 'composing' | 'paused' | 'available'): Promise<void> {
    const s = this.active.get(sessionId);
    if (!s || !this.isReady(s)) return;
    try {
      await s.socket.sendPresenceUpdate(presence, jid);
    } catch (err) {
      // Abaikan error presence jika socket sedang sibuk
    }
  }
}
