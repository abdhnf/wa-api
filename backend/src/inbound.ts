/**
 * Normalisasi pesan masuk dari Baileys menjadi baris inbox.
 *
 * Dipisah dari engine supaya bisa diuji tanpa socket: fungsi di sini hanya
 * menerima objek pesan dan mengembalikan bentuk yang siap disimpan, atau `null`
 * bila pesan itu memang tidak layak masuk inbox.
 *
 * Yang disaring dan alasannya:
 *
 *   - `type !== 'notify'` — `messages.upsert` juga memancarkan `append` untuk
 *     riwayat yang disinkronkan. Tanpa saringan ini, inbox terisi percakapan
 *     lama yang tidak pernah benar-benar "masuk" hari ini.
 *   - `key.fromMe` — pesan kita sendiri. Kalau ikut disimpan, chatbot akan
 *     membalas dirinya sendiri.
 *   - `status@broadcast` — status story, bukan percakapan.
 *   - grup — DISIMPAN, tetapi ditandai `chat_type = 'group'`. Menyimpannya murah
 *     dan berguna untuk audit; yang membatasi chatbot adalah `chat_type`, bukan
 *     penyimpanannya.
 */
import type { InboundChatType, InboundType } from './db/inbox.js';

export interface NormalizedInbound {
  waMessageId: string | null;
  fromJid: string;
  fromPhone: string | null;
  /**
   * JID bentuk nomor bila pengirim muncul sebagai LID dan pemetaannya diketahui.
   * `null` bila pengirim memang sudah berupa nomor, atau pemetaan belum ada.
   */
  fromPnJid?: string | null;
  pushName: string | null;
  chatType: InboundChatType;
  type: InboundType;
  text: string | null;
  mediaMime: string | null;
  mediaCaption: string | null;
  raw: string | null;
}

/** Batas panjang teks yang disimpan. Pesan WA sendiri dibatasi ~65k karakter. */
const MAX_TEXT = 8000;

/**
 * Buka pembungkus yang menyembunyikan isi pesan sebenarnya.
 *
 * WhatsApp membungkus pesan menghilang (`ephemeralMessage`), lihat-sekali
 * (`viewOnceMessage` / `viewOnceMessageV2`), dan pesan yang diedit
 * (`editedMessage`) dalam lapisan tambahan. Tanpa dibuka, semua pesan dari chat
 * "pesan sementara" akan terbaca sebagai tipe `other` tanpa teks.
 */
function unwrap(message: any): any {
  let m = message;
  // Dibatasi 5 lapis: struktur ini tidak pernah lebih dalam dari itu, dan
  // pembatas mencegah loop tak berujung kalau ada payload cacat.
  for (let i = 0; i < 5 && m && typeof m === 'object'; i++) {
    const next =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.viewOnceMessageV2Extension?.message ??
      m.documentWithCaptionMessage?.message ??
      m.editedMessage?.message;
    if (!next) break;
    m = next;
  }
  return m;
}

/**
 * Ambil nomor telepon dari JID. `628123@s.whatsapp.net` -> `628123`.
 *
 * JID berbentuk `@lid` BUKAN nomor telepon. Sejak WhatsApp memperkenalkan LID
 * (Linked Identity), pengirim bisa muncul sebagai `14396814266545@lid` — angka
 * itu id internal, bukan nomor yang bisa dikirimi pesan. Mengembalikannya
 * sebagai nomor membuat balasan chatbot dikirim ke alamat yang tidak ada
 * (`not_registered`), dan pesan yang sama tampil sebagai kontak berbeda dari
 * percakapan sebelumnya di nomor aslinya.
 *
 * Pemetaan LID -> nomor ditangani pemanggil lewat `lidResolver`; fungsi ini
 * hanya menjawab "apakah JID ini sendiri sudah berupa nomor".
 */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  // JID grup berbentuk `123456-789@g.us`; nomornya bukan nomor telepon.
  // `@lid` sengaja ikut ditolak: angkanya id internal, bukan nomor.
  if (
    jid.endsWith('@g.us') ||
    jid.endsWith('@broadcast') ||
    jid.endsWith('@newsletter') ||
    jid.endsWith('@lid')
  ) {
    return null;
  }
  const user = jid.split('@')[0] || '';
  // Buang device suffix (`628123:12`).
  const digits = user.split(':')[0].replace(/\D/g, '');
  return digits || null;
}

function chatTypeFor(jid: string): InboundChatType {
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return 'broadcast';
  return 'private';
}

/**
 * Tentukan tipe dan isi pesan.
 *
 * Caption media disimpan terpisah dari `text`: chatbot perlu tahu bahwa
 * pengirim mengirim gambar, bukan sekadar membaca caption-nya sebagai teks
 * biasa. `text` hanya diisi untuk pesan yang memang teks.
 */
function extractContent(message: any): {
  type: InboundType;
  text: string | null;
  mediaMime: string | null;
  mediaCaption: string | null;
} {
  if (!message || typeof message !== 'object') {
    return { type: 'other', text: null, mediaMime: null, mediaCaption: null };
  }

  if (typeof message.conversation === 'string') {
    return { type: 'text', text: message.conversation, mediaMime: null, mediaCaption: null };
  }
  if (typeof message.extendedTextMessage?.text === 'string') {
    return { type: 'text', text: message.extendedTextMessage.text, mediaMime: null, mediaCaption: null };
  }

  const media: Array<[string, InboundType]> = [
    ['imageMessage', 'image'],
    ['videoMessage', 'video'],
    ['audioMessage', 'audio'],
    ['documentMessage', 'document'],
  ];
  for (const [key, type] of media) {
    const node = message[key];
    if (node) {
      return {
        type,
        text: null,
        mediaMime: typeof node.mimetype === 'string' ? node.mimetype : null,
        mediaCaption: typeof node.caption === 'string' ? node.caption : null,
      };
    }
  }

  if (message.locationMessage) {
    return { type: 'location', text: null, mediaMime: null, mediaCaption: null };
  }

  return { type: 'other', text: null, mediaMime: null, mediaCaption: null };
}

/**
 * Ubah satu item `messages.upsert` menjadi baris inbox.
 *
 * Mengembalikan `null` untuk pesan yang tidak boleh masuk inbox (lihat catatan
 * di kepala berkas).
 *
 * `penyelesaiLid` opsional: diberi JID pengirim, mengembalikan JID bentuk nomor
 * bila pemetaan LID->PN diketahui. Disuntikkan, bukan diimpor, supaya modul ini
 * tetap bisa diuji tanpa database.
 */
export function normalizeInbound(
  msg: any,
  upsertType?: string,
  penyelesaiLid?: (jid: string) => string | null,
): NormalizedInbound | null {
  if (!msg || typeof msg !== 'object') return null;
  if (upsertType && upsertType !== 'notify') return null;

  const key = msg.key;
  if (!key || typeof key !== 'object') return null;
  if (key.fromMe) return null;

  const remoteJid: string = key.remoteJid || '';
  if (!remoteJid) return null;
  if (remoteJid === 'status@broadcast') return null;

  const chatType = chatTypeFor(remoteJid);
  const content = extractContent(unwrap(msg.message));

  // Pesan tanpa isi yang bisa dibaca (reaction, poll update, protocol message)
  // tetap disimpan sebagai 'other' — yang dibuang hanya pesan yang benar-benar
  // kosong, karena baris tanpa isi tidak berguna untuk inbox maupun chatbot.
  const hasAnything = content.text !== null || content.mediaMime !== null || content.type !== 'other';
  if (!hasAnything) return null;

  const text = content.text !== null ? content.text.slice(0, MAX_TEXT) : null;
  const caption = content.mediaCaption !== null ? content.mediaCaption.slice(0, MAX_TEXT) : null;

  // Pengirim bisa muncul sebagai `@lid`. Urutan penentuan nomor:
  //   1. JID itu sendiri sudah nomor        -> pakai.
  //   2. `remoteJidAlt` berisi bentuk nomor -> pakai (Baileys menyertakannya).
  //   3. Pemetaan LID tersimpan             -> pakai.
  //   4. Tidak ada                         -> null, dan chatbot tidak membalas.
  // Langkah 4 penting: lebih baik diam daripada mengirim ke angka LID yang
  // bukan nomor, yang berakhir `not_registered` dan masuk hitungan gagal.
  const altJid: string | null = typeof key.remoteJidAlt === 'string' ? key.remoteJidAlt : null;
  let fromPhone = phoneFromJid(remoteJid);
  let fromPnJid: string | null = fromPhone ? remoteJid : null;

  if (!fromPhone) {
    const altPhone = phoneFromJid(altJid);
    if (altPhone) {
      fromPhone = altPhone;
      fromPnJid = altJid;
    } else if (penyelesaiLid && remoteJid.endsWith('@lid')) {
      const pnJid = penyelesaiLid(remoteJid);
      const pnPhone = phoneFromJid(pnJid);
      if (pnPhone) {
        fromPhone = pnPhone;
        fromPnJid = pnJid;
      }
    }
  }

  // `raw` sengaja ringkas: hanya field yang berguna untuk penelusuran. Menyimpan
  // seluruh objek Baileys berarti menyimpan kunci enkripsi dan metadata protokol
  // ke tabel yang masa simpannya lebih panjang dari pesan aslinya.
  const raw = JSON.stringify({
    id: key.id ?? null,
    remoteJid,
    remoteJidAlt: altJid,
    participant: key.participant ?? null,
    pushName: msg.pushName ?? null,
    timestamp: msg.messageTimestamp ?? null,
    type: content.type,
  });

  return {
    waMessageId: typeof key.id === 'string' ? key.id : null,
    fromJid: remoteJid,
    fromPhone,
    fromPnJid,
    pushName: typeof msg.pushName === 'string' && msg.pushName.trim() ? msg.pushName.trim().slice(0, 120) : null,
    chatType,
    type: content.type,
    text,
    mediaMime: content.mediaMime,
    mediaCaption: caption,
    raw,
  };
}
