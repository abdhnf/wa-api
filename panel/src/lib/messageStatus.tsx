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
}

export const MESSAGE_STATUS: Record<MessageStatus, StatusStyle> = {
  pending: { label: 'Pending', tone: 'neutral', Icon: Clock },
  queued: { label: 'Queued', tone: 'neutral', Icon: Clock },
  pacing: { label: 'Pacing', tone: 'wait', Icon: Clock },
  sending: { label: 'Sending', tone: 'active', Icon: Zap, pulse: true },
  sent: { label: 'Sent', tone: 'active', Icon: Send },
  delivered: { label: 'Delivered', tone: 'ok', Icon: CheckCircle2 },
  read: { label: 'Read', tone: 'ok', Icon: CheckCheck },
  failed: { label: 'Failed', tone: 'error', Icon: AlertTriangle },
  invalid_number: { label: 'Invalid Number', tone: 'error', Icon: AlertTriangle },
  not_registered: { label: 'Not Registered', tone: 'error', Icon: AlertTriangle },
  cancelled: { label: 'Cancelled', tone: 'neutral', Icon: XCircle },
};

/** `invalid_number` -> `Invalid Number` untuk status yang belum dipetakan. */
function humanize(status: string): string {
  return status
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export interface MessageStatusBadgeProps {
  status: string;
  /** Ukuran ikon; panel memakai 12, Command Center 11. */
  iconSize?: number;
  /** Ukuran teks; panel memakai 11px, Command Center 10px + font-semibold. */
  compact?: boolean;
}

/**
 * Badge status pesan. Status yang tidak dikenal dirender netral dengan
 * namanya sendiri — tidak pernah dilabeli "Failed", karena menandai pesan
 * yang sehat sebagai gagal membuat operator melakukan retry yang tidak perlu.
 */
export const MessageStatusBadge: React.FC<MessageStatusBadgeProps> = ({
  status,
  iconSize = 12,
  compact = false,
}) => {
  const style = MESSAGE_STATUS[status as MessageStatus];
  const label = style?.label ?? humanize(status);
  const tone: Tone = style?.tone ?? 'neutral';
  const Icon = style?.Icon ?? Clock;

  const size = compact
    ? 'text-[10px] font-semibold px-2 py-0.5'
    : 'text-[11px] px-2 py-0.5';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border ${size} ${TONE_CLASS[tone]}`}
      title={status}
    >
      <Icon size={iconSize} className={style?.pulse ? 'animate-pulse' : undefined} />
      {label}
    </span>
  );
};
