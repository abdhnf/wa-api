/**
 * Penyaring isi `req.body` sebelum disimpan ke kolom `api_logs.params`.
 *
 * Kenapa ada: `api_logs` dipakai sebagai bukti audit untuk permintaan dari agen.
 * Tanpa penyaringan, tabel itu berubah menjadi salinan data pribadi dan
 * kredensial — nomor penerima masuk apa adanya, begitu juga password dan PIN
 * yang dikirim ke endpoint auth. Log audit yang menyimpan rahasia bukan audit,
 * melainkan kebocoran kedua.
 *
 * Tiga aturan, berurutan:
 *
 *   1. **Buang kredensial.** Field yang namanya menandakan rahasia diganti
 *      penanda, bukan dihapus — supaya tetap terlihat bahwa field itu ada dan
 *      dikirim, tanpa menyimpan nilainya.
 *   2. **Ganti nomor telepon dengan hash.** Memakai `hashRecipient()` yang sama
 *      dengan `antiban_decisions`, sehingga satu nomor menghasilkan hash yang
 *      sama di kedua tabel dan bisa dikorelasikan tanpa menyimpan nomornya.
 *   3. **Batasi ukuran.** `bodyLimit` server 50 MB untuk upload media base64;
 *      tanpa batas, satu permintaan media bisa menulis puluhan MB ke tabel log.
 *
 * Yang TIDAK dilakukan: menyaring teks bebas. Isi pesan (`content`) dibiarkan
 * apa adanya karena justru itu yang perlu diaudit saat menyelidiki blast. Nomor
 * yang muncul di tengah kalimat juga tidak diubah — hanya nilai utuh yang
 * bentuknya nomor.
 */
import { normalisasiNomor } from './phone.js';
import { hashRecipient } from './db/decision-log.js';

/** Penanda untuk field yang nilainya tidak boleh disimpan. */
export const PENANDA_RAHASIA = '[REDACTED]';

/** Batas panjang JSON yang disimpan. Cukup untuk membaca parameter aksi. */
export const BATAS_PARAMS = 2048;

/** Kedalaman maksimum yang ditelusuri. Body bersarang lebih dalam dipotong. */
const KEDALAMAN_MAKS = 4;

/** Jumlah elemen array maksimum yang disimpan per tingkat. */
const ELEMEN_MAKS = 20;

/**
 * Nama field yang nilainya tidak boleh masuk log.
 *
 * Dicocokkan sebagai bagian dari nama (case-insensitive), bukan sama persis,
 * supaya `newPassword`, `blast_pin`, dan `apiKey` ikut tertangkap tanpa harus
 * mendaftarkan setiap variasi.
 */
const POLA_RAHASIA =
  /(password|passwd|pin|token|secret|api[_-]?key|authorization|credential|private[_-]?key|cvv|otp|session[_-]?cookie)/i;

/**
 * Pengecualian: nama yang MENGANDUNG pola di atas tetapi bukan rahasia.
 *
 * `typingWPM` tertangkap oleh `pin` karena "ty**pin**g". Nilainya angka kecepatan
 * mengetik — bagian dari konfigurasi anti-ban yang justru ingin diaudit. Menyaring
 * berlebihan sama merusaknya dengan menyaring kurang: audit yang isinya
 * `[REDACTED]` tidak bisa menjawab pertanyaan apa pun.
 *
 * Dicocokkan pada nama lengkap (case-insensitive), dan polanya sendiri TIDAK
 * dilonggarkan. Memperbaiki "typingWPM" dengan mengubah pola menjadi
 * `(^|[_-])pin$` akan meloloskan `pinCode` — jauh lebih berbahaya daripada satu
 * angka kecepatan mengetik yang tersensor.
 */
const PENGECUALIAN = new Set(['typingwpm', 'typingwpmstddev']);

/**
 * Nilai string yang bentuknya nomor telepon.
 *
 * Sengaja memakai `normalisasiNomor()` — bukan pencocokan digit sendiri — supaya
 * definisi "nomor" hanya ada di satu tempat. Konsekuensinya `"1500"` (kuota)
 * tidak dianggap nomor karena tidak lolos pola kanonik, sedangkan
 * `"+62 812-3456-7890"` dan `"0812..."` dianggap nomor yang sama.
 */
function tampakSepertiNomor(nilai: string): boolean {
  // Buang bagian JID lebih dulu, sama seperti `hashRecipient()`.
  //
  // Tanpa ini, `6281234567890@s.whatsapp.net` (27 karakter) tertolak oleh
  // pemeriksaan panjang di bawah dan nomornya tersimpan mentah — padahal JID
  // justru bentuk yang paling sering muncul di body pengiriman. Kesalahan ini
  // sempat lolos karena nomor tanpa JID tetap tersaring dengan benar.
  const inti = nilai.split('@')[0].split(':')[0];

  // Batasi setelah JID dibuang: teks panjang bukan nomor, dan normalisasi teks
  // panjang hanya membuang waktu.
  if (inti.length === 0 || inti.length > 25) return false;

  // Harus didominasi digit. Ini menolak "preset-broadcast" dan "sess-abc123"
  // yang kebetulan mengandung digit.
  const digit = (inti.match(/\d/g) || []).length;
  if (digit < 7) return false;

  return normalisasiNomor(inti) !== null;
}

/** Apakah nama field ini menyimpan rahasia. */
export function namaFieldRahasia(nama: string): boolean {
  if (PENGECUALIAN.has(nama.toLowerCase())) return false;
  return POLA_RAHASIA.test(nama);
}

/**
 * Saring satu nilai. Diekspor untuk diuji langsung tanpa melalui HTTP.
 */
export function saringNilai(nilai: unknown, kedalaman = 0): unknown {
  if (nilai === null || nilai === undefined) return nilai;

  if (typeof nilai === 'string') {
    if (tampakSepertiNomor(nilai)) {
      const hash = hashRecipient(nilai);
      // `hashRecipient` mengembalikan null kalau normalisasi gagal; dalam kasus
      // itu jangan simpan nilai aslinya.
      return hash ? `hash:${hash}` : PENANDA_RAHASIA;
    }
    return nilai;
  }

  if (typeof nilai === 'number' || typeof nilai === 'boolean') return nilai;

  // Body bersarang lebih dalam dari batas: jangan telusuri, cukup tandai.
  // Menelusuri tanpa batas membuka jalan badan JSON yang sangat dalam untuk
  // menghabiskan stack.
  if (kedalaman >= KEDALAMAN_MAKS) return '[TERLALU_DALAM]';

  if (Array.isArray(nilai)) {
    const dipotong = nilai.slice(0, ELEMEN_MAKS).map((v) => saringNilai(v, kedalaman + 1));
    if (nilai.length > ELEMEN_MAKS) {
      dipotong.push(`[+${nilai.length - ELEMEN_MAKS} elemen lain]`);
    }
    return dipotong;
  }

  if (typeof nilai === 'object') {
    const hasil: Record<string, unknown> = {};
    for (const [kunci, isi] of Object.entries(nilai as Record<string, unknown>)) {
      hasil[kunci] = namaFieldRahasia(kunci) ? PENANDA_RAHASIA : saringNilai(isi, kedalaman + 1);
    }
    return hasil;
  }

  // Fungsi, BigInt, Symbol: tidak mungkin datang dari JSON, tapi jangan simpan.
  return '[TIDAK_DIKENAL]';
}

/**
 * Ubah `req.body` menjadi string JSON yang aman disimpan, atau `null`.
 *
 * Mengembalikan `null` kalau body kosong — kolom `params` dibiarkan `NULL`
 * untuk permintaan yang tidak membawa isi, bukan diisi `"{}"` yang tidak
 * memberi informasi apa pun.
 */
export function saringParams(body: unknown): string | null {
  if (body === null || body === undefined) return null;
  if (typeof body === 'object' && Object.keys(body as object).length === 0) return null;
  // Body non-objek (mis. string mentah) tetap dicatat, tetapi disaring dulu.
  if (typeof body !== 'object') {
    const saring = saringNilai(body);
    return potong(String(saring));
  }

  let json: string;
  try {
    json = JSON.stringify(saringNilai(body));
  } catch {
    // Body melingkar (tidak mungkin dari JSON, tapi jangan sampai logger
    // melempar dan mengganggu respons).
    return '[GAGAL_DISERIALISASI]';
  }
  return potong(json);
}

/** Potong JSON yang melebihi batas, dengan penanda yang jelas. */
function potong(json: string): string {
  if (json.length <= BATAS_PARAMS) return json;
  return `${json.slice(0, BATAS_PARAMS)}…[dipotong, ${json.length} karakter]`;
}
