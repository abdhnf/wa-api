/**
 * Konteks bersama: instance Fastify, hook lintas-rute, engine WhatsApp,
 * dan SessionManager. Modul lain mengimpor `app`, `engine`, dan `manager`
 * dari sini supaya hanya ada satu instance.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { config } from '../config.js';
import { SessionManager } from '../session-manager.js';
import { BaileysEngine } from '../engine/BaileysEngine.js';
import { rateLimitHook, getClientIp } from '../security.js';
import { insertApiLog } from '../db.js';

export const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 }); // 50MB body limit untuk upload media base64
await app.register(cors, { origin: true });
await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtExpiresIn } });

// Proteksi Rate Limiting & Anti-DDoS Global
app.addHook('onRequest', rateLimitHook);

// Non-blocking Selective Logging untuk Audit Request & Troubleshooting API
app.addHook('onResponse', async (req, reply) => {
  try {
    const rawUrl = req.url || '';
    const url = rawUrl.split('?')[0];
    const method = req.method;
    const statusCode = reply.statusCode;

    // Filter Noise: Lewati polling GET yang sukses dan healthcheck
    if (method === 'OPTIONS') return;
    if (method === 'GET' && statusCode < 400) return;
    if (url.startsWith('/api/v1/health') || url.startsWith('/api/v1/api-logs') || url.startsWith('/favicon.ico')) return;

    const user = (req as any).apiKeyUser;
    const userId = user?.id || 'anonymous';
    const durationMs = Math.round(reply.elapsedTime || 0);
    const ip = getClientIp(req);

    // Asynchronous non-blocking write ke SQLite agar thread HTTP tidak tertahan
    setImmediate(() => {
      insertApiLog({
        id: `log_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`,
        userId,
        method,
        endpoint: url,
        statusCode,
        ip,
        durationMs,
      });
    });
  } catch (err) {
    // Fail-safe: error logging tidak boleh mengganggu respon API
    console.error('[onResponse:logger] Gagal memproses log:', err);
  }
});

export const engine = new BaileysEngine([]);
export const manager = new SessionManager(engine);
engine.on463Callback = (sessionId) => manager.record463(sessionId);
engine.onTimelockUpdateCallback = (sessionId, data) => manager.handleTimelockUpdate(sessionId, data);
engine.onBlocklistCallback = (sessionId, blockedCount) => manager.metrics.setBlockedContacts(sessionId, blockedCount);
engine.onDisconnectCallback = (sessionId) => manager.onDisconnect(sessionId);
engine.onReconnectCallback = (sessionId) => manager.onReconnect(sessionId);
engine.onIncomingCallback = (sessionId, jid) => manager.onIncoming(sessionId, jid);
await engine.restoreSavedSessions();
app.addContentTypeParser(/^(image|video|audio)\//, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
for (const rawType of ['application/octet-stream', 'application/pdf']) {
  app.addContentTypeParser(rawType, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
}
