/**
 * Email selamat datang untuk akun yang baru mendaftar: versi HTML dan
 * versi teks biasa.
 */
import { WARNA, FONT, escapeHtml, BRAND } from './dasar.js';
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
