/**
 * Satu-satunya sumber kebenaran untuk tampilan kesehatan sesi (risiko ban).
 *
 * Modul ini mengikuti pola `messageStatus.tsx`: peta status -> label + tone +
 * ikon, dengan fallback netral untuk nilai yang tidak dikenal. Alasannya sama —
 * badge yang diduplikasi di beberapa halaman cepat menyimpang, dan level risiko
 * yang salah dibaca membuat operator mengambil tindakan yang keliru.
 *
 * Bentuk data mengikuti `HealthMonitor.getStatus()` di backend/src/health.ts.
 */

import { ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion, TrendingDown } from 'lucide-react';

export type BanRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface HealthStatus {
  risk: BanRiskLevel;
  score: number;
  reasons: string[];
  recommendation: string;
  stats: {
    disconnectsLastHour: number;
    failedMessagesLastHour: number;
    forbiddenErrors: number;
    timelockErrors: number;
    uptimeMs: number;
    lastDisconnectReason?: string;
  };
}

type Tone = 'ok' | 'wait' | 'warn' | 'error' | 'neutral';

/** Kelas Tailwind per tone — memakai token tema panel (pine/honey/clay/slate). */
const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-pine bg-pine-wash/60 border-pine-line/50',
  wait: 'text-honey bg-honey-wash/60 border-honey-line/50',
  warn: 'text-clay bg-clay-wash/60 border-clay-line/50',
  error: 'text-clay-deep bg-clay-wash border-clay-line',
  neutral: 'text-ink-muted bg-surface-sunken border-line',
};

/** Warna batang skor — dipakai untuk indikator progres 0-100. */
export const RISK_BAR_CLASS: Record<BanRiskLevel, string> = {
  low: 'bg-pine',
  medium: 'bg-honey',
  high: 'bg-clay',
  critical: 'bg-clay-deep',
};

interface RiskStyle {
  label: string;
  tone: Tone;
  Icon: typeof ShieldCheck;
  /** Level yang butuh perhatian segera diberi denyut halus. */
  pulse?: boolean;
}

export const RISK_LEVEL: Record<BanRiskLevel, RiskStyle> = {
  low: { label: 'Aman', tone: 'ok', Icon: ShieldCheck },
  medium: { label: 'Perhatian', tone: 'wait', Icon: ShieldAlert },
  high: { label: 'Risiko Tinggi', tone: 'warn', Icon: ShieldAlert, pulse: true },
  critical: { label: 'Kritis', tone: 'error', Icon: ShieldX, pulse: true },
};

/**
 * Ambang batas HARUS sama dengan `getStatus()` di backend/src/health.ts.
 * Kalau salah satu berubah, ubah keduanya — badge yang bilang "Aman" padahal
 * backend sudah auto-pause adalah bug yang berbahaya.
 */
export function scoreToRisk(score: number): BanRiskLevel {
  if (score >= 80) return 'critical';
  if (score >= 40) return 'high';
  if (score >= 15) return 'medium';
  return 'low';
}

export interface RiskBadgeProps {
  risk: BanRiskLevel | string;
  score?: number;
  /** Ukuran ikon; kartu sesi memakai 12. */
  iconSize?: number;
  /** Ukuran teks ringkas untuk tabel/kartu padat. */
  compact?: boolean;
  /** Tampilkan angka skor di samping label. */
  showScore?: boolean;
}

/**
 * Badge tingkat risiko. Level yang tidak dikenal dirender netral dengan
 * namanya sendiri — tidak pernah dilabeli "Aman", karena menyatakan sesi sehat
 * tanpa data lebih berbahaya daripada mengaku tidak tahu.
 */
export const RiskBadge: React.FC<RiskBadgeProps> = ({
  risk,
  score,
  iconSize = 12,
  compact = false,
  showScore = false,
}) => {
  const style = RISK_LEVEL[risk as BanRiskLevel];
  const label = style?.label ?? String(risk);
  const tone: Tone = style?.tone ?? 'neutral';
  const Icon = style?.Icon ?? ShieldQuestion;

  const size = compact
    ? 'text-[10px] font-semibold px-2 py-0.5'
    : 'text-[11px] px-2 py-0.5';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border ${size} ${TONE_CLASS[tone]}`}
      title={score != null ? `Skor risiko ${score}/100` : `Risiko: ${risk}`}
    >
      <Icon size={iconSize} className={style?.pulse ? 'animate-pulse' : undefined} />
      {label}
      {showScore && score != null && (
        <span className="font-mono opacity-80">{score}</span>
      )}
    </span>
  );
};

/**
 * Batang skor risiko 0-100.
 * Menampilkan angka secara monospace karena ini data numerik — konsisten
 * dengan aturan tipografi panel.
 */
export const RiskBar: React.FC<{ score: number; risk: BanRiskLevel | string; className?: string }> = ({
  score,
  risk,
  className,
}) => {
  const pct = Math.max(0, Math.min(100, score));
  const bar = RISK_BAR_CLASS[risk as BanRiskLevel] ?? 'bg-slate';
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <div className="h-1.5 flex-1 rounded-full bg-surface-sunken overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] text-ink-muted tabular-nums w-8 text-right">{pct}</span>
    </div>
  );
};

/**
 * Panel ringkas alasan risiko + rekomendasi tindakan.
 * Dipakai di detail sesi, bukan di kartu daftar — di sana ruangnya terlalu sempit
 * dan operator cuma butuh levelnya sekilas.
 */
export const RiskDetail: React.FC<{ health: HealthStatus | null | undefined }> = ({ health }) => {
  if (!health) {
    return (
      <div className="rounded border border-line bg-surface-sunken px-3 py-2.5 text-[12px] text-ink-muted">
        Data kesehatan belum tersedia untuk sesi ini.
      </div>
    );
  }

  const style = RISK_LEVEL[health.risk];
  const isProblem = health.risk !== 'low';

  return (
    <div className={`rounded border px-3 py-2.5 ${TONE_CLASS[style?.tone ?? 'neutral']}`}>
      <div className="flex items-center gap-2">
        <RiskBadge risk={health.risk} score={health.score} showScore />
        {isProblem && <TrendingDown size={13} />}
      </div>

      {isProblem && (
        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed">
          {health.reasons.map((r, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="opacity-50">•</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] leading-relaxed opacity-90">{health.recommendation}</p>

      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] border-t border-current/10 pt-2">
        <div className="flex justify-between">
          <span className="opacity-70">Disconnect/jam</span>
          <span className="font-mono tabular-nums">{health.stats.disconnectsLastHour}</span>
        </div>
        <div className="flex justify-between">
          <span className="opacity-70">Pesan gagal/jam</span>
          <span className="font-mono tabular-nums">{health.stats.failedMessagesLastHour}</span>
        </div>
        <div className="flex justify-between">
          <span className="opacity-70">Error 403</span>
          <span className="font-mono tabular-nums">{health.stats.forbiddenErrors}</span>
        </div>
        <div className="flex justify-between">
          <span className="opacity-70">Timelock 463</span>
          <span className="font-mono tabular-nums">{health.stats.timelockErrors}</span>
        </div>
      </div>
    </div>
  );
};
