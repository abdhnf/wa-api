/**
 * Lima tool tulis — semuanya bisa dibalik.
 *
 * Batasnya disengaja dan dijaga di satu tempat (lihat `DAFTAR_TOOL_TULIS` di
 * bawah). Yang tidak ada di sini dan tidak boleh ditambahkan tanpa keputusan
 * sadar: kirim pesan/blast, hapus sesi, logout, kelola user, dan `queue/clear`.
 * Alasan utamanya bukan kehati-hatian berlebihan: `queue/clear` dan blast adalah
 * dua operasi yang paling mungkin dipanggil agen secara tidak sengaja karena
 * keduanya terdengar seperti "bersihkan" dan "kirim pengumuman".
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Klien } from '../client.js';

const idSesi = z.string().min(1).describe('Id sesi, mis. "sess-mtvs3tj5".');

function teks(isi: string) {
  return { content: [{ type: 'text' as const, text: isi }] };
}

/**
 * Nama tool tulis yang diizinkan. Dipakai uji untuk memastikan tidak ada tool
 * tulis yang lolos tanpa disadari — daftar tool yang teregistrasi dibandingkan
 * dengan daftar ini.
 */
export const DAFTAR_TOOL_TULIS = [
  'wa_set_antiban_preset',
  'wa_pause_queue',
  'wa_resume_queue',
  'wa_reconnect_session',
  'wa_reset_cooldown',
] as const;

export function daftarkanToolTulis(server: McpServer, klien: Klien): void {
  server.registerTool(
    'wa_set_antiban_preset',
    {
      title: 'Ubah preset anti-ban',
      description:
        'Mengubah preset anti-ban satu sesi. Preset standar: strict (paling hati-hati), ' +
        'balanced (bawaan), broadcast (blast satu arah). Nilai sebelumnya dibaca lebih dulu ' +
        'dan dilaporkan, sehingga perubahan bisa dibalik.',
      inputSchema: {
        sessionId: idSesi,
        preset: z.enum(['strict', 'balanced', 'broadcast']).describe('Preset tujuan.'),
      },
    },
    async ({ sessionId, preset }) => {
      // Baca dulu: tanpa ini jawabannya hanya "sekarang broadcast", dan pemanggil
      // tidak tahu harus mengembalikan ke apa. Nilai sebelumnya juga ikut tercatat
      // di api_logs lewat respons ini, bukan sebagai laporan pemanggil.
      const sebelum = await klien.get<{ antiBan?: { preset?: string } }>(
        `/sessions/${encodeURIComponent(sessionId)}/antiban`,
      );
      const presetLama = sebelum.antiBan?.preset ?? '(tidak diketahui)';

      if (presetLama === preset) {
        return teks(
          `Preset sesi ${sessionId} sudah "${preset}" — tidak ada yang diubah.`,
        );
      }

      await klien.put(`/sessions/${encodeURIComponent(sessionId)}/antiban`, { preset });

      return teks(
        `Preset sesi ${sessionId} diubah: "${presetLama}" → "${preset}".\n` +
          `Untuk membalik: wa_set_antiban_preset dengan preset "${presetLama}".\n\n` +
          (preset === 'broadcast'
            ? 'Catatan: broadcast menonaktifkan replyRatio dan contactGraph, sehingga dua guard itu ' +
              'tidak lagi memeriksa. Ini pilihan yang tepat untuk blast satu arah, tetapi bukan untuk ' +
              'percakapan dua arah.'
            : preset === 'strict'
              ? 'Catatan: strict memperlambat pengiriman (delay 3-8 dtk, 5/menit, 100/jam).'
              : ''),
      );
    },
  );

  server.registerTool(
    'wa_pause_queue',
    {
      title: 'Jeda antrean',
      description:
        'Menghentikan sementara pengiriman satu sesi. Pesan yang sudah menunggu tetap di ' +
        'antrean, tidak dibatalkan. Dibalik dengan wa_resume_queue.',
      inputSchema: {
        sessionId: idSesi,
        reason: z.string().max(300).optional().describe('Alasan penjedaan, tercatat di audit.'),
      },
    },
    async ({ sessionId, reason }) => {
      const r = await klien.post<any>(`/sessions/${encodeURIComponent(sessionId)}/queue/pause`, {
        reason: reason || 'Dijeda lewat MCP',
      });
      const tertunda = r?.pendingCount ?? r?.queue?.pendingCount;
      return teks(
        `Antrean sesi ${sessionId} dijeda.` +
          (tertunda !== undefined ? ` ${tertunda} pesan tetap menunggu (tidak dibatalkan).` : '') +
          `\nUntuk melanjutkan: wa_resume_queue.`,
      );
    },
  );

  server.registerTool(
    'wa_resume_queue',
    {
      title: 'Lanjutkan antrean',
      description: 'Melanjutkan pengiriman sesi yang dijeda. Dibalik dengan wa_pause_queue.',
      inputSchema: { sessionId: idSesi },
    },
    async ({ sessionId }) => {
      const r = await klien.post<any>(`/sessions/${encodeURIComponent(sessionId)}/queue/resume`, {});
      const tertunda = r?.pendingCount ?? r?.queue?.pendingCount;
      return teks(
        `Antrean sesi ${sessionId} dilanjutkan.` +
          (tertunda !== undefined ? ` ${tertunda} pesan akan diproses.` : ''),
      );
    },
  );

  server.registerTool(
    'wa_reconnect_session',
    {
      title: 'Sambung ulang sesi',
      description:
        'Meminta sesi menyambung ulang ke WhatsApp tanpa pairing ulang. Bersifat idempoten: ' +
        'memanggilnya dua kali tidak merusak apa pun, tetapi juga tidak mempercepat apa pun.',
      inputSchema: { sessionId: idSesi },
    },
    async ({ sessionId }) => {
      const r = await klien.post<any>(`/sessions/${encodeURIComponent(sessionId)}/reconnect`, {});
      const status = r?.session?.status;
      return teks(
        `Sesi ${sessionId} diminta menyambung ulang.` +
          (status ? ` Status sekarang: ${status}.` : '') +
          '\nPeriksa hasilnya dengan wa_get_session; penyambungan tidak instan.',
      );
    },
  );

  server.registerTool(
    'wa_reset_cooldown',
    {
      title: 'Reset cooldown anti-ban',
      description:
        'Menghapus cooldown anti-ban satu sesi (mis. setelah timelock atau penahanan rate ' +
        'limiter). Cooldown akan aktif lagi dengan sendirinya bila pelanggaran terulang — ' +
        'mereset berulang tanpa memperbaiki penyebabnya hanya menunda masalah.',
      inputSchema: { sessionId: idSesi },
    },
    async ({ sessionId }) => {
      await klien.post(`/sessions/${encodeURIComponent(sessionId)}/antiban/reset-cooldown`, {});
      return teks(
        `Cooldown sesi ${sessionId} direset.\n` +
          'Periksa dengan wa_audit_antiban. Kalau timelock aktif kembali dalam waktu dekat, ' +
          'penyebabnya belum hilang — periksa err463/err429 lewat wa_get_metrics.',
      );
    },
  );
}
