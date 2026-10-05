/**
 * Email reset password: versi HTML dan versi teks biasa.
 */
import { WARNA, FONT, escapeHtml, BRAND } from './dasar.js';
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
