/**
 * Webhook: pendaftaran, pengujian, dan riwayat pengiriman.
 *
 * Rute lama (`POST`/`GET /webhooks`) hanya menyimpan konfigurasi; tidak ada
 * kode yang mengirim HTTP ke URL terdaftar. Berkas ini melengkapinya dan
 * sekaligus menutup dua celah pada versi lama:
 *
 *   1. `secret` dikembalikan mentah pada setiap pembacaan. Sekarang hanya
 *      ditampilkan sekali saat dibuat; pembacaan berikutnya disamarkan.
 *   2. `events` menerima string apa pun. Sekarang divalidasi terhadap daftar
 *      event yang benar-benar dipancarkan, supaya tidak ada langganan yang
 *      tidak akan pernah terkirim.
 *
 * Berkas ini tidak dijalankan sendiri: server.ts memanggil
 * daftarkanRuteWebhook() saat menyusun aplikasi.
 */
import { requireAuth } from '../auth.js';
import { generateApiKey } from '../security.js';
import {
  upsertWebhook,
  listWebhooks,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  antrekanUlangPengiriman,
  hitungWebhookUser,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from '../db.js';
import {
  urlWebhookAman,
  hitungTandaTangan,
  jalankanSatuPutaran,
  bangunHeaderWebhook,
} from '../webhook.js';
import { tolakSesi } from '../kepemilikan.js';
import { regexValid, type MatchType } from '../matcher.js';
import { webhookSchema, parseBody } from './schemas.js';
import { db } from '../db.js';
import type { FastifyInstance } from 'fastify';

const CHAT_TYPES = ['private', 'group', 'broadcast'] as const;

/**
 * Batas jumlah webhook per akun.
 *
 * Default 16; bisa diubah lewat `WEBHOOK_MAX_PER_USER`. Nilai 0 mematikan batas
 * (berguna untuk instalasi yang memang butuh banyak endpoint), nilai tidak valid
 * jatuh ke default.
 */
function batasWebhookPerUser(): number {
  const parsed = Number.parseInt(process.env.WEBHOOK_MAX_PER_USER ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 0) return 16;
  return parsed;
}

/**
 * Pastikan sesi yang dipakai sebagai cakupan benar-benar ada.
 *
 * `tolakSesi` meloloskan admin untuk sesi apa pun — benar untuk rute yang
 * menyentuh sesi (admin memang mengelola semua nomor), tetapi salah di sini:
 * webhook yang dibatasi ke sesi yang tidak ada tidak akan pernah terkirim
 * karena tidak ada event yang membawa `sessionId` itu. Kesalahannya baru
 * terlihat berhari-hari kemudian sebagai "webhook tidak pernah masuk".
 */
function sesiAda(sessionId: string): boolean {
  const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId) as any;
  return Boolean(row);
}

/**
 * Validasi filter isi pesan.
 *
 * Regex diperiksa saat disimpan, bukan saat pesan masuk. Regex yang salah tulis
 * akan membuat filter tidak pernah cocok — dan bagi penerima itu tampak sama
 * dengan "belum ada pesan", bukan "aturan saya rusak". Menolaknya di sini
 * membuat kesalahannya terlihat saat operator masih di depan formulir.
 */
function validasiMatch(
  matchType: MatchType | null | undefined,
  matchValue: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  const adaTipe = matchType !== undefined && matchType !== null;
  const adaNilai = matchValue !== undefined && matchValue !== null && String(matchValue).trim() !== '';

  if (adaTipe !== adaNilai) {
    return { ok: false, error: 'matchType dan matchValue harus diisi bersama, atau dikosongkan keduanya' };
  }
  if (!adaTipe) return { ok: true };

  if (matchType === 'regex' && !regexValid(String(matchValue))) {
    return { ok: false, error: `Regex tidak valid: ${matchValue}` };
  }
  if (matchType === 'keyword') {
    const kata = String(matchValue).split(',').map((k) => k.trim()).filter(Boolean);
    if (kata.length === 0) return { ok: false, error: 'matchValue keyword butuh minimal satu kata' };
  }
  return { ok: true };
}

/** Validasi daftar event terhadap event yang benar-benar dipancarkan. */
function validasiEvents(events: string[]): { ok: true; events: WebhookEvent[] } | { ok: false; error: string } {
  const tidakDikenal = events.filter((e) => e !== '*' && !WEBHOOK_EVENTS.includes(e as WebhookEvent));
  if (tidakDikenal.length > 0) {
    return {
      ok: false,
      error: `Event tidak dikenal: ${tidakDikenal.join(', ')}. Pilihan: ${WEBHOOK_EVENTS.join(', ')}`,
    };
  }
  return { ok: true, events: events as WebhookEvent[] };
}

/** Validasi dan normalisasi `chatTypes` (buang duplikat, tolak nilai asing). */
function validasiChatTypes(
  nilai: unknown,
): { ok: true; chatTypes: string[] | null } | { ok: false; error: string } {
  if (nilai === undefined || nilai === null) return { ok: true, chatTypes: null };
  if (!Array.isArray(nilai)) return { ok: false, error: 'chatTypes harus berupa array' };
  const asing = nilai.filter((v) => !CHAT_TYPES.includes(v as any));
  if (asing.length > 0) {
    return {
      ok: false,
      error: `chatTypes tidak dikenal: ${asing.join(', ')}. Pilihan: ${CHAT_TYPES.join(', ')}`,
    };
  }
  return { ok: true, chatTypes: [...new Set(nilai as string[])] };
}

export function daftarkanRuteWebhook(app: FastifyInstance): void {
  // Daftar webhook milik akun. Secret disamarkan — lihat catatan di kepala berkas.
  app.get('/api/v1/webhooks', { preHandler: requireAuth }, async (req) => {
    return { webhooks: listWebhooks(req.apiKeyUser!.id) };
  });

  app.post('/api/v1/webhooks', { preHandler: requireAuth }, async (req, reply) => {
    const parsed = parseBody(webhookSchema, req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { data } = parsed;

    // Batas jumlah webhook per akun.
    //
    // Satu event masuk dipancarkan ke SETIAP webhook yang cocok, jadi jumlah
    // yang tidak dibatasi melipatgandakan salinan payload, koneksi keluar, dan
    // baris antrean per event. Batas ini hanya menolak pendaftaran BARU;
    // webhook yang sudah ada tidak disentuh.
    const batas = batasWebhookPerUser();
    if (batas > 0 && hitungWebhookUser(req.apiKeyUser!.id) >= batas) {
      return reply.code(400).send({
        error: `Batas ${batas} webhook per akun sudah tercapai. Hapus salah satu sebelum menambah yang baru.`,
      });
    }

    const aman = urlWebhookAman(data.url);
    if (!aman.ok) return reply.code(400).send({ error: aman.alasan });

    const events = validasiEvents(data.events);
    if (!events.ok) return reply.code(400).send({ error: events.error });

    const chat = validasiChatTypes(data.chatTypes);
    if (!chat.ok) return reply.code(400).send({ error: chat.error });

    const match = validasiMatch(data.matchType, data.matchValue);
    if (!match.ok) return reply.code(400).send({ error: match.error });

    // Cakupan sesi diperiksa kepemilikannya, sama seperti rute lain yang
    // menerima `sessionId`: tanpa ini, user bisa mendaftarkan webhook untuk
    // sesi tenant lain dan menerima pesan masuknya.
    if (data.sessionId) {
      const tolak = tolakSesi(req.apiKeyUser, data.sessionId);
      if (tolak) return reply.code(tolak.code).send(tolak.body);
      if (!sesiAda(data.sessionId)) {
        return reply.code(404).send({ error: 'Session tidak ditemukan' });
      }
    }

    const hook = {
      id: `whk_${crypto.randomUUID().slice(0, 8)}`,
      userId: req.apiKeyUser!.id,
      url: data.url,
      events: events.events,
      secret: data.secret || generateApiKey('whsec').replace('wa_live_sec_', ''),
      status: 'active' as const,
      sessionId: data.sessionId ?? null,
      // Tanpa pilihan eksplisit, hanya chat pribadi yang dikirim. Penerima inbox
      // umumnya tidak bisa memakai pesan grup, dan mengirimkannya secara diam-diam
      // membuat dashboard mereka terisi percakapan yang bukan urusannya.
      chatTypes: chat.chatTypes ?? ['private'],
      matchType: data.matchType ?? null,
      matchValue: data.matchValue ? String(data.matchValue).trim() : null,
    };
    upsertWebhook(hook);

    // Secret dikembalikan HANYA di sini. Setelah ini nilainya tidak bisa
    // dibaca lagi lewat API — hanya dipakai server untuk menandatangani.
    return reply.code(201).send({
      success: true,
      webhookId: hook.id,
      status: hook.status,
      secret: hook.secret,
      events: hook.events,
      sessionId: hook.sessionId,
      chatTypes: hook.chatTypes,
      matchType: hook.matchType,
      matchValue: hook.matchValue,
      catatan: 'Simpan secret ini sekarang. Nilainya tidak akan ditampilkan lagi.',
    });
  });

  app.patch('/api/v1/webhooks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as {
      url?: string;
      events?: string[];
      status?: 'active' | 'disabled';
      sessionId?: string | null;
      chatTypes?: string[] | null;
      matchType?: MatchType | null;
      matchValue?: string | null;
    };

    const lama = getWebhook(id);
    if (!lama || lama.userId !== req.apiKeyUser!.id) {
      return reply.code(404).send({ error: 'Webhook tidak ditemukan' });
    }

    if (body.url !== undefined) {
      const aman = urlWebhookAman(body.url);
      if (!aman.ok) return reply.code(400).send({ error: aman.alasan });
    }
    if (body.events !== undefined) {
      if (!Array.isArray(body.events) || body.events.length === 0) {
        return reply.code(400).send({ error: 'events harus berisi minimal satu event' });
      }
      const events = validasiEvents(body.events);
      if (!events.ok) return reply.code(400).send({ error: events.error });
    }
    if (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled') {
      return reply.code(400).send({ error: "status harus 'active' atau 'disabled'" });
    }
    if (body.sessionId) {
      const tolak = tolakSesi(req.apiKeyUser, body.sessionId);
      if (tolak) return reply.code(tolak.code).send(tolak.body);
      if (!sesiAda(body.sessionId)) {
        return reply.code(404).send({ error: 'Session tidak ditemukan' });
      }
    }
    if (body.chatTypes !== undefined) {
      const chat = validasiChatTypes(body.chatTypes);
      if (!chat.ok) return reply.code(400).send({ error: chat.error });
      if (chat.chatTypes && chat.chatTypes.length === 0) {
        return reply.code(400).send({ error: 'chatTypes tidak boleh kosong; kirim null untuk semua jenis' });
      }
    }

    /**
     * Filter isi pesan.
     *
     * Nilai yang dipakai untuk validasi adalah GABUNGAN patch dengan keadaan
     * sekarang, bukan patch saja. Tanpa penggabungan ini, mengubah hanya
     * `matchValue` pada webhook yang sudah punya `matchType` akan ditolak
     * sebagai "setengah filter" — padahal konfigurasinya lengkap.
     *
     * `matchType: null` menghapus filter sekaligus nilainya; menyisakan
     * `matchValue` yatim akan membuat filter menyala lagi begitu tipe dipasang.
     */
    const patch: typeof body = { ...body };
    if (body.matchType === null) {
      // Filter dilepas: nilainya ikut dibuang sebelum divalidasi. Tanpa ini,
      // `matchValue` lama ikut terbaca sebagai "setengah filter" dan pelepasan
      // filter ditolak 400 — padahal permintaannya justru menghapus keduanya.
      patch.matchValue = null;
    }
    if (body.matchType !== undefined || body.matchValue !== undefined) {
      const tipe = body.matchType !== undefined ? body.matchType : lama.matchType ?? null;
      const nilai = body.matchType === null
        ? null
        : body.matchValue !== undefined ? body.matchValue : lama.matchValue ?? null;
      const match = validasiMatch(tipe, nilai);
      if (!match.ok) return reply.code(400).send({ error: match.error });
      patch.matchType = tipe;
      patch.matchValue = nilai === null ? null : String(nilai).trim();
    }

    const ok = updateWebhook(id, req.apiKeyUser!.id, patch);
    if (!ok) return reply.code(404).send({ error: 'Webhook tidak ditemukan' });
    return { success: true, webhook: listWebhooks(req.apiKeyUser!.id).find((w) => w.id === id) };
  });

  /**
   * Ganti secret webhook.
   *
   * Ini menutup kasus yang tidak bisa diselesaikan dengan menampilkan secret:
   * webhook yang didaftarkan sebelum secret hanya dikembalikan sekali — atau
   * sebelum fitur ini ada — tidak punya salinan secret di mana pun. Tanpa
   * rotasi, satu-satunya jalan adalah menghapus dan mendaftar ulang, yang ikut
   * menghapus riwayat pengirimannya.
   *
   * Nilai baru dikembalikan sekali, sama seperti saat pendaftaran.
   */
  app.post('/api/v1/webhooks/:id/rotate-secret', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hook = getWebhook(id);
    if (!hook || hook.userId !== req.apiKeyUser!.id) {
      return reply.code(404).send({ error: 'Webhook tidak ditemukan' });
    }

    const secret = generateApiKey('whsec').replace('wa_live_sec_', '');
    if (!updateWebhook(id, req.apiKeyUser!.id, { secret })) {
      return reply.code(404).send({ error: 'Webhook tidak ditemukan' });
    }

    return {
      success: true,
      webhookId: id,
      secret,
      catatan:
        'Perbarui secret di penerima sekarang. Kiriman yang masih pending akan memakai secret baru saat dicoba, karena secret dibaca ulang dari database pada setiap percobaan.',
    };
  });

  app.delete('/api/v1/webhooks/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = deleteWebhook(id, req.apiKeyUser!.id);
    if (!ok) return reply.code(404).send({ error: 'Webhook tidak ditemukan' });
    return { success: true, deleted: id };
  });

  /**
   * Kirim payload contoh ke endpoint terdaftar.
   *
   * Dijalankan langsung (bukan lewat antrean) supaya operator mendapat jawaban
   * seketika: status code dan pesan galat dari penerima. Ini satu-satunya jalur
   * yang boleh menunggu HTTP, karena pemanggilnya memang sedang menunggu hasil.
   */
  app.post('/api/v1/webhooks/:id/test', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hook = getWebhook(id);
    if (!hook || hook.userId !== req.apiKeyUser!.id) {
      return reply.code(404).send({ error: 'Webhook tidak ditemukan' });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    // Satu `deliveryId` untuk body DAN header, sama seperti jalur antrean.
    // Tanpa ini penerima yang dedupe berdasarkan `X-WA-Delivery` menerima
    // payload uji yang tidak bisa dicocokkan dengan header-nya.
    const deliveryId = crypto.randomUUID();
    const body = JSON.stringify({
      event: 'webhook.test',
      deliveryId,
      occurredAt: new Date().toISOString(),
      data: { message: 'Ini payload uji dari wa-api. Tidak ada pesan WhatsApp yang dikirim.' },
    });
    const signature = hitungTandaTangan(hook.secret, timestamp, body);

    const mulai = Date.now();
    try {
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: bangunHeaderWebhook({
          webhookId: hook.id,
          event: 'webhook.test',
          deliveryId,
          // Payload uji tidak mewakili kejadian nyata, jadi kuncinya diturunkan
          // dari `deliveryId` — tetap unik per uji, tetap stabil di header.
          idempotencyKey: `test_${deliveryId}`,
          timestamp,
          signature,
        }),
        body,
        signal: AbortSignal.timeout(10_000),
      });
      return {
        success: res.ok,
        statusCode: res.status,
        durationMs: Date.now() - mulai,
        // Cuplikan balasan penerima: tanpa ini, "HTTP 500" tidak memberi tahu
        // apa pun tentang penyebabnya.
        responsePreview: (await res.text().catch(() => '')).slice(0, 500),
      };
    } catch (err: any) {
      return reply.code(200).send({
        success: false,
        statusCode: null,
        durationMs: Date.now() - mulai,
        error: err?.name === 'TimeoutError' ? 'Timeout setelah 10000ms' : err?.message || String(err),
      });
    }
  });

  // Riwayat pengiriman, termasuk yang masih menunggu.
  app.get('/api/v1/webhooks/:id/deliveries', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hook = getWebhook(id);
    if (!hook || hook.userId !== req.apiKeyUser!.id) {
      return reply.code(404).send({ error: 'Webhook tidak ditemukan' });
    }

    const q = (req.query || {}) as { status?: string; page?: string; limit?: string };
    const page = Math.max(1, parseInt(q.page || '1', 10) || 1);
    const limit = Math.max(1, Math.min(parseInt(q.limit || '50', 10) || 50, 200));
    const status =
      q.status === 'pending' || q.status === 'success' || q.status === 'failed' ? q.status : undefined;

    const { deliveries, total } = listWebhookDeliveries({
      webhookId: id,
      status,
      limit,
      offset: (page - 1) * limit,
    });

    return { deliveries, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
  });

  // Coba lagi satu pengiriman yang gagal.
  app.post('/api/v1/webhooks/deliveries/:id/retry', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hasil = antrekanUlangPengiriman(id, req.apiKeyUser!.id);
    if (hasil === 'not_found') {
      return reply.code(404).send({ error: 'Pengiriman tidak ditemukan' });
    }
    if (hasil === 'payload_cleared') {
      // 409, bukan 404: barisnya ada, tetapi body-nya sudah dibersihkan sesuai
      // masa simpan. Mengulang akan mengirim body kosong ke penerima.
      return reply.code(409).send({
        error:
          'Body pengiriman ini sudah dibersihkan sesuai masa simpan, jadi tidak bisa dikirim ulang. ' +
          'Perpanjang WEBHOOK_PAYLOAD_RETENTION_HOURS bila riwayat perlu bisa diulang lebih lama.',
      });
    }
    // Picu satu putaran segera supaya operator tidak menunggu tick berikutnya.
    void jalankanSatuPutaran();
    return { success: true, message: 'Pengiriman dimasukkan kembali ke antrean' };
  });
}
