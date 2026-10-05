/**
 * Helper berkas media: lokasi penyimpanan, peta MIME, penentuan tipe saat
 * berkas dilayani, dan penyusunan URL absolut. Berisi murni fungsi dan
 * konstanta — tidak ada rute di sini.
 */

import { resolve, extname } from 'node:path';
import { config } from '../config.js';

// ============ Media Upload ============
// Jalur unggah media dari klien eksternal (mis. WhatsApp Blast Dashboard):
//   1. POST berkas ke /api/v1/media/upload  -> dapat { id, url }
//   2. Kirim { mediaUrl: url } ke /api/v1/messages/send-media
//   3. Setelah wa-api selesai mengunduh, klien boleh DELETE /api/v1/media/:id
// Langkah 3 opsional: berkas dibersihkan otomatis lewat TTL di bawah.
// Ini pelengkap, BUKAN pengganti mediaBase64 — klien yang belum punya
// penyimpanan sendiri tetap bisa mengirim base64 seperti sebelumnya.
export const MEDIA_DIR = process.env.MEDIA_DIR || resolve(process.cwd(), 'data', 'media');
export const MEDIA_TTL_MS = Number(process.env.MEDIA_TTL_MS || 6 * 60 * 60 * 1000);

export const MEDIA_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'application/pdf': '.pdf',
  'video/mp4': '.mp4', 'video/quicktime': '.mov',
  'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'audio/webm': '.webm',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

// Peta ekstensi -> MIME untuk SAAT MELAYANI berkas.
//
// Kenapa terpisah dari MEDIA_EXT_BY_MIME: satu MIME bisa punya beberapa ekstensi
// (.jpg dan .jpeg). Peta balik dari MEDIA_EXT_BY_MIME hanya mengenali ekstensi
// yang tertulis di sana, sehingga .jpeg jatuh ke application/octet-stream.
// Baileys meneruskan mimetype apa adanya ke WhatsApp, dan WhatsApp menolak
// gambar ber-mimetype octet-stream: pesan tercatat 'sent' tapi tidak pernah
// sampai ke penerima — kegagalan senyap tanpa error di log.
export const MEDIA_MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'audio/webm',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// Tentukan MIME saat berkas dilayani. Metadata unggahan (sidecar .json) adalah
// sumber paling akurat karena mencatat tipe yang dikirim klien saat upload;
// ekstensi dipakai sebagai cadangan.
export function resolveMediaMime(ext: string, declaredMime?: string): string {
  const clean = (declaredMime || '').split(';')[0].trim().toLowerCase();
  if (clean && clean !== 'application/octet-stream' && /^[a-z]+\/[a-z0-9.+-]+$/.test(clean)) {
    return clean;
  }
  return MEDIA_MIME_BY_EXT[ext.toLowerCase()] || clean || 'application/octet-stream';
}

export const MEDIA_ID_PATTERN = /^[a-f0-9]{16,32}\.[a-z0-9]{2,5}$/i;

export function resolveMediaExtension(fileName: string, mimeType: string): string {
  const fromName = extname(fileName || '').toLowerCase();
  if (fromName && /^\.[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const cleanMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  return MEDIA_EXT_BY_MIME[cleanMime] || '.bin';
}

export function mediaAbsoluteUrl(req: { headers: Record<string, any> }, id: string): string {
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = forwardedHost || req.headers.host || `127.0.0.1:${config.port}`;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto || 'http';
  return `${proto}://${host}/api/v1/media/${id}`;
}

// Parser biner untuk unggahan mentah (image/*, video/*, audio/*, pdf, octet-stream).
