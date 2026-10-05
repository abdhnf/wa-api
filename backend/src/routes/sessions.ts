/**
 * Sesi WhatsApp dan kendali antrean: pasangkan, putuskan, anti-ban,
 * whitelist penerima kampanye, serta jeda/lanjut/batal per sesi dan per batch.
 *
 * Berkas ini tidak dijalankan sendiri: server.ts memanggil
 * daftarkanRuteSessions() saat menyusun aplikasi.
 */

import { validatePhoneFormat } from '../session-manager.js';
import { requireJwt, requireAuth } from '../auth.js';
import { db } from '../db.js';
import { engine, manager } from './konteks.js';
import type { FastifyInstance } from 'fastify';

export function daftarkanRuteSessions(app: FastifyInstance): void {
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
  app.get('/api/v1/sessions/:id/metrics', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ metrics: manager.metrics.getReport(id) });
  });

  app.get('/api/v1/metrics', { preHandler: requireAuth }, async (_req, reply) => {
    return reply.send({ metrics: manager.metrics.getAllReports() });
  });

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

  /**
   * Whitelist penerima kampanye (contactGraph).
   *
   * Penerima blast adalah kontak baru, jadi tanpa whitelist seluruh blast akan
   * tertahan handshake selama handshakeMinDelayMs. Endpoint ini mendaftarkan
   * pasangan (batchId, nomor) sehingga hanya penerima kampanye ITU yang lolos;
   * nomor yang sama di luar konteks batch tetap wajib handshake.
   *
   * GET    /sessions/:id/contact-graph/batch/:batchId  -> status whitelist batch
   * POST   /sessions/:id/contact-graph/batch           -> daftarkan penerima
   * DELETE /sessions/:id/contact-graph/batch/:batchId  -> cabut (semua / satu nomor)
   */
  app.get('/api/v1/sessions/:id/contact-graph/batch/:batchId', { preHandler: requireAuth }, async (req, reply) => {
    const { id, batchId } = req.params as { id: string; batchId: string };
    const user = req.apiKeyUser;
    try {
      const session = await manager.getSession(id);
      if (user && user.role !== 'admin' && session.userId && session.userId !== user.id) {
        return reply.code(403).send({ error: 'Akses ditolak: sesi ini milik pengguna lain' });
      }
    } catch {
      return reply.code(404).send({ error: 'Session tidak ditemukan' });
    }
    const status = manager.getBatchApprovalStatus(id, batchId);
    return { sessionId: id, ...status };
  });

  app.post('/api/v1/sessions/:id/contact-graph/batch', { preHandler: requireAuth }, async (req, reply) => {
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

    const body = (req.body || {}) as { batchId?: string; recipients?: string[] };
    if (!body.batchId) return reply.code(400).send({ error: 'batchId wajib diisi' });
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (recipients.length === 0) return reply.code(400).send({ error: 'recipients wajib berisi minimal 1 nomor' });

    // Normalisasi WAJIB memakai validator yang sama dengan processQueue().
    // Implementasi terpisah pernah membuat '0813...' tersimpan sebagai
    // '0813...@s.whatsapp.net' sementara processQueue memakai '62813...' — approval
    // tidak akan pernah cocok dan blast tetap terblokir tanpa penjelasan.
    const jids: string[] = [];
    const invalid: string[] = [];
    for (const raw of recipients) {
      const r = String(raw).trim();
      if (!r) continue;
      if (r.includes('@')) { jids.push(r); continue; }
      const check = validatePhoneFormat(r);
      if (!check.valid) { invalid.push(r); continue; }
      jids.push(`${check.normalized}@s.whatsapp.net`);
    }

    if (jids.length === 0) {
      return reply.code(400).send({ error: 'Tidak ada nomor valid untuk didaftarkan', invalid });
    }

    const result = manager.approveBatchRecipients(id, body.batchId, jids);
    return { success: true, sessionId: id, batchId: body.batchId, ...result, invalid };
  });

  app.delete('/api/v1/sessions/:id/contact-graph/batch/:batchId', { preHandler: requireAuth }, async (req, reply) => {
    const { id, batchId } = req.params as { id: string; batchId: string };
    const user = req.apiKeyUser;
    try {
      const session = await manager.getSession(id);
      if (user && user.role !== 'admin' && session.userId && session.userId !== user.id) {
        return reply.code(403).send({ error: 'Akses ditolak: sesi ini milik pengguna lain' });
      }
    } catch {
      return reply.code(404).send({ error: 'Session tidak ditemukan' });
    }

    const body = (req.body || {}) as { recipient?: string };
    let jid: string | undefined;
    if (body.recipient) {
      const r = String(body.recipient).trim();
      if (r.includes('@')) {
        jid = r;
      } else {
        // Validator yang sama dengan processQueue — lihat catatan di endpoint POST.
        const check = validatePhoneFormat(r);
        jid = check.valid ? `${check.normalized}@s.whatsapp.net` : undefined;
      }
    }

    const result = manager.revokeBatchApproval(id, batchId, jid);
    return { success: true, sessionId: id, batchId, ...result };
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
    const body = (req.body || {}) as { name?: string; phone?: string; numberProfile?: 'fresh' | 'mature' };
    const id = `sess-${Date.now().toString(36)}`;
    const { qr, session } = await manager.startPairing(id, body.name || 'New Session', body.phone || '62xxx', user.id, body.numberProfile);
    return reply.code(201).send({ success: true, sessionId: id, qr, session });
  });

  // Rename atau ganti profile session (tanpa putus koneksi)
  app.patch('/api/v1/sessions/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { name?: string; numberProfile?: 'fresh' | 'mature' };

    if (!body.name && !body.numberProfile) {
      return reply.code(400).send({ error: 'Parameter name atau numberProfile harus disertakan' });
    }

    try {
      let session;
      if (body.name && body.name.trim()) {
        session = await manager.renameSession(id, body.name.trim());
      }
      if (body.numberProfile && (body.numberProfile === 'fresh' || body.numberProfile === 'mature')) {
        session = await manager.updateSessionProfile(id, body.numberProfile);
      }
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
  /**
   * Cek kepemilikan batch untuk kontrol kampanye.
   *
   * `batchId` dipilih klien dan berpola mudah ditebak, sedangkan endpoint
   * pause/resume/clear sebelumnya hanya memakai requireAuth. Tanpa cek ini,
   * user mana pun bisa menghentikan kampanye milik user lain (IDOR).
   *
   * Batch tanpa baris pesan (mis. sudah dibersihkan) tidak dapat diverifikasi
   * kepemilikannya; batch seperti itu diperlakukan sebagai boleh diakses agar
   * operasi bersih-bersih tetap idempoten. Operasi tersebut tidak merusak data
   * karena tidak ada pesan yang tersisa untuk dibatalkan.
   */
  function userOwnsBatch(userId: string, role: string, batchId: string): boolean {
    if (role === 'admin') return true;
    const row = db.prepare('SELECT user_id FROM messages WHERE batch_id = ? LIMIT 1').get(batchId) as { user_id?: string } | undefined;
    if (!row) return true;
    return !row.user_id || row.user_id === userId;
  }

  app.get('/api/v1/batches/:batchId/status', { preHandler: requireAuth }, async (req, reply) => {
    const { batchId } = req.params as { batchId: string };
    if (!userOwnsBatch(req.apiKeyUser!.id, req.apiKeyUser!.role, batchId)) {
      return reply.code(403).send({ error: 'Akses ditolak: batch ini bukan milik Anda' });
    }
    return reply.send(manager.isBatchPaused(batchId));
  });

  app.post('/api/v1/batches/:batchId/pause', { preHandler: requireAuth }, async (req, reply) => {
    const { batchId } = req.params as { batchId: string };
    if (!userOwnsBatch(req.apiKeyUser!.id, req.apiKeyUser!.role, batchId)) {
      return reply.code(403).send({ error: 'Akses ditolak: batch ini bukan milik Anda' });
    }
    const body = (req.body || {}) as { reason?: string };
    const res = manager.pauseBatch(batchId, body.reason || 'Kampanye dijeda oleh pengguna');
    return reply.send(res);
  });

  app.post('/api/v1/batches/:batchId/resume', { preHandler: requireAuth }, async (req, reply) => {
    const { batchId } = req.params as { batchId: string };
    if (!userOwnsBatch(req.apiKeyUser!.id, req.apiKeyUser!.role, batchId)) {
      return reply.code(403).send({ error: 'Akses ditolak: batch ini bukan milik Anda' });
    }
    const res = manager.resumeBatch(batchId);
    return reply.send(res);
  });

  app.post('/api/v1/batches/:batchId/clear', { preHandler: requireAuth }, async (req, reply) => {
    const { batchId } = req.params as { batchId: string };
    if (!userOwnsBatch(req.apiKeyUser!.id, req.apiKeyUser!.role, batchId)) {
      return reply.code(403).send({ error: 'Akses ditolak: batch ini bukan milik Anda' });
    }
    const body = (req.body || {}) as { reason?: string };
    const res = manager.clearBatch(batchId, body.reason || 'Kampanye dibatalkan oleh pengguna');
    return reply.send(res);
  });
}
