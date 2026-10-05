/**
 * Template email untuk wa-api.
 *
 * Berkas ini sengaja hanya meneruskan (re-export): isinya sudah dipisah per
 * jenis email di `email/`. Pemakai lama tidak perlu berubah — impor dari
 * './mail-templates.js' tetap bekerja seperti sebelumnya.
 *
 * - email/dasar.ts           palet, font, escapeHtml, BRAND
 * - email/reset-password.ts  email reset password
 * - email/registrasi.ts      email selamat datang akun baru
 * - email/uji.ts             email uji koneksi SMTP
 */
export {
  escapeHtml,
  BRAND,
} from './email/dasar.js';
// Interface adalah ekspor TIPE: tidak punya wujud saat runtime. Memakai
// `export type` membuatnya tetap benar kalau nanti compiler dijalankan dengan
// `verbatimModuleSyntax` atau `isolatedModules` yang lebih ketat.
export type { DataEmailReset } from './email/reset-password.js';
export {
  bangunTautanReset,
  templateResetPassword,
  templateResetPasswordTeks,
} from './email/reset-password.js';
export type { DataEmailRegistrasi } from './email/registrasi.js';
export {
  templateRegistrasiBerhasil,
  templateRegistrasiBerhasilTeks,
} from './email/registrasi.js';
export type { DataEmailUji } from './email/uji.js';
export {
  templateEmailUji,
  templateEmailUjiTeks,
} from './email/uji.js';
