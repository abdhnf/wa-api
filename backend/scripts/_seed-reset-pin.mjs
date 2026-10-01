// Seed DB sementara untuk uji endpoint reset-pin.
// Dijalankan sebagai proses terpisah supaya koneksi SQLite-nya sudah tertutup
// saat server uji dibuka (menghindari 'database is locked').
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
