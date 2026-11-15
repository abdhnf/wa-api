/**
 * Pencocokan teks untuk filter berbasis aturan.
 *
 * Dipakai dua fitur yang butuh arti "cocok" yang sama persis: aturan chatbot
 * (menentukan balasan) dan filter webhook (menentukan pesan mana yang
 * diteruskan). Kalau keduanya punya penafsiran sendiri-sendiri, operator yang
 * menulis `keyword: harga` di chatbot lalu menyalinnya ke filter webhook akan
 * mendapat hasil berbeda — dan perbedaan itu baru terlihat saat ada pesan nyata
 * yang tidak diteruskan, jauh setelah konfigurasinya disimpan.
 */

export type MatchType = 'exact' | 'contains' | 'regex' | 'keyword';

/** Urutan ini yang ditampilkan di panel; jangan diacak tanpa alasan. */
export const MATCH_TYPES: readonly MatchType[] = ['exact', 'contains', 'keyword', 'regex'];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Apakah `nilai` adalah tipe pencocokan yang dikenal. */
export function adalahMatchType(nilai: unknown): nilai is MatchType {
  return typeof nilai === 'string' && (MATCH_TYPES as readonly string[]).includes(nilai);
}

/**
 * Cocokkan teks dengan satu aturan.
 *
 * `regex` yang tidak valid TIDAK melempar dan TIDAK dianggap cocok: satu aturan
 * yang salah tulis tidak boleh mematikan seluruh chatbot, dan mencocokkan
 * semuanya justru lebih berbahaya daripada tidak cocok sama sekali. Untuk
 * webhook, regex yang salah tulis ditolak saat disimpan (lihat rutenya) karena
 * efeknya sama buruknya dengan diam: integrasi tidak pernah menerima apa pun.
 */
export function cocokTeks(matchType: MatchType, matchValue: string, teks: string): boolean {
  const t = (teks ?? '').trim();
  if (!t) return false;

  switch (matchType) {
    case 'exact':
      return t.toLowerCase() === matchValue.trim().toLowerCase();

    case 'contains':
      return t.toLowerCase().includes(matchValue.toLowerCase());

    case 'keyword': {
      // Daftar kata dipisah koma; cocok bila SALAH SATU muncul sebagai kata utuh.
      // Batas kata dipakai supaya "harga" tidak ikut cocok pada "hargai".
      const kata = matchValue.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
      if (kata.length === 0) return false;
      const rendah = t.toLowerCase();
      return kata.some((k) =>
        new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(k)}([^\\p{L}\\p{N}]|$)`, 'u').test(rendah),
      );
    }

    case 'regex':
      try {
        return new RegExp(matchValue, 'i').test(t);
      } catch {
        return false;
      }

    default:
      return false;
  }
}

/** `true` bila `pola` bisa dikompilasi sebagai regex. */
export function regexValid(pola: string): boolean {
  try {
    new RegExp(pola, 'i');
    return true;
  } catch {
    return false;
  }
}
