/**
 * Chatbot: aturan, state percakapan, opt-out, dan uji coba.
 *
 * Semua rute memakai `requireAuth` dan dikunci pada `apiKeyUser.id`. Aturan
 * chatbot menentukan apa yang dikirim ke nomor pelanggan, jadi kebocoran antar
 * tenant di sini bukan sekadar masalah privasi — satu tenant bisa mengubah
 * balasan yang diterima pelanggan tenant lain.
 *
 * Berkas ini tidak dijalankan sendiri: server.ts memanggil
 * daftarkanRuteChatbot() saat menyusun aplikasi.
 */
import { requireAuth } from '../auth.js';
import {
  listChatbotFlows,
  insertChatbotFlow,
  updateChatbotFlow,
  deleteChatbotFlow,
  listChatbotSessions,
  listOptouts,
  addOptout,
  removeOptout,
  listApplicableFlows,
  getChatbotFlow,
  type ChatbotStep,
  type MatchType,
} from '../db.js';
import { tolakSesi } from '../kepemilikan.js';
import { rencanakanBalasan, adalahOptOut } from '../chatbot.js';
import { regexValid, MATCH_TYPES } from '../matcher.js';
import { chatbotFlowSchema, chatbotTestSchema, parseBody } from './schemas.js';
import { db } from '../db.js';
import type { FastifyInstance } from 'fastify';

/**
 * Validasi pola regex pada aturan.
 *
 * Regex yang salah tulis membuat aturan tidak pernah cocok — dan bagi operator
 * itu tampak sama dengan "belum ada pesan yang cocok", bukan "aturan saya
 * rusak". Menolaknya saat disimpan membuat kesalahannya terlihat selagi masih
 * di depan formulir. Aturan yang sama dipakai filter webhook.
 */
function validasiRegex(matchType: unknown, matchValue: unknown): { ok: true } | { ok: false; error: string } {
  if (matchType !== 'regex') return { ok: true };
  if (typeof matchValue !== 'string' || !matchValue.trim()) {
    return { ok: false, error: 'matchValue wajib diisi untuk matchType regex' };
  }
  if (!regexValid(matchValue)) return { ok: false, error: `Regex tidak valid: ${matchValue}` };
  return { ok: true };
}

/**
 * Pastikan sesi yang dipakai sebagai cakupan benar-benar ada.
 *
 * `tolakSesi` meloloskan admin untuk sesi apa pun, jadi tanpa pemeriksaan ini
 * aturan yang dibatasi ke sesi yang tidak ada tetap tersimpan — dan tidak akan
 * pernah menyala, karena tidak ada pesan dengan `sessionId` itu.
 */
function sesiAda(sessionId: string): boolean {
  return Boolean(db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId));
}

/** Validasi langkah alur: id unik, `next` hanya menunjuk langkah yang ada. */
function validasiSteps(steps: ChatbotStep[] | null | undefined): { ok: true } | { ok: false; error: string } {
  if (!steps) return { ok: true };
  if (!Array.isArray(steps)) return { ok: false, error: 'steps harus berupa array' };

  const ids = new Set<string>();
  for (const s of steps) {
    if (!s || typeof s.id !== 'string' || !s.id.trim()) {
      return { ok: false, error: 'Setiap langkah wajib punya id' };
    }
    if (ids.has(s.id)) return { ok: false, error: `id langkah ganda: ${s.id}` };
    ids.add(s.id);
    if (typeof s.reply !== 'string' || !s.reply.trim()) {
      return { ok: false, error: `Langkah ${s.id} wajib punya reply` };
    }
  }
  // Rujukan ke langkah yang tidak ada akan membuat percakapan berhenti tanpa
  // penjelasan di tengah jalan — lebih baik ditolak saat disimpan.
  for (const s of steps) {
    for (const target of Object.values(s.next || {})) {
      if (!ids.has(target)) {
        return { ok: false, error: `Langkah ${s.id} menunjuk langkah yang tidak ada: ${target}` };
      }
    }
  }
  return { ok: true };
}

export function daftarkanRuteChatbot(app: FastifyInstance): void {
  // ---------- Aturan ----------

  app.get('/api/v1/chatbot/flows', { preHandler: requireAuth }, async (req) => {
    return { flows: listChatbotFlows(req.apiKeyUser!.id) };
  });

  app.post('/api/v1/chatbot/flows', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = parseBody(chatbotFlowSchema, req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const d = parsed.data;

    if (!MATCH_TYPES.includes(d.matchType as MatchType)) {
      return reply.code(400).send({ error: `matchType harus salah satu dari: ${MATCH_TYPES.join(', ')}` });
    }
    const regex = validasiRegex(d.matchType, d.matchValue);
    if (!regex.ok) return reply.code(400).send({ error: regex.error });
    if (d.sessionId) {
      const tolak = tolakSesi(req.apiKeyUser, d.sessionId);
      if (tolak) return reply.code(tolak.code).send(tolak.body);
      if (!sesiAda(d.sessionId)) {
        return reply.code(404).send({ error: 'Session tidak ditemukan' });
      }
    }
    const steps = validasiSteps(d.steps as ChatbotStep[] | undefined);
    if (!steps.ok) return reply.code(400).send({ error: steps.error });

    const id = `bot_${crypto.randomUUID().slice(0, 10)}`;
    insertChatbotFlow({
      id,
      userId: req.apiKeyUser!.id,
      sessionId: d.sessionId ?? null,
      name: d.name,
      enabled: d.enabled ?? true,
      priority: d.priority ?? 100,
      matchType: d.matchType as MatchType,
      matchValue: d.matchValue,
      replyText: d.replyText ?? null,
      replyMediaUrl: d.replyMediaUrl ?? null,
      steps: (d.steps as ChatbotStep[]) ?? null,
      cooldownSeconds: d.cooldownSeconds ?? 0,
    });

    return reply.code(201).send({ success: true, flow: listChatbotFlows(req.apiKeyUser!.id).find((f) => f.id === id) });
  });

  app.patch('/api/v1/chatbot/flows/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as Record<string, unknown>;

    if (body.matchType !== undefined && !MATCH_TYPES.includes(body.matchType as MatchType)) {
      return reply.code(400).send({ error: `matchType harus salah satu dari: ${MATCH_TYPES.join(', ')}` });
    }
    // Regex diperiksa dengan nilai gabungan: mengubah hanya `matchValue` pada
    // aturan yang sudah bertipe regex harus tetap divalidasi.
    if (body.matchType !== undefined || body.matchValue !== undefined) {
      const lama = getChatbotFlow(id);
      if (lama && lama.userId === req.apiKeyUser!.id) {
        const regex = validasiRegex(
          body.matchType !== undefined ? body.matchType : lama.matchType,
          body.matchValue !== undefined ? body.matchValue : lama.matchValue,
        );
        if (!regex.ok) return reply.code(400).send({ error: regex.error });
      }
    }
    if (body.sessionId) {
      const tolak = tolakSesi(req.apiKeyUser, String(body.sessionId));
      if (tolak) return reply.code(tolak.code).send(tolak.body);
      if (!sesiAda(String(body.sessionId))) {
        return reply.code(404).send({ error: 'Session tidak ditemukan' });
      }
    }
    if (body.steps !== undefined) {
      const steps = validasiSteps(body.steps as ChatbotStep[] | null);
      if (!steps.ok) return reply.code(400).send({ error: steps.error });
    }

    const ok = updateChatbotFlow(id, req.apiKeyUser!.id, body as any);
    if (!ok) return reply.code(404).send({ error: 'Aturan tidak ditemukan' });
    return { success: true, flow: listChatbotFlows(req.apiKeyUser!.id).find((f) => f.id === id) };
  });

  app.delete('/api/v1/chatbot/flows/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = deleteChatbotFlow(id, req.apiKeyUser!.id);
    if (!ok) return reply.code(404).send({ error: 'Aturan tidak ditemukan' });
    return { success: true, deleted: id };
  });

  // ---------- Percakapan ----------

  app.get('/api/v1/chatbot/sessions', { preHandler: requireAuth }, async (req) => {
    const q = (req.query || {}) as { limit?: string };
    const limit = Math.max(1, Math.min(parseInt(q.limit || '50', 10) || 50, 200));
    return { sessions: listChatbotSessions(req.apiKeyUser!.id, limit) };
  });

  // ---------- Opt-out ----------

  app.get('/api/v1/chatbot/optouts', { preHandler: requireAuth }, async (req) => {
    return { optouts: listOptouts(req.apiKeyUser!.id) };
  });

  app.post('/api/v1/chatbot/optouts', { preHandler: requireAuth }, async (req, reply) => {
    const body = (req.body || {}) as { sessionId?: string; contactPhone?: string; reason?: string };
    if (!body.sessionId || !body.contactPhone) {
      return reply.code(400).send({ error: 'sessionId dan contactPhone wajib diisi' });
    }
    const tolak = tolakSesi(req.apiKeyUser, body.sessionId);
    if (tolak) return reply.code(tolak.code).send(tolak.body);

    addOptout(body.sessionId, body.contactPhone.replace(/\D/g, ''), body.reason);
    return reply.code(201).send({ success: true });
  });

  app.delete('/api/v1/chatbot/optouts', { preHandler: requireAuth }, async (req, reply) => {
    const q = (req.query || {}) as { sessionId?: string; contactPhone?: string };
    if (!q.sessionId || !q.contactPhone) {
      return reply.code(400).send({ error: 'sessionId dan contactPhone wajib diisi' });
    }
    const tolak = tolakSesi(req.apiKeyUser, q.sessionId);
    if (tolak) return reply.code(tolak.code).send(tolak.body);

    const ok = removeOptout(q.sessionId, q.contactPhone.replace(/\D/g, ''));
    if (!ok) return reply.code(404).send({ error: 'Opt-out tidak ditemukan' });
    return { success: true };
  });

  /**
   * Uji aturan tanpa mengirim WhatsApp.
   *
   * Ini yang membuat penyusunan aturan bisa dilakukan tanpa risiko: operator
   * mengetik pesan contoh dan melihat balasan yang AKAN dikirim, termasuk
   * langkah alur berikutnya. Tidak ada pesan yang masuk antrean.
   */
  app.post('/api/v1/chatbot/test', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = parseBody(chatbotTestSchema, req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { sessionId, text, currentFlowId, currentStep } = parsed.data;

    const tolak = tolakSesi(req.apiKeyUser, sessionId);
    if (tolak) return reply.code(tolak.code).send(tolak.body);

    const flows = listApplicableFlows(req.apiKeyUser!.id, sessionId);
    const rencana = rencanakanBalasan(
      {
        id: 'uji',
        sessionId,
        userId: req.apiKeyUser!.id,
        fromJid: 'uji@s.whatsapp.net',
        fromPhone: '628000',
        chatType: 'private',
        type: 'text',
        text,
        receivedAt: new Date().toISOString(),
        botHandled: false,
      },
      currentFlowId ? { currentFlowId, currentStep: currentStep ?? null } : null,
      flows,
    );

    return {
      optOut: adalahOptOut(text),
      matched: Boolean(rencana),
      reply: rencana?.reply ?? null,
      flowId: rencana?.flowId ?? null,
      nextStep: rencana?.nextStep ?? null,
      selesai: rencana?.selesai ?? null,
      // Jumlah aturan yang diperiksa membantu operator memahami kenapa tidak
      // ada yang cocok: nol aturan berarti belum ada yang aktif.
      totalAturanDiperiksa: flows.length,
    };
  });
}
