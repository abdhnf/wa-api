/**
 * Basis URL panel — alamat yang bisa dibuka pengguna dari perangkatnya.
 *
 * Dipakai untuk menyusun tautan di email: tautan reset password dan tautan
 * "buka dashboard" / "lengkapi nomor WhatsApp" pada email selamat datang.
 * Keduanya WAJIB memakai fungsi ini supaya tidak ada email yang menunjuk alamat
 * berbeda — sebelumnya keduanya membaca sumber yang tidak sama, sehingga satu
 * tautan benar sementara yang lain menunjuk alamat pengembangan.
 *
 * Urutan prioritas:
 *   1. tabel `settings` (key `panel_base_url`) — bisa diubah admin dari panel,
 *      tanpa deploy dan tanpa restart.
 *   2. env `PANEL_BASE_URL` — untuk instalasi yang belum punya nilai di tabel.
 *   3. alamat pengembangan.
 *
 * Nilai dari tabel dibaca SETIAP pemanggilan, bukan di-cache saat modul dimuat.
 * Alasannya: perubahan dari panel harus langsung berlaku pada email berikutnya.
 * Kalau di-cache, admin yang baru memperbaiki alamat akan tetap mengirim tautan
 * lama sampai service di-restart — dan restart memutus sesi WhatsApp.
 *
 * NILAI BAWAAN SENGAJA ALAMAT PENGEMBANGAN, dan itu tidak berbahaya selama
 * salah satu dari dua sumber di atas terisi. Yang harus dihindari adalah
 * mengandalkannya di produksi: tautannya tidak bisa dibuka pengguna dan tidak
 * ada error yang muncul. Karena itu alamat ini juga ditampilkan di panel
 * sebagai nilai contoh, supaya terlihat kalau belum pernah diisi.
 */
import { getSetting } from './db.js';

/** Alamat pengembangan. Hanya dipakai kalau tabel dan env sama-sama kosong. */
export const PANEL_BASE_URL_BAWAAN = 'http://172.30.30.229:5174';

/**
 * Ambil basis URL panel yang sedang berlaku.
 *
 * Garis miring di ujung dibuang supaya penggabungan dengan path tidak
 * menghasilkan `//` — mis. `https://panel/` + `/onboarding`.
 */
export function ambilBasisPanel(): string {
  const dariPengaturan = (getSetting('panel_base_url') || '').trim();
  if (dariPengaturan) return dariPengaturan.replace(/\/+$/, '');

  const dariEnv = (process.env.PANEL_BASE_URL || '').trim();
  if (dariEnv) return dariEnv.replace(/\/+$/, '');

  return PANEL_BASE_URL_BAWAAN;
}
