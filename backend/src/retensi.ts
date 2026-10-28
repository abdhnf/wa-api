/**
 * Penjadwal retensi `api_logs`.
 *
 * Kenapa perlu: baris bertanda `audit = 1` sengaja TIDAK bisa dihapus oleh
 * pemiliknya (lihat `clearApiLogs`), supaya pihak yang diaudit tidak bisa
 * menghapus buktinya sendiri. Konsekuensinya, `POST /api-logs/clear` tidak akan
 * pernah menyusutkan baris audit — jadi kalau tidak ada yang membersihkan dari
 * sisi server, tabelnya tumbuh tanpa batas. Volume naik lagi karena GET dari agen
 * kini ikut tercatat.
 *
 * Kenapa dijalankan sekali sehari, bukan tiap jam: retensinya dihitung dalam
 * hari, jadi menjalankannya lebih sering hanya menambah beban tulis tanpa
 * mengubah hasil. Waktu pertama sengaja diberi jeda agar tidak berebut dengan
 * pemulihan antrean saat server baru naik.
 */
import { jalankanRetensi, RETENSI_AUDIT_HARI, RETENSI_GALAT_HARI } from './db/api-logs.js';

const JEDA_AWAL_MS = 5 * 60 * 1000; // 5 menit setelah start
const INTERVAL_MS = 24 * 60 * 60 * 1000; // sekali sehari

let timer: NodeJS.Timeout | undefined;

function bersihkan(): void {
  try {
    const { audit, galat } = jalankanRetensi();
    if (audit > 0 || galat > 0) {
      // Dicatat, bukan dihapus senyap: retensi yang tidak terlihat sama saja
      // dengan kehilangan data tanpa penjelasan.
      console.log(
        `[retensi:api_logs] dihapus ${audit} baris audit (>${RETENSI_AUDIT_HARI} hari) ` +
          `dan ${galat} catatan galat (>${RETENSI_GALAT_HARI} hari)`,
      );
    }
  } catch (err) {
    // Retensi gagal tidak boleh menjatuhkan server; dicoba lagi pada siklus
    // berikutnya.
    console.error('[retensi:api_logs] gagal:', err);
  }
}

export function jadwalkanRetensiApiLogs(): void {
  if (timer) return;
  const pertama = setTimeout(() => {
    bersihkan();
    timer = setInterval(bersihkan, INTERVAL_MS);
    // Jangan menahan proses tetap hidup hanya karena timer ini.
    timer.unref?.();
  }, JEDA_AWAL_MS);
  pertama.unref?.();
}

/** Dipakai uji: jalankan sekali tanpa menunggu jadwal. */
export { bersihkan as jalankanRetensiSekarang };
