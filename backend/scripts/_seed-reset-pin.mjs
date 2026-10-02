// Seed DB sementara untuk uji endpoint reset-pin.
// Dijalankan sebagai proses terpisah supaya koneksi SQLite-nya sudah tertutup
// saat server uji dibuka (menghindari 'database is locked').
//
// WAJIB: DATABASE_PATH harus diarahkan ke DB sementara. Tanpa penjaga ini
// skrip pernah dijalankan tanpa DATABASE_PATH dan menulis user uji ke DB
// produksi (data/wa.db). Penjaga di bawah menolak jalan sebelum menyentuh DB.
const dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
  console.error(
    '[seed-reset-pin] DITOLAK: DATABASE_PATH belum diisi.\n' +
    '  Skrip ini menulis user uji dan TIDAK BOLEH menyentuh DB produksi.\n' +
    '  Jalankan: DATABASE_PATH=/tmp/uji/wa.db node scripts/_seed-reset-pin.mjs'
  );
  process.exit(2);
}
if (!/tmp|temp|test|uji/i.test(dbPath)) {
  console.error(
    `[seed-reset-pin] DITOLAK: DATABASE_PATH menunjuk ke "${dbPath}" yang ` +
    'tidak terlihat seperti DB sementara.\n' +
    '  Arahkan ke path di bawah /tmp (mis. /tmp/uji/wa.db) lalu ulangi.'
  );
  process.exit(2);
}

// Semua output diagnostik ke stderr supaya stdout hanya berisi JSON hasil.
// Parser skrip verifikasi membaca stdout sebagai JSON — warning apa pun yang
// ikut ke stdout akan merusaknya.
const log = (...a) => console.error('[seed-reset-pin]', ...a);

log('menulis ke', dbPath);

import { createUser, getOrCreateUserBlastAccessToken, db } from '../dist/db.js';
import { hashPassword } from '../dist/security.js';

const admin = createUser({
  name: 'Admin Uji',
  email: 'admin@uji.local',
  passwordHash: hashPassword('rahasia123'),
  role: 'admin',
  apiKey: 'key-admin-uji-0001',
  quotaPerDay: 1000,
  status: 'active',
});

const target = createUser({
  name: 'Budi Uji',
  email: 'budi@uji.local',
  passwordHash: hashPassword('rahasia123'),
  role: 'user',
  apiKey: 'key-user-uji-0002',
  quotaPerDay: 100,
  status: 'active',
});

const nonAdmin = createUser({
  name: 'Sari Uji',
  email: 'sari@uji.local',
  passwordHash: hashPassword('rahasia123'),
  role: 'user',
  apiKey: 'key-user-uji-0003',
  quotaPerDay: 100,
  status: 'active',
});

// Token blast target supaya verify-blast-launch bisa diuji end-to-end.
const token = getOrCreateUserBlastAccessToken(target.id);

console.log(JSON.stringify({
  adminId: admin.id, adminKey: 'key-admin-uji-0001',
  targetId: target.id, nonAdminKey: 'key-user-uji-0003',
  blastToken: token,
}));

// Tutup koneksi SQLite secara eksplisit: handle DatabaseSync menahan event loop,
// tanpa ini proses tidak pernah keluar dan test yang memanggilnya menggantung.
db.close();
