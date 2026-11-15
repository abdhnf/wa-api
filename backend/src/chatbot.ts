/**
 * Chatbot rule-based: pencocokan aturan, alur bertingkat, dan pengiriman balasan.
 *
 * Keputusan desain yang menentukan perilakunya:
 *
 *   1. **Balasan masuk antrean prioritas.** Dikirim lewat `manager.enqueue()`
 *      dengan `priority: 'high'`, bukan lewat socket langsung. Dengan begitu
 *      balasan bot tetap tercatat di `messages`, tetap kena pacing, dan tetap
 *      terlihat di panel — sama seperti pesan lain.
 *   2. **Chat pribadi saja.** Grup sengaja dilewati: membalas setiap pesan grup
 *      adalah cara tercepat membuat nomor dilaporkan.
 *   3. **Human takeover.** Begitu operator membalas manual, bot berhenti untuk
 *      kontak itu selama 24 jam. Tanpa ini bot akan menabrak percakapan yang
 *      sedang dipegang manusia — kesalahan yang mahal dan sulit dijelaskan.
 *   4. **Opt-out dihormati lebih dulu dari apa pun.** Kontak yang menulis
 *      STOP/BERHENTI tidak dibalas dan tidak boleh dikirimi blast lagi.
 */
import {
  listApplicableFlows,
  getChatbotSession,
  saveChatbotSession,
  pauseBotForContact,
  addOptout,
  isOptedOut,
  markInboundBotHandled,
  getSessionOwnerId,
  type ChatbotFlow,
  type ChatbotStep,
} from './db.js';
import type { InboundMessage } from './db/inbox.js';
import { cocokTeks, regexValid } from './matcher.js';

/** Lama bot diam setelah operator membalas manual. */
export const HUMAN_TAKEOVER_MS = 24 * 60 * 60 * 1000;

/**
 * Kata kunci berhenti.
 *
 * Daftar pendek dan eksplisit. Mencocokkan "stop" sebagai substring akan
 * menangkap "stop kontak" dan mematikan bot untuk pertanyaan yang sah.
 */
const KATA_OPT_OUT = new Set([
  'stop', 'berhenti', 'unsub', 'unsubscribe', 'batal', 'jangan kirim',
  'jangan hubungi', 'hapus nomor', 'remove me',
]);

/**
 * Periksa apakah teks adalah permintaan berhenti.
 *
 * Dicocokkan pada teks yang sudah dinormalisasi: huruf kecil, tanda baca
 * dibuang, spasi dirapikan. "STOP!" dan "  stop  " harus sama-sama dikenali.
 */
export function adalahOptOut(teks: string | null | undefined): boolean {
  if (!teks) return false;
  const normal = teks.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!normal) return false;
  return KATA_OPT_OUT.has(normal);
}

/**
 * Cocokkan teks dengan aturan.
 *
 * Logika pencocokannya ada di `matcher.ts` — dipakai bersama filter webhook
 * supaya kedua fitur tidak pernah punya arti "cocok" yang berbeda. Fungsi ini
 * hanya meneruskan, tetap diekspor karena sudah dipakai uji dan pemanggil lama.
 */
export function cocok(flow: ChatbotFlow, teks: string): boolean {
  return cocokTeks(flow.matchType, flow.matchValue, teks);
}

/** `true` bila pola regex aturan ini bisa dikompilasi. */
export function regexFlowValid(flow: Pick<ChatbotFlow, 'matchType' | 'matchValue'>): boolean {
  return flow.matchType !== 'regex' || regexValid(flow.matchValue);
}

export interface RencanaBalasan {
  flowId: string;
  /** Teks balasan yang akan dikirim. */
  reply: string;
  /** Langkah berikutnya, atau `null` bila percakapan selesai. */
  nextStep: string | null;
  /** `true` bila state percakapan harus dibersihkan setelah balasan ini. */
  selesai: boolean;
}

/**
 * Tentukan balasan untuk satu pesan masuk. Fungsi murni — tidak mengirim apa pun.
 *
 * Dipisah dari pengiriman supaya keputusannya bisa diuji tanpa WhatsApp, dan
 * supaya pemanggil bisa memilih menunda pengiriman tanpa mengubah logika.
 */
export function rencanakanBalasan(
  pesan: InboundMessage,
  state: { currentFlowId: string | null; currentStep: string | null } | null,
  flows: ChatbotFlow[],
): RencanaBalasan | null {
  const teks = pesan.text ?? pesan.mediaCaption ?? '';

  // 1. Lanjutkan alur yang sedang berjalan lebih dulu.
  //
  // Ini mendahului pencocokan aturan baru: kalau bot sedang menanyakan "1. Produk
  // 2. Harga", jawaban "1" harus dibaca sebagai langkah alur, bukan sebagai
  // pencocokan aturan yang kebetulan juga mengandung "1".
  if (state?.currentFlowId && state.currentStep) {
    // Alur yang sedang berjalan dicari di daftar aturan yang BERLAKU, bukan
    // langsung ke database. Kalau aturannya sudah dinonaktifkan atau dihapus
    // di tengah percakapan, percakapan harus berhenti — bukan melanjutkan
    // memakai aturan yang sudah tidak dipakai.
    const flow = flows.find((f) => f.id === state.currentFlowId);
    if (flow && flow.steps) {
      const langkah = cariLangkah(flow.steps, state.currentStep);
      if (langkah) {
        const kunci = pilihCabang(langkah, teks);
        if (kunci !== null) {
          const berikut = langkah.next?.[kunci];
          const langkahBerikut = berikut ? cariLangkah(flow.steps, berikut) : undefined;
          if (langkahBerikut) {
            return {
              flowId: flow.id,
              reply: langkahBerikut.reply,
              nextStep: langkahBerikut.id,
              selesai: Boolean(langkahBerikut.end) || !langkahBerikut.next,
            };
          }
        }
        // Jawaban tidak dikenali: ulangi pertanyaan langkah ini, jangan
        // memulai aturan lain. Operator biasanya ingin pengguna memilih ulang.
        return { flowId: flow.id, reply: langkah.reply, nextStep: langkah.id, selesai: false };
      }
    }
  }

  // 2. Cocokkan aturan, urut prioritas. Flow khusus sesi sudah didahulukan
  // oleh `listApplicableFlows`.
  if (!teks) return null;
  for (const flow of flows) {
    if (!cocok(flow, teks)) continue;

    // Aturan dengan `steps` memulai alur di langkah pertama.
    if (flow.steps && flow.steps.length > 0) {
      const pertama = flow.steps[0];
      return {
        flowId: flow.id,
        reply: pertama.reply,
        nextStep: pertama.id,
        selesai: Boolean(pertama.end) || !pertama.next,
      };
    }
    if (flow.replyText) {
      return { flowId: flow.id, reply: flow.replyText, nextStep: null, selesai: true };
    }
  }

  return null;
}

function cariLangkah(steps: ChatbotStep[], id: string): ChatbotStep | undefined {
  return steps.find((s) => s.id === id);
}

/**
 * Pilih cabang dari jawaban pengguna.
 *
 * Dicocokkan persis dulu, lalu sebagai awalan: "1. Produk" dan "1" sama-sama
 * menuju cabang "1". Awalan dipakai karena orang sering menjawab dengan
 * menyalin seluruh baris menu.
 */
function pilihCabang(langkah: ChatbotStep, teks: string): string | null {
  if (!langkah.next) return null;
  const t = teks.trim().toLowerCase();
  if (!t) return null;

  const kunci = Object.keys(langkah.next);
  const persis = kunci.find((k) => k.toLowerCase() === t);
  if (persis) return persis;

  const awalan = kunci.find((k) => t.startsWith(k.toLowerCase()));
  return awalan ?? null;
}

/**
 * Kirim balasan bot.
 *
 * `enqueue` disuntikkan pemanggil, bukan diimpor langsung: modul ini tidak
 * perlu tahu soal `SessionManager`, dan pengujian bisa memeriksa apa yang akan
 * dikirim tanpa menyentuh antrean sungguhan.
 */
export async function kirimBalasan(params: {
  sessionId: string;
  to: string;
  text: string;
  enqueue: (input: { sessionId: string; to: string; text: string; priority: 'high' }) => Promise<unknown>;
}): Promise<void> {
  await params.enqueue({
    sessionId: params.sessionId,
    to: params.to,
    text: params.text,
    priority: 'high',
  });
}

export interface HasilChatbot {
  /** `true` bila bot menangani pesan ini (membalas atau menandai opt-out). */
  ditangani: boolean;
  alasan?: string;
  balasan?: string;
}

/**
 * Proses satu pesan masuk melalui chatbot.
 *
 * Dipanggil dari `inbound-pipeline.ts` setelah pesan tersimpan. Tidak pernah
 * melempar: kegagalan chatbot tidak boleh membuat pesan hilang dari inbox.
 */
export async function prosesChatbot(
  pesan: InboundMessage,
  enqueue: (input: { sessionId: string; to: string; text: string; priority: 'high' }) => Promise<unknown>,
): Promise<HasilChatbot> {
  try {
    // Grup dilewati. Membalas grup otomatis adalah cara tercepat dilaporkan.
    if (pesan.chatType !== 'private') return { ditangani: false, alasan: 'bukan chat pribadi' };
    if (!pesan.fromPhone) return { ditangani: false, alasan: 'nomor pengirim tidak dikenali' };

    // Opt-out diperiksa lebih dulu dari segala hal, termasuk takeover:
    // permintaan berhenti harus selalu dihormati.
    if (adalahOptOut(pesan.text)) {
      addOptout(pesan.sessionId, pesan.fromPhone, 'permintaan pengguna');
      markInboundBotHandled(pesan.id);
      return { ditangani: true, alasan: 'opt-out dicatat' };
    }

    if (isOptedOut(pesan.sessionId, pesan.fromPhone)) {
      return { ditangani: false, alasan: 'kontak sudah opt-out' };
    }

    const state = getChatbotSession(pesan.sessionId, pesan.fromPhone);
    if (state?.botPausedUntil && state.botPausedUntil > Date.now()) {
      return { ditangani: false, alasan: 'bot dijeda (ambil alih operator)' };
    }

    const userId = pesan.userId || getSessionOwnerId(pesan.sessionId);
    const flows = listApplicableFlows(userId, pesan.sessionId);
    if (flows.length === 0) return { ditangani: false, alasan: 'belum ada aturan aktif' };

    const rencana = rencanakanBalasan(pesan, state, flows);
    if (!rencana) return { ditangani: false, alasan: 'tidak ada aturan yang cocok' };

    // Cooldown per aturan: mencegah balasan berulang saat pengguna mengirim
    // pesan yang sama berkali-kali berturut-turut.
    const flow = flows.find((f) => f.id === rencana.flowId);
    if (flow && flow.cooldownSeconds > 0 && state?.lastActivityAt) {
      const terakhir = Date.parse(state.lastActivityAt.replace(' ', 'T') + 'Z');
      if (Number.isFinite(terakhir) && Date.now() - terakhir < flow.cooldownSeconds * 1000) {
        return { ditangani: false, alasan: 'masih dalam cooldown aturan' };
      }
    }

    await kirimBalasan({
      sessionId: pesan.sessionId,
      to: pesan.fromPhone,
      text: rencana.reply,
      enqueue,
    });

    saveChatbotSession({
      sessionId: pesan.sessionId,
      contactPhone: pesan.fromPhone,
      currentFlowId: rencana.selesai ? null : rencana.flowId,
      currentStep: rencana.selesai ? null : rencana.nextStep,
      context: state?.context ?? null,
      botPausedUntil: null,
    });

    markInboundBotHandled(pesan.id);
    return { ditangani: true, balasan: rencana.reply };
  } catch (err: any) {
    console.error('[chatbot] Gagal memproses pesan masuk:', err?.message || err);
    return { ditangani: false, alasan: 'galat internal' };
  }
}

/**
 * Tandai bot dijeda karena operator membalas manual.
 *
 * Dipanggil dari jalur pengiriman manual. Tanpa ini, bot dan operator akan
 * membalas hal yang sama secara bergantian.
 */
export function tandaiTakeoverOperator(sessionId: string, to: string): void {
  try {
    const nomor = to.replace(/\D/g, '');
    if (!nomor) return;
    pauseBotForContact(sessionId, nomor, Date.now() + HUMAN_TAKEOVER_MS);
  } catch (err) {
    console.warn('[chatbot] Gagal menandai takeover:', err);
  }
}
