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

export const Toast: React.FC<ToastProps> = ({ toast, onClose, duration = 3500 }) => {
 useEffect(() => {
 if (!toast) return;
 const timer = setTimeout(() => {
 onClose();
 }, duration);
 return () => clearTimeout(timer);
 }, [toast, onClose, duration]);

 if (!toast) return null;

 const bgStyles = {
 success: 'bg-pine-wash/95 border-pine-line/60 text-pine-deep ',
 error: 'bg-clay-wash/95 border-clay-line/60 text-clay-deep shadow-rose-950/50',
 info: 'bg-surface/95 border-line-strong/80 text-ink shadow-black/60',
 }[toast.type];

 const icon = {
 success: <CheckCircle2 className="w-4 h-4 text-pine shrink-0" />,
 error: <AlertCircle className="w-4 h-4 text-clay shrink-0" />,
 info: <Info className="w-4 h-4 text-sea shrink-0" />,
 }[toast.type];

 return (
 <div className="fixed bottom-5 right-5 z-[200] max-w-sm w-full animate-in slide-in-from-bottom-5 fade-in duration-200">
 <div className={`flex items-start gap-3 p-3.5 rounded-md border backdrop-blur-md ${bgStyles}`}>
 <div className="pt-0.5">{icon}</div>
 <div className="flex-1 text-xs leading-relaxed font-medium">
 {toast.msg}
 </div>
 <button
 onClick={onClose}
 className="text-ink-muted hover:text-surface p-0.5 rounded-md transition-colors shrink-0"
 >
 <X className="w-3.5 h-3.5" />
 </button>
 </div>
 </div>
 );
};
