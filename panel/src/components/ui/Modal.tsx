import React, { useEffect, useRef } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Modal bersama untuk panel.
 *
 * Sebelumnya setiap halaman menulis sendiri lapisan `fixed inset-0` dengan
 * susunan tombol dan penanganan Escape yang berbeda-beda. Perbedaan itu yang
 * membuat satu dialog bisa ditutup dengan Escape dan yang lain tidak, dan satu
 * dialog mengunci scroll halaman sementara yang lain tidak.
 *
 * Yang ditangani di sini, sekali:
 *   - Escape menutup (kecuali `busy`: menutup di tengah penyimpanan membuat
 *     operator mengira aksinya batal padahal request sudah terkirim).
 *   - Klik latar menutup, klik di dalam kotak tidak.
 *   - Scroll halaman dikunci selama modal terbuka.
 *   - Fokus dipindah ke kotak modal saat dibuka, dan dikembalikan ke pemicunya
 *     saat ditutup. Tanpa ini pengguna keyboard tertinggal di elemen yang sudah
 *     tidak terlihat.
 */
interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  /** Lebar maksimum kotak. Default `lg` (32rem) cukup untuk formulir dua kolom. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Cegah penutupan selama operasi berjalan. */
  busy?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const UKURAN: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  icon,
  size = 'lg',
  busy = false,
  children,
  footer,
}) => {
  const kotakRef = useRef<HTMLDivElement>(null);
  const pemicuRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    pemicuRef.current = document.activeElement as HTMLElement | null;
    kotakRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);

    // Kunci scroll latar: tanpa ini halaman di belakang ikut bergeser saat
    // modal dibuka, dan posisi gulir tidak kembali setelah ditutup.
    const overflowLama = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflowLama;
      pemicuRef.current?.focus?.();
    };
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 wa-modal-fade"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="fixed inset-0 bg-ink/80 backdrop-blur-xs"
        onClick={() => { if (!busy) onClose(); }}
      />

      <div
        ref={kotakRef}
        tabIndex={-1}
        className={`relative w-full ${UKURAN[size]} bg-surface border border-line rounded-md z-10 wa-modal-pop max-h-[calc(100dvh-2rem)] flex flex-col focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-3 border-b border-line shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            {icon && <div className="shrink-0">{icon}</div>}
            <div className="min-w-0">
              <h3 className="text-base font-bold text-ink">{title}</h3>
              {description && <p className="text-xs text-ink-muted mt-1">{description}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Tutup"
            className="shrink-0 text-ink-muted hover:text-ink transition p-1 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Dialog konfirmasi untuk aksi yang tidak bisa dibatalkan.
 *
 * Menggantikan `window.confirm()`: kotak bawaan browser tidak bisa memberi tahu
 * apa yang akan hilang, tidak mengikuti bahasa visual panel, dan memblokir
 * seluruh utas. Yang terakhir membuat spinner tombol berhenti berputar tepat
 * saat operator paling butuh kepastian bahwa sesuatu sedang terjadi.
 */
interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Lanjutkan',
  cancelLabel = 'Batal',
  variant = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  const gaya = variant === 'danger'
    ? 'bg-clay-wash/80 text-clay border border-clay-line/60'
    : 'bg-honey-wash/80 text-honey border border-honey-line/60';
  const tombol = variant === 'danger'
    ? 'bg-clay text-white hover:opacity-90'
    : 'bg-honey text-white hover:opacity-90';

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="md"
      busy={busy}
      icon={<div className={`p-2.5 rounded-md ${gaya}`}><AlertTriangle className="w-5 h-5" /></div>}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 bg-surface-alt text-ink-soft rounded-md text-xs font-semibold transition disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition disabled:opacity-50 ${tombol}`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-ink-soft leading-relaxed">{message}</div>
    </Modal>
  );
};