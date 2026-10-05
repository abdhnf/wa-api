/**
 * Akses database wa-api.
 *
 * Berkas ini sengaja hanya meneruskan (re-export): isinya sudah dipisah per
 * domain data di `db/`. Pemakai lama tidak perlu berubah — impor dari
 * './db.js' tetap bekerja seperti sebelumnya.
 *
 * PENTING: urutan muat berkas ini bukan gaya penulisan, melainkan syarat
 * kebenaran. `db/skema.ts` berisi efek samping (CREATE TABLE, migrasi kolom,
 * index, seed settings) yang HARUS berjalan sebelum fungsi lain dipakai.
 * Karena itu ia diimpor lebih dulu, dan `seedDefaultAdmin()` dipanggil
 * paling akhir setelah semua modul selesai dimuat.
 *
 * - db/client.ts          koneksi DatabaseSync
 * - db/skema.ts           skema, migrasi, index, seed settings (efek samping)
 * - db/users.ts           akun, kunci API, PIN/token blast
 * - db/reset-password.ts  token reset password
 * - db/kuota.ts           kuota harian/mingguan/bulanan
 * - db/sessions.ts        sesi WhatsApp
 * - db/pesan.ts           pesan keluar/masuk, antrean, webhook
 * - db/lid.ts             pemetaan LID <-> nomor telepon
 * - db/kesehatan.ts       skor risiko sesi
 * - db/jeda.ts            status jeda antrean
 * - db/api-logs.ts        log permintaan API
 * - db/admin.ts           seed Super Admin
 */
import './db/skema.js';

export * from './db/client.js';
export * from './db/users.js';
export * from './db/reset-password.js';
export * from './db/sessions.js';
export * from './db/pesan.js';
export * from './db/kuota.js';
export * from './db/lid.js';
export * from './db/kesehatan.js';
export * from './db/jeda.js';
export * from './db/api-logs.js';
export * from './db/admin.js';

import { seedDefaultAdmin } from './db/admin.js';

// Instalasi baru: buat Super Admin pertama. Dijalankan setelah skema ada.
seedDefaultAdmin();
