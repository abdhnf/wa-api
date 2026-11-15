import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id?: string;
  msg: string;
  type: ToastType;
}

interface ToastProps {
  toast: ToastMessage | null;
  onClose: () => void;
  duration?: number;
}

/**
 * Notifikasi ringkas di pojok kanan bawah.
 *
 * Memakai kelas `wa-alert-*` yang sama dengan peringatan di dalam halaman,
 * supaya warna dan tipografinya satu bahasa. Dua hal yang TIDAK boleh dipakai
 * di sini:
 *
 *   - `.wa-alert` mentah, karena kelas itu menetapkan `width: 100%`. Pada
 *     elemen `fixed` hasilnya selebar layar, bukan sekotak kecil di pojok.
 *   - `animate-in`, karena plugin `tailwindcss-animate` tidak terpasang di
 *     proyek ini sehingga kelasnya tidak menghasilkan animasi apa pun.
 */
export const Toast: React.FC<ToastProps> = ({ toast, onClose, duration = 4000 }) => {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [toast, onClose, duration]);

  if (!toast) return null;

  const gaya = {
    success: 'wa-alert-success',
    error: 'wa-alert-danger',
    info: 'wa-alert-info',
  }[toast.type];

  const ikon = {
    success: <CheckCircle2 className="w-4 h-4 shrink-0" />,
    error: <AlertCircle className="w-4 h-4 shrink-0" />,
    info: <Info className="w-4 h-4 shrink-0" />,
  }[toast.type];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`wa-toast wa-alert ${gaya}`}
    >
      {ikon}
      <span className="flex-1 min-w-0 break-words">{toast.msg}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup notifikasi"
        className="shrink-0 -mr-1 p-0.5 rounded opacity-70 hover:opacity-100 transition-opacity"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
