/**
 * Jalur pemrosesan pesan masuk: normalisasi -> simpan -> (chatbot, webhook).
 *
 * Satu tempat, bukan tiga pemanggil terpisah di engine. Alasannya: urutannya
 * penting. Pesan harus tersimpan lebih dulu supaya chatbot dan webhook melihat
 * baris yang sama, dan supaya kegagalan salah satunya tidak menghilangkan
 * pesannya. Kalau tiap konsumen mendaftarkan callback sendiri di engine,
 * urutan itu tidak dijamin dan pesan bisa diproses dua kali.
 *
 * Semua langkah setelah penyimpanan bersifat best-effort: kegagalan chatbot
 * atau webhook tidak boleh membuat pesan hilang dari inbox.
 */
import { normalizeInbound } from './inbound.js';
import { insertInboundMessage, getSessionOwnerId, type InboundMessage } from './db.js';
import { pancarkanEvent } from './webhook.js';
import { prosesChatbot } from './chatbot.js';

/**
 * Pengirim balasan bot, disuntikkan dari luar.
 *
 * Tidak diimpor langsung dari `routes/konteks.ts` karena berkas itu sendiri
 * mengimpor modul ini — impor dua arah akan membuat salah satu binding
 * `undefined` pada saat modul dievaluasi. Pemanggil mendaftarkannya sekali
 * lewat `setPengirimBalasan()`.
 */
type PengirimBalasan = (input: {
  sessionId: string;
  to: string;
  text: string;
  priority: 'high';
}) => Promise<unknown>;

let pengirimBalasan: PengirimBalasan | null = null;

export function setPengirimBalasan(fn: PengirimBalasan | null): void {
  pengirimBalasan = fn;
}

/**
 * Penyelesai LID -> JID bentuk nomor, disuntikkan dari luar.
 *
 * Pengirim bisa muncul sebagai `14396814266545@lid`; angka itu id internal
 * WhatsApp, bukan nomor yang bisa dikirimi pesan. Tanpa penyelesaian, nomor itu
 * tersimpan sebagai `from_phone` dan balasan chatbot dikirim ke alamat yang
 * tidak ada (`not_registered`). Pemetaannya sudah dimiliki `LidResolver`, jadi
 * di sini cukup ditanyakan — bukan diduplikasi.
 */
let penyelesaiLid: ((jid: string) => string | null) | null = null;

export function setPenyelesaiLid(fn: ((jid: string) => string | null) | null): void {
  penyelesaiLid = fn;
}

export interface HasilPesanMasuk {
  /** `null` bila pesan disaring (bukan pesan baru, dari diri sendiri, dsb). */
  pesan: InboundMessage | null;
  /** `false` bila baris dilewati karena duplikat. */
  tersimpan: boolean;
}

/**
 * Proses satu item `messages.upsert`.
 *
 * `upsertType` diteruskan apa adanya dari Baileys; `normalizeInbound` yang
 * memutuskan apakah nilainya layak diproses.
 */
export function prosesPesanMasuk(sessionId: string, msg: any, upsertType?: string): HasilPesanMasuk {
  const normalized = normalizeInbound(msg, upsertType, penyelesaiLid ?? undefined);
  if (!normalized) return { pesan: null, tersimpan: false };

  const userId = getSessionOwnerId(sessionId);
  const receivedAt = new Date().toISOString();
  const id = `inb_${crypto.randomUUID().slice(0, 12)}`;

  const tersimpan = insertInboundMessage({
    id,
    sessionId,
    userId,
    waMessageId: normalized.waMessageId,
    fromJid: normalized.fromJid,
    fromPhone: normalized.fromPhone,
    pushName: normalized.pushName,
    chatType: normalized.chatType,
    type: normalized.type,
    text: normalized.text,
    mediaMime: normalized.mediaMime,
    mediaCaption: normalized.mediaCaption,
    raw: normalized.raw,
    receivedAt,
  });

  if (!tersimpan) return { pesan: null, tersimpan: false };

  const pesan: InboundMessage = {
    id,
    sessionId,
    userId,
    waMessageId: normalized.waMessageId,
    fromJid: normalized.fromJid,
    fromPhone: normalized.fromPhone,
    pushName: normalized.pushName,
    chatType: normalized.chatType,
    type: normalized.type,
    text: normalized.text,
    mediaMime: normalized.mediaMime,
    mediaCaption: normalized.mediaCaption,
    raw: normalized.raw,
    receivedAt,
    botHandled: false,
  };

  // Event webhook dipancarkan SETELAH baris tersimpan. Urutannya penting:
  // penerima yang membaca balik inbox lewat API harus sudah bisa menemukan
  // pesan yang dirujuk event ini, bukan menerima rujukan ke baris yang belum ada.
  pancarkanEvent('message.received', userId, {
    id: pesan.id,
    // `userId` ikut dikirim karena penerima webhook perlu tahu tenant mana
    // pesan ini miliknya. Tanpa itu, dashboard harus menebak dari sesi — dan
    // tebakan yang salah membuat pesan tersimpan tanpa bisa dibaca pemiliknya.
    // Nilainya bukan rahasia bagi penerima: webhook ini memang milik user itu.
    userId,
    sessionId,
    waMessageId: pesan.waMessageId,
    from: pesan.fromPhone,
    fromJid: pesan.fromJid,
    pushName: pesan.pushName,
    chatType: pesan.chatType,
    type: pesan.type,
    text: pesan.text,
    mediaMime: pesan.mediaMime,
    mediaCaption: pesan.mediaCaption,
    receivedAt,
  }, {
    sessionId,
    chatType: pesan.chatType,
    // Bahan filter isi pesan. Caption ikut dipakai supaya filter `keyword: promo`
    // juga mengenai gambar promo — sama seperti aturan chatbot yang membaca
    // `text ?? mediaCaption`. Tanpa ini, pesan bergambar lolos dari filter
    // hanya karena teksnya ada di caption, bukan di body.
    message: { text: pesan.text ?? pesan.mediaCaption ?? null },
  });

  // Chatbot dijalankan setelah event webhook dimasukkan antrean, dan sengaja
  // TIDAK ditunggu. Balasan bot masuk antrean kirim yang punya pacing sendiri;
  // menahannya di sini akan menahan pemrosesan pesan berikutnya dari Baileys.
  if (pengirimBalasan) {
    void prosesChatbot(pesan, pengirimBalasan);
  }

  return { pesan, tersimpan: true };
}
