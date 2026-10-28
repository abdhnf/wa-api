/**
 * Tujuh tool baca.
 *
 * Semua memakai endpoint yang sudah menegakkan isolasi tenant (`backend/src/
 * kepemilikan.ts`), sehingga batas akses agen sama dengan batas akses pemilik
 * kuncinya — bukan batas yang didefinisikan ulang di sini.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Klien } from '../client.js';
import {
  formatAntiban,
  formatAntrean,
  formatDaftarSesi,
  formatKeputusan,
  formatMetrik,
  formatPesan,
  formatSesi,
  type InfoSesi,
} from '../format.js';

const idSesi = z.string().min(1).describe('Id sesi, mis. "sess-mtvs3tj5". Diperoleh dari wa_list_sessions.');

function teks(isi: string) {
  return { content: [{ type: 'text' as const, text: isi }] };
}

export function daftarkanToolBaca(server: McpServer, klien: Klien): void {
  server.registerTool(
    'wa_list_sessions',
    {
      title: 'Daftar sesi',
      description:
        'Sesi WhatsApp yang boleh dilihat pemanggil, lengkap dengan status, profil nomor, ' +
        'warmup, dan jumlah antrean. Mulai dari sini untuk mendapatkan id sesi.',
      inputSchema: {},
    },
    async () => {
      const r = await klien.get<{ sessions: InfoSesi[] }>('/sessions');
      return teks(formatDaftarSesi(r.sessions ?? []));
    },
  );

  server.registerTool(
    'wa_get_session',
    {
      title: 'Detail sesi',
      description:
        'Detail satu sesi: status koneksi, profil nomor, pemilik, jumlah terkirim, ' +
        'delivery rate, dan antrean.',
      inputSchema: { sessionId: idSesi },
    },
    async ({ sessionId }) => {
      const r = await klien.get<{ session: InfoSesi }>(`/sessions/${encodeURIComponent(sessionId)}`);
      return teks(formatSesi(r.session));
    },
  );

  server.registerTool(
    'wa_audit_antiban',
    {
      title: 'Audit anti-ban',
      description:
        'Keadaan semua guard anti-ban pada satu sesi: warmup, timelock, rate limiter, ' +
        'circadian, recovery, reply ratio, contact graph, dan skor kesehatan. Ini tool inti ' +
        'untuk menjawab "kenapa pengiriman sesi ini tertahan".',
      inputSchema: { sessionId: idSesi },
    },
    async ({ sessionId }) => {
      // Status sesi diambil terpisah supaya keluaran menyebut koneksinya; kalau
      // sesi tidak ada, permintaan ini yang gagal lebih dulu dengan 404 yang jelas.
      const [ab, s] = await Promise.all([
        klien.get<{ sessionId: string; antiBan: any }>(
          `/sessions/${encodeURIComponent(sessionId)}/antiban`,
        ),
        klien.get<{ session: InfoSesi }>(`/sessions/${encodeURIComponent(sessionId)}`).catch(() => null),
      ]);
      return teks(formatAntiban(sessionId, ab.antiBan ?? {}, s?.session?.status));
    },
  );

  server.registerTool(
    'wa_get_queue',
    {
      title: 'Status antrean',
      description:
        'Isi antrean satu sesi: berapa tertunda, berapa prioritas/VIP, apakah dijeda, ' +
        'kapan lanjut otomatis, dan sebaran status pesan.',
      inputSchema: { sessionId: idSesi },
    },
    async ({ sessionId }) => {
      const q = await klien.get<any>(`/sessions/${encodeURIComponent(sessionId)}/queue/status`);
      return teks(formatAntrean(q));
    },
  );

  server.registerTool(
    'wa_get_metrics',
    {
      title: 'Metrik pengiriman',
      description:
        'Metrik satu sesi: jumlah terkirim, err463 (reachout restriction), err429 (rate limit), ' +
        'nomor tidak terdaftar, error lain, dan kontak diblokir — beserta rasio per 100.',
      inputSchema: { sessionId: idSesi },
    },
    async ({ sessionId }) => {
      const r = await klien.get<{ metrics: any }>(`/sessions/${encodeURIComponent(sessionId)}/metrics`);
      return teks(formatMetrik(sessionId, r.metrics));
    },
  );

  server.registerTool(
    'wa_list_messages',
    {
      title: 'Riwayat pesan',
      description:
        'Riwayat pesan satu sesi, terbaru dulu. Bisa disaring per status, batch, atau nomor ' +
        'tujuan. Berguna untuk mencari pesan gagal beserta alasannya.',
      inputSchema: {
        sessionId: idSesi,
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Jumlah pesan (bawaan 20, maksimum 100).'),
        status: z
          .string()
          .optional()
          .describe('Saring status, pisahkan koma. Mis. "failed,cancelled".'),
        batchId: z.string().optional().describe('Saring satu batch pengiriman.'),
        phones: z
          .string()
          .optional()
          .describe('Saring nomor tujuan, pisahkan koma.'),
      },
    },
    async ({ sessionId, limit, status, batchId, phones }) => {
      const q = new URLSearchParams();
      // Batas bawaan kecil, bukan 50 seperti API: 30 pesan saja sudah ~7.500 byte,
      // dan konteks agen lebih berguna untuk analisis daripada untuk data mentah.
      q.set('limit', String(limit ?? 20));
      if (status) q.set('status', status);
      if (batchId) q.set('batchId', batchId);
      if (phones) q.set('phones', phones);
      const r = await klien.get<{ messages: any[]; total: number }>(
        `/messages/${encodeURIComponent(sessionId)}?${q.toString()}`,
      );
      return teks(formatPesan(r.messages ?? [], r.total ?? 0));
    },
  );

  server.registerTool(
    'wa_audit_decisions',
    {
      title: 'Audit keputusan guard',
      description:
        'Keputusan guard anti-ban yang tercatat: guard mana yang menahan, berapa kali, dan ' +
        'alasannya. Menggabungkan ringkasan dan rincian karena pertanyaannya satu.',
      inputSchema: {
        sessionId: idSesi,
        sinceHours: z
          .number()
          .int()
          .min(1)
          .max(720)
          .optional()
          .describe('Rentang jam ke belakang (bawaan 24).'),
        limit: z.number().int().min(1).max(200).optional().describe('Jumlah rincian (bawaan 20).'),
      },
    },
    async ({ sessionId, sinceHours, limit }) => {
      const jam = sinceHours ?? 24;
      const dasar = `/antiban/decisions?sessionId=${encodeURIComponent(sessionId)}&sinceHours=${jam}&limit=${limit ?? 20}`;
      const [ringkas, rinci] = await Promise.all([
        klien.get<{ summary: any[] }>(
          `/antiban/decisions/summary?sessionId=${encodeURIComponent(sessionId)}&sinceHours=${jam}`,
        ),
        klien.get<{ decisions: any[]; total: number }>(dasar),
      ]);
      return teks(formatKeputusan(ringkas.summary ?? [], rinci.decisions ?? [], rinci.total ?? 0));
    },
  );
}
