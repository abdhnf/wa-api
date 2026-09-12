import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { z } from 'zod';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { config } from './config.js';
import { SessionManager } from './session-manager.js';
import { BaileysEngine } from './engine/BaileysEngine.js';
import { requireApiKey, requireJwt, requireAdmin, requireAuth } from './auth.js';
import { hashPassword, verifyPassword, generateApiKey, rateLimitHook, checkLoginBruteForce, recordLoginFailure, recordLoginSuccess, verifyTurnstileToken, getClientIp } from './security.js';
import {
  getUserByEmail, getUserById, listUsers, createUser,
  upsertWebhook, listWebhooks, listMessages, listMessagesPaged, updateUser, deleteUser, setUserPassword, setUserApiKey,
  setUserBlastPin, createBlastLaunchToken, verifyAndBurnBlastLaunchToken,
  getMessageById, db,
  getSetting, getAllSettings, setSettings, getAllUserSettings, setUserSettings, upsertGoogleUser, checkAndIncrementWeeklyQuota, getUserLogs, insertApiLog, listApiLogs, deleteApiLogs, clearApiLogs,
} from './db.js';
import { EMPTY_SESSIONS } from './seed-sessions.js';

const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 }); // 50MB body limit untuk upload media base64
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

const engine = new BaileysEngine([]);
const manager = new SessionManager(engine);
engine.on463Callback = (sessionId) => manager.record463(sessionId);
engine.onDisconnectCallback = (sessionId) => manager.onDisconnect(sessionId);
engine.onReconnectCallback = (sessionId) => manager.onReconnect(sessionId);
engine.onIncomingCallback = (sessionId, jid) => manager.onIncoming(sessionId, jid);
await engine.restoreSavedSessions();

// ============ Schemas ============
const sendTextSchema = z.object({
  sessionId: z.string().min(1),
  to: z.string().regex(/^\d+$/, 'Nomor harus numerik (format 628xxx)'),
  text: z.string().min(1),
  priority: z.enum(['high', 'normal']).optional(),
  batchId: z.string().optional(),
});

const sendMediaSchema = z.object({
  sessionId: z.string().min(1),
  to: z.string().regex(/^\d+$/),
  mediaType: z.enum(['image', 'document', 'audio', 'video']),
  mediaUrl: z.string().url().optional(),
  mediaBase64: z.string().optional(),
  mediaMimeType: z.string().optional(),
  fileName: z.string().optional(),
  caption: z.string().optional(),
  priority: z.enum(['high', 'normal']).optional(),
  batchId: z.string().optional(),
}).refine((d) => d.mediaUrl || d.mediaBase64, { message: 'Butuh mediaUrl atau mediaBase64' });

const sendLocationSchema = z.object({
  sessionId: z.string().min(1),
  to: z.string().regex(/^\d+$/),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().optional(),
  address: z.string().optional(),
  priority: z.enum(['high', 'normal']).optional(),
  batchId: z.string().optional(),
});

const sendBulkSchema = z.object({
  sessionId: z.string().min(1),
  recipients: z.array(z.string().regex(/^\d+$/)).min(1).max(500),
  text: z.string().min(1),
  priority: z.enum(['high', 'normal']).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
});

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

const webhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(8).optional(),
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'subscription', 'user']).default('user'),
  quotaPerDay: z.number().int().min(1).default(100),
  assignedSessionId: z.string().optional(),
});

function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    return { ok: false, error: `Validasi gagal — ${msg}` };
  }
  return { ok: true, data: r.data };
}

// ============ Auth ============
app.post('/api/v1/auth/login', async (req, reply) => {
  const clientIp = getClientIp(req);

  // 1. Cek Proteksi Brute Force per IP
  const bruteCheck = checkLoginBruteForce(clientIp);
  if (!bruteCheck.allowed) {
    return reply.code(429).send({
      error: `IP Anda diblokir sementara karena terlalu banyak percobaan login gagal. Coba lagi dalam ${bruteCheck.waitSeconds} detik.`,
      statusCode: 429
    });
  }

  const parsed = parseBody(loginSchema, req.body);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const { data } = parsed;

  // 2. Cek Cloudflare Turnstile (jika diaktifkan di pengaturan sistem)
  const turnstileEnabled = getSetting('turnstile_enabled') === 'true';
  const turnstileSecret = getSetting('turnstile_secret_key') || '';
  if (turnstileEnabled && turnstileSecret) {
    if (!data.turnstileToken) {
      return reply.code(403).send({ error: 'Verifikasi CAPTCHA Cloudflare wajib diselesaikan.' });
    }
    const verifyResult = await verifyTurnstileToken(data.turnstileToken, turnstileSecret, clientIp);
    if (!verifyResult.success) {
      return reply.code(403).send({ error: `Verifikasi CAPTCHA gagal: ${verifyResult.error || 'Token tidak valid'}` });
    }
  }

  // 3. Autentikasi Pengguna
  const cleanEmail = (data.email || '').trim().toLowerCase();
  const cleanPassword = data.password || '';
  const user = getUserByEmail(cleanEmail);
  if (!user || !verifyPassword(cleanPassword, user.passwordHash)) {
    const failStatus = recordLoginFailure(clientIp);
    if (failStatus.locked) {
      return reply.code(429).send({
        error: 'Terlalu banyak percobaan login gagal. IP Anda diblokir selama 15 menit untuk alasan keamanan.',
        statusCode: 429
      });
    }
    return reply.code(401).send({
      error: 'Email atau password salah',
      remainingAttempts: failStatus.remainingAttempts
    });
  }

  // Reset catatan brute force saat berhasil login
  recordLoginSuccess(clientIp);

  const token = app.jwt.sign({ id: user.id, role: user.role, email: user.email });
  return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, apiKey: user.apiKey, quotaPerDay: user.quotaPerDay, usedToday: user.usedToday } };
});

// Ambil profil user saat ini (termasuk API key & quota)
app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (req, reply) => {
  const user = req.apiKeyUser || getUserById((req.user as any)?.id);
  if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    apiKey: user.apiKey,
    quotaPerDay: user.quotaPerDay,
    usedToday: user.usedToday,
    quotaPerWeek: user.quotaPerWeek,
    usedThisWeek: user.usedThisWeek,
    status: user.status,
    hasBlastPin: !!user.blastPinHash,
  };
});

// Rotasi API key oleh user itu sendiri
app.post('/api/v1/auth/rotate-key', { preHandler: requireAuth }, async (req, reply) => {
  const user = req.apiKeyUser || getUserById((req.user as any)?.id);
  if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });
  const newKey = generateApiKey('wa');
  setUserApiKey(user.id, newKey);
  return { success: true, apiKey: newKey };
});

// ============ Blast Dashboard Launch & PIN Handshake ============

// Set / Ubah 6-digit PIN Keamanan Blast Dashboard
app.post('/api/v1/auth/blast-pin', { preHandler: requireAuth }, async (req, reply) => {
  const user = req.apiKeyUser || getUserById((req.user as any)?.id);
  if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

  const body = req.body as any;
  const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
  if (!/^\d{6}$/.test(pin)) {
    return reply.code(400).send({ error: 'PIN wajib berupa 6 digit angka numerik.' });
  }

  const pinHash = hashPassword(pin);
  setUserBlastPin(user.id, pinHash);
  return { success: true, message: 'PIN keamanan Blast Dashboard berhasil disimpan!' };
});

// Generate One-Time Launch URL / Token untuk membuka WhatsApp Blast Dashboard
app.post('/api/v1/auth/blast-launch', { preHandler: requireAuth }, async (req, reply) => {
  const user = req.apiKeyUser || getUserById((req.user as any)?.id);
  if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

  // Cek apakah user sudah memasang PIN
  const hasPin = !!user.blastPinHash;
  if (!hasPin) {
    return reply.code(400).send({
      error: 'Anda belum mengatur PIN keamanan Blast Dashboard. Silakan atur PIN terlebih dahulu.',
      requirePinSetup: true,
    });
  }

  const token = createBlastLaunchToken(user.id, 600); // 10 menit TTL
  const blastDashboardBaseUrl = (getSetting('blast_dashboard_url') || 'http://172.30.30.229:8085').replace(/\/$/, '');
  const launchUrl = `${blastDashboardBaseUrl}/auth/launch?token=${token}`;

  return {
    success: true,
    token,
    launchUrl,
    expiresInSeconds: 600,
    hasBlastPin: true,
  };
});

// Verifikasi Handshake dari Blast Dashboard (Menerima Token + PIN, Burn Token, dan Mengembalikan API Key & Profil)
app.post('/api/v1/auth/verify-blast-launch', async (req, reply) => {
  const body = req.body as any;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';

  if (!token) {
    return reply.code(400).send({ error: 'Token peluncuran blast wajib disertakan.' });
  }

  // 1. Verifikasi dan bakar token peluncuran (burn on verify)
  const tokenCheck = verifyAndBurnBlastLaunchToken(token);
  if (!tokenCheck.valid || !tokenCheck.userId) {
    return reply.code(401).send({ error: tokenCheck.reason || 'Token tidak valid atau telah kedaluwarsa.' });
  }

  // 2. Ambil user
  const user = getUserById(tokenCheck.userId);
  if (!user) {
    return reply.code(404).send({ error: 'User terdaftar tidak ditemukan.' });
  }

  // 3. Verifikasi PIN numerik 6 digit
  if (!user.blastPinHash) {
    return reply.code(400).send({ error: 'User ini belum memiliki PIN keamanan blast yang terdaftar.' });
  }

  if (!verifyPassword(pin, user.blastPinHash)) {
    return reply.code(401).send({ error: 'PIN keamanan yang Anda masukkan salah.' });
  }

  // 4. Return kredensial & profil lengkap untuk dikonsumsi Blast Dashboard
  return {
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      apiKey: user.apiKey,
      quotaPerWeek: user.quotaPerWeek,
      quotaLimit: user.quotaLimit,
      usedInPeriod: user.usedInPeriod,
    }
  };
});

// Konfigurasi Auth Publik (apakah Google / Register aktif)
app.get('/api/v1/auth/config', async () => {
  return {
    googleAuthEnabled: getSetting('google_auth_enabled') === 'true',
    googleClientId: getSetting('google_client_id') || '',
    registrationEnabled: getSetting('registration_enabled') !== 'false',
    turnstileEnabled: getSetting('turnstile_enabled') === 'true',
    turnstileSiteKey: getSetting('turnstile_site_key') || '',
  };
});

// Login / Register dengan Google OAuth
app.post('/api/v1/auth/google', async (req, reply) => {
  if (getSetting('google_auth_enabled') !== 'true') {
    return reply.code(403).send({ error: 'Login Google saat ini dinonaktifkan oleh Administrator.' });
  }

  const body = (req.body || {}) as { credential?: string; email?: string; name?: string; googleId?: string; avatarUrl?: string };
  let googleEmail = body.email;
  let googleName = body.name;
  let googleId = body.googleId;
  let googleAvatar = body.avatarUrl;

  // Jika dikirim JWT Credential dari Google GSI (Google Identity Services)
  if (body.credential) {
    try {
      // Decode JWT payload (base64)
      const parts = body.credential.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        googleEmail = payload.email;
        googleName = payload.name || payload.given_name || 'Google User';
        googleId = payload.sub;
        googleAvatar = payload.picture;
      }
    } catch (err) {
      return reply.code(400).send({ error: 'Token kredensial Google tidak valid' });
    }
  }

  if (!googleEmail || !googleId) {
    return reply.code(400).send({ error: 'Data profil Google tidak lengkap (butuh email dan googleId)' });
  }

  // Validasi Email / Domain Whitelist Google Auth
  const allowedDomainsSetting = (getSetting('google_allowed_domains') || '').trim();
  if (allowedDomainsSetting) {
    const allowedList = allowedDomainsSetting
      .split(/[\n,; ]+/)
      .map((d: string) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);

    const emailLower = googleEmail.toLowerCase();
    const emailDomain = emailLower.split('@')[1] || '';

    const isAllowed = allowedList.some((item: string) => {
      return item === emailDomain || item === emailLower;
    });

    if (!isAllowed) {
      console.warn(`[auth:google] Login ditolak untuk ${googleEmail} (domain @${emailDomain} tidak ada di whitelist)`);
      return reply.code(403).send({
        error: `Akses ditolak: Domain email (@${emailDomain}) tidak diizinkan masuk ke gateway.`
      });
    }
  }

  // Catatan: Google Auth selalu mengizinkan user baru terlepas dari toggle form registrasi publik manual

  const user = upsertGoogleUser({
    googleId,
    email: googleEmail,
    name: googleName || 'Google User',
    avatarUrl: googleAvatar,
  });

  const token = app.jwt.sign({ id: user.id, role: user.role, email: user.email });
  return { token, user };
});

app.post('/api/v1/auth/register', async (req, reply) => {
  const parsed = parseBody(registerSchema, req.body);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const { data } = parsed;

  if (getUserByEmail(data.email)) return reply.code(409).send({ error: 'Email sudah terdaftar' });

  const user = createUser({
    name: data.name,
    email: data.email,
    passwordHash: hashPassword(data.password),
    role: 'user',
    apiKey: generateApiKey('wa'),
    quotaPerDay: 100,
    status: 'active',
  });
  return reply.code(201).send({ success: true, user: { id: user.id, name: user.name, email: user.email, apiKey: user.apiKey } });
});

// ============ Users ============
app.get('/api/v1/users', { preHandler: requireAdmin }, async () => {
  return { users: listUsers().map((u) => ({ ...u, passwordHash: undefined })) };
});

app.post('/api/v1/users', { preHandler: requireAdmin }, async (req, reply) => {
  const parsed = parseBody(createUserSchema, req.body);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const { data } = parsed;

  if (getUserByEmail(data.email)) return reply.code(409).send({ error: 'Email sudah terdaftar' });

  const user = createUser({
    name: data.name,
    email: data.email,
    passwordHash: hashPassword(data.password),
    role: data.role || 'user',
    apiKey: generateApiKey('wa'),
    quotaPerDay: data.quotaPerDay ?? 100,
    assignedSessionId: data.assignedSessionId,
    status: 'active',
  });
  return reply.code(201).send({ success: true, user: { ...user, passwordHash: undefined } });
});

app.post('/api/v1/users/:id/rotate-key', { preHandler: requireAdmin }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const user = getUserById(id);
  if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });
  const newKey = generateApiKey('wa');
    setUserApiKey(id, newKey);
    return { success: true, apiKey: newKey };
});

// ============ Users CRUD (admin only) ============
app.patch('/api/v1/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body || {}) as any;
  const cur = getUserById(id);
  if (!cur) return reply.code(404).send({ error: 'User tidak ditemukan' });
  if (cur.role === 'admin' && body.role && body.role !== 'admin') {
    return reply.code(400).send({ error: 'Tidak bisa menurunkan role admin' });
  }
  const user = updateUser(id, {
    name: body.name,
    role: body.role,
    quotaPerDay: body.quotaPerDay,
    quotaPerWeek: body.quotaLimit !== undefined ? Number(body.quotaLimit) : (body.quotaPerWeek !== undefined ? Number(body.quotaPerWeek) : undefined),
    quotaLimit: body.quotaLimit !== undefined ? Number(body.quotaLimit) : (body.quotaPerWeek !== undefined ? Number(body.quotaPerWeek) : undefined),
    quotaPeriod: body.quotaPeriod,
    status: body.status,
    assignedSessionId: body.assignedSessionId === undefined ? undefined : (body.assignedSessionId || null),
  });
  return { success: true, user: { ...user, passwordHash: undefined } };
});

app.delete('/api/v1/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const cur = getUserById(id);
  if (!cur) return reply.code(404).send({ error: 'User tidak ditemukan' });
  if (cur.role === 'admin') return reply.code(400).send({ error: 'Tidak bisa menghapus admin' });
  deleteUser(id);
  return { success: true };
});

app.post('/api/v1/users/:id/reset-password', { preHandler: requireAdmin }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body || {}) as { password?: string };
  if (!body.password || body.password.length < 6) {
    return reply.code(400).send({ error: 'Password minimal 6 karakter' });
  }
  if (!getUserById(id)) return reply.code(404).send({ error: 'User tidak ditemukan' });
  setUserPassword(id, hashPassword(body.password));
  return { success: true };
});

// ============ Sessions ============
app.get('/api/v1/sessions', { preHandler: requireAuth }, async (req) => {
  const user = (req as any).apiKeyUser;
  const filterUserId = (user && user.role === 'admin') ? undefined : user?.id;
  return { sessions: await manager.listSessions(filterUserId) };
});

app.get('/api/v1/sessions/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const user = (req as any).apiKeyUser;
  try {
    const session = await manager.getSession(id);
    if (user && user.role !== 'admin' && session.userId && session.userId !== user.id) {
      return reply.code(403).send({ error: 'Akses ditolak: sesi ini milik pengguna lain' });
    }
    return { session };
  } catch {
    return reply.code(404).send({ error: 'Session tidak ditemukan' });
  }
});

// Status engine anti-ban session (warmup, rate limiter, timelock, circadian)
app.get('/api/v1/sessions/:id/antiban', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const user = req.apiKeyUser;

  try {
    const session = await manager.getSession(id);
    if (user && user.role !== 'admin' && session.userId && session.userId !== user.id) {
      return reply.code(403).send({ error: 'Akses ditolak: sesi ini milik pengguna lain' });
    }
  } catch {
    return reply.code(404).send({ error: 'Session tidak ditemukan' });
  }

  const status = manager.getAntiBanStatus(id);
  if (!status) return reply.code(404).send({ error: 'Session tidak ditemukan' });
  return { sessionId: id, antiBan: status };
});

// Update konfigurasi anti-ban per session (preset & custom tuning)
app.put('/api/v1/sessions/:id/antiban', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const user = req.apiKeyUser;

  try {
    const session = await manager.getSession(id);
    if (user && user.role !== 'admin' && session.userId && session.userId !== user.id) {
      return reply.code(403).send({ error: 'Akses ditolak: sesi ini milik pengguna lain' });
    }
  } catch {
    return reply.code(404).send({ error: 'Session tidak ditemukan' });
  }

  const body = (req.body || {}) as { preset?: string; config?: any };
  const preset = body.preset || 'balanced';

  // Proteksi Hak Akses Opsi A:
  // User biasa HANYA boleh memilih preset standar ('strict' | 'balanced' | 'broadcast').
  // Custom tuning (konfigurasi manual delay/sliding window mentah) hanya diizinkan untuk ADMIN.
  if (user && user.role !== 'admin') {
    if (preset === 'custom' || body.config) {
      return reply.code(403).send({
        error: 'Akses ditolak: Penyesuaian konfigurasi custom hanya dapat dilakukan oleh Admin. Anda hanya dapat memilih preset standar (Strict, Balanced, Broadcast).'
      });
    }
  }

  try {
    const updated = manager.updateAntiBanSettings(id, preset, body.config);
    return { success: true, sessionId: id, antiBan: updated };
  } catch (err: any) {
    return reply.code(500).send({ error: err.message || 'Gagal update setting anti-ban' });
  }
});

// Reset cooldown Reply Ratio (opsional per target JID atau semua kontak)
app.post('/api/v1/sessions/:id/antiban/reset-cooldown', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const user = req.apiKeyUser;

  try {
    const session = await manager.getSession(id);
    if (user && user.role !== 'admin' && session.userId && session.userId !== user.id) {
      return reply.code(403).send({ error: 'Akses ditolak: sesi ini milik pengguna lain' });
    }
  } catch {
    return reply.code(404).send({ error: 'Session tidak ditemukan' });
  }

  const body = (req.body || {}) as { jid?: string };
  try {
    const replyRatioStats = manager.resetReplyRatioCooldown(id, body.jid);
    return { success: true, sessionId: id, replyRatio: replyRatioStats };
  } catch (err: any) {
    return reply.code(500).send({ error: err.message || 'Gagal reset cooldown' });
  }
});

app.post('/api/v1/sessions', { preHandler: requireAuth }, async (req, reply) => {
  const user = req.apiKeyUser!;
  const body = (req.body || {}) as { name?: string; phone?: string };
  const id = `sess-${Date.now().toString(36)}`;
  const { qr, session } = await manager.startPairing(id, body.name || 'New Session', body.phone || '62xxx', user.id);
  return reply.code(201).send({ success: true, sessionId: id, qr, session });
});

// Rename session (ubah nama tampilan tanpa putus koneksi)
app.patch('/api/v1/sessions/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body || {}) as { name?: string };
  if (!body.name || !body.name.trim()) {
    return reply.code(400).send({ error: 'Nama session tidak boleh kosong' });
  }
  try {
    const session = await manager.renameSession(id, body.name.trim());
    return { success: true, session };
  } catch (err: any) {
    return reply.code(404).send({ error: err.message || 'Session tidak ditemukan' });
  }
});

app.post('/api/v1/sessions/:id/logout', { preHandler: requireAuth }, async (req) => {
  const { id } = req.params as { id: string };
  await manager.logout(id);
  return { success: true };
});

app.post('/api/v1/sessions/:id/reconnect', { preHandler: requireAuth }, async (req) => {
  const { id } = req.params as { id: string };
  const session = await manager.reconnect(id);
  return { success: true, session };
});

// Re-pair (putuskan auth lama & request QR code baru untuk session yang sama)
app.post('/api/v1/sessions/:id/pair', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body || {}) as { name?: string; phone?: string };
  try {
    const { qr, session } = await manager.startPairing(id, body.name || id, body.phone || '62xxx');
    return reply.send({ success: true, sessionId: id, qr, session });
  } catch (err: any) {
    return reply.code(500).send({ error: err.message || 'Gagal generate QR' });
  }
});

app.delete('/api/v1/sessions/:id', { preHandler: requireAuth }, async (req) => {
  const { id } = req.params as { id: string };
  await manager.delete(id);
  return { success: true };
});

// QR polling: client panggil setelah POST /sessions untuk ambil QR yang muncul
app.get('/api/v1/sessions/:id/qr', { preHandler: requireJwt }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const engineAny = engine as any;
  if (typeof engineAny.getPendingQr !== 'function') {
    return reply.code(400).send({ error: 'QR tidak tersedia' });
  }
  const qr = await engineAny.getPendingQr(id);
  if (!qr) return reply.code(404).send({ error: 'QR belum muncul / sudah kedaluwarsa' });
  return { qr };
});


// ============ Queue Control Endpoints (Pause / Resume / Status) ============
app.get('/api/v1/sessions/:id/queue/status', { preHandler: requireAuth }, async (req) => {
  const { id } = req.params as { id: string };
  return manager.getQueueStatus(id);
});

app.post('/api/v1/sessions/:id/queue/pause', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body || {}) as { reason?: string };
  const res = manager.pauseQueue(id, body.reason || 'Dijeda manual oleh pengguna');
  return reply.send(res);
});

app.post('/api/v1/sessions/:id/queue/resume', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const res = manager.resumeQueue(id);
  return reply.send(res);
});

app.post('/api/v1/sessions/:id/queue/clear', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body || {}) as { reason?: string; batchId?: string };
  const res = manager.clearQueue(id, body.reason || 'Dibatalkan oleh pengguna', body.batchId);
  return reply.send(res);
});

// ============ Batch Queue Controls (Jeda, Lanjut, dan Batalkan Per Kampanye/Batch) ============
app.get('/api/v1/batches/:batchId/status', { preHandler: requireAuth }, async (req, reply) => {
  const { batchId } = req.params as { batchId: string };
  return reply.send(manager.isBatchPaused(batchId));
});

app.post('/api/v1/batches/:batchId/pause', { preHandler: requireAuth }, async (req, reply) => {
  const { batchId } = req.params as { batchId: string };
  const body = (req.body || {}) as { reason?: string };
  const res = manager.pauseBatch(batchId, body.reason || 'Kampanye dijeda oleh pengguna');
  return reply.send(res);
});

app.post('/api/v1/batches/:batchId/resume', { preHandler: requireAuth }, async (req, reply) => {
  const { batchId } = req.params as { batchId: string };
  const res = manager.resumeBatch(batchId);
  return reply.send(res);
});

app.post('/api/v1/batches/:batchId/clear', { preHandler: requireAuth }, async (req, reply) => {
  const { batchId } = req.params as { batchId: string };
  const body = (req.body || {}) as { reason?: string };
  const res = manager.clearBatch(batchId, body.reason || 'Kampanye dibatalkan oleh pengguna');
  return reply.send(res);
});

// ============ Messages (6 endpoints) — JWT panel ATAU X-API-Key ============
app.post('/api/v1/messages/send', { preHandler: requireAuth }, async (req, reply) => {
  const parsed = parseBody(sendTextSchema, req.body);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const { data } = parsed;

  const user = req.apiKeyUser!;
  const quota = checkAndIncrementWeeklyQuota(user.id);
  if (!quota.allowed) {
    return reply.code(429).send({ error: quota.reason, quota: quota.limit, used: quota.used, resetAt: quota.resetAt });
  }

  let resolved;
  try {
    resolved = await manager.resolveSession(data.sessionId, data.to, user.id, user.role);
  } catch (err: any) {
    return reply.code(400).send({ error: err.message || 'Gagal memproses sesi WhatsApp' });
  }
  const msg = await manager.enqueue({ sessionId: resolved.sessionId, userId: user.id, mode: 'text', to: data.to, text: data.text, priority: data.priority, batchId: data.batchId });
  return reply.code(202).send({ success: true, messageId: msg.id, type: 'text', status: msg.status, jitterDelayMs: msg.jitterDelayMs });
});

app.post('/api/v1/messages/send-media', { preHandler: requireAuth }, async (req, reply) => {
  const user = req.apiKeyUser!;
  const parsed = parseBody(sendMediaSchema, req.body);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const { data } = parsed;

  // Kuota periode (weekly/daily/monthly) — harus dicek untuk SEMUA mode kirim,
  // bukan hanya teks/bulk, supaya meter kuota tidak bisa dilewati lewat media.
  const quota = checkAndIncrementWeeklyQuota(user.id);
  if (!quota.allowed) {
    return reply.code(429).send({ error: quota.reason, quota: quota.limit, used: quota.used, resetAt: quota.resetAt });
  }

  let resolved;
  try {
    resolved = await manager.resolveSession(data.sessionId, data.to, user.id, user.role);
  } catch (err: any) {
    return reply.code(400).send({ error: err.message || 'Gagal memproses sesi WhatsApp' });
  }
  const msg = await manager.enqueue({
    sessionId: resolved.sessionId, userId: user.id, mode: 'media', to: data.to,
    mediaUrl: data.mediaUrl, mediaBase64: data.mediaBase64, mediaMimeType: data.mediaMimeType,
    mediaType: data.mediaType, fileName: data.fileName, caption: data.caption,
    priority: data.priority, batchId: data.batchId,
  });
  return reply.code(202).send({ success: true, messageId: msg.id, type: 'media', status: msg.status });
});

app.post('/api/v1/messages/send-location', { preHandler: requireAuth }, async (req, reply) => {
  const user = req.apiKeyUser!;
  const parsed = parseBody(sendLocationSchema, req.body);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const { data } = parsed;

  // Kuota periode — sama seperti mode teks/media.
  const quota = checkAndIncrementWeeklyQuota(user.id);
  if (!quota.allowed) {
    return reply.code(429).send({ error: quota.reason, quota: quota.limit, used: quota.used, resetAt: quota.resetAt });
  }

  let resolved;
  try {
    resolved = await manager.resolveSession(data.sessionId, data.to, user.id, user.role);
  } catch (err: any) {
    return reply.code(400).send({ error: err.message || 'Gagal memproses sesi WhatsApp' });
  }
  const msg = await manager.enqueue({
    sessionId: resolved.sessionId, userId: user.id, mode: 'location', to: data.to,
    latitude: data.latitude, longitude: data.longitude,
    name: data.name, address: data.address,
    batchId: data.batchId,
    priority: data.priority,
  });
  return reply.code(202).send({ success: true, messageId: msg.id, type: 'location', status: msg.status });
});

app.post('/api/v1/messages/send-bulk', { preHandler: requireAuth }, async (req, reply) => {
  const parsed = parseBody(sendBulkSchema, req.body);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const { data } = parsed;

  const user = req.apiKeyUser!;
  const quota = checkAndIncrementWeeklyQuota(user.id);
  if (!quota.allowed) {
    return reply.code(429).send({ error: quota.reason, quota: quota.limit, used: quota.used, resetAt: quota.resetAt });
  }

  const batchId = `batch_${Date.now().toString(36)}`;
  const msgs = await Promise.all(
    data.recipients.map(async (to: string) => {
      let resolved;
      try {
        resolved = await manager.resolveSession(data.sessionId, to, user.id, user.role);
      } catch (err: any) {
        throw new Error(err.message || 'Gagal memproses sesi WhatsApp');
      }
      return manager.enqueue({ sessionId: resolved.sessionId, userId: user.id, mode: 'text', to, text: data.text, batchId, priority: data.priority });
    })
  ).catch((err: any) => {
    return reply.code(400).send({ error: err.message });
  });
  if (reply.sent) return;
  return reply.code(202).send({
    success: true,
    batchId,
    totalQueued: data.recipients.length,
    strategy: 'gaussian_jitter_pacing',
    messages: msgs.map((m: { id: string; to: string; status: string }) => ({ id: m.id, to: m.to, status: m.status })),
  });
});

// Status pesan: satuan (by id) atau bulk (batchId dari send-bulk)
app.get('/api/v1/messages/status/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const actor = req.apiKeyUser!;
  const msg = getMessageById(id);
  if (!msg) return reply.code(404).send({ error: 'Pesan tidak ditemukan' });
  // Proteksi BOLA/IDOR: User biasa hanya boleh melihat pesan miliknya sendiri
  if (actor.role !== 'admin' && (msg as any).userId && (msg as any).userId !== actor.id) {
    return reply.code(403).send({ error: 'Akses ditolak: Anda tidak memiliki izin melihat pesan ini' });
  }
  return { message: msg };
});

// Endpoint retry pengiriman pesan yang gagal
app.post('/api/v1/messages/:id/retry', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const retried = await manager.retryMessage(id);
    return { success: true, message: retried };
  } catch (err: any) {
    return reply.code(400).send({ error: err.message || 'Gagal retry pesan' });
  }
});

app.get('/api/v1/messages/status/bulk/:batchId', { preHandler: requireAuth }, async (req, reply) => {
  const { batchId } = req.params as { batchId: string };
  const rows = db.prepare('SELECT payload FROM messages WHERE batch_id = ?').all(batchId) as any[];
  const messages = rows.map((r) => JSON.parse(r.payload));
  return { batchId, total: messages.length, messages };
});

// ============ Webhooks ============
app.post('/api/v1/webhooks', { preHandler: requireApiKey }, async (req, reply) => {
  const parsed = parseBody(webhookSchema, req.body);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const { data } = parsed;

  const hook = {
    id: `whk_${crypto.randomUUID().slice(0, 8)}`,
    userId: req.apiKeyUser!.id,
    url: data.url,
    events: data.events,
    secret: data.secret || generateApiKey('whsec').replace('wa_live_sec_', ''),
    status: 'active' as const,
  };
  upsertWebhook(hook);
  return reply.code(201).send({ success: true, webhookId: hook.id, status: hook.status });
});

app.get('/api/v1/webhooks', { preHandler: requireApiKey }, async (req) => {
  return { webhooks: listWebhooks(req.apiKeyUser!.id) };
});

// ============ Usage & Health ============
// Catatan: quotaPerDay/usedToday dipertahankan untuk kompatibilitas panel lama.
// Kuota otoritatif sekarang berbasis periode (quotaLimit/usedInPeriod/quotaPeriod),
// dipakai konsumen seperti WhatsApp Blast Dashboard.
app.get('/api/v1/usage', { preHandler: requireApiKey }, async (req) => {
  const u = req.apiKeyUser!;
  const quotaLimit = u.quotaLimit ?? u.quotaPerWeek ?? 0;
  const usedInPeriod = u.usedInPeriod ?? 0;
  return {
    quotaPerDay: u.quotaPerDay,
    usedToday: u.usedToday,
    remaining: Math.max(0, u.quotaPerDay - u.usedToday),
    quotaLimit,
    usedInPeriod,
    quotaPeriod: u.quotaPeriod ?? 'weekly',
    quotaResetAt: u.quotaResetAt,
    remainingInPeriod: u.role === 'admin' ? null : Math.max(0, quotaLimit - usedInPeriod),
  };
});

app.get('/api/v1/messages/:sessionId', { preHandler: requireAuth }, async (req) => {
  const { sessionId } = req.params as { sessionId: string };
  const query = (req.query || {}) as {
    batchId?: string;
    limit?: string;
    offset?: string;
    status?: string;
    phones?: string;
  };
  const user = req.apiKeyUser!;
  const filterUserId = user.role === 'admin' ? undefined : user.id;
  const targetSession = (sessionId === 'auto' || sessionId === 'all') ? undefined : sessionId;

  const statuses = typeof query.status === 'string' && query.status.length > 0
    ? query.status.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const phones = typeof query.phones === 'string' && query.phones.length > 0
    ? query.phones.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
    : undefined;

  const result = listMessagesPaged({
    sessionId: targetSession,
    filterUserId,
    batchId: query.batchId || undefined,
    statuses,
    phones,
    limit: query.limit ? Number(query.limit) : 50,
    offset: query.offset ? Number(query.offset) : 0,
  });

  return { messages: result.messages, total: result.total };
});

// ============ Media Upload ============
// Jalur unggah media dari klien eksternal (mis. WhatsApp Blast Dashboard):
//   1. POST berkas ke /api/v1/media/upload  -> dapat { id, url }
//   2. Kirim { mediaUrl: url } ke /api/v1/messages/send-media
//   3. Setelah wa-api selesai mengunduh, klien boleh DELETE /api/v1/media/:id
// Langkah 3 opsional: berkas dibersihkan otomatis lewat TTL di bawah.
// Ini pelengkap, BUKAN pengganti mediaBase64 — klien yang belum punya
// penyimpanan sendiri tetap bisa mengirim base64 seperti sebelumnya.
const MEDIA_DIR = process.env.MEDIA_DIR || resolve(process.cwd(), 'data', 'media');
const MEDIA_TTL_MS = Number(process.env.MEDIA_TTL_MS || 6 * 60 * 60 * 1000);

const MEDIA_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/webm': '.webm',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

const MEDIA_ID_PATTERN = /^[a-f0-9]{16,32}\.[a-z0-9]{2,5}$/i;

function resolveMediaExtension(fileName: string, mimeType: string): string {
  const fromName = extname(fileName || '').toLowerCase();
  if (fromName && /^\.[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const cleanMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  return MEDIA_EXT_BY_MIME[cleanMime] || '.bin';
}

function mediaAbsoluteUrl(req: { headers: Record<string, any> }, id: string): string {
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = forwardedHost || req.headers.host || `127.0.0.1:${config.port}`;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto || 'http';
  return `${proto}://${host}/api/v1/media/${id}`;
}

// Parser biner untuk unggahan mentah (image/*, video/*, audio/*, pdf, octet-stream).
// application/json tetap ditangani parser bawaan Fastify.
app.addContentTypeParser(/^(image|video|audio)\//, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
for (const rawType of ['application/octet-stream', 'application/pdf']) {
  app.addContentTypeParser(rawType, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
}

app.post('/api/v1/media/upload', { preHandler: requireAuth }, async (req, reply) => {
  try {
    await mkdir(MEDIA_DIR, { recursive: true });

    const contentType = String(req.headers['content-type'] || '');
    let buffer: Buffer;
    let declaredName = '';
    let declaredMime = contentType.split(';')[0].trim().toLowerCase();

    if (contentType.includes('application/json')) {
      const body = (req.body || {}) as { data?: string; base64?: string; mimeType?: string; fileName?: string };
      const raw = (body.data || body.base64 || '').replace(/^data:[^;]+;base64,/, '');
      if (!raw) return reply.code(400).send({ error: 'Field data/base64 wajib berisi konten berkas.' });
      buffer = Buffer.from(raw, 'base64');
      declaredName = body.fileName || '';
      declaredMime = (body.mimeType || '').toLowerCase();
    } else if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
      const rawName = req.headers['x-file-name'];
      declaredName = typeof rawName === 'string' ? decodeURIComponent(rawName) : '';
    } else {
      return reply.code(415).send({
        error: 'Content-Type tidak didukung. Kirim berkas biner, atau JSON { data, mimeType, fileName }.',
      });
    }

    if (!buffer.length) return reply.code(400).send({ error: 'Berkas kosong.' });

    const ext = resolveMediaExtension(declaredName, declaredMime);
    const id = `${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}${ext}`;
    await writeFile(join(MEDIA_DIR, id), buffer);

    return reply.code(201).send({
      success: true,
      id,
      url: mediaAbsoluteUrl(req as any, id),
      size: buffer.length,
      mimeType: declaredMime || undefined,
      expiresInMs: MEDIA_TTL_MS,
    });
  } catch (err: any) {
    req.log.error({ err }, 'media upload gagal');
    return reply.code(500).send({ error: err?.message || 'Gagal menyimpan berkas media.' });
  }
});

app.get('/api/v1/media/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!MEDIA_ID_PATTERN.test(id)) return reply.code(400).send({ error: 'ID media tidak valid.' });

  const filePath = join(MEDIA_DIR, id);
  // Pertahanan path traversal meski pola ID sudah ketat.
  if (!resolve(filePath).startsWith(resolve(MEDIA_DIR))) {
    return reply.code(400).send({ error: 'ID media tidak valid.' });
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('bukan berkas');
    const ext = extname(id).toLowerCase();
    const mime = Object.entries(MEDIA_EXT_BY_MIME).find(([, e]) => e === ext)?.[0] || 'application/octet-stream';
    reply.header('Content-Type', mime);
    reply.header('Content-Length', String(info.size));
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(filePath));
  } catch {
    return reply.code(404).send({ error: 'Media tidak ditemukan atau sudah dibersihkan.' });
  }
});

app.delete('/api/v1/media/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!MEDIA_ID_PATTERN.test(id)) return reply.code(400).send({ error: 'ID media tidak valid.' });
  try {
    await unlink(join(MEDIA_DIR, id));
    return { success: true, deleted: id };
  } catch {
    return { success: false, message: 'Media sudah tidak ada.' };
  }
});

// Pembersih berkas media kedaluwarsa (berjalan tiap 30 menit, non-blocking).
setInterval(() => {
  void (async () => {
    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(MEDIA_DIR).catch(() => [] as string[]);
      const now = Date.now();
      let removed = 0;
      for (const name of entries) {
        const full = join(MEDIA_DIR, name);
        const info = await stat(full).catch(() => null);
        if (info?.isFile() && now - info.mtimeMs > MEDIA_TTL_MS) {
          await unlink(full).catch(() => {});
          removed++;
        }
      }
      if (removed > 0) app.log.info(`[media-gc] ${removed} berkas media kedaluwarsa dibersihkan`);
    } catch {
      /* pembersihan bersifat best-effort */
    }
  })();
}, 30 * 60 * 1000).unref();

// Endpoint Admin: Lihat log & aktivitas user tertentu
app.get('/api/v1/admin/users/:id/logs', { preHandler: requireAuth }, async (req, reply) => {
  const actor = (req as any).apiKeyUser;
  if (!actor || actor.role !== 'admin') {
    return reply.code(403).send({ error: 'Akses ditolak: khusus Super Admin / Admin' });
  }
  const { id } = req.params as { id: string };
  const logs = getUserLogs(id);
  if (!logs.user) return reply.code(404).send({ error: 'User tidak ditemukan' });
  return logs;
});

app.get('/api/v1/health', async () => {
  return { status: 'ok', uptime: process.uptime(), sessions: (await manager.listSessions()).length };
});

// ============ Start ============

// ============ Settings (Admin Only) ============
app.get('/api/v1/settings', { preHandler: requireAuth }, async (req, reply) => {
  const user = (req as any).user || (req as any).apiKeyUser;
  if (!user || user.role !== 'admin') {
    return reply.code(403).send({ error: 'Akses ditolak. Khusus Administrator.' });
  }
  const all = getAllSettings();
  return {
    settings: {
      googleAuthEnabled: all['google_auth_enabled'] === 'true',
      googleClientId: all['google_client_id'] || '',
      googleAllowedDomains: all['google_allowed_domains'] || '',
      googleClientSecret: all['google_client_secret'] ? '••••••••' : '',
      hasClientSecret: Boolean(all['google_client_secret']),
      registrationEnabled: all['registration_enabled'] !== 'false',
      turnstileEnabled: all['turnstile_enabled'] === 'true',
      turnstileSiteKey: all['turnstile_site_key'] || '',
      turnstileSecretKey: all['turnstile_secret_key'] ? '••••••••' : '',
      hasTurnstileSecret: Boolean(all['turnstile_secret_key']),
      blastDashboardUrl: all['blast_dashboard_url'] || 'http://172.30.30.229:8085',
    },
  };
});

app.patch('/api/v1/settings', { preHandler: requireAuth }, async (req, reply) => {
  const user = (req as any).user || (req as any).apiKeyUser;
  if (!user || user.role !== 'admin') {
    return reply.code(403).send({ error: 'Akses ditolak. Khusus Administrator.' });
  }
  const body = (req.body || {}) as {
    googleAuthEnabled?: boolean;
    googleClientId?: string;
    googleClientSecret?: string;
    googleAllowedDomains?: string;
    registrationEnabled?: boolean;
    turnstileEnabled?: boolean;
    turnstileSiteKey?: string;
    turnstileSecretKey?: string;
    blastDashboardUrl?: string;
  };
  const updates: Record<string, string> = {};
  if (body.googleAuthEnabled !== undefined) {
    updates['google_auth_enabled'] = body.googleAuthEnabled ? 'true' : 'false';
  }
  if (body.googleClientId !== undefined) {
    updates['google_client_id'] = body.googleClientId.trim();
  }
  if (body.googleAllowedDomains !== undefined) {
    updates['google_allowed_domains'] = body.googleAllowedDomains.trim();
  }
  if (body.googleClientSecret !== undefined && body.googleClientSecret !== '••••••••' && body.googleClientSecret.trim() !== '') {
    updates['google_client_secret'] = body.googleClientSecret.trim();
  }
  if (body.registrationEnabled !== undefined) {
    updates['registration_enabled'] = body.registrationEnabled ? 'true' : 'false';
  }
  if (body.turnstileEnabled !== undefined) {
    updates['turnstile_enabled'] = body.turnstileEnabled ? 'true' : 'false';
  }
  if (body.turnstileSiteKey !== undefined) {
    updates['turnstile_site_key'] = body.turnstileSiteKey.trim();
  }
  if (body.turnstileSecretKey !== undefined && body.turnstileSecretKey !== '••••••••' && body.turnstileSecretKey.trim() !== '') {
    updates['turnstile_secret_key'] = body.turnstileSecretKey.trim();
  }
  if (body.blastDashboardUrl !== undefined) {
    updates['blast_dashboard_url'] = body.blastDashboardUrl.trim();
  }
  setSettings(updates);
  return { success: true, message: 'Pengaturan berhasil diperbarui.' };
});


// ============ Auto-Rotate & Session Pooling ============
app.get('/api/v1/autorotate/settings', { preHandler: requireAuth }, async (req) => {
  const user = (req as any).apiKeyUser;
  const all = user ? getAllUserSettings(user.id) : getAllSettings();
  let poolSessions: string[] = [];
  try {
    if (all['autorotate_pool_sessions']) poolSessions = JSON.parse(all['autorotate_pool_sessions']);
  } catch {}

  return {
    settings: {
      enabled: all['autorotate_enabled'] === 'true',
      strategy: all['autorotate_strategy'] || 'least_loaded',
      rotateOnLimit: all['autorotate_rotate_on_limit'] !== 'false',
      rotateOnDisconnect: all['autorotate_rotate_on_disconnect'] !== 'false',
      rotateOn463: all['autorotate_rotate_on_463'] !== 'false',
      stickySession: all['autorotate_sticky_session'] !== 'false',
      poolSessions,
    },
  };
});

app.patch('/api/v1/autorotate/settings', { preHandler: requireAuth }, async (req, reply) => {
  const user = (req as any).apiKeyUser;
  const body = (req.body || {}) as {
    enabled?: boolean;
    strategy?: 'least_loaded' | 'round_robin' | 'warmup_priority';
    rotateOnLimit?: boolean;
    rotateOnDisconnect?: boolean;
    rotateOn463?: boolean;
    stickySession?: boolean;
    poolSessions?: string[];
  };

  const updates: Record<string, string> = {};
  if (body.enabled !== undefined) updates['autorotate_enabled'] = body.enabled ? 'true' : 'false';
  if (body.strategy !== undefined) updates['autorotate_strategy'] = body.strategy;
  if (body.rotateOnLimit !== undefined) updates['autorotate_rotate_on_limit'] = body.rotateOnLimit ? 'true' : 'false';
  if (body.rotateOnDisconnect !== undefined) updates['autorotate_rotate_on_disconnect'] = body.rotateOnDisconnect ? 'true' : 'false';
  if (body.rotateOn463 !== undefined) updates['autorotate_rotate_on_463'] = body.rotateOn463 ? 'true' : 'false';
  if (body.stickySession !== undefined) updates['autorotate_sticky_session'] = body.stickySession ? 'true' : 'false';
  if (body.poolSessions !== undefined) updates['autorotate_pool_sessions'] = JSON.stringify(body.poolSessions);

  if (user) {
    setUserSettings(user.id, updates);
  } else {
    setSettings(updates);
  }
  return { success: true, message: 'Pengaturan Auto-Rotate akun Anda berhasil diperbarui.' };
});

app.get('/api/v1/autorotate/status', { preHandler: requireAuth }, async (req) => {
  const user = (req as any).apiKeyUser;
  const isAdmin = user && user.role === 'admin';
  const filterUserId = isAdmin ? undefined : user?.id;

  const sessions = await manager.listSessions(filterUserId);
  const all = user ? getAllUserSettings(user.id) : getAllSettings();
  let poolSessions: string[] = [];
  try {
    if (all['autorotate_pool_sessions']) poolSessions = JSON.parse(all['autorotate_pool_sessions']);
  } catch {}

  const roster = sessions.map((s) => {
    const ab = manager.getAntiBanStatus(s.id);
    return {
      id: s.id,
      name: s.name,
      phone: s.phone,
      status: s.status,
      inPool: poolSessions.length === 0 || poolSessions.includes(s.id),
      warmupDay: s.warmupDay,
      messagesSentToday: s.messagesSentToday,
      deliveryRate: s.deliveryRate,
      riskScore: s.riskScore,
      warmupStatus: ab?.warmup || null,
      timelockActive: ab?.timelock?.isActive || false,
    };
  });

  const userPrefEnabled = all['autorotate_enabled'] === 'true';
  const userEligible = sessions.length >= 2;

  return {
    enabled: userPrefEnabled && userEligible,
    userPrefEnabled,
    userEligible,
    strategy: all['autorotate_strategy'] || 'least_loaded',
    totalSessions: sessions.length,
    poolCount: roster.filter((r) => r.inPool).length,
    activePoolCount: roster.filter((r) => r.inPool && r.status === 'connected').length,
    roster,
  };
});


// ============ API Request Logs Endpoints ============

// 1. Ambil daftar log dengan pagination & filter
app.get('/api/v1/api-logs', { preHandler: requireAuth }, async (req, reply) => {
  const user = (req as any).apiKeyUser;
  const isAdmin = user && user.role === 'admin';
  const query = (req.query || {}) as {
    page?: string;
    limit?: string;
    status?: 'all' | 'success' | 'error';
    userId?: string;
  };

  const page = Math.max(1, parseInt(query.page || '1', 10) || 1);
  const limit = Math.max(1, Math.min(parseInt(query.limit || '25', 10) || 25, 100));
  const offset = (page - 1) * limit;
  const statusFilter = query.status || 'all';

  // Isolasi tenant: Non-admin HANYA boleh melihat log akunnya sendiri
  const filterUserId = isAdmin ? (query.userId || undefined) : user?.id;

  const { logs, total } = listApiLogs({
    userId: filterUserId,
    limit,
    offset,
    statusFilter,
  });

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    logs,
    total,
    page,
    limit,
    totalPages,
  };
});

// 2. Hapus log tertentu (Bulk / Single Delete by Checkbox)
app.delete('/api/v1/api-logs', { preHandler: requireAuth }, async (req, reply) => {
  const user = (req as any).apiKeyUser;
  const isAdmin = user && user.role === 'admin';
  const body = (req.body || {}) as { ids?: string[] };

  if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return reply.code(400).send({ error: 'Daftar ID log yang akan dihapus tidak valid' });
  }

  // Non-admin hanya bisa menghapus log milik dirinya sendiri
  const filterUserId = isAdmin ? undefined : user?.id;
  const deletedCount = deleteApiLogs(body.ids, filterUserId);

  return {
    success: true,
    deletedCount,
    message: `${deletedCount} log berhasil dihapus.`,
  };
});

// 3. Bersihkan log massal (Clear All / Cleanup Cronjob)
app.post('/api/v1/api-logs/clear', { preHandler: requireAuth }, async (req, reply) => {
  const user = (req as any).apiKeyUser;
  const isAdmin = user && user.role === 'admin';
  const body = (req.body || {}) as { olderThanDays?: number; all?: boolean };

  // Non-admin hanya bisa membersihkan log miliknya sendiri
  const filterUserId = isAdmin && body.all ? undefined : user?.id;
  const olderThanDays = typeof body.olderThanDays === 'number' ? body.olderThanDays : undefined;

  const deletedCount = clearApiLogs(filterUserId, olderThanDays);

  return {
    success: true,
    deletedCount,
    message: olderThanDays
      ? `Log yang lebih lama dari ${olderThanDays} hari berhasil dibersihkan (${deletedCount} log dihapus).`
      : `Seluruh riwayat log berhasil dibersihkan (${deletedCount} log dihapus).`,
  };
});

const port = config.port;
try {
  await app.listen({ port, host: config.host });
  // Pulihkan antrean pesan yang belum terkirim dari SQLite
  await manager.recoverPendingMessages();
} catch (err) {
  app.log.error(err);
  process.exit(1);
}