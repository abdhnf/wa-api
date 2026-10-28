/**
 * Konteks bersama: instance Fastify, hook lintas-rute, engine WhatsApp,
 * dan SessionManager. Modul lain mengimpor `app`, `engine`, dan `manager`
 * dari sini supaya hanya ada satu instance.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { config } from '../config.js';
import { SessionManager } from '../session-manager.js';
import { BaileysEngine } from '../engine/BaileysEngine.js';
import { rateLimitHook, getClientIp } from '../security.js';
import { insertApiLog } from '../db.js';
import { saringParams } from '../audit-params.js';

/**
 * Tentukan sasaran sebuah permintaan dari parameter rutenya.
 *
 * Dipakai untuk mengisi kolom `target_type` / `target_id` di `api_logs`.
 *
 * Kenapa tidak mengekstrak dari `endpoint`: id sesi memang ada di dalam string
 * seperti `/api/v1/sessions/sess-abc/queue/pause`, tetapi mengambilnya dengan
 * pencocokan teks bergantung pada bentuk URL yang bisa berubah, dan hasilnya
 * tidak bisa dibedakan dari potongan URL lain yang kebetulan mirip. `req.params`
 * sudah diurai Fastify berdasarkan definisi rute, jadi lebih tepat.
 *
 * Urutan pemeriksaan mengikuti kekhususan: `batchId` lebih khusus daripada `id`,
 * karena rute seperti `/sessions/:id/contact-graph/batch/:batchId` punya
 * keduanya dan yang dimaksud aksi biasanya batch-nya.
 */
/**
 * Penyimpan sementara nilai-sebelum-aksi, per permintaan.
 *
 * Dipakai handler yang sudah membaca keadaan lama sebelum menulis:
 *
 *     catatNilaiSebelum(req, { preset: lama });
 *
 * Nilainya diambil lagi oleh hook `onResponse` dan disimpan ke `params_before`.
 * Tanpa jalur ini, `params` hanya bisa menjawab "diubah menjadi apa", bukan
 * "diubah dari apa" — dan untuk aksi yang bisa dibalik, pertanyaan kedua itulah
 * yang menentukan.
 *
 * Disimpan di objek `req`, bukan variabel modul, supaya tidak tertukar antar
 * permintaan yang berjalan bersamaan.
 */
const KUNCI_NILAI_SEBELUM = Symbol.for('wa.nilaiSebelum');

export function catatNilaiSebelum(req: unknown, nilai: Record<string, unknown>): void {
  try {
    const r = req as Record<symbol, unknown>;
    // Digabung, bukan ditimpa: satu handler boleh mencatat beberapa hal.
    r[KUNCI_NILAI_SEBELUM] = { ...((r[KUNCI_NILAI_SEBELUM] as object) || {}), ...nilai };
  } catch {
    /* pencatatan audit tidak boleh menggagalkan permintaan */
  }
}

function ambilNilaiSebelum(req: unknown): string | null {
  try {
    const nilai = (req as Record<symbol, unknown>)[KUNCI_NILAI_SEBELUM];
    if (!nilai || typeof nilai !== 'object' || Object.keys(nilai).length === 0) return null;
    return saringParams(nilai);
  } catch {
    return null;
  }
}

function ambilSasaran(params: unknown): { targetType: string | null; targetId: string | null } {
  const p = (params || {}) as Record<string, unknown>;
  const ambil = (kunci: string): string | null => {
    const v = p[kunci];
    return typeof v === 'string' && v ? v.slice(0, 128) : null;
  };

  const batchId = ambil('batchId');
  if (batchId) return { targetType: 'batch', targetId: batchId };

  const sessionId = ambil('sessionId');
  if (sessionId) return { targetType: 'session', targetId: sessionId };

  const id = ambil('id');
  if (id) {
    // `id` dipakai untuk beberapa jenis sasaran, jadi tipenya ditebak dari
    // bentuk id — bukan dari URL. Awalan id di repo ini konsisten:
    // `sess-` sesi, `msg_`/`wamid` pesan, `usr_` user, `log_` log.
    if (id.startsWith('sess-')) return { targetType: 'session', targetId: id };
    if (id.startsWith('usr_')) return { targetType: 'user', targetId: id };
    if (id.startsWith('msg_') || id.startsWith('wamid')) return { targetType: 'message', targetId: id };
    return { targetType: null, targetId: id };
  }

  return { targetType: null, targetId: null };
}

export const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 }); // 50MB body limit untuk upload media base64
await app.register(cors, { origin: true });
await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtExpiresIn } });

// Proteksi Rate Limiting & Anti-DDoS Global
app.addHook('onRequest', rateLimitHook);

// Non-blocking Selective Logging untuk Audit Request & Troubleshooting API
//
// Perubahan penting: `api_logs` sekarang juga berfungsi sebagai bukti audit untuk
// permintaan yang datang dari agen (MCP), bukan hanya catatan galat.
//
// Dua penyesuaian yang menyertainya:
//
//   1. GET yang berhasil TIDAK lagi dibuang tanpa syarat. Sebelumnya baris
//      `if (method === 'GET' && statusCode < 400) return` membuat seluruh
//      operasi baca agen tidak berjejak — padahal tujuh dari dua belas tool MCP
//      adalah baca. Filternya tidak dihapus, karena panel melakukan polling GET
//      terus-menerus dan tanpa filter itu log akan penuh sampah. Yang diubah:
//      GET sukses tetap dilewati KECUALI permintaan itu membawa `X-MCP-Actor`.
//      Jadi jejak agen tercatat, kebisingan panel tetap tersaring.
//
//   2. Kolom `actor`, `target_type`, `target_id`, dan `params` diisi dari
//      permintaan yang sedang ditangani server — bukan dari laporan pemanggil.
//      Pelakunya (`user_id`) tetap dari kunci API yang sudah diverifikasi, jadi
//      yang bisa dipalsukan hanya label agennya, bukan identitas pelakunya.
app.addHook('onResponse', async (req, reply) => {
  try {
    const rawUrl = req.url || '';
    const url = rawUrl.split('?')[0];
    const method = req.method;
    const statusCode = reply.statusCode;

    // Penanda agen. Hanya label, bukan autentikasi: siapa pun yang punya API key
    // bisa mengirimnya. Nilainya dipakai untuk dua hal saja — memutuskan apakah
    // GET yang berhasil dicatat, dan mengisi kolom `actor`.
    const actorHeader = req.headers['x-mcp-actor'];
    const actor = typeof actorHeader === 'string' && actorHeader.trim() ? actorHeader.trim().slice(0, 64) : null;

    // Filter Noise: Lewati polling GET yang sukses dan healthcheck.
    // GET sukses dari agen tetap dicatat (lihat alasan di atas).
    if (method === 'OPTIONS') return;
    if (method === 'GET' && statusCode < 400 && !actor) return;
    if (url.startsWith('/api/v1/health') || url.startsWith('/api/v1/api-logs') || url.startsWith('/favicon.ico')) return;

    const user = (req as any).apiKeyUser;
    const userId = user?.id || 'anonymous';
    const durationMs = Math.round(reply.elapsedTime || 0);
    const ip = getClientIp(req);

    // Sasaran aksi, diambil dari parameter rute. Disimpan sebagai kolom supaya
    // tidak perlu mengekstraknya dari string `endpoint` saat membaca audit.
    const { targetType, targetId } = ambilSasaran(req.params);

    // Parameter hanya berguna untuk metode yang menulis. Body GET tidak
    // disimpan: isinya tidak ada, dan kalau ada pun bukan sesuatu yang mengubah
    // keadaan. Ini juga menghemat penyaringan yang tidak perlu.
    const menulis = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    const params = menulis ? saringParams((req as any).body) : null;

    // Nilai SEBELUM aksi. Server tidak bisa mengetahuinya sendiri — ia hanya
    // melihat permintaan yang sedang berjalan, bukan keadaan sebelum handler
    // mengubahnya. Yang mengisinya adalah handler yang memang sudah membaca nilai
    // lama (mis. `PUT /sessions/:id/antiban`), lewat `catatNilaiSebelum()`.
    // Menebaknya di sini akan berarti mencatat sesuatu yang belum terjadi.
    const paramsBefore = menulis ? ambilNilaiSebelum(req) : null;

    // Baris ini bukti audit bila datang dari agen ATAU membawa nilai sebelum
    // aksi. Konsekuensinya: baris audit tidak bisa dihapus non-admin, sedangkan
    // log galat biasa tetap bisa dibersihkan pemiliknya.
    const audit = Boolean(actor) || Boolean(paramsBefore);

    // Asynchronous non-blocking write ke SQLite agar thread HTTP tidak tertahan
    setImmediate(() => {
      insertApiLog({
        id: `log_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`,
        userId,
        method,
        endpoint: url,
        statusCode,
        ip,
        durationMs,
        actor,
        targetType,
        targetId,
        params,
        paramsBefore,
        audit,
      });
    });
  } catch (err) {
    // Fail-safe: error logging tidak boleh mengganggu respon API
    console.error('[onResponse:logger] Gagal memproses log:', err);
  }
});

export const engine = new BaileysEngine([]);
export const manager = new SessionManager(engine);
engine.on463Callback = (sessionId) => manager.record463(sessionId);
engine.onTimelockUpdateCallback = (sessionId, data) => manager.handleTimelockUpdate(sessionId, data);
engine.onBlocklistCallback = (sessionId, blockedCount) => manager.metrics.setBlockedContacts(sessionId, blockedCount);
engine.onDisconnectCallback = (sessionId) => manager.onDisconnect(sessionId);
engine.onReconnectCallback = (sessionId) => manager.onReconnect(sessionId);
engine.onIncomingCallback = (sessionId, jid) => manager.onIncoming(sessionId, jid);
await engine.restoreSavedSessions();
app.addContentTypeParser(/^(image|video|audio)\//, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
for (const rawType of ['application/octet-stream', 'application/pdf']) {
  app.addContentTypeParser(rawType, { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
}
