/**
 * Pengiriman webhook: pemancar event + worker antrean.
 *
 * Prinsip yang dipegang di sini:
 *
 *   1. **Tidak pernah mengirim dari jalur permintaan.** `pancarkanEvent()` hanya
 *      menulis baris antrean. Penerima yang mati atau lambat tidak boleh menahan
 *      pemrosesan pesan WhatsApp.
 *   2. **Tanda tangan atas isi yang dikirim.** HMAC dihitung dari
 *      `${timestamp}.${body}` — bukan dari body saja — supaya penerima bisa
 *      menolak kiriman yang diputar ulang (replay) di luar jendela waktu.
 *   3. **Kegagalan dicatat, bukan ditelan.** Setiap percobaan meninggalkan baris
 *      di `webhook_deliveries`; tanpa itu, integrasi yang diam-diam tidak pernah
 *      menerima apa pun tidak bisa didiagnosis.
 */
import { createHmac, randomUUID } from 'node:crypto';
import {
  listActiveWebhooksForEvent,
  enqueueWebhookDelivery,
  ambilPengirimanSiap,
  tandaiPengirimanBerhasil,
  tandaiPengirimanGagal,
  catatKeberhasilanWebhook,
  catatKegagalanWebhook,
  getWebhook,
  pruneWebhookDeliveries,
  kosongkanPayloadLama,
  type WebhookEvent,
} from './db.js';

/** Batas waktu satu percobaan kirim. Penerima lambat tidak boleh menahan worker. */
const TIMEOUT_MS = 10_000;

/** Jeda antar percobaan. Indeks = jumlah percobaan yang sudah gagal. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 6 * 60 * 60_000];

/** Setelah ini, pengiriman menyerah dan ditandai `failed`. */
const MAX_ATTEMPTS = BACKOFF_MS.length;

/** Interval worker. Cukup rapat untuk terasa real-time, cukup longgar untuk murah. */
const TICK_MS = 2_000;

/** Batas kiriman per menit per webhook, supaya penerima tidak dibanjiri. */
const MAX_PER_MINUTE = 60;

/** Jendela waktu tanda tangan. Penerima menolak timestamp di luar ini. */
export const SIGNATURE_TOLERANCE_SEC = 300;

/**
 * Berapa jam body pengiriman disimpan setelah selesai.
 *
 * Default 24 jam; atur lewat `WEBHOOK_PAYLOAD_RETENTION_HOURS`. Nilai `<= 0`
 * mematikan pembersihan, sehingga body bertahan sampai barisnya dipangkas
 * (30 hari). Nilai tidak valid jatuh ke default, bukan ke "mati" — salah tulis
 * konfigurasi seharusnya tidak diam-diam memperpanjang penyimpanan data pribadi.
 */
function jamSimpanPayload(): number {
  const parsed = Number.parseInt(process.env.WEBHOOK_PAYLOAD_RETENTION_HOURS ?? '', 10);
  if (!Number.isInteger(parsed)) return 24;
  return parsed;
}

/**
 * Hitung tanda tangan HMAC.
 *
 * Diekspor supaya bisa dipakai penerima (dan uji) untuk memverifikasi tanpa
 * menyalin logikanya. Format yang dikirim: `sha256=<hex>`.
 */
export function hitungTandaTangan(secret: string, timestamp: number, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Kunci idempotensi stabil untuk satu kejadian.
 *
 * Bedanya dengan `deliveryId` penting: `deliveryId` dibuat acak per pemancaran,
 * jadi ia hanya menyatukan percobaan ulang dari SATU baris antrean. Kunci ini
 * diturunkan dari isi kejadian, sehingga dua pemancaran untuk kejadian yang sama
 * — pesan yang dikirim ulang Baileys setelah reconnect, atau status yang
 * berubah bolak-balik ke nilai yang sama — menghasilkan kunci yang sama dan
 * bisa dikenali penerima sebagai kiriman ganda.
 *
 * Kunci dihitung SEKALI saat masuk antrean lalu disimpan; percobaan ulang
 * memakai nilai tersimpan itu, bukan menghitung ulang.
 *
 * `occurredAt` sengaja ikut pada `session.status`: transisi ke status yang sama
 * bisa terjadi berkali-kali (putus → nyambung → putus) dan tiap kejadian itu
 * berita tersendiri. Tanpa penyangat ini, kejadian kedua akan dibuang penerima
 * sebagai duplikat kejadian pertama.
 */
export function hitungIdempotencyKey(event: string, data: Record<string, unknown>): string {
  const s = (v: unknown, fallback = 'unknown'): string =>
    v === null || v === undefined ? fallback : typeof v === 'string' ? v : String(v);

  switch (event) {
    case 'message.received':
      // waMessageId unik per akun, bukan global — sesi ikut supaya dua nomor
      // tidak saling membatalkan pesan satu sama lain.
      return `msg_${s(data.sessionId)}_${s(data.waMessageId ?? data.id)}`;
    case 'message.status':
      // Satu pesan bisa melewati beberapa status; status adalah bagian identitas.
      return `ack_${s(data.sessionId)}_${s(data.waMessageId ?? data.messageId)}_${s(data.status)}`;
    case 'session.status':
      return `sess_${s(data.sessionId)}_${s(data.status)}_${s(data.occurredAt)}`;
    default:
      return `evt_${event.replace(/\./g, '_')}_${s(data.sessionId)}`;
  }
}

/**
 * Susun header kiriman webhook.
 *
 * Diekspor supaya jalur antrean (`kirimSatu`) dan endpoint uji
 * (`POST /webhooks/:id/test`) mengirim set header yang PERSIS sama. Sebelumnya
 * endpoint uji membuat `X-WA-Delivery` terpisah dari `deliveryId` di body,
 * sehingga penerima yang melakukan dedupe berdasarkan nilai itu melihat payload
 * uji sebagai kiriman yang tidak bisa dicocokkan dengan header-nya.
 *
 * `X-WA-Webhook-Id` ada karena secret bersifat per-webhook: penerima dengan
 * beberapa endpoint butuh tahu kunci mana yang harus dipakai untuk memverifikasi
 * tanda tangan. Tanpa header ini satu-satunya cara adalah mencoba setiap secret
 * yang dimiliki, dan satu request yang gagal menjadi percobaan terhadap N kunci.
 *
 * Nilai `webhookId` bukan rahasia: ia hanya penunjuk baris konfigurasi, bukan
 * kunci. Mengirimkannya tidak melemahkan HMAC — pemalsuan tetap butuh secret.
 */
export function bangunHeaderWebhook(input: {
  webhookId: string;
  event: string;
  deliveryId: string;
  idempotencyKey: string;
  timestamp: number;
  signature: string;
  /** Percobaan ke berapa (0 = pertama). Penerima bisa memakainya untuk observability. */
  retryCount?: number;
}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'wa-api-webhook/1.0',
    'X-WA-Webhook-Id': input.webhookId,
    'X-WA-Event': input.event,
    'X-WA-Delivery': input.deliveryId,
    'X-WA-Idempotency-Key': input.idempotencyKey,
    'X-WA-Retry-Count': String(input.retryCount ?? 0),
    'X-WA-Timestamp': String(input.timestamp),
    'X-WA-Signature': input.signature,
  };
}

/**
 * Tolak URL yang jelas tidak boleh dihubungi server.
 *
 * Webhook memang dirancang untuk memanggil alamat internal (dashboard biasanya
 * ada di jaringan yang sama), jadi memblokir seluruh alamat privat akan membuat
 * fitur ini tidak berguna. Yang diblokir hanya alamat metadata cloud — satu-
 * satunya sasaran SSRF yang dampaknya jauh lebih besar daripada risiko yang
 * sudah diterima dengan mengizinkan alamat privat.
 */
export function urlWebhookAman(url: string): { ok: true } | { ok: false; alasan: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, alasan: 'URL tidak valid' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, alasan: 'Hanya http dan https yang didukung' };
  }
  // Kredensial di dalam URL (`https://user:pass@host/...`) tidak dipakai oleh
  // pengirim, tetapi tersimpan di database dan ikut tampil di panel serta
  // riwayat. Menolaknya di sini mencegah rahasia menumpang di tempat yang tidak
  // pernah membacanya.
  if (u.username || u.password) {
    return { ok: false, alasan: 'URL tidak boleh memuat kredensial (user:pass@)' };
  }
  if (u.href.length > 2048) {
    return { ok: false, alasan: 'URL terlalu panjang (maksimal 2048 karakter)' };
  }
  const host = u.hostname.toLowerCase();
  if (host === '169.254.169.254' || host === 'metadata.google.internal' || host === '[fd00:ec2::254]') {
    return { ok: false, alasan: 'Alamat metadata cloud tidak diizinkan' };
  }
  return { ok: true };
}

/**
 * Pancarkan satu event ke seluruh webhook aktif milik user yang melanggannya.
 *
 * `scope` menyaring penerima berdasarkan sesi, jenis chat, dan isi pesan. Tanpa
 * ini, akun dengan beberapa nomor tidak bisa mengarahkan pesan nomor A ke
 * dashboard A saja — semuanya bercampur di satu endpoint. `scope.message`
 * diisi hanya untuk event yang membawa pesan; lihat catatan di
 * `listActiveWebhooksForEvent` tentang kenapa pembedaan itu penting.
 *
 * Tidak pernah melempar: pemanggilnya adalah jalur pemrosesan pesan, dan
 * kegagalan pencatatan webhook tidak boleh membuat pesan hilang dari inbox.
 */
export function pancarkanEvent(
  event: WebhookEvent,
  userId: string,
  data: Record<string, unknown>,
  scope?: {
    sessionId?: string | null;
    chatType?: string | null;
    /** Diisi HANYA untuk event yang membawa pesan; `null` = event tanpa pesan. */
    message?: { text: string | null } | null;
  },
): number {
  try {
    const hooks = listActiveWebhooksForEvent(userId, event, scope);
    if (hooks.length === 0) return 0;

    // Satu `deliveryId` untuk satu event, dipakai di payload DAN header
    // `X-WA-Delivery`. Kalau keduanya dibuat terpisah, penerima tidak punya
    // kunci tunggal untuk dedupe — dan retry akan terlihat sebagai event baru.
    const deliveryId = randomUUID();
    // Kunci idempotensi diturunkan dari isi kejadian, bukan dari `deliveryId`:
    // dua pemancaran untuk kejadian yang sama harus menghasilkan kunci yang
    // sama, sementara `deliveryId` sengaja berbeda tiap pemancaran.
    const idempotencyKey = hitungIdempotencyKey(event, data);
    const body = JSON.stringify({
      event,
      deliveryId,
      occurredAt: new Date().toISOString(),
      data,
    });

    let jumlah = 0;
    for (const hook of hooks) {
      enqueueWebhookDelivery({
        id: `whd_${randomUUID().slice(0, 12)}`,
        webhookId: hook.id,
        userId: hook.userId,
        event,
        payload: body,
        deliveryId,
        idempotencyKey,
        nextAttemptAt: Date.now(),
      });
      jumlah++;
    }
    return jumlah;
  } catch (err) {
    console.error('[webhook] Gagal memasukkan event ke antrean:', err);
    return 0;
  }
}

/** Penghitung kiriman per menit, per webhook. Disimpan di memori proses. */
const jendelaKirim = new Map<string, number[]>();

function bolehKirimSekarang(webhookId: string): boolean {
  const now = Date.now();
  const batas = now - 60_000;
  const daftar = (jendelaKirim.get(webhookId) || []).filter((t) => t > batas);
  if (daftar.length >= MAX_PER_MINUTE) {
    jendelaKirim.set(webhookId, daftar);
    return false;
  }
  daftar.push(now);
  jendelaKirim.set(webhookId, daftar);
  return true;
}

/**
 * Kirim satu baris antrean.
 *
 * Mengembalikan `true` bila berhasil. Kegagalan HTTP 4xx (selain 408/429)
 * dianggap permanen: penerima menolak isinya, jadi mengulang dengan isi yang
 * sama tidak akan berubah hasilnya.
 */
async function kirimSatu(delivery: {
  id: string;
  webhookId: string;
  event: string;
  payload: string;
  attempts: number;
  /** Id stabil event, sama dengan yang ada di payload. Dipakai penerima untuk dedupe. */
  deliveryId: string;
  /** Kunci idempotensi tersimpan; `null` untuk baris lama sebelum kolom ini ada. */
  idempotencyKey: string | null;
}): Promise<boolean> {
  const hook = getWebhook(delivery.webhookId);
  if (!hook) {
    // Webhook sudah dihapus; baris antreannya tidak ada gunanya.
    tandaiPengirimanGagal(delivery.id, null, 'Webhook sudah tidak ada', true, Date.now());
    return false;
  }
  if (hook.status !== 'active') {
    tandaiPengirimanGagal(delivery.id, null, 'Webhook dinonaktifkan', true, Date.now());
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const signature = hitungTandaTangan(hook.secret, timestamp, delivery.payload);

  let statusCode: number | null = null;
  let error = '';

  try {
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: bangunHeaderWebhook({
        webhookId: hook.id,
        event: delivery.event ?? '',
        deliveryId: delivery.deliveryId,
        // Baris lama (sebelum kolom ini ada) tidak punya kunci tersimpan; pakai
        // `deliveryId` sebagai gantinya supaya header tidak pernah kosong.
        idempotencyKey: delivery.idempotencyKey ?? delivery.deliveryId,
        timestamp,
        signature,
        retryCount: delivery.attempts,
      }),
      body: delivery.payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    statusCode = res.status;

    if (res.ok) {
      tandaiPengirimanBerhasil(delivery.id, res.status);
      catatKeberhasilanWebhook(hook.id);
      return true;
    }
    error = `HTTP ${res.status} ${res.statusText}`.trim();
  } catch (err: any) {
    error = err?.name === 'TimeoutError' ? `Timeout setelah ${TIMEOUT_MS}ms` : err?.message || String(err);
  }

  const attempts = delivery.attempts + 1;
  const permanen =
    attempts >= MAX_ATTEMPTS ||
    (statusCode !== null && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429);

  const nextAttemptAt = permanen ? Date.now() : Date.now() + (BACKOFF_MS[attempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
  tandaiPengirimanGagal(delivery.id, statusCode, error, permanen, nextAttemptAt);
  catatKegagalanWebhook(hook.id);

  if (permanen) {
    console.warn(`[webhook] ${hook.id} menyerah setelah ${attempts} percobaan: ${error}`);
  }
  return false;
}

let timer: NodeJS.Timeout | undefined;
let sedangJalan = false;

/** Satu putaran worker. Diekspor supaya bisa dipanggil langsung dari uji. */
export async function jalankanSatuPutaran(limit = 20): Promise<{ dicoba: number; berhasil: number }> {
  if (sedangJalan) return { dicoba: 0, berhasil: 0 };
  sedangJalan = true;
  let dicoba = 0;
  let berhasil = 0;

  try {
    const siap = ambilPengirimanSiap(limit);
    for (const d of siap) {
      if (!bolehKirimSekarang(d.webhookId)) {
        // Ditunda, bukan dibuang: barisnya tetap `pending` dan dicoba pada
        // putaran berikutnya setelah jendela per menitnya longgar.
        continue;
      }
      dicoba++;
      if (await kirimSatu(d)) berhasil++;
    }
  } catch (err) {
    console.error('[webhook] Worker gagal pada satu putaran:', err);
  } finally {
    sedangJalan = false;
  }

  return { dicoba, berhasil };
}

/**
 * Jalankan worker.
 *
 * Dipanggil setelah server listen, sama seperti penjadwal retensi: kegagalan
 * worker tidak boleh menghalangi server melayani permintaan.
 */
export function mulaiWorkerWebhook(): void {
  if (timer) return;

  timer = setInterval(() => {
    void jalankanSatuPutaran();
  }, TICK_MS);
  timer.unref?.();

  // Pembersihan riwayat: sekali sehari, cukup untuk data yang hanya dipakai
  // saat menelusuri masalah integrasi.
  const pembersih = setInterval(() => {
    try {
      const n = pruneWebhookDeliveries(30);
      if (n > 0) console.log(`[webhook] ${n} riwayat pengiriman lama dibersihkan`);
    } catch (err) {
      console.error('[webhook] Gagal membersihkan riwayat:', err);
    }
  }, 24 * 60 * 60 * 1000);
  pembersih.unref?.();

  // Pembersihan body: tiap jam, bukan harian.
  //
  // Body berisi isi pesan pelanggan, jadi jendela simpannya dihitung dalam jam.
  // Menumpangkannya pada pembersih harian akan membuat jendela 24 jam melebar
  // sampai 48 jam — dua kali lipat dari yang dijanjikan konfigurasinya.
  const jamSimpan = jamSimpanPayload();
  if (jamSimpan > 0) {
    const bersihkanBody = () => {
      try {
        const n = kosongkanPayloadLama(jamSimpan);
        if (n > 0) console.log(`[webhook] ${n} body pengiriman lama dibersihkan (${jamSimpan} jam)`);
      } catch (err) {
        console.error('[webhook] Gagal membersihkan body pengiriman:', err);
      }
    };
    bersihkanBody(); // sekali saat start, supaya penumpukan lama langsung susut
    const pembersihBody = setInterval(bersihkanBody, 60 * 60 * 1000);
    pembersihBody.unref?.();
  } else {
    console.log('[webhook] Pembersihan body pengiriman dimatikan (WEBHOOK_PAYLOAD_RETENTION_HOURS <= 0)');
  }

  console.log('[webhook] Worker pengiriman aktif');
}
