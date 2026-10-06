/**
 * Buat berkas sesi untuk verifikasi panel di browser.
 *
 * Kenapa: panel menyimpan sesi di localStorage, dan browser otomatis tidak bisa
 * mengisinya. Mengetikkan kata sandi admin uji lewat form adalah jalur yang
 * dihindari. Sebagai gantinya, token ditandatangani langsung memakai
 * `JWT_SECRET` yang sama dengan backend uji — sah, dan hanya berlaku untuk
 * DB uji di /tmp (bukan produksi).
 *
 * Jalankan: node scripts-pecah/buat-sesi-panel.mjs <path-db> <jwt-secret>
 */
import { createHmac } from 'node:crypto';

const dbPath = process.argv[2];
const secret = process.argv[3];
if (!dbPath || !secret) {
  console.error('pakai: node buat-sesi-panel.mjs <path-db> <jwt-secret>');
  process.exit(1);
}

process.env.DATABASE_PATH = dbPath;
await import('../dist/db.js');
const { db } = await import('../dist/db/client.js');

const user = db.prepare("SELECT id, name, email, role, api_key FROM users WHERE role = 'admin' LIMIT 1").get();
if (!user) {
  console.error('  tidak ada admin di DB ini');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sekarang = Math.floor(Date.now() / 1000);
const kepala = b64({ alg: 'HS256', typ: 'JWT' });
const isi = b64({ id: user.id, role: user.role, email: user.email, iat: sekarang, exp: sekarang + 3600 });
const tanda = createHmac('sha256', secret).update(`${kepala}.${isi}`).digest('base64url');
const token = `${kepala}.${isi}.${tanda}`;

console.log(JSON.stringify({
  token,
  user: { id: user.id, name: user.name, email: user.email, role: user.role, apiKey: user.api_key },
}));
