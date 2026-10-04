/**
 * Normalisasi dan validasi nomor telepon.
 *
 * Bentuk kanonik yang dipakai di seluruh sistem: digit saja dengan awalan 628,
 * tanpa tanda plus, spasi, atau tanda hubung. Contoh: 628123456789.
 *
 * Alasannya mengikuti skema `phoneDigits` yang sudah ada di server.ts untuk
 * penerima pesan. Kalau nomor user disimpan dalam format berbeda dari format
 * pengiriman, setiap perbandingan nomor di kemudian hari akan salah — dan
 * kesalahan seperti itu sulit terlihat karena datanya "kelihatan benar".
 */

/** Bentuk kanonik: 628 diikuti 7–13 digit. Panjang total 10–15 digit. */
const POLA_KANONIK = /^628\d{7,13}$/;

/**
 * Ubah input pengguna menjadi bentuk kanonik.
 *
 * Menerima bentuk yang lazim ditulis orang:
 *   +62 812-3456-7890  -> 6281234567890
 *   0812 3456 7890     -> 6281234567890
 *   62812 3456 7890    -> 6281234567890
 *   81234567890        -> 6281234567890
 *
 * Mengembalikan null kalau hasilnya tidak masuk akal, supaya pemanggil bisa
 * menolaknya alih-alih menyimpan nomor yang salah diam-diam.
 */
export function normalisasiNomor(masukan: string | null | undefined): string | null {
  if (masukan == null) return null;

  // Buang semua karakter selain digit: spasi, plus, tanda hubung, tanda kurung.
  let digit = String(masukan).replace(/\D/g, '');
  if (!digit) return null;

  // 62 812... -> sudah kanonik, biarkan
  // 0 812...  -> buang nol depan, tambahkan 62
  // 812...    -> tambahkan 62
  if (digit.startsWith('62')) {
    // sudah benar
  } else if (digit.startsWith('0')) {
    digit = `62${digit.slice(1)}`;
  } else {
    digit = `62${digit}`;
  }

  return POLA_KANONIK.test(digit) ? digit : null;
}

/** Apakah input ini nomor yang valid setelah dinormalisasi? */
export function nomorValid(masukan: string | null | undefined): boolean {
  return normalisasiNomor(masukan) !== null;
}

/**
 * Tampilkan nomor dalam bentuk yang enak dibaca: +62 812-3456-7890.
 * Dipakai di panel dan email; penyimpanan tetap memakai bentuk kanonik.
 */
export function formatNomorTampil(kanonik: string | null | undefined): string {
  if (!kanonik) return '';
  const digit = String(kanonik).replace(/\D/g, '');
  if (!digit.startsWith('628') || digit.length < 8) return kanonik;

  const sisa = digit.slice(3);
  // Pecah jadi grup 3-4 digit supaya mudah dibaca.
  const grup: string[] = [];
  let i = 0;
  while (i < sisa.length) {
    grup.push(sisa.slice(i, i + 4));
    i += 4;
  }
  return `+62 8${grup.join('-')}`;
}
