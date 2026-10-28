/**
 * Ringkasan kolom "Perubahan" pada tabel API Logs.
 *
 * Dipisah dari komponen karena di sinilah letak keputusan yang menentukan
 * benar-tidaknya pembacaan audit — bukan urusan tata letak. Tiga keadaan di bawah
 * HARUS tampil berbeda; kalau disamakan, pembaca menyimpulkan hal yang salah, dan
 * tabel audit yang menyesatkan lebih buruk daripada tidak ada tabel.
 *
 *   1. lama + baru ada   -> "preset: strict → broadcast"
 *   2. hanya baru        -> "preset: → broadcast" + catatan "nilai lama tidak dicatat"
 *   3. tak ada keduanya  -> "—" (permintaan ditolak sebelum handler berjalan)
 *
 * Nilai di dalamnya sudah tersaring di server (`audit-params.ts`): nomor telepon
 * sebagai `hash:…`, kredensial `[REDACTED]`, isi panjang dipotong. Panel tidak
 * boleh menawarkan "lihat nilai asli" — nilai aslinya memang tidak disimpan.
 */

export interface BarisPerubahan {
  /** Teks ringkas untuk ditampilkan. */
  teks: string;
  /** Keterangan kecil di bawah teks, bila ada yang perlu dijelaskan. */
  catatan?: string;
  /** Penanda bahaya (perubahan menjadi preset `broadcast`). */
  bahaya?: boolean;
}

const KOSONG: BarisPerubahan = { teks: '—' };

function urai(nilai?: string | null): Record<string, unknown> | null {
  if (!nilai) return null;
  try {
    const v = JSON.parse(nilai);
    // Array bukan objek parameter; jangan diperlakukan sebagai kunci.
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function tampil(v: unknown): string {
  if (v === undefined) return '∅';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    // Objek besar (mis. `config` seluruh preset) diringkas: menampilkan isinya
    // akan menenggelamkan satu nilai yang sebenarnya ditanyakan.
    return `{${Object.keys(v as object).length} field}`;
  }
  return String(v);
}

/**
 * @param params       nilai SESUDAH aksi (kolom `params`)
 * @param paramsBefore nilai SEBELUM aksi (kolom `params_before`), null bila
 *                     handler tidak mencatatnya
 */
export function ringkasPerubahan(
  params?: string | null,
  paramsBefore?: string | null,
): BarisPerubahan {
  const baru = urai(params);
  const lama = urai(paramsBefore);

  if (!baru && !lama) return KOSONG;

  const semuaKunci = Object.keys({ ...(lama || {}), ...(baru || {}) });

  // Hanya kunci yang berubah. Kalau tidak ada yang berubah (mis. permintaan
  // mengulang nilai yang sama), tampilkan kuncinya saja — bukan "tidak ada
  // perubahan", karena permintaannya tetap terjadi.
  const berubah = semuaKunci.filter((k) => {
    const a = JSON.stringify((lama || {})[k]);
    const b = JSON.stringify((baru || {})[k]);
    return a !== b;
  });
  const dipakai = (berubah.length > 0 ? berubah : semuaKunci).slice(0, 3);

  const bagian = dipakai.map((k) => {
    const a = (lama || {})[k];
    const b = (baru || {})[k];
    if (lama && baru) return `${k}: ${tampil(a)} → ${tampil(b)}`;
    if (baru) return `${k}: → ${tampil(b)}`;
    return `${k}: ${tampil(a)} → ∅`;
  });

  const sisa = semuaKunci.length - dipakai.length;
  const teks = bagian.join(' · ') + (sisa > 0 ? ` (+${sisa} lainnya)` : '');

  // Perubahan MENJADI preset broadcast ditandai bahaya: pada preset ini
  // `contactGraph` dan `replyRatio` tidak berjalan, sehingga "allow" di sana
  // berarti "dimatikan", bukan "diperiksa dan aman".
  const jadiBroadcast =
    String((baru || {}).preset ?? '') === 'broadcast' &&
    String((lama || {}).preset ?? '') !== 'broadcast';

  return {
    teks,
    catatan: baru && !lama ? 'nilai lama tidak dicatat untuk aksi ini' : undefined,
    bahaya: jadiBroadcast || undefined,
  };
}

/**
 * Apakah baris ini boleh dihapus oleh peran yang sedang melihat.
 *
 * Baris bukti audit (`audit = 1`) hanya bisa dihapus admin — ditegakkan di
 * `deleteApiLogs`. Menampilkan tombol yang pasti gagal lebih buruk daripada
 * tidak menampilkannya, dan mencentangnya membuat "hapus 5" menghasilkan
 * "3 dihapus" tanpa penjelasan di layar.
 */
export function bisaDihapus(baris: { audit?: boolean }, isAdmin: boolean): boolean {
  return isAdmin || !baris.audit;
}
