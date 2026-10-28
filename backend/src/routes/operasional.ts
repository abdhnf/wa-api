/**
 * Endpoint operasional: kesehatan layanan, log aktivitas API,
 * dan log aktivitas per pengguna.
 *
 * Berkas ini tidak dijalankan sendiri: server.ts memanggil
 * daftarkanRuteOperasional() saat menyusun aplikasi.
 */
import { requireAuth } from '../auth.js';
import { getUserLogs, listApiLogs, deleteApiLogs, clearApiLogs, summarizeDecisions, listDecisions } from '../db.js';
import { manager } from './konteks.js';
import type { FastifyInstance } from 'fastify';

export function daftarkanRuteOperasional(app: FastifyInstance): void {
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

  // ============ Audit Keputusan Guard Anti-Ban ============
  //
  // Dua endpoint di bawah READ-ONLY dan sengaja tanpa jalur tulis: tujuannya
  // menjawab "kenapa pesan ini lolos/ditahan" dari data, bukan menebak dari
  // log journal yang berotasi. Agen/analis memakainya untuk menyusun
  // rekomendasi anti-ban; karena itu bentuk balasannya stabil dan tanpa PII
  // (nomor tujuan hanya muncul sebagai hash).

  // 1. Ringkasan: berapa keputusan per guard dalam N jam terakhir.
  app.get('/api/v1/antiban/decisions/summary', { preHandler: requireAuth }, async (req, reply) => {
    const user = (req as any).apiKeyUser;
    const isAdmin = user && user.role === 'admin';
    const q = (req.query || {}) as { sessionId?: string; sinceHours?: string };

    // Isolasi tenant: non-admin hanya boleh melihat sesi miliknya.
    let sessionId = q.sessionId;
    if (!isAdmin) {
      if (!sessionId) return reply.code(400).send({ error: 'Parameter sessionId wajib untuk akun non-admin' });
      const owned = await manager.listSessions(user?.id);
      if (!owned.some((s: { id: string }) => s.id === sessionId)) {
        return reply.code(403).send({ error: 'Akses ditolak: sesi bukan milik akun Anda' });
      }
    }

    const sinceHours = Math.max(1, Math.min(parseInt(q.sinceHours || '24', 10) || 24, 24 * 90));
    return {
      sessionId: sessionId ?? null,
      sinceHours,
      summary: summarizeDecisions({ sessionId, sinceHours }),
    };
  });

  // 2. Daftar keputusan terbaru dengan filter guard/decision/batch.
  app.get('/api/v1/antiban/decisions', { preHandler: requireAuth }, async (req, reply) => {
    const user = (req as any).apiKeyUser;
    const isAdmin = user && user.role === 'admin';
    const q = (req.query || {}) as {
      sessionId?: string; guard?: string; decision?: string;
      batchId?: string; limit?: string; offset?: string;
    };

    let sessionId = q.sessionId;
    if (!isAdmin) {
      if (!sessionId) return reply.code(400).send({ error: 'Parameter sessionId wajib untuk akun non-admin' });
      const owned = await manager.listSessions(user?.id);
      if (!owned.some((s: { id: string }) => s.id === sessionId)) {
        return reply.code(403).send({ error: 'Akses ditolak: sesi bukan milik akun Anda' });
      }
    }

    const limit = Math.max(1, Math.min(parseInt(q.limit || '50', 10) || 50, 200));
    const offset = Math.max(0, parseInt(q.offset || '0', 10) || 0);
    const { rows, total } = listDecisions({
      sessionId,
      guard: q.guard,
      decision: q.decision,
      batchId: q.batchId,
      limit,
      offset,
    });

    return {
      total,
      limit,
      offset,
      // metrics/threshold disimpan sebagai JSON string di DB; diurai di sini
      // supaya pemakai tidak perlu tahu detail penyimpanannya.
      decisions: rows.map((r) => ({
        ...r,
        metrics: r.metrics ? safeJson(r.metrics) : null,
        threshold: r.threshold ? safeJson(r.threshold) : null,
      })),
    };
  });
}

/** Parse JSON tanpa melempar — satu baris rusak tidak boleh menggagalkan respons. */
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
