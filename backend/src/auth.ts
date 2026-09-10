import type { FastifyReply, FastifyRequest } from 'fastify';
import { getUserByApiKey, getUserById } from './db.js';
import type { UserRecord } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyUser?: UserRecord;
  }
}

// Auth middleware: X-API-Key header -> cari user aktif
export async function requireApiKey(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['x-api-key'] as string | undefined;
  if (!key) return reply.code(401).send({ error: 'X-API-Key header wajib' });

  const user = getUserByApiKey(key);
  if (!user) return reply.code(401).send({ error: 'API key tidak valid' });
  if (user.status !== 'active') return reply.code(403).send({ error: 'User di-suspend' });

  // Cek status suspend
  if (user.status !== 'active') return reply.code(403).send({ error: 'Akun Anda sedang di-suspend' });
  req.apiKeyUser = user;
}

// Auth middleware: JWT (dipakai route admin/user panel)
export async function requireJwt(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Token JWT tidak valid atau kedaluwarsa' });
  }
}

// Auth middleware: JWT ATAU X-API-Key (satu cukup).
// Dipakai route /messages/* supaya panel admin (JWT) dan API user (X-API-Key)
// sama-sama bisa kirim. Kalau API key, isi req.apiKeyUser; kalau JWT, pakai user.id.
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers['x-api-key'] as string | undefined;
  if (key) {
    const user = getUserByApiKey(key);
    if (!user) return reply.code(401).send({ error: 'API key tidak valid' });
    if (user.status !== 'active') return reply.code(403).send({ error: 'User di-suspend' });
    req.apiKeyUser = user;
    return;
  }
  // Fallback: JWT
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Butuh X-API-Key atau token JWT valid' });
  }
  const user = getUserById((req.user as any)?.id);
  if (user) req.apiKeyUser = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  // Coba X-API-Key dulu (kalau ada dan role admin, bypass JWT expired)
  const key = req.headers['x-api-key'] as string | undefined;
  if (key) {
    const user = getUserByApiKey(key);
    if (user && user.role === 'admin' && user.status === 'active') {
      req.apiKeyUser = user;
      return;
    }
  }

  // Fallback: JWT
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Token JWT tidak valid atau kedaluwarsa' });
  }
  const user = getUserById((req.user as any)?.id);
  if (!user || user.role !== 'admin') {
    return reply.code(403).send({ error: 'Butuh role admin' });
  }
  req.apiKeyUser = user;
}