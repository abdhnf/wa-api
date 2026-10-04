/**
 * Template email untuk wa-api.
 *
 * Palet dan bentuknya mengikuti panel wa-api (src/index.css): latar krem hangat,
 * kartu putih bergaris tipis, aksen hijau "pine", sudut membulat 6px (rounded-md
 * Tailwind), dan kotak logo "WA" hijau seperti di halaman Auth.
 *
 * KENAPA HTML-nya BERTABEL, BUKAN flexbox/grid:
 * Klien email tidak seragam. Outlook memakai mesin render Word, Gmail membuang
 * sebagian <style> di kepala dokumen, dan banyak klien lain tidak mendukung
 * flexbox sama sekali. Tabel + style inline adalah satu-satunya susunan yang
 * tampil konsisten di semuanya. Ini bukan kode yang boleh "dirapikan" jadi
 * div+flex — hasilnya akan berantakan justru di klien yang paling banyak dipakai.
 *
 * Warna ditulis sebagai literal hex, bukan var(--color-*), karena variabel CSS
 * tidak didukung di sebagian besar klien email.
 */

/** Palet panel wa-api — disalin dari panel/src/index.css. */
const WARNA = {
  shell: '#fbf8ef',
  surface: '#ffffff',
  surfaceAlt: '#f4efdf',
  surfaceSunken: '#f8f5ea',
  line: '#e4dcc4',
  lineStrong: '#cfc4a3',
  ink: '#23301f',
  inkSoft: '#3d4a35',
  inkMuted: '#5c6752',
  inkFaint: '#5f6a56',
  pine: '#1f7a4d',
  pineStrong: '#17603d',
  pineWash: '#e3f2e8',
  pineLine: '#a9d7bd',
  clayWash: '#fbeaea',
  clayLine: '#e9b8b3',
  clayDeep: '#8f2c22',
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/**
 * Escape nilai yang berasal dari pengguna sebelum disisipkan ke HTML.
 *
 * Tanpa ini, nama yang berisi `<script>` atau tanda kutip bisa merusak struktur
 * email — dan pada klien yang menampilkan HTML, itu menjadi celah injeksi.
 */
export function escapeHtml(nilai: string): string {
  return String(nilai ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Nama brand yang tampil di email. Bisa ditimpa lewat parameter. */
export const BRAND = {
  nama: 'WA Gateway',
  tagline: 'Sistem API WhatsApp Multi-Device dengan Anti-Ban Engine',
};

export interface DataEmailReset {
  /** Nama penerima, untuk sapaan. Kosongkan untuk sapaan generik. */
  namaPenerima?: string;
  /** Tautan lengkap yang berisi token reset. */
  tautan: string;
  /** Masa berlaku dalam menit, untuk ditampilkan ke pengguna. */
  ttlMenit: number;
  /** Alamat IP peminta, opsional — membantu pengguna menyadari kalau bukan dia. */
  alamatIp?: string;
  /** Nama brand, opsional. */
  brand?: string;
}

/**
 * Bangun tautan reset dari basis URL + token.
 *
 * Token di-encode karena bisa berisi karakter yang tidak aman di URL.
 */
export function bangunTautanReset(basisUrl: string, token: string): string {
  const basis = String(basisUrl || '').replace(/\/+$/, '');
  return `${basis}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Email reset password — versi HTML.
 *
 * Susunan mengikuti halaman Auth panel: logo kotak, judul tebal, subjudul abu,
 * kartu bergaris, tombol utama hijau. Ditambah kotak peringatan dan tautan
 * cadangan (banyak klien memblokir tombol, jadi tautan mentah wajib ada).
 */
export function templateResetPassword(data: DataEmailReset): string {
  const brand = escapeHtml(data.brand || BRAND.nama);
  const sapaan = data.namaPenerima
    ? `Halo ${escapeHtml(data.namaPenerima)},`
    : 'Halo,';
  const tautan = escapeHtml(data.tautan);
  const ttl = Math.max(1, Math.floor(data.ttlMenit));
  const ip = data.alamatIp ? escapeHtml(data.alamatIp) : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Atur Ulang Password</title>
</head>
<body style="margin:0;padding:0;background-color:${WARNA.shell};">
<!-- Preheader: teks pratinjau di kotak masuk, tidak tampil di badan email. -->
<div style="display:none;font-size:1px;color:${WARNA.shell};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
Permintaan atur ulang password untuk akun ${brand}. Tautan berlaku ${ttl} menit.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${WARNA.shell};">
<tr>
<td align="center" style="padding:32px 16px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

    <!-- Logo + nama brand, meniru kepala halaman Auth -->
    <tr>
      <td align="center" style="padding-bottom:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="48" height="48" align="center" valign="middle"
                style="width:48px;height:48px;background-color:${WARNA.pine};border-radius:6px;color:#ffffff;font-family:${FONT};font-size:18px;font-weight:bold;letter-spacing:0.5px;">
              WA
            </td>
            <td style="padding-left:12px;font-family:${FONT};font-size:15px;font-weight:bold;color:${WARNA.ink};">
              ${brand}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Kartu utama -->
    <tr>
      <td style="background-color:${WARNA.surface};border:1px solid ${WARNA.line};border-radius:6px;padding:32px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td style="font-family:${FONT};font-size:21px;font-weight:bold;color:${WARNA.ink};letter-spacing:-0.3px;padding-bottom:6px;">
              Atur Ulang Password
            </td>
          </tr>

          <tr>
            <td style="font-family:${FONT};font-size:12px;color:${WARNA.inkMuted};padding-bottom:24px;">
              ${escapeHtml(BRAND.tagline)}
            </td>
          </tr>

          <tr>
            <td style="font-family:${FONT};font-size:14px;line-height:1.65;color:${WARNA.inkSoft};padding-bottom:14px;">
              ${sapaan}
            </td>
          </tr>

          <tr>
            <td style="font-family:${FONT};font-size:14px;line-height:1.65;color:${WARNA.inkSoft};padding-bottom:24px;">
              Kami menerima permintaan untuk mengatur ulang password akun ${brand} Anda.
              Klik tombol di bawah untuk membuat password baru.
            </td>
          </tr>

          <!-- Tombol utama -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${WARNA.pine}"
                      style="border-radius:6px;">
                    <a href="${tautan}"
                       style="display:inline-block;padding:13px 30px;font-family:${FONT};font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">
                      Buat Password Baru
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Tautan cadangan: sebagian klien memblokir atau merusak tombol. -->
          <tr>
            <td style="font-family:${FONT};font-size:12px;line-height:1.6;color:${WARNA.inkMuted};padding-bottom:8px;">
              Tombol tidak berfungsi? Salin tautan berikut ke peramban Anda:
            </td>
          </tr>
          <tr>
            <td style="background-color:${WARNA.surfaceSunken};border:1px solid ${WARNA.line};border-radius:6px;padding:12px;font-family:Consolas,Monaco,'Courier New',monospace;font-size:11px;line-height:1.5;color:${WARNA.inkSoft};word-break:break-all;">
              ${tautan}
            </td>
          </tr>

          <tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>

          <!-- Kotak info masa berlaku -->
          <tr>
            <td style="background-color:${WARNA.pineWash};border:1px solid ${WARNA.pineLine};border-radius:6px;padding:14px;font-family:${FONT};font-size:12px;line-height:1.6;color:${WARNA.pineStrong};">
              <strong>Tautan ini berlaku ${ttl} menit</strong> dan hanya bisa dipakai satu kali.
              Setelah kedaluwarsa, ajukan permintaan baru.
            </td>
          </tr>

          <tr><td style="height:12px;line-height:12px;font-size:0;">&nbsp;</td></tr>

          <!-- Kotak peringatan keamanan -->
          <tr>
            <td style="background-color:${WARNA.clayWash};border:1px solid ${WARNA.clayLine};border-radius:6px;padding:14px;font-family:${FONT};font-size:12px;line-height:1.6;color:${WARNA.clayDeep};">
              <strong>Bukan Anda yang meminta?</strong> Abaikan email ini — password Anda tidak
              akan berubah.${ip ? ` Permintaan ini tercatat dari alamat IP ${ip}.` : ''}
              Jika Anda merasa akun Anda tidak aman, segera hubungi administrator.
            </td>
          </tr>

        </table>

      </td>
    </tr>

    <!-- Kaki email -->
    <tr>
      <td style="padding-top:20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" style="font-family:${FONT};font-size:11px;line-height:1.7;color:${WARNA.inkFaint};">
              Email ini dikirim otomatis oleh sistem. Jangan membalas pesan ini.<br>
              ${brand} &middot; ${escapeHtml(BRAND.tagline)}
            </td>
          </tr>
        </table>
      </td>
    </tr>

  </table>

</td>
</tr>
</table>
</body>
</html>`;
}

/**
 * Email reset password — versi teks polos.
 *
 * Wajib ada, bukan pelengkap. Sebagian klien dan filter spam menolak email HTML
 * yang tidak menyertakan alternatif teks, dan sebagian pengguna memakai klien
 * teks. Tautannya ditulis utuh supaya tetap bisa disalin.
 */
export function templateResetPasswordTeks(data: DataEmailReset): string {
  const brand = data.brand || BRAND.nama;
  const sapaan = data.namaPenerima ? `Halo ${data.namaPenerima},` : 'Halo,';
  const ttl = Math.max(1, Math.floor(data.ttlMenit));

  return [
    `${brand} — Atur Ulang Password`,
    '',
    sapaan,
    '',
    `Kami menerima permintaan untuk mengatur ulang password akun ${brand} Anda.`,
    'Buka tautan berikut untuk membuat password baru:',
    '',
    data.tautan,
    '',
    `Tautan ini berlaku ${ttl} menit dan hanya bisa dipakai satu kali.`,
    'Setelah kedaluwarsa, ajukan permintaan baru.',
    '',
    data.alamatIp
      ? `Permintaan ini tercatat dari alamat IP ${data.alamatIp}.`
      : '',
    'Bukan Anda yang meminta? Abaikan email ini — password Anda tidak akan berubah.',
    'Jika Anda merasa akun Anda tidak aman, segera hubungi administrator.',
    '',
    '---',
    'Email ini dikirim otomatis oleh sistem. Jangan membalas pesan ini.',
    brand,
  ]
    .filter((baris) => baris !== '')
    .join('\r\n');
}

/**
 * Data email registrasi berhasil.
 *
 * Dipakai untuk dua jalur pendaftaran. Bedanya cuma satu: pendaftar lewat Google
 * belum punya nomor WhatsApp, jadi emailnya sekaligus mengarahkan ke halaman
 * onboarding. Pendaftar manual sudah mengisi nomornya di formulir.
 */
export interface DataEmailRegistrasi {
  namaPenerima?: string;
  email: string;
  metode: 'manual' | 'google';
  kuotaPerHari: number;
  kuotaPerMinggu: number;
  /** Tautan ke panel. Untuk pendaftar Google diarahkan ke onboarding. */
  tautanPanel: string;
  /** True kalau nomor WA belum ada dan perlu dilengkapi. */
  butuhNomorWa: boolean;
  brand?: string;
}

/** Angka dengan pemisah ribuan gaya Indonesia: 700000 -> "700.000". */
function ribuan(n: number): string {
  return Math.max(0, Math.floor(n)).toLocaleString('id-ID');
}

/** Email selamat datang setelah akun berhasil dibuat. */
export function templateRegistrasiBerhasil(data: DataEmailRegistrasi): string {
  const brand = escapeHtml(data.brand || BRAND.nama);
  const sapaan = data.namaPenerima ? `Halo ${escapeHtml(data.namaPenerima)},` : 'Halo,';
  const email = escapeHtml(data.email);
  const tautan = escapeHtml(data.tautanPanel);

  const lewatGoogle = data.metode === 'google';
  const labelMetode = lewatGoogle ? 'Google' : 'Formulir pendaftaran';

  // Judul dan ajakan menyesuaikan: pendaftar Google masih perlu mengisi nomor.
  const judulAksi = data.butuhNomorWa ? 'Lengkapi Nomor WhatsApp' : 'Buka Dashboard';
  const kalimatAksi = data.butuhNomorWa
    ? 'Satu langkah lagi. Isi nomor WhatsApp Anda supaya akun siap dipakai mengirim pesan.'
    : 'Akun Anda sudah siap. Masuk ke dashboard untuk mulai menghubungkan perangkat WhatsApp.';

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Akun Berhasil Dibuat</title>
</head>
<body style="margin:0;padding:0;background-color:${WARNA.shell};">
<div style="display:none;font-size:1px;color:${WARNA.shell};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
Akun ${brand} Anda berhasil dibuat. Kuota ${ribuan(data.kuotaPerMinggu)} pesan per minggu.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${WARNA.shell};">
<tr>
<td align="center" style="padding:32px 16px;">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

    <tr>
      <td align="center" style="padding-bottom:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="48" height="48" align="center" valign="middle"
                style="width:48px;height:48px;background-color:${WARNA.pine};border-radius:6px;color:#ffffff;font-family:${FONT};font-size:18px;font-weight:bold;letter-spacing:0.5px;">
              WA
            </td>
            <td style="padding-left:12px;font-family:${FONT};font-size:15px;font-weight:bold;color:${WARNA.ink};">
              ${brand}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="background-color:${WARNA.surface};border:1px solid ${WARNA.line};border-radius:6px;padding:32px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

          <tr>
            <td style="font-family:${FONT};font-size:21px;font-weight:bold;color:${WARNA.ink};letter-spacing:-0.3px;padding-bottom:6px;">
              Akun Anda Berhasil Dibuat
            </td>
          </tr>

          <tr>
            <td style="font-family:${FONT};font-size:12px;color:${WARNA.inkMuted};padding-bottom:24px;">
              ${escapeHtml(BRAND.tagline)}
            </td>
          </tr>

          <tr>
            <td style="font-family:${FONT};font-size:14px;line-height:1.65;color:${WARNA.inkSoft};padding-bottom:14px;">
              ${sapaan}
            </td>
          </tr>

          <tr>
            <td style="font-family:${FONT};font-size:14px;line-height:1.65;color:${WARNA.inkSoft};padding-bottom:24px;">
              Pendaftaran akun ${brand} Anda berhasil dan sudah aktif. Tidak ada biaya
              pendaftaran, dan tidak ada langkah verifikasi tambahan yang perlu Anda lakukan.
            </td>
          </tr>

          <tr>
            <td style="background-color:${WARNA.pineWash};border:1px solid ${WARNA.pineLine};border-radius:6px;padding:14px;font-family:${FONT};font-size:12px;line-height:1.7;color:${WARNA.pineStrong};padding-bottom:14px;">
              <strong>Cara daftar:</strong> ${labelMetode}<br>
              <strong>Email akun:</strong> ${email}
            </td>
          </tr>

          <tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>

          <tr>
            <td style="font-family:${FONT};font-size:12px;font-weight:bold;color:${WARNA.inkMuted};padding-bottom:10px;text-transform:uppercase;letter-spacing:0.6px;">
              Kuota Pesan Anda
            </td>
          </tr>

          <tr>
            <td style="padding-bottom:24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="50%" valign="top" style="padding-right:6px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:${WARNA.surfaceSunken};border:1px solid ${WARNA.line};border-radius:6px;padding:14px;text-align:center;">
                          <div style="font-family:${FONT};font-size:11px;color:${WARNA.inkMuted};padding-bottom:6px;">Per Hari</div>
                          <div style="font-family:${FONT};font-size:22px;font-weight:bold;color:${WARNA.pine};">${ribuan(data.kuotaPerHari)}</div>
                          <div style="font-family:${FONT};font-size:11px;color:${WARNA.inkFaint};padding-top:4px;">pesan</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="50%" valign="top" style="padding-left:6px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:${WARNA.surfaceSunken};border:1px solid ${WARNA.line};border-radius:6px;padding:14px;text-align:center;">
                          <div style="font-family:${FONT};font-size:11px;color:${WARNA.inkMuted};padding-bottom:6px;">Per Minggu</div>
                          <div style="font-family:${FONT};font-size:22px;font-weight:bold;color:${WARNA.pine};">${ribuan(data.kuotaPerMinggu)}</div>
                          <div style="font-family:${FONT};font-size:11px;color:${WARNA.inkFaint};padding-top:4px;">pesan</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="font-family:${FONT};font-size:14px;line-height:1.65;color:${WARNA.inkSoft};padding-bottom:24px;">
              ${kalimatAksi}
            </td>
          </tr>

          <tr>
            <td align="center" style="padding-bottom:18px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${WARNA.pine}" style="border-radius:6px;">
                    <a href="${tautan}" target="_blank"
                       style="display:inline-block;padding:12px 28px;font-family:${FONT};font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:6px;">
                      ${judulAksi}
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="font-family:${FONT};font-size:11px;line-height:1.7;color:${WARNA.inkFaint};padding-bottom:8px;">
              Kalau tombol di atas tidak bisa diklik, salin dan tempel alamat berikut di peramban Anda:
            </td>
          </tr>

          <tr>
            <td style="font-family:${FONT};font-size:11px;line-height:1.7;color:${WARNA.pineStrong};word-break:break-all;padding-bottom:20px;">
              ${tautan}
            </td>
          </tr>

          <tr>
            <td style="border-top:1px solid ${WARNA.line};padding-top:16px;font-family:${FONT};font-size:11px;line-height:1.7;color:${WARNA.inkFaint};">
              Kalau Anda tidak merasa mendaftar akun di ${brand}, abaikan email ini. Tidak ada
              tindakan yang perlu dilakukan, dan tidak ada akun yang bisa dipakai tanpa Anda
              mengatur passwordnya sendiri.
            </td>
          </tr>

        </table>
      </td>
    </tr>

    <tr>
      <td align="center" style="padding-top:20px;font-family:${FONT};font-size:11px;line-height:1.7;color:${WARNA.inkFaint};">
        Email ini dikirim otomatis oleh sistem. Jangan membalas pesan ini.
      </td>
    </tr>

  </table>

</td>
</tr>
</table>
</body>
</html>`;
}

/** Versi teks polos dari email registrasi — cadangan untuk klien tanpa HTML. */
export function templateRegistrasiBerhasilTeks(data: DataEmailRegistrasi): string {
  const brand = data.brand || BRAND.nama;
  const sapaan = data.namaPenerima ? `Halo ${data.namaPenerima},` : 'Halo,';
  const labelMetode = data.metode === 'google' ? 'Google' : 'Formulir pendaftaran';
  const judulAksi = data.butuhNomorWa ? 'Lengkapi Nomor WhatsApp' : 'Buka Dashboard';

  const baris = [
    `Akun ${brand} Anda Berhasil Dibuat`,
    '',
    sapaan,
    '',
    `Pendaftaran akun ${brand} Anda berhasil dan sudah aktif. Tidak ada biaya`,
    'pendaftaran, dan tidak ada langkah verifikasi tambahan yang perlu Anda lakukan.',
    '',
    `Cara daftar     : ${labelMetode}`,
    `Email akun      : ${data.email}`,
    '',
    'KUOTA PESAN ANDA',
    `  Per hari   : ${ribuan(data.kuotaPerHari)} pesan`,
    `  Per minggu : ${ribuan(data.kuotaPerMinggu)} pesan`,
    '',
    data.butuhNomorWa
      ? 'Satu langkah lagi. Isi nomor WhatsApp Anda supaya akun siap dipakai mengirim pesan.'
      : 'Akun Anda sudah siap. Masuk ke dashboard untuk mulai menghubungkan perangkat WhatsApp.',
    '',
    `${judulAksi}:`,
    data.tautanPanel,
    '',
    `Kalau Anda tidak merasa mendaftar akun di ${brand}, abaikan email ini.`,
    '',
    'Email ini dikirim otomatis oleh sistem. Jangan membalas pesan ini.',
  ];
  return baris.join('\n');
}

export interface DataEmailUji {
  tujuan: string;
  brand?: string;
  waktuKirim?: Date;
}

/** Email uji konfigurasi SMTP — dipakai tombol "Kirim email uji" di panel. */
export function templateEmailUji(data: DataEmailUji): string {
  const brand = escapeHtml(data.brand || BRAND.nama);
  const waktu = (data.waktuKirim || new Date()).toISOString();
  const tujuan = escapeHtml(data.tujuan);

  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Uji SMTP</title></head>
<body style="margin:0;padding:0;background-color:${WARNA.shell};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${WARNA.shell};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr>
      <td align="center" style="padding-bottom:20px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="48" height="48" align="center" valign="middle"
              style="width:48px;height:48px;background-color:${WARNA.pine};border-radius:6px;color:#ffffff;font-family:${FONT};font-size:18px;font-weight:bold;">WA</td>
          <td style="padding-left:12px;font-family:${FONT};font-size:15px;font-weight:bold;color:${WARNA.ink};">${brand}</td>
        </tr></table>
      </td>
    </tr>
    <tr>
      <td style="background-color:${WARNA.surface};border:1px solid ${WARNA.line};border-radius:6px;padding:32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="font-family:${FONT};font-size:21px;font-weight:bold;color:${WARNA.ink};padding-bottom:6px;">Konfigurasi SMTP Berhasil</td></tr>
          <tr><td style="font-family:${FONT};font-size:12px;color:${WARNA.inkMuted};padding-bottom:24px;">Email uji dari panel ${brand}</td></tr>
          <tr><td style="font-family:${FONT};font-size:14px;line-height:1.65;color:${WARNA.inkSoft};padding-bottom:20px;">
            Email ini dikirim untuk memastikan konfigurasi SMTP berjalan. Kalau Anda menerimanya, artinya
            autentikasi server berhasil, alamat pengirim sudah terverifikasi, dan email lolos ke kotak masuk.
          </td></tr>
          <tr>
            <td style="background-color:${WARNA.pineWash};border:1px solid ${WARNA.pineLine};border-radius:6px;padding:14px;font-family:${FONT};font-size:12px;line-height:1.7;color:${WARNA.pineStrong};">
              <strong>Terkirim ke:</strong> ${tujuan}<br>
              <strong>Waktu:</strong> ${escapeHtml(waktu)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr><td align="center" style="padding-top:20px;font-family:${FONT};font-size:11px;line-height:1.7;color:${WARNA.inkFaint};">
      Email ini dikirim otomatis oleh sistem. Jangan membalas pesan ini.
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

/** Email uji — versi teks polos. */
export function templateEmailUjiTeks(data: DataEmailUji): string {
  const brand = data.brand || BRAND.nama;
  const waktu = (data.waktuKirim || new Date()).toISOString();
  return [
    `${brand} — Konfigurasi SMTP Berhasil`,
    '',
    'Email ini dikirim untuk memastikan konfigurasi SMTP berjalan.',
    'Kalau Anda menerimanya, artinya autentikasi server berhasil,',
    'alamat pengirim sudah terverifikasi, dan email lolos ke kotak masuk.',
    '',
    `Terkirim ke: ${data.tujuan}`,
    `Waktu: ${waktu}`,
    '',
    '---',
    'Email ini dikirim otomatis oleh sistem. Jangan membalas pesan ini.',
    brand,
  ].join('\r\n');
}
