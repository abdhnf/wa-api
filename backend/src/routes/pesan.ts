/**
 * Pengiriman pesan (teks, media, lokasi, massal), status & retry, webhook,
 * serta unggah dan penyajian berkas media.
 *
 * Berkas ini tidak dijalankan sendiri: server.ts memanggil
 * daftarkanRutePesan() saat menyusun aplikasi.
 */
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, unlink, stat, readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { requireApiKey, requireAuth } from '../auth.js';
import { generateApiKey } from '../security.js';
import { upsertWebhook, listWebhooks, getMessageById, db, checkAndIncrementWeeklyQuota, checkAndIncrementQuota, refundQuota } from '../db.js';
import { sendTextSchema, sendMediaSchema, sendLocationSchema, sendBulkSchema, webhookSchema, parseBody } from './schemas.js';
import { manager } from './konteks.js';
import { MEDIA_DIR, MEDIA_TTL_MS, MEDIA_ID_PATTERN, resolveMediaMime, resolveMediaExtension, mediaAbsoluteUrl } from './media.js';
import type { FastifyInstance } from 'fastify';

export function daftarkanRutePesan(app: FastifyInstance): void {
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

    // Normalisasi v1 -> v2 supaya jalur eksekusi hanya satu.
    const items = data.messages
      ? data.messages
      : (data.recipients || []).map((to: string) => ({ mode: 'text' as const, to, text: data.text! }));

    // Kuota dihitung per pesan, bukan per request: kampanye 500 nomor tidak boleh
    // hanya terhitung 1 pesan kuota.
    const quota = checkAndIncrementQuota(user.id, items.length);
    if (!quota.allowed) {
      return reply.code(429).send({ error: quota.reason, quota: quota.limit, used: quota.used, resetAt: quota.resetAt });
    }

    // batchId dari klien (kampanye dashboard) supaya pause/resume/clear punya sasaran
    // yang stabil; fallback ke perilaku lama bila klien tidak mengirimnya.
    const batchId = data.batchId || `batch_${Date.now().toString(36)}`;

    // Mode uji: kembalikan hasil validasi tanpa menyentuh antrean sama sekali.
    // Kuota yang sudah terlanjur ditambah dikembalikan penuh.
    if (data.dryRun) {
      refundQuota(user.id, items.length);
      return reply.code(200).send({
        dryRun: true,
        batchId,
        totalValidated: items.length,
        totalQueued: 0,
        totalFailed: 0,
        messages: items.map((item: any) => ({ id: null, to: item.to, status: 'validated', mode: item.mode })),
        errors: [],
      });
    }

    const results: Array<{ id: string; to: string; status: string; mode: string }> = [];
    const errors: Array<{ to: string; error: string }> = [];

    for (const item of items) {
      try {
        const resolved = await manager.resolveSession(data.sessionId, item.to, user.id, user.role);
        const msg = await manager.enqueue({
          sessionId: resolved.sessionId,
          userId: user.id,
          mode: item.mode,
          to: item.to,
          batchId,
          priority: data.priority,
          ...(item.mode === 'text'
            ? { text: item.text }
            : item.mode === 'media'
              ? {
                  mediaType: item.mediaType,
                  mediaUrl: item.mediaUrl,
                  mediaBase64: item.mediaBase64,
                  mediaMimeType: item.mediaMimeType,
                  fileName: item.fileName,
                  caption: item.caption,
                }
              : {
                  latitude: item.latitude,
                  longitude: item.longitude,
                  name: item.name,
                  address: item.address,
                }),
        });
        results.push({ id: msg.id, to: msg.to, status: msg.status, mode: item.mode });
      } catch (err: any) {
        // Kegagalan satu penerima tidak boleh menggagalkan seluruh batch.
        errors.push({ to: item.to, error: err?.message || 'Gagal memproses sesi WhatsApp' });
      }
    }

    // Kuota hanya boleh mencerminkan pesan yang benar-benar masuk antrean.
    if (errors.length > 0) refundQuota(user.id, errors.length);

    if (results.length === 0) {
      return reply.code(400).send({ error: 'Tidak ada pesan yang berhasil masuk antrean.', errors });
    }

    return reply.code(202).send({
      success: true,
      batchId,
      totalQueued: results.length,
      totalFailed: errors.length,
      strategy: 'gaussian_jitter_pacing',
      messages: results,
      errors,
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

      const meta = {
        originalName: declaredName || '',
        mimeType: declaredMime || '',
        uploadedAt: Date.now(),
      };
      await writeFile(join(MEDIA_DIR, `${id}.json`), JSON.stringify(meta));

      return reply.code(201).send({
        success: true,
        id,
        fileName: declaredName || undefined,
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

      // Baca metadata unggahan lebih dulu: di sana tersimpan mimeType asli dari
      // klien. Ini yang membuat .jpeg tidak lagi jatuh ke application/octet-stream.
      let declaredMime = '';
      let originalName = '';
      try {
        const metaRaw = await readFile(join(MEDIA_DIR, `${id}.json`), 'utf-8');
        const meta = JSON.parse(metaRaw);
        declaredMime = meta?.mimeType || '';
        originalName = meta?.originalName || '';
      } catch {}

      const mime = resolveMediaMime(ext, declaredMime);
      reply.header('Content-Type', mime);
      reply.header('Content-Length', String(info.size));
      reply.header('Cache-Control', 'private, max-age=3600');

      // Jika ada metadata nama asli, kirim header Content-Disposition
      if (originalName) {
        const encoded = encodeURIComponent(originalName);
        reply.header('Content-Disposition', `inline; filename="${originalName.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`);
      }

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
      await unlink(join(MEDIA_DIR, `${id}.json`)).catch(() => {});
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
            await unlink(`${full}.json`).catch(() => {});
            removed++;
          }
        }
        if (removed > 0) app.log.info(`[media-gc] ${removed} berkas media kedaluwarsa dibersihkan`);
      } catch {
        /* pembersihan bersifat best-effort */
      }
    })();
  }, 30 * 60 * 1000).unref();
}
