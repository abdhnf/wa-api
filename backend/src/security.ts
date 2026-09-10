import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// ============ Password & API Key Crypto ============

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, combinedHash: string): boolean {
  if (!combinedHash || !combinedHash.includes(':')) return false;
  try {
    const [salt, key] = combinedHash.split(':');
    const hashBuffer = scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(key, 'hex');
    if (hashBuffer.length !== keyBuffer.length) return false;
    return timingSafeEqual(hashBuffer, keyBuffer);
  } catch {
    return false;
  }
}

export function generateApiKey(prefix = 'wa'): string {
  return `${prefix}_${randomBytes(24).toString('hex')}`;
}

// ============ Brute Force & Rate Limit Tracker ============

interface LoginAttempt {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}

interface WindowRecord {
  count: number;
  resetAt: number;
}

const loginAttempts = new Map<string, LoginAttempt>();
const globalWindows = new Map<string, WindowRecord>();
const authWindows = new Map<string, WindowRecord>();

const MAX_FAILED_LOGIN = 5;
const LOGIN_FAIL_WINDOW_MS = 5 * 60 * 1000; // 5 menit
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;    // 15 menit

const MAX_GLOBAL_PER_MIN = 240; // 240 req/menit per IP
const MAX_AUTH_PER_MIN = 30;    // 30 req/menit per IP

export function getClientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

export function checkLoginBruteForce(ip: string): { allowed: boolean; waitSeconds?: number } {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };

  if (record.lockedUntil && record.lockedUntil > now) {
    const waitSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, waitSeconds };
  }

  if (record.lockedUntil && record.lockedUntil <= now) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  if (now - record.firstAttemptAt > LOGIN_FAIL_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  return { allowed: true };
}

export function recordLoginFailure(ip: string): { locked: boolean; remainingAttempts: number; waitSeconds?: number } {
  const now = Date.now();
  let record = loginAttempts.get(ip);

  if (!record || now - record.firstAttemptAt > LOGIN_FAIL_WINDOW_MS) {
    record = { count: 1, firstAttemptAt: now };
  } else {
    record.count += 1;
  }

  if (record.count >= MAX_FAILED_LOGIN) {
    record.lockedUntil = now + LOGIN_LOCKOUT_MS;
    loginAttempts.set(ip, record);
    return {
      locked: true,
      remainingAttempts: 0,
      waitSeconds: Math.ceil(LOGIN_LOCKOUT_MS / 1000),
    };
  }

  loginAttempts.set(ip, record);
  return {
    locked: false,
    remainingAttempts: MAX_FAILED_LOGIN - record.count,
  };
}

export function recordLoginSuccess(ip: string): void {
  loginAttempts.delete(ip);
}

export async function rateLimitHook(req: FastifyRequest, reply: FastifyReply) {
  const now = Date.now();
  const ip = getClientIp(req);
  const path = req.url.split('?')[0];

  // Bypass internal / static / health check
  if (path === '/api/v1/health' || path === '/health') return;

  // 1. Endpoint autentikasi publik (/api/v1/auth/*)
  if (path.startsWith('/api/v1/auth/')) {
    let authRec = authWindows.get(ip);
    if (!authRec || now > authRec.resetAt) {
      authRec = { count: 1, resetAt: now + 60000 };
    } else {
      authRec.count += 1;
    }
    authWindows.set(ip, authRec);

    reply.header('X-RateLimit-Limit-Auth', MAX_AUTH_PER_MIN);
    reply.header('X-RateLimit-Remaining-Auth', Math.max(0, MAX_AUTH_PER_MIN - authRec.count));

    if (authRec.count > MAX_AUTH_PER_MIN) {
      const waitSec = Math.ceil((authRec.resetAt - now) / 1000);
      reply.header('Retry-After', waitSec);
      return reply.code(429).send({
        error: `Terlalu banyak permintaan autentikasi dari IP Anda. Coba lagi dalam ${waitSec} detik.`,
        statusCode: 429,
      });
    }
  }

  // 2. Global Rate Limit
  let globalRec = globalWindows.get(ip);
  if (!globalRec || now > globalRec.resetAt) {
    globalRec = { count: 1, resetAt: now + 60000 };
  } else {
    globalRec.count += 1;
  }
  globalWindows.set(ip, globalRec);

  reply.header('X-RateLimit-Limit', MAX_GLOBAL_PER_MIN);
  reply.header('X-RateLimit-Remaining', Math.max(0, MAX_GLOBAL_PER_MIN - globalRec.count));

  if (globalRec.count > MAX_GLOBAL_PER_MIN) {
    const waitSec = Math.ceil((globalRec.resetAt - now) / 1000);
    reply.header('Retry-After', waitSec);
    return reply.code(429).send({
      error: `Permintaan melebihi batas wajar (rate limit exceeded). Coba lagi dalam ${waitSec} detik.`,
      statusCode: 429,
    });
  }
}

// ============ Cloudflare Turnstile Verification ============

export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const formData = new URLSearchParams();
    formData.append('secret', secretKey);
    formData.append('response', token);
    if (remoteIp) formData.append('remoteip', remoteIp);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const data: any = await res.json();
    return {
      success: Boolean(data.success),
      error: data['error-codes'] ? data['error-codes'].join(', ') : undefined,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts.entries()) {
    if (rec.lockedUntil && rec.lockedUntil < now) loginAttempts.delete(ip);
    else if (!rec.lockedUntil && now - rec.firstAttemptAt > LOGIN_FAIL_WINDOW_MS) loginAttempts.delete(ip);
  }
  for (const [ip, rec] of globalWindows.entries()) {
    if (now > rec.resetAt) globalWindows.delete(ip);
  }
  for (const [ip, rec] of authWindows.entries()) {
    if (now > rec.resetAt) authWindows.delete(ip);
  }
}, 10 * 60 * 1000);
