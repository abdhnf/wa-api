/**
 * Pemeriksaan kepemilikan sesi, dipakai bersama oleh rute yang menyentuh satu
 * sesi tertentu.
 *
 * Kenapa ada: sebelumnya blok yang sama disalin ke setiap endpoint yang
 * memeriksa kepemilikan, dan yang tidak disalin justru bocor. Enam endpoint
 * (`GET /sessions/:id/metrics`, `GET /metrics`, `GET/POST /queue/*`,
 * `POST /reconnect`, `POST /logout`, `DELETE /sessions/:id`) hanya memakai
 * `requireAuth` tanpa pemeriksaan apa pun, sehingga API key milik user mana pun
 * bisa membaca metrik dan menghentikan antrean sesi milik user lain.
 *
 * Membaca `sessions.user_id` dari database — bukan dari `manager.getSession()` —
 * punya dua alasan:
 *
 *   1. `manager.getSession()` menyentuh engine WhatsApp. Pemeriksaan otorisasi
 *      tidak boleh bergantung pada koneksi WA yang mungkin sedang putus.
 *   2. `upsertSession()` memakai `COALESCE(sessions.user_id, excluded.user_id)`,
 *      jadi pemilik yang tersimpan di DB tidak pernah tertimpa. DB adalah sumber
 *      yang tepat untuk pertanyaan "siapa pemiliknya".
 */
import { db } from './db.js';
import type { UserRecord } from './types.js';

export type HasilKepemilikan =
  | { status: 'ok' }
  | { status: 'tidak-ada' }
  | { status: 'bukan-milik' };

/**
 * Periksa apakah `user` boleh menyentuh sesi `sessionId`.
 *
 * Aturan:
 *   - admin: selalu boleh.
 *   - sesi tidak ada di DB: `tidak-ada` (pemanggil menjawab 404).
 *   - sesi tanpa `user_id`: boleh. Ini sesi lama dari sebelum kolom `user_id`
 *     ada; menolaknya akan mengunci admin dari sesinya sendiri, dan tidak ada
 *     informasi siapa pemiliknya untuk dibandingkan.
 *   - selain itu: cocokkan `user_id`.
 */
export function periksaKepemilikanSesi(user: UserRecord | null | undefined, sessionId: string): HasilKepemilikan {
  if (user && user.role === 'admin') return { status: 'ok' };

  const row = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(sessionId) as
    | { user_id?: string | null }
    | undefined;

  if (!row) return { status: 'tidak-ada' };
  if (!row.user_id) return { status: 'ok' };
  if (!user) return { status: 'bukan-milik' };
  if (row.user_id !== user.id) return { status: 'bukan-milik' };

  return { status: 'ok' };
}

/**
 * Versi untuk rute yang ingin menjawab sendiri. Mengembalikan `null` kalau boleh
 * lanjut, atau objek `{ code, body }` yang siap dikirim sebagai penolakan.
 *
 * Dipisah begini supaya setiap rute tidak perlu menulis `if` bertingkat, tetapi
 * tetap bisa memilih pesan yang tepat: 404 untuk sesi yang tidak ada (jangan
 * membocorkan bahwa id itu ada), 403 untuk sesi milik orang lain.
 */
export function tolakSesi(
  user: UserRecord | null | undefined,
  sessionId: string,
): { code: number; body: { error: string } } | null {
  const hasil = periksaKepemilikanSesi(user, sessionId);
  if (hasil.status === 'ok') return null;
  if (hasil.status === 'tidak-ada') {
    return { code: 404, body: { error: 'Session tidak ditemukan' } };
  }
  return { code: 403, body: { error: 'Akses ditolak: sesi ini milik pengguna lain' } };
}

/**
 * Id sesi yang boleh dilihat pemanggil, atau `null` untuk admin (artinya semua).
 *
 * Dipakai `GET /metrics`, yang mengembalikan laporan SEMUA sesi sekaligus —
 * sehingga tanpa penyaringan, satu API key bisa membaca metrik seluruh tenant.
 */
export function idSesiMilik(user: UserRecord | null | undefined): Set<string> | null {
  if (user && user.role === 'admin') return null;
  const rows = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(user?.id ?? '') as { id: string }[];
  return new Set(rows.map((r) => r.id));
}
