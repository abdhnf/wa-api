/**
 * Satu-satunya sumber kebenaran untuk tampilan status pesan.
 *
 * Sebelumnya `getStatusBadge` diduplikasi di `RealtimeMonitor.tsx` dan
 * `AdminCommandCenter.tsx` dengan isi berbeda. Command Center menggabungkan
 * `case 'failed'` dengan `default`, sehingga SETIAP status yang belum punya
 * `case` sendiri tampil sebagai "Gagal" — termasuk `sending` (pesan yang
 * sedang aktif dikirim), `queued`, `invalid_number`, dan `not_registered`.
 *
 * Union di bawah harus tetap sinkron dengan `MessageStatus` di
 * `backend/src/types.ts`. Status baru di backend otomatis tampil apa adanya
 * lewat fallback netral, bukan lagi diam-diam menjadi "Gagal".
 */
import { AlertTriangle, CheckCheck, CheckCircle2, Clock, Send, XCircle, Zap } from 'lucide-react';

/** Cerminan `MessageStatus` di backend/src/types.ts. */
export type MessageStatus =
  | 'pending'
  | 'queued'
  | 'pacing'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'invalid_number'
  | 'not_registered'
  | 'cancelled';

type Tone = 'neutral' | 'wait' | 'active' | 'ok' | 'error';

/** Kelas Tailwind per tone — memakai token tema panel (pine/sea/honey/clay). */
const TONE_CLASS: Record<Tone, string> = {
  neutral: 'text-ink-muted bg-surface-sunken border-line',
  wait: 'text-honey bg-honey-wash/60 border-honey-line/50',
  active: 'text-sea bg-sea-wash/60 border-sea-line/50',
  ok: 'text-pine bg-pine-wash/60 border-pine-line/50',
  error: 'text-clay bg-clay-wash/60 border-clay-line/50',
};

interface StatusStyle {
  /** Label yang ditampilkan — istilah Inggris mengikuti status asli backend. */
  label: string;
  tone: Tone;
  Icon: typeof Clock;
  /** Animasi untuk status yang sedang bergerak. */
  pulse?: boolean;
  /**
   * Penjelasan singkat untuk tooltip.
   * Penting untuk membedakan status yang terlihat mirip tapi tindakannya
   * berbeda jauh — terutama `queued` (belum pernah dicoba kirim, tidak ada
   * gunanya retry) versus `failed` (sudah dicoba dan ditolak, retry masuk akal).
   */
  hint: string;
}

export const MESSAGE_STATUS: Record<MessageStatus, StatusStyle> = {
  pending: { label: 'Pending', tone: 'neutral', Icon: Clock, hint: 'Menunggu masuk antrean pengiriman.' },
  queued: { label: 'Queued', tone: 'neutral', Icon: Clock, hint: 'Masih di antrean — belum pernah dicoba kirim. Retry tidak diperlukan; cukup lanjutkan antreannya.' },
  pacing: { label: 'Pacing', tone: 'wait', Icon: Clock, hint: 'Sedang menunggu jeda anti-ban sebelum dikirim.' },
  sending: { label: 'Sending', tone: 'active', Icon: Zap, pulse: true, hint: 'Sedang dikirim ke server WhatsApp.' },
  sent: { label: 'Sent', tone: 'active', Icon: Send, hint: 'Sampai di server WhatsApp, belum tentu sampai ke penerima.' },
  delivered: { label: 'Delivered', tone: 'ok', Icon: CheckCircle2, hint: 'Sampai di perangkat penerima.' },
  read: { label: 'Read', tone: 'ok', Icon: CheckCheck, hint: 'Sudah dibaca penerima.' },
  failed: { label: 'Failed', tone: 'error', Icon: AlertTriangle, hint: 'Gagal terkirim. Retry masuk akal kalau penyebabnya sementara.' },
  invalid_number: { label: 'Invalid Number', tone: 'error', Icon: AlertTriangle, hint: 'Format nomor tidak valid. Retry tidak akan menolong.' },
  not_registered: { label: 'Not Registered', tone: 'error', Icon: AlertTriangle, hint: 'Nomor tidak terdaftar di WhatsApp. Retry tidak akan menolong.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', Icon: XCircle, hint: 'Dibatalkan sebelum dikirim.' },
};

/** `invalid_number` -> `Invalid Number` untuk status yang belum dipetakan. */
function humanize(status: string): string {
  return status
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Waktu kejadian per status, epoch milidetik. Cerminan `statusTimes` di backend. */
export type StatusTimes = Partial<Record<MessageStatus, number>>;

/**
 * Urutan tampil waktu status — mengikuti alur hidup pesan, bukan urutan kode.
 *
 * Hanya status alur maju yang masuk daftar ini. `failed` sengaja TIDAK di sini:
 * kegagalan bisa terjadi di titik mana pun (sebelum dikirim, saat dikirim, atau
 * bahkan setelah read), jadi menempatkannya di urutan tetap akan menyesatkan.
 * Waktu `failed` ditampilkan terpisah di akhir.
 */
const URUTAN_ALUR: MessageStatus[] = ['queued', 'pacing', 'sending', 'sent', 'delivered', 'read'];

/** Nama tahap dalam bahasa Indonesia untuk daftar waktu di modal detail. */
const TAHAP_LABEL: Partial<Record<MessageStatus, string>> = {
  queued: 'Masuk antrean',
  pacing: 'Jeda anti-ban',
  sending: 'Mulai dikirim',
  sent: 'Sampai server WhatsApp',
  delivered: 'Sampai perangkat penerima',
  read: 'Dibaca penerima',
  failed: 'Gagal dikirim',
  invalid_number: 'Nomor tidak valid',
  not_registered: 'Nomor tidak terdaftar',
  cancelled: 'Dibatalkan',
};

/**
 * Status terminal — peristiwa yang MENGhentikan alur, bukan melanjutkannya.
 *
 * Daftar ini harus sejalan dengan `FORCED_STATUSES` di backend
 * (`src/db/pesan.ts`); backend mencatat waktu untuk keempatnya.
 */
const STATUS_TERMINAL: MessageStatus[] = [
  'failed',
  'invalid_number',
  'not_registered',
  'cancelled',
];

/** Jam:menit:detik waktu lokal perangkat operator. */
export function formatJam(ms: number): string {
  return new Date(ms).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Selisih dari waktu antrean, mis. `+3,2 dtk` atau `+1 mnt 12 dtk`.
 *
 * Dipakai sebagai pelengkap, bukan pengganti jam absolut: "14:04:52" menjawab
 * "kapan", sedangkan "+3,2 dtk" menjawab "lama prosesnya berapa".
 */
export function formatSelisih(ms: number): string {
  if (ms < 0) return '0 dtk';
  const detik = ms / 1000;
  if (detik < 60) return `+${detik.toFixed(1).replace('.', ',')} dtk`;
  const menit = Math.floor(detik / 60);
  const sisa = Math.round(detik % 60);
  return `+${menit} mnt ${sisa} dtk`;
}

export interface BarisWaktu {
  status: MessageStatus;
  /** Nama tahap bahasa Indonesia, mis. "Sampai perangkat penerima". */
  tahap: string;
  /** Jam:menit:detik lokal. */
  jam: string;
  /** Selisih dari waktu masuk antrean; `null` untuk baris antrean itu sendiri. */
  selisih: string | null;
}

/**
 * Susun daftar waktu per status untuk ditampilkan.
 *
 * Mengembalikan array kosong bila `statusTimes` tidak ada — pesan yang dibuat
 * sebelum fitur ini tidak punya catatan waktu, dan itu memang tidak bisa
 * direkonstruksi. Pemanggil WAJIB menangani array kosong dengan menampilkan
 * pesan lama apa adanya, bukan mengarang waktu dari `created_at`.
 */
export function susunBarisWaktu(times?: StatusTimes): BarisWaktu[] {
  if (!times) return [];
  const basis = times.queued;
  const baris: BarisWaktu[] = [];

  for (const status of URUTAN_ALUR) {
    const ms = times[status];
    if (typeof ms !== 'number') continue;
    baris.push({
      status,
      tahap: TAHAP_LABEL[status] ?? MESSAGE_STATUS[status].label,
      jam: formatJam(ms),
      selisih: basis !== undefined && status !== 'queued' ? formatSelisih(ms - basis) : null,
    });
  }

  // Status terminal ditampilkan paling akhir apa pun posisinya, karena itu
  // peristiwa yang menjelaskan kenapa alur di atas berhenti. Sebelumnya hanya
  // `failed` yang ditangani, sehingga pesan `not_registered` / `invalid_number`
  // / `cancelled` tampil seolah masih di antrean.
  for (const status of STATUS_TERMINAL) {
    const ms = times[status];
    if (typeof ms !== 'number') continue;
    baris.push({
      status,
      tahap: TAHAP_LABEL[status] ?? MESSAGE_STATUS[status].label,
      jam: formatJam(ms),
      selisih: basis !== undefined ? formatSelisih(ms - basis) : null,
    });
  }

  return baris;
}

/**
 * Ringkasan waktu untuk tooltip badge — satu baris per status yang tercatat.
 * Mengembalikan `undefined` bila tidak ada catatan, supaya pemanggil jatuh ke
 * `hint` biasa alih-alih menampilkan tooltip kosong.
 */
export function ringkasWaktu(times?: StatusTimes): string | undefined {
  const baris = susunBarisWaktu(times);
  if (baris.length === 0) return undefined;
  return baris
    .map((b) => `${b.tahap}: ${b.jam}${b.selisih ? ` (${b.selisih})` : ''}`)
    .join('\n');
}

export interface MessageStatusBadgeProps {
  status: string;
  /** Ukuran ikon; panel memakai 12, Command Center 11. */
  iconSize?: number;
  /** Ukuran teks; panel memakai 11px, Command Center 10px + font-semibold. */
  compact?: boolean;
  /**
   * Waktu per status. Bila diisi, tooltip menampilkan jam tiap tahap di bawah
   * penjelasan status. Tanpa ini badge tampil seperti sebelumnya.
   */
  statusTimes?: StatusTimes;
}

/**
 * Jam kejadian status yang SEDANG tampil, untuk ditulis langsung di sel tabel.
 *
 * Kenapa ini ada: rincian waktu lengkap hanya bisa dilihat lewat tooltip, dan
 * tooltip menyembunyikan informasi di balik tindakan (arahkan kursor) yang tidak
 * tersedia di layar sentuh. Operator yang memindai daftar tidak bisa membandingkan
 * kecepatan kirim tanpa membuka tiap baris satu per satu.
 *
 * Mengembalikan `null` bila status terkini tidak punya catatan waktu. Pemanggil
 * WAJIB memperlakukan `null` sebagai "tidak ada data", bukan mengisinya dengan
 * waktu antrean — dua waktu itu berbeda dan mencampurnya menyesatkan.
 */
export function jamStatusTerakhir(status: string, times?: StatusTimes): string | null {
  const ms = times?.[status as MessageStatus];
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return formatJam(ms);
}

export interface JamStatusProps {
  status: string;
  statusTimes?: StatusTimes;
  /** Kelas tambahan, mis. `text-ink-faint` pada tabel yang lebih padat. */
  className?: string;
}

/**
 * Jam status terkini sebagai elemen. Tidak merender apa pun bila tidak ada
 * catatan, sehingga pemanggil cukup menaruhnya di JSX tanpa pengecekan sendiri.
 */
export const JamStatus: React.FC<JamStatusProps> = ({ status, statusTimes, className }) => {
  const jam = jamStatusTerakhir(status, statusTimes);
  if (!jam) return null;
  return (
    <span className={`font-mono text-[10px] text-ink-faint ${className ?? ''}`.trim()}>{jam}</span>
  );
};

/**
 * Badge status pesan. Status yang tidak dikenal dirender netral dengan
 * namanya sendiri — tidak pernah dilabeli "Failed", karena menandai pesan
 * yang sehat sebagai gagal membuat operator melakukan retry yang tidak perlu.
 */
export const MessageStatusBadge: React.FC<MessageStatusBadgeProps> = ({
  status,
  iconSize = 12,
  compact = false,
  statusTimes,
}) => {
  const style = MESSAGE_STATUS[status as MessageStatus];
  const label = style?.label ?? humanize(status);
  const tone: Tone = style?.tone ?? 'neutral';
  const Icon = style?.Icon ?? Clock;

  const size = compact
    ? 'text-[10px] font-semibold px-2 py-0.5'
    : 'text-[11px] px-2 py-0.5';

  const penjelasan = style?.hint ?? status;
  const waktu = ringkasWaktu(statusTimes);
  const tooltip = waktu ? `${penjelasan}\n\n${waktu}` : penjelasan;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border ${size} ${TONE_CLASS[tone]}`}
      title={tooltip}
    >
      <Icon size={iconSize} className={style?.pulse ? 'animate-pulse' : undefined} />
      {label}
    </span>
  );
};
