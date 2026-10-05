/**
 * Skema validasi zod untuk seluruh endpoint.
 * Dipisah dari rutenya supaya berkas rute hanya berisi alur, bukan bentuk data.
 */
import { z } from 'zod';

// ============ Schemas ============
export const sendTextSchema = z.object({
  sessionId: z.string().min(1),
  to: z.string().regex(/^\d+$/, 'Nomor harus numerik (format 628xxx)'),
  text: z.string().min(1),
  priority: z.enum(['high', 'normal']).optional(),
  batchId: z.string().optional(),
});

export const sendMediaSchema = z.object({
  sessionId: z.string().min(1),
  to: z.string().regex(/^\d+$/),
  mediaType: z.enum(['image', 'document', 'audio', 'video']),
  mediaUrl: z.string().url().optional(),
  mediaBase64: z.string().optional(),
  mediaMimeType: z.string().optional(),
  fileName: z.string().optional(),
  caption: z.string().optional(),
  priority: z.enum(['high', 'normal']).optional(),
  batchId: z.string().optional(),
}).refine((d) => d.mediaUrl || d.mediaBase64, { message: 'Butuh mediaUrl atau mediaBase64' });

export const sendLocationSchema = z.object({
  sessionId: z.string().min(1),
  to: z.string().regex(/^\d+$/),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().optional(),
  address: z.string().optional(),
  priority: z.enum(['high', 'normal']).optional(),
  batchId: z.string().optional(),
});

// Nomor tujuan format internasional tanpa simbol (628xxx)
export const phoneDigits = z.string().regex(/^\d+$/, 'Nomor harus numerik (format 628xxx)');

// Satu item pesan pada pengiriman bulk. `mode` menentukan bentuk payload yang wajib.
// Catatan: zod v3 tidak mengizinkan `.refine()` di dalam discriminatedUnion, sehingga
// validasi "butuh mediaUrl atau mediaBase64" dilakukan di superRefine pada array-nya.
export const bulkItemSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('text'),
    to: phoneDigits,
    text: z.string().min(1),
  }),
  z.object({
    mode: z.literal('media'),
    to: phoneDigits,
    mediaType: z.enum(['image', 'document', 'audio', 'video']),
    mediaUrl: z.string().url().optional(),
    mediaBase64: z.string().optional(),
    mediaMimeType: z.string().optional(),
    fileName: z.string().optional(),
    caption: z.string().optional(),
  }),
  z.object({
    mode: z.literal('location'),
    to: phoneDigits,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    name: z.string().optional(),
    address: z.string().optional(),
  }),
]);

export const bulkItemsSchema = z.array(bulkItemSchema).min(1).max(500).superRefine((items, ctx) => {
  items.forEach((item, i) => {
    if (item.mode === 'media' && !item.mediaUrl && !item.mediaBase64) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: 'Butuh mediaUrl atau mediaBase64' });
    }
  });
});

/**
 * Bulk v2 menerima `messages[]` berisi payload lengkap per penerima, sehingga
 * personalisasi (variabel kustom, spintax) dan pesan media/lokasi tetap utuh.
 * `batchId` boleh dipasok klien agar dashboard bisa mengendalikan kampanye
 * (pause / resume / clear) memakai ID yang stabil.
 *
 * Bentuk v1 (`recipients[]` + `text`) tetap diterima untuk kompatibilitas panel.
 */
export const sendBulkSchema = z.object({
  sessionId: z.string().min(1),
  batchId: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/, 'batchId hanya boleh huruf, angka, tanda hubung, dan garis bawah (3-64 karakter)').optional(),
  priority: z.enum(['high', 'normal']).optional(),
  // Mode uji: validasi kontrak + kuota TANPA memasukkan pesan ke antrean.
  // Dipakai oleh uji otomatis supaya tidak ada pesan nyata yang terkirim
  // ke WhatsApp (enqueue = kirim; tidak ada undo setelah worker mengambilnya).
  dryRun: z.boolean().optional(),

  // v2
  messages: bulkItemsSchema.optional(),
  // v1 legacy
  recipients: z.array(phoneDigits).min(1).max(500).optional(),
  text: z.string().min(1).optional(),
}).refine((d) => Boolean(d.messages) || Boolean(d.recipients && d.text), {
  message: 'Butuh messages[] (v2) atau recipients[] + text (v1)',
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
});

export const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  // Nomor WhatsApp opsional, sama seperti di panel admin. Diterima dalam bentuk
  // apa pun yang lazim ditulis (08xx, +62xxx, 62xxx) lalu dinormalisasi.
  phone: z.string().optional(),
});

export const webhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(8).optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'subscription', 'user']).default('user'),
  // quotaPerDay tetap number ketat; panel mengirim angka. Tapi terima juga
  // string numerik dari klien lain supaya tidak gagal validasi tanpa alasan.
  quotaPerDay: z.coerce.number().int().min(1).default(100),
  quotaPeriod: z.enum(['daily', 'weekly', 'monthly']).optional(),
  quotaLimit: z.coerce.number().int().min(1).optional(),
  assignedSessionId: z.string().optional(),
  // Nomor telepon opsional. Diterima dalam bentuk apa pun yang lazim ditulis
  // (08xx, +62xxx, 62xxx) lalu dinormalisasi ke bentuk kanonik 628xxx.
  phone: z.string().optional(),
});

// Skema reset password mandiri. Aturan panjang password disamakan dengan
// endpoint reset-password milik admin supaya tidak ada dua aturan berbeda.
export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(6).max(200),
});

export function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    return { ok: false, error: `Validasi gagal — ${msg}` };
  }
  return { ok: true, data: r.data };
}
