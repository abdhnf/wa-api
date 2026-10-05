export const MS = { MIN: 60_000, HOUR: 3_600_000, DAY: 86_400_000 };

/** Gaussian (Box-Muller) jitter in [min,max], clustered around middle */
export function gaussianJitter(min: number, max: number): number {
  const u1 = Math.max(Math.random(), 1e-9);
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const normalized = Math.max(0, Math.min(1, (normal + 3) / 6));
  return Math.round(min + normalized * (max - min));
}

export function hashContent(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

/**
 * Normalisasi konten sebelum hashing untuk guard anti-spam konten identik.
 *
 * Tanpa ini guard `maxIdenticalMessages` praktis tidak pernah aktif pada blast:
 * dashboard me-render variabel per kontak (mis. baris sapaan "Yth. <nama>"),
 * sehingga setiap pesan menghasilkan hash berbeda walau isi pesannya sama.
 * Hasilnya 52 pesan identik lolos tanpa terdeteksi.
 *
 * Heuristik ini menyamarkan baris personalisasi yang bervariasi per penerima.
 * Pesan tanpa baris sapaan tidak terpengaruh (hash tidak berubah).
 */
/**
 * Kunci pelacak pesan identik: kombinasi penerima + hash konten.
 *
 * Kenapa per penerima, bukan global: mengirim satu pengumuman yang sama ke 52
 * orang adalah broadcast yang sah, bukan spam. Yang benar-benar berisiko adalah
 * mengirim pesan yang sama berulang kali ke ORANG YANG SAMA.
 */
export function identicalKey(recipient: string, contentHash: string): string {
  return `${recipient}|${contentHash}`;
}

export function normalizeContentForHash(content: string): string {
  return content
    .replace(/^[ \t]*(Yth|Kepada|Dear|Halo|Hai|Hi)[^\n]*/gim, '$1 <PENERIMA>')
    .replace(/\s+/g, ' ')
    .trim();
}
