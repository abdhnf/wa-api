/**
 * Email uji koneksi SMTP — dikirim dari halaman Pengaturan untuk memastikan
 * konfigurasi email bekerja.
 */
import { WARNA, FONT, escapeHtml, BRAND } from './dasar.js';
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
