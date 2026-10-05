/**
 * Bagian bersama seluruh template email.
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
export const WARNA = {
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

export const FONT =
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
