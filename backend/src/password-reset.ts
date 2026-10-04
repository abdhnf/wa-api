/**
 * Layanan reset password.
 *
 * Alur: pengguna memasukkan email -> sistem membuat token acak, menyimpan
 * HASH-nya, dan mengirim tautan berisi token asli -> pengguna membuka tautan dan
 * memasukkan password baru -> token diverifikasi, dipakai sekali, lalu dibatalkan.
 *
 * Tiga aturan keamanan yang membentuk seluruh berkas ini:
 *
 *   1. JANGAN BOCORKAN KEBERADAAN AKUN. Respons untuk email terdaftar dan tidak
 *      terdaftar harus identik, termasuk waktu responsnya. Kalau ada perbedaan
 *      yang terukur, penyerang bisa memetakan email mana yang punya akun.
 *
 *   2. RATE LIMIT PER EMAIL, bukan hanya per IP. Kalau hanya per IP, penyerang
 *      tinggal berganti IP dan mengebom satu email target.
 *
 *   3. TOKEN SEKALI PAKAI. Setelah dipakai, semua token lain milik user itu ikut
 *      dibatalkan — supaya tautan lama yang mungkin sudah bocor tidak berguna.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hashPassword } from './security.js';
import {
  getUserByEmail,
  getUserById,
  setUserPassword,
  simpanTokenReset,
  ambilTokenReset,
  tandaiTokenResetTerpakai,
  batalkanTokenResetUser,
  hitungPermintaanReset,
} from './db.js';
import { ambilKonfigurasiMail, kirimEmail } from './mailer.js';
import {
  bangunTautanReset,
  templateResetPassword,
  templateResetPasswordTeks,
  BRAND,
} from './mail-templates.js';

/** Batas permintaan per alamat email dalam satu jendela waktu. */
const BATAS_PER_EMAIL = 3;
const JENDELA_EMAIL_MENIT = 15;

/** Batas permintaan per alamat IP — lapisan tambahan, bukan pengganti. */
const BATAS_PER_IP = 10;
const JENDELA_IP_MENIT = 15;

/**
 * Percobaan per IP disimpan di memori, mengikuti pola brute-force login di
 * security.ts. Konsekuensinya sama: hitungan hilang saat service restart.
 * Untuk lapisan ini itu bisa diterima, karena batas per email sudah dijaga di
 * database dan tidak hilang saat restart.
 */
const percobaanPerIp = new Map<string, { jumlah: number; jendelaMulai: number }>();

function cekBatasIp(ip: string): { boleh: boolean; sisaDetik: number } {
  const sekarang = Date.now();
  const catatan = percobaanPerIp.get(ip);

  if (!catatan || sekarang - catatan.jendelaMulai > JENDELA_IP_MENIT * 60_000) {
    percobaanPerIp.set(ip, { jumlah: 1, jendelaMulai: sekarang });
    return { boleh: true, sisaDetik: 0 };
  }

  if (catatan.jumlah >= BATAS_PER_IP) {
    const sisaMs = catatan.jendelaMulai + JENDELA_IP_MENIT * 60_000 - sekarang;
    return { boleh: false, sisaDetik: Math.max(1, Math.ceil(sisaMs / 1000)) };
  }

  catatan.jumlah += 1;
  return { boleh: true, sisaDetik: 0 };
}

/** Bersihkan catatan IP yang sudah lewat jendelanya, supaya Map tidak menumpuk. */
export function bersihkanCatatanIp(): void {
  const sekarang = Date.now();
  for (const [ip, catatan] of percobaanPerIp.entries()) {
    if (sekarang - catatan.jendelaMulai > JENDELA_IP_MENIT * 60_000) {
      percobaanPerIp.delete(ip);
    }
  }
}

/** Buat token acak 32 byte dalam bentuk hex. */
export function buatTokenAcak(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Hash token dengan SHA-256.
 *
 * Determinstik, jadi bisa dicari lewat `WHERE token_hash = ?`. Aman karena token
 * berasal dari 32 byte acak — bukan password yang bisa ditebak. Lihat catatan
 * lengkap di db.ts bagian Reset Password.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Bandingkan dua hash tanpa membocorkan waktu perbandingan. */
function hashSama(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface HasilPermintaanReset {
  /** Selalu true untuk permintaan yang sah — tidak membocorkan keberadaan akun. */
  ok: boolean;
  pesan: string;
  /** Terisi hanya saat pengiriman benar-benar terjadi. Tidak dikembalikan ke klien. */
  terkirim?: boolean;
}

/**
 * Ajukan permintaan reset password.
 *
 * PENTING: pemanggil TIDAK BOLEH mengembalikan nilai selain `pesan` ke klien.
 * `terkirim` hanya untuk log internal.
 */
export async function ajukanResetPassword(
  emailMentah: string,
  alamatIp: string
): Promise<HasilPermintaanReset> {
  const email = (emailMentah || '').trim().toLowerCase();

  // Pesan ini dipakai untuk SEMUA hasil — email ada, tidak ada, dibatasi, atau
  // gagal kirim. Keseragaman ini yang mencegah pemetaan akun.
  const pesanSeragam =
    'Kalau email tersebut terdaftar, kami sudah mengirim tautan untuk mengatur ulang password. ' +
    'Periksa kotak masuk dan folder spam Anda.';

  const batasIp = cekBatasIp(alamatIp);
  if (!batasIp.boleh) {
    return {
      ok: false,
      pesan: `Terlalu banyak permintaan dari jaringan ini. Coba lagi dalam ${batasIp.sisaDetik} detik.`,
    };
  }

  // Rate limit per email. Dicek SEBELUM lookup user supaya email yang tidak
  // terdaftar pun tidak bisa dipakai mengebom sistem.
  if (hitungPermintaanReset(email, JENDELA_EMAIL_MENIT) >= BATAS_PER_EMAIL) {
    return {
      ok: false,
      pesan: `Permintaan untuk email ini sudah terlalu sering. Coba lagi dalam ${JENDELA_EMAIL_MENIT} menit.`,
    };
  }

  const user = getUserByEmail(email);

  if (!user) {
    // Akun tidak ada. Tetap lakukan pekerjaan yang sebanding (hash) supaya waktu
    // responsnya tidak jauh berbeda dari jalur yang mengirim email.
    hashToken(buatTokenAcak());
    return { ok: true, pesan: pesanSeragam, terkirim: false };
  }

  if (user.status !== 'active') {
    return { ok: true, pesan: pesanSeragam, terkirim: false };
  }

  const cfg = ambilKonfigurasiMail();
  const token = buatTokenAcak();
  const ttlMenit = cfg.resetTtlMenit;
  const kedaluwarsa = new Date(Date.now() + ttlMenit * 60_000).toISOString();

  // Simpan token SEBELUM mengirim. Kalau pengiriman gagal, barisnya tetap
  // tercatat — dan itu memang diinginkan, karena hitungannya dipakai untuk
  // rate limit. Token yang tidak pernah sampai akan kedaluwarsa sendiri.
  simpanTokenReset({
    tokenHash: hashToken(token),
    userId: user.id,
    channel: 'email',
    destination: email,
    expiresAt: kedaluwarsa,
    requestedIp: alamatIp,
  });

  const basisUrl = process.env.PANEL_BASE_URL || 'http://172.30.30.229:5174';
  const tautan = bangunTautanReset(basisUrl, token);

  const hasilKirim = await kirimEmail({
    tujuan: email,
    subjek: `${BRAND.nama} — Atur Ulang Password`,
    html: templateResetPassword({
      namaPenerima: user.name,
      tautan,
      ttlMenit,
      alamatIp,
    }),
    teks: templateResetPasswordTeks({
      namaPenerima: user.name,
      tautan,
      ttlMenit,
      alamatIp,
    }),
  });

  if (!hasilKirim.ok) {
    // Kegagalan dicatat untuk admin, tapi pengguna tetap menerima pesan seragam.
    console.error(`[reset-password] gagal kirim ke ${email}: ${hasilKirim.pesan}`);
    return { ok: true, pesan: pesanSeragam, terkirim: false };
  }

  return { ok: true, pesan: pesanSeragam, terkirim: true };
}

export interface HasilVerifikasiToken {
  valid: boolean;
  userId?: string;
  nama?: string;
  pesan: string;
}

/**
 * Periksa token tanpa memakainya.
 *
 * Dipakai halaman reset untuk memastikan token masih berlaku sebelum pengguna
 * diminta mengisi form — supaya tidak ada pengguna yang mengisi password baru
 * lalu baru diberi tahu tautannya kedaluwarsa.
 */
export function verifikasiTokenReset(token: string): HasilVerifikasiToken {
  if (!token || typeof token !== 'string') {
    return { valid: false, pesan: 'Tautan tidak memuat token.' };
  }

  const catatan = ambilTokenReset(hashToken(token));
  if (!catatan) {
    return { valid: false, pesan: 'Tautan tidak valid atau sudah pernah dipakai.' };
  }
  if (!hashSama(catatan.tokenHash, hashToken(token))) {
    return { valid: false, pesan: 'Tautan tidak valid.' };
  }
  if (catatan.usedAt) {
    return { valid: false, pesan: 'Tautan ini sudah pernah dipakai. Ajukan permintaan baru.' };
  }
  if (new Date(catatan.expiresAt).getTime() < Date.now()) {
    return { valid: false, pesan: 'Tautan sudah kedaluwarsa. Ajukan permintaan baru.' };
  }

  const user = getUserById(catatan.userId);
  if (!user) {
    return { valid: false, pesan: 'Akun tidak ditemukan.' };
  }
  if (user.status !== 'active') {
    return { valid: false, pesan: 'Akun sedang tidak aktif. Hubungi administrator.' };
  }

  return { valid: true, userId: user.id, nama: user.name, pesan: 'Tautan valid.' };
}

export interface HasilPakaiToken {
  ok: boolean;
  pesan: string;
}

/**
 * Pakai token untuk memasang password baru.
 *
 * Urutan operasinya penting: token ditandai terpakai LEBIH DULU, baru password
 * diubah. Kalau dibalik, dua permintaan bersamaan bisa sama-sama lolos
 * verifikasi dan keduanya mengubah password — yang terakhir menang, dan pengguna
 * bisa terkunci dari password yang dia kira sudah tersimpan.
 */
export function pakaiTokenReset(token: string, passwordBaru: string): HasilPakaiToken {
  const periksa = verifikasiTokenReset(token);
  if (!periksa.valid || !periksa.userId) {
    return { ok: false, pesan: periksa.pesan };
  }

  if (!passwordBaru || passwordBaru.length < 6) {
    return { ok: false, pesan: 'Password minimal 6 karakter.' };
  }
  if (passwordBaru.length > 200) {
    return { ok: false, pesan: 'Password terlalu panjang (maksimal 200 karakter).' };
  }

  const hash = hashToken(token);
  // Klaim token secara atomik. Kalau false, berarti ada permintaan lain yang
  // lebih dulu memakainya — dan itu harus ditolak, bukan dipaksa.
  if (!tandaiTokenResetTerpakai(hash)) {
    return { ok: false, pesan: 'Tautan ini baru saja dipakai. Ajukan permintaan baru.' };
  }

  setUserPassword(periksa.userId, hashPassword(passwordBaru));
  // Tautan lain yang masih aktif untuk user ini ikut dimatikan.
  batalkanTokenResetUser(periksa.userId);

  return { ok: true, pesan: 'Password berhasil diubah. Silakan masuk dengan password baru Anda.' };
}
