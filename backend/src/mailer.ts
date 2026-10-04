/**
 * Pengiriman email wa-api.
 *
 * Satu jalur SMTP generik. Provider apa pun yang menyediakan relay SMTP bisa
 * dipakai — Brevo, Google Workspace, Resend, Mailgun, SendGrid, Postmark, atau
 * Mailpit untuk pengembangan. Ganti provider berarti ganti nilai di tabel
 * `settings`, tanpa mengubah kode dan tanpa restart service.
 *
 * KENAPA KONFIGURASI DI DATABASE, BUKAN DI .env:
 * Admin harus bisa membetulkan kredensial SMTP dari panel saat email reset
 * sedang bermasalah. Kalau di .env, setiap perbaikan butuh deploy dan restart —
 * justru pada saat pengguna sedang tidak bisa masuk ke akunnya.
 *
 * KENAPA PAKAI nodemailer, BUKAN KLIEN SMTP SENDIRI:
 * Menyusun MIME yang benar (encoding, lampiran, batas multipart, baris panjang)
 * jauh lebih rumit daripada yang terlihat, dan kesalahannya halus — email tetap
 * "terkirim" tapi tampil rusak di klien tertentu. nodemailer sudah teruji untuk
 * itu. Skrip `scripts/set-smtp-config.mjs` tetap memakai klien sendiri karena
 * di sana tujuannya hanya menguji autentikasi, bukan mengirim email sungguhan.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getSetting, setSetting } from './db.js';

/** Kunci konfigurasi di tabel `settings`. */
export const KUNCI_MAIL = {
  enabled: 'mail_enabled',
  provider: 'mail_provider',
  host: 'mail_host',
  port: 'mail_port',
  secure: 'mail_secure',
  user: 'mail_user',
  pass: 'mail_pass',
  fromAddress: 'mail_from_address',
  fromName: 'mail_from_name',
  replyTo: 'mail_reply_to',
  resetTtlMenit: 'mail_reset_ttl_minutes',
} as const;

/** Nilai bawaan. Dipakai kalau kunci belum ada di tabel `settings`. */
export const DEFAULT_MAIL = {
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  fromAddress: 'noreply@mail.srvx.my.id',
  fromName: 'SRVX Apps',
  resetTtlMenit: 30,
} as const;

/**
 * Preset provider. Semuanya memakai SMTP, jadi tidak ada kode khusus per
 * provider — preset hanya mengisi host dan port di panel.
 *
 * Port 587 (STARTTLS) dipilih sebagai bawaan karena paling luas didukung.
 * Port 465 (TLS langsung) juga bekerja dan sudah diuji.
 */
export const PRESET_PROVIDER = [
  { id: 'brevo', label: 'Brevo', host: 'smtp-relay.brevo.com', port: 587, secure: false },
  { id: 'google', label: 'Google Workspace', host: 'smtp.gmail.com', port: 587, secure: false },
  { id: 'resend', label: 'Resend', host: 'smtp.resend.com', port: 587, secure: false },
  { id: 'mailgun', label: 'Mailgun', host: 'smtp.mailgun.org', port: 587, secure: false },
  { id: 'sendgrid', label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false },
  { id: 'postmark', label: 'Postmark', host: 'smtp.postmarkapp.com', port: 587, secure: false },
  { id: 'mailpit', label: 'Mailpit (pengembangan)', host: '127.0.0.1', port: 1025, secure: false },
] as const;

export interface KonfigurasiMail {
  enabled: boolean;
  provider: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  resetTtlMenit: number;
}

/**
 * Baca berkas bootstrap `~/.config/wa-api/mail.env`.
 *
 * Ini jalur penyisipan awal: admin mengisi kredensial lewat
 * `scripts/set-smtp-config.mjs`, yang memverifikasi ke server SMTP sebelum
 * menyimpan. Berkas itu dipakai HANYA kalau tabel `settings` belum punya nilai,
 * sehingga setelah admin menyimpan dari panel, panel yang menang.
 *
 * Berguna juga sebagai pemulihan: kalau konfigurasi di database rusak sampai
 * email tidak bisa dikirim, berkas ini masih bisa jadi sumber cadangan.
 */
function bacaBerkasBootstrap(): Partial<KonfigurasiMail> {
  const berkas = join(homedir(), '.config', 'wa-api', 'mail.env');
  if (!existsSync(berkas)) return {};
  try {
    const isi = readFileSync(berkas, 'utf8');
    const map: Record<string, string> = {};
    for (const baris of isi.split('\n')) {
      const m = /^([A-Z_]+)=(.*)$/.exec(baris.trim());
      if (m) map[m[1]] = m[2];
    }
    const hasil: Partial<KonfigurasiMail> = {};
    if (map.MAIL_HOST) hasil.host = map.MAIL_HOST;
    if (map.MAIL_PORT) hasil.port = Number(map.MAIL_PORT);
    if (map.MAIL_SECURE) hasil.secure = map.MAIL_SECURE === 'true';
    if (map.MAIL_USER) hasil.user = map.MAIL_USER;
    if (map.MAIL_PASS) hasil.pass = map.MAIL_PASS;
    if (map.MAIL_FROM_ADDRESS) hasil.fromAddress = map.MAIL_FROM_ADDRESS;
    if (map.MAIL_FROM_NAME) hasil.fromName = map.MAIL_FROM_NAME;
    return hasil;
  } catch {
    return {};
  }
}

/**
 * Ambil konfigurasi efektif: tabel `settings` lebih diutamakan, berkas
 * bootstrap hanya mengisi yang kosong, lalu nilai bawaan menutup sisanya.
 */
export function ambilKonfigurasiMail(): KonfigurasiMail {
  const bootstrap = bacaBerkasBootstrap();
  const baca = (kunci: string) => getSetting(kunci);

  const host = baca(KUNCI_MAIL.host) || bootstrap.host || DEFAULT_MAIL.host;
  const portMentah = baca(KUNCI_MAIL.port) || (bootstrap.port != null ? String(bootstrap.port) : '');
  const port = Number(portMentah) || DEFAULT_MAIL.port;

  const secureMentah = baca(KUNCI_MAIL.secure);
  const secure =
    secureMentah != null
      ? secureMentah === 'true'
      : bootstrap.secure != null
        ? bootstrap.secure
        : port === 465;

  const enabledMentah = baca(KUNCI_MAIL.enabled);

  return {
    // Bawaan aktif supaya konfigurasi yang sudah diisi lewat skrip langsung
    // berfungsi tanpa perlu menyalakan saklar dulu.
    enabled: enabledMentah != null ? enabledMentah === 'true' : true,
    provider: baca(KUNCI_MAIL.provider) || 'brevo',
    host,
    port,
    secure,
    user: baca(KUNCI_MAIL.user) || bootstrap.user || '',
    pass: baca(KUNCI_MAIL.pass) || bootstrap.pass || '',
    fromAddress: baca(KUNCI_MAIL.fromAddress) || bootstrap.fromAddress || DEFAULT_MAIL.fromAddress,
    fromName: baca(KUNCI_MAIL.fromName) || bootstrap.fromName || DEFAULT_MAIL.fromName,
    replyTo: baca(KUNCI_MAIL.replyTo) || '',
    resetTtlMenit: Number(baca(KUNCI_MAIL.resetTtlMenit)) || DEFAULT_MAIL.resetTtlMenit,
  };
}

/**
 * Apakah konfigurasi sudah cukup untuk mencoba mengirim?
 *
 * Login dan kunci TIDAK diwajibkan. Server SMTP lokal seperti Mailpit menerima
 * pengiriman tanpa autentikasi, dan memaksakan syarat itu akan membuat preset
 * Mailpit tidak pernah bisa dipakai. Kalau salah satu dari login/kunci diisi,
 * keduanya harus lengkap — kombinasi setengah jadi hampir pasti salah ketik.
 */
export function konfigurasiLengkap(cfg: KonfigurasiMail = ambilKonfigurasiMail()): boolean {
  const dasarLengkap = Boolean(cfg.host && cfg.port && cfg.fromAddress);
  const authKosong = !cfg.user && !cfg.pass;
  const authLengkap = Boolean(cfg.user && cfg.pass);
  return dasarLengkap && (authKosong || authLengkap);
}

/**
 * Konfigurasi untuk ditampilkan di panel.
 *
 * Password TIDAK pernah dikirim utuh — hanya penanda bahwa password sudah
 * tersimpan. Panel memakai penanda ini untuk menampilkan kolom password dalam
 * keadaan terisi, dan mengirim balik nilai bertopeng saat admin menyimpan tanpa
 * mengubah password.
 */
export function konfigurasiUntukKlien(): {
  enabled: boolean;
  provider: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  hasPass: boolean;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  resetTtlMenit: number;
  lengkap: boolean;
} {
  const cfg = ambilKonfigurasiMail();
  return {
    enabled: cfg.enabled,
    provider: cfg.provider,
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.user,
    pass: cfg.pass ? '••••••••' : '',
    hasPass: Boolean(cfg.pass),
    fromAddress: cfg.fromAddress,
    fromName: cfg.fromName,
    replyTo: cfg.replyTo,
    resetTtlMenit: cfg.resetTtlMenit,
    lengkap: konfigurasiLengkap(cfg),
  };
}

export interface HasilSimpan {
  ok: boolean;
  pesan: string;
}

/**
 * Simpan konfigurasi ke tabel `settings`.
 *
 * Divalidasi dulu sebelum ditulis: konfigurasi SMTP yang salah akan membuat
 * pengiriman gagal diam-diam, dan gejalanya baru terlihat saat pengguna
 * melaporkan tidak menerima email reset. Lebih baik ditolak saat disimpan.
 */
export function simpanKonfigurasiMail(perubahan: Partial<KonfigurasiMail>): HasilSimpan {
  // Validasi hanya untuk nilai yang benar-benar dikirim. Field yang tidak
  // disertakan berarti "jangan ubah", jadi tidak perlu diperiksa.
  if (perubahan.host !== undefined && perubahan.host.trim() === '') {
    return { ok: false, pesan: 'Host SMTP tidak boleh kosong.' };
  }
  if (perubahan.port !== undefined) {
    const p = Number(perubahan.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return { ok: false, pesan: 'Port SMTP harus berupa angka antara 1 dan 65535.' };
    }
  }
  if (perubahan.fromAddress !== undefined) {
    const alamat = perubahan.fromAddress.trim();
    if (alamat === '' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alamat)) {
      return { ok: false, pesan: 'Alamat pengirim tidak valid.' };
    }
  }
  if (perubahan.replyTo !== undefined && perubahan.replyTo.trim() !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(perubahan.replyTo.trim())) {
      return { ok: false, pesan: 'Alamat balasan (reply-to) tidak valid.' };
    }
  }
  if (perubahan.resetTtlMenit !== undefined) {
    const ttl = Number(perubahan.resetTtlMenit);
    if (!Number.isInteger(ttl) || ttl < 5 || ttl > 1440) {
      return { ok: false, pesan: 'Masa berlaku tautan reset harus antara 5 dan 1440 menit.' };
    }
  }
  if (perubahan.provider !== undefined) {
    const dikenal = PRESET_PROVIDER.some((p) => p.id === perubahan.provider);
    if (!dikenal) {
      return { ok: false, pesan: `Provider "${perubahan.provider}" tidak dikenal.` };
    }
  }

  const pasangan: Array<[string, string]> = [];
  if (perubahan.enabled !== undefined) pasangan.push([KUNCI_MAIL.enabled, perubahan.enabled ? 'true' : 'false']);
  if (perubahan.provider !== undefined) pasangan.push([KUNCI_MAIL.provider, perubahan.provider]);
  if (perubahan.host !== undefined) pasangan.push([KUNCI_MAIL.host, perubahan.host.trim()]);
  if (perubahan.port !== undefined) pasangan.push([KUNCI_MAIL.port, String(perubahan.port)]);
  if (perubahan.secure !== undefined) pasangan.push([KUNCI_MAIL.secure, perubahan.secure ? 'true' : 'false']);
  if (perubahan.user !== undefined) pasangan.push([KUNCI_MAIL.user, perubahan.user.trim()]);
  // Nilai bertopeng berarti admin tidak mengubah password — jangan ditimpa.
  if (perubahan.pass !== undefined && perubahan.pass !== '••••••••' && perubahan.pass.trim() !== '') {
    pasangan.push([KUNCI_MAIL.pass, perubahan.pass]);
  }
  if (perubahan.fromAddress !== undefined) pasangan.push([KUNCI_MAIL.fromAddress, perubahan.fromAddress.trim()]);
  if (perubahan.fromName !== undefined) pasangan.push([KUNCI_MAIL.fromName, perubahan.fromName.trim()]);
  if (perubahan.replyTo !== undefined) pasangan.push([KUNCI_MAIL.replyTo, perubahan.replyTo.trim()]);
  if (perubahan.resetTtlMenit !== undefined) {
    pasangan.push([KUNCI_MAIL.resetTtlMenit, String(perubahan.resetTtlMenit)]);
  }
  for (const [k, v] of pasangan) setSetting(k, v);
  transporterCache = null; // paksa koneksi dibangun ulang dengan konfigurasi baru

  return { ok: true, pesan: 'Konfigurasi email berhasil disimpan.' };
}

/**
 * Cache transporter.
 *
 * Membangun ulang koneksi untuk setiap email itu boros dan memperlambat
 * pengiriman. Cache ini dihapus setiap kali konfigurasi disimpan, jadi tidak
 * ada kemungkinan memakai kredensial lama setelah diubah.
 */
let transporterCache: { kunci: string; transporter: Transporter } | null = null;

/** Sidik jari konfigurasi — kalau berubah, koneksi dibangun ulang. */
function sidikKonfigurasi(cfg: KonfigurasiMail): string {
  return [cfg.host, cfg.port, cfg.secure, cfg.user, cfg.pass].join('|');
}

function ambilTransporter(cfg: KonfigurasiMail): Transporter {
  const kunci = sidikKonfigurasi(cfg);
  if (transporterCache && transporterCache.kunci === kunci) return transporterCache.transporter;

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    // `auth` hanya dipasang kalau login benar-benar ada. Server tanpa
    // autentikasi (Mailpit) akan menolak kalau dikirimi kredensial kosong.
    ...(cfg.user && cfg.pass ? { auth: { user: cfg.user, pass: cfg.pass } } : {}),
    // Batas waktu eksplisit: tanpa ini, permintaan reset bisa menggantung lama
    // saat server SMTP tidak merespons, dan permintaan pengguna ikut tertahan.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });

  transporterCache = { kunci, transporter };
  return transporter;
}

/** Buang cache koneksi. Dipakai saat konfigurasi berubah atau setelah error. */
export function resetKoneksiMail(): void {
  try {
    transporterCache?.transporter.close();
  } catch {
    // Menutup koneksi yang sudah mati bisa melempar — tidak perlu ditangani.
  }
  transporterCache = null;
}

export interface HasilKirim {
  ok: boolean;
  messageId?: string;
  /** Pesan siap tampil untuk admin/pengguna, sudah dalam Bahasa Indonesia. */
  pesan: string;
}

/**
 * Terjemahkan error SMTP menjadi pesan yang bisa ditindaklanjuti.
 *
 * Pesan mentah seperti "535 5.7.8 Authentication failed" tidak memberi tahu
 * admin apa yang harus diperbaiki. Padanan di bawah ini menyebut penyebab dan
 * langkah perbaikannya.
 */
function terjemahkanError(err: any): string {
  const kode = String(err?.code || '');
  const respons = String(err?.response || err?.message || '');
  const gabungan = `${kode} ${respons}`;

  if (kode === 'EAUTH' || /535|534|530/.test(gabungan)) {
    return (
      'Kredensial SMTP ditolak. Periksa kembali login dan kunci SMTP. ' +
      'Catatan: kunci SMTP berbeda dari password akun — ambil di dashboard Brevo pada SMTP & API, tab SMTP.'
    );
  }
  if (kode === 'EENVELOPE' || /550|553|551|554/.test(gabungan)) {
    return (
      'Alamat pengirim atau penerima ditolak server SMTP. ' +
      'Pastikan domain pengirim sudah diverifikasi di penyedia email, dan alamat penerima valid.'
    );
  }
  if (/ECONNECTION|ETIMEDOUT|ESOCKET|ECONNREFUSED|ENOTFOUND/.test(gabungan)) {
    return (
      `Tidak bisa menghubungi server SMTP di ${kode || 'alamat yang dikonfigurasi'}. ` +
      'Periksa host, port, dan koneksi jaringan dari server ini.'
    );
  }
  if (/421|450|451|452|454/.test(gabungan)) {
    return 'Server SMTP menolak sementara (kemungkinan batas pengiriman atau gangguan di sisi penyedia). Coba lagi beberapa saat lagi.';
  }
  if (/quota|limit|rate/i.test(gabungan)) {
    return 'Kuota pengiriman email habis atau permintaan terlalu sering. Tunggu sampai kuota pulih.';
  }
  return `Pengiriman email gagal: ${respons || 'penyebab tidak dikenali'}`;
}

export interface OpsiKirimEmail {
  tujuan: string;
  subjek: string;
  html: string;
  teks: string;
  /** Balasan diarahkan ke alamat ini, kalau ada. */
  replyTo?: string;
}

/**
 * Kirim satu email.
 *
 * Selalu menyertakan versi teks polos bersama HTML. Sebagian filter spam
 * menolak email HTML tanpa alternatif teks, dan sebagian pengguna memakai
 * klien teks.
 */
export async function kirimEmail(opsi: OpsiKirimEmail): Promise<HasilKirim> {
  const cfg = ambilKonfigurasiMail();

  if (!cfg.enabled) {
    return { ok: false, pesan: 'Pengiriman email sedang dinonaktifkan di pengaturan.' };
  }
  if (!konfigurasiLengkap(cfg)) {
    return {
      ok: false,
      pesan: 'Konfigurasi SMTP belum lengkap. Isi host, login, kunci, dan alamat pengirim di pengaturan email.',
    };
  }

  try {
    const transporter = ambilTransporter(cfg);
    const info = await transporter.sendMail({
      from: { name: cfg.fromName, address: cfg.fromAddress },
      to: opsi.tujuan,
      subject: opsi.subjek,
      text: opsi.teks,
      html: opsi.html,
      replyTo: opsi.replyTo || cfg.replyTo || undefined,
    });
    return { ok: true, messageId: info.messageId, pesan: 'Email terkirim.' };
  } catch (err: any) {
    // Koneksi yang gagal bisa tertinggal dalam keadaan buruk — buang supaya
    // percobaan berikutnya membangun koneksi baru, bukan memakai yang rusak.
    resetKoneksiMail();
    return { ok: false, pesan: terjemahkanError(err) };
  }
}

/**
 * Uji koneksi tanpa mengirim email (memanggil EHLO + AUTH).
 * Dipakai tombol "Uji koneksi" di panel.
 */
export async function ujiKoneksiMail(): Promise<HasilKirim> {
  const cfg = ambilKonfigurasiMail();
  if (!konfigurasiLengkap(cfg)) {
    return { ok: false, pesan: 'Konfigurasi SMTP belum lengkap.' };
  }
  try {
    const transporter = ambilTransporter(cfg);
    await transporter.verify();
    return { ok: true, pesan: `Koneksi ke ${cfg.host}:${cfg.port} berhasil dan kredensial diterima.` };
  } catch (err: any) {
    resetKoneksiMail();
    return { ok: false, pesan: terjemahkanError(err) };
  }
}
