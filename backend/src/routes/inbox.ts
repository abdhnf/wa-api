/**
 * Inbox: pesan masuk dari WhatsApp.
 *
 * Semua rute di sini memakai `requireAuth` dan menyaring berdasarkan pemilik
 * sesi. Isolasi tenant tidak boleh bergantung pada parameter yang dikirim klien:
 * `userId` hanya diambil dari kunci API yang sudah diverifikasi, dan admin
 * boleh memintanya secara eksplisit.
 *
 * Berkas ini tidak dijalankan sendiri: server.ts memanggil
 * daftarkanRuteInbox() saat menyusun aplikasi.
 */
import { requireAuth } from '../auth.js';
import { listInboundMessages, listConversation, listConversations, getSessionOwnerId } from '../db.js';
import { tolakSesi } from '../kepemilikan.js';
import type { FastifyInstance } from 'fastify';

export function daftarkanRuteInbox(app: FastifyInstance): void {
  // Daftar pesan masuk, dengan filter opsional.
  app.get('/api/v1/inbound', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.apiKeyUser!;
    const q = (req.query || {}) as {
      sessionId?: string;
      fromPhone?: string;
      chatType?: string;
      page?: string;
      limit?: string;
      userId?: string;
    };

    // Non-admin terkunci pada akunnya sendiri. Admin boleh memilih tenant lain,
    // dan tanpa `userId` melihat semua.
    const filterUserId = user.role === 'admin' ? (q.userId || undefined) : user.id;

    // Sesi yang diminta harus boleh disentuh pemanggil. Tanpa pemeriksaan ini,
    // filter `sessionId` menjadi jalan memutar untuk membaca inbox tenant lain.
    if (q.sessionId) {
      const tolak = tolakSesi(user, q.sessionId);
      if (tolak) return reply.code(tolak.code).send(tolak.body);
    }

    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(q.limit || '50', 10) || 50, 200));

    const { messages, total } = listInboundMessages({
      userId: filterUserId,
      sessionId: q.sessionId,
      fromPhone: q.fromPhone,
      chatType: q.chatType === 'private' || q.chatType === 'group' || q.chatType === 'broadcast' ? q.chatType : undefined,
      limit,
      offset: (page - 1) * limit,
    });

    return {
      messages,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  });

  // Ringkasan percakapan: satu baris per nomor, pesan terakhirnya saja.
  // Dipakai daftar inbox di panel supaya tidak perlu mengunduh seluruh riwayat.
  app.get('/api/v1/inbound/conversations', { preHandler: requireAuth }, async (req) => {
    const user = req.apiKeyUser!;
    const q = (req.query || {}) as { limit?: string; userId?: string };
    const targetUserId = user.role === 'admin' ? (q.userId || user.id) : user.id;
    const limit = Math.max(1, Math.min(parseInt(q.limit || '50', 10) || 50, 200));
    return { conversations: listConversations(targetUserId, limit) };
  });

  // Riwayat satu percakapan pada satu sesi.
  app.get('/api/v1/inbound/conversation', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.apiKeyUser!;
    const q = (req.query || {}) as { sessionId?: string; fromPhone?: string; limit?: string };

    if (!q.sessionId || !q.fromPhone) {
      return reply.code(400).send({ error: 'sessionId dan fromPhone wajib diisi' });
    }

    const tolak = tolakSesi(user, q.sessionId);
    if (tolak) return reply.code(tolak.code).send(tolak.body);

    // Pemeriksaan kepemilikan sesi di atas sudah menutup jalur lintas tenant,
    // tetapi sesi lama tanpa `user_id` dianggap boleh untuk semua. Untuk inbox,
    // itu terlalu longgar: pesan masuk selalu punya `user_id` yang jelas, jadi
    // kecocokannya diperiksa lagi di sini.
    if (user.role !== 'admin' && getSessionOwnerId(q.sessionId) !== user.id) {
      return reply.code(403).send({ error: 'Akses ditolak: sesi ini milik pengguna lain' });
    }

    const limit = Math.max(1, Math.min(parseInt(q.limit || '100', 10) || 100, 500));
    return { messages: listConversation(q.sessionId, q.fromPhone, limit) };
  });
}
