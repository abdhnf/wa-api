import React, { useState } from 'react';
import { KeyRound, Copy, Check, Eye, EyeOff, RotateCcw, AlertTriangle, X, ExternalLink, ShieldCheck, Sparkles, Infinity as InfinityIcon } from 'lucide-react';
import { apiRotateMyKey } from '../api';

interface ApiKeyModalProps {
 isOpen: boolean;
 onClose: () => void;
 user: any;
 onKeyRotated: (newKey: string) => void;
 onOpenDocs: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
 isOpen,
 onClose,
 user,
 onKeyRotated,
 onOpenDocs,
}) => {
 const [showKey, setShowKey] = useState(false);
 const [copied, setCopied] = useState(false);
 const [rotating, setRotating] = useState(false);
 const [confirmRotate, setConfirmRotate] = useState(false);
 const [error, setError] = useState<string | null>(null);

 if (!isOpen) return null;

 const rawKey = user?.apiKey || localStorage.getItem('wa_api_key') || 'wa_live_not_generated';
 const maskedKey = rawKey.length > 16 
 ? `${rawKey.slice(0, 10)}${'•'.repeat(18)}${rawKey.slice(-4)}`
 : '••••••••••••••••••••••••';

 const handleCopy = () => {
 navigator.clipboard.writeText(rawKey);
 setCopied(true);
 setTimeout(() => setCopied(false), 2000);
 };

 const handleRotate = async () => {
 if (!confirmRotate) {
 setConfirmRotate(true);
 return;
 }

 setRotating(true);
 setError(null);
 try {
 const res = await apiRotateMyKey();
 if (res && res.apiKey) {
 onKeyRotated(res.apiKey);
 setConfirmRotate(false);
 } else {
 setError(res?.error || 'Gagal merotasi API Key');
 }
 } catch (e: any) {
 setError(e.message || 'Terjadi kesalahan saat rotasi key');
 } finally {
 setRotating(false);
 }
 };

 const role = user?.role || 'user';
 const isAdmin = role === 'admin';
 const isSubscription = role === 'subscription';

 const usedToday = user?.usedToday || 0;
 const quotaPerDay = user?.quotaPerDay || (isAdmin ? 100000 : isSubscription ? 1000 : 100);
 const todayPct = isAdmin ? 100 : Math.min(100, Math.round((usedToday / quotaPerDay) * 100));

 // Kuota mingguan disinkronkan (default: 7x harian bila tidak ada)
 const usedWeek = user?.usedThisWeek || 0;
 const rawQuotaWeek = user?.quotaPerWeek || user?.quotaLimit;
 const quotaWeek = (rawQuotaWeek && rawQuotaWeek >= quotaPerDay) ? rawQuotaWeek : (quotaPerDay * 7);
 const weekPct = isAdmin ? 100 : Math.min(100, Math.round((usedWeek / quotaWeek) * 100));

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
 {/* Backdrop */}
 <div 
 className="fixed inset-0 bg-ink/80 backdrop-blur-xs"
 onClick={onClose}
 />

 {/* Modal Box */}
 <div className="relative w-full max-w-lg bg-surface border border-line rounded-md p-5 sm:p-6 space-y-5 z-10 animate-in zoom-in-95 duration-150">
 
 {/* Header */}
 <div className="flex items-center justify-between pb-3 border-b border-line">
 <div className="flex items-center gap-3">
 <div className={`w-10 h-10 rounded-md flex items-center justify-center ${
 isAdmin 
 ? 'bg-sea-wash/80 border border-sea-line/60 text-sea-deep shadow-purple-950/50' 
 : isSubscription 
 ? 'bg-honey-wash/80 border border-honey-line/60 text-honey-deep shadow-amber-950/50'
 : 'bg-pine-wash/80 border border-pine-line/60 text-pine '
 }`}>
 {isAdmin ? <ShieldCheck className="w-5 h-5" /> : isSubscription ? <Sparkles className="w-5 h-5" /> : <KeyRound className="w-5 h-5" />}
 </div>
 <div>
 <div className="flex items-center gap-2">
 <h3 className="text-base font-bold text-ink">API Key & Kuota Akun</h3>
 {isAdmin ? (
 <span className="text-[10px] bg-sea-wash text-sea-deep border border-sea-line/60 px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider">
 Super Admin
 </span>
 ) : isSubscription ? (
 <span className="text-[10px] bg-honey-wash text-honey-deep border border-honey-line/60 px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider flex items-center gap-1">
 <Sparkles className="w-2.5 h-2.5" /> Subscription
 </span>
 ) : (
 <span className="text-[10px] bg-sea-wash text-sea-deep border border-sea-line/60 px-2 py-0.5 rounded-sm font-bold uppercase tracking-wider">
 Free Tier
 </span>
 )}
 </div>
 <p className="text-xs text-ink-muted">
 {isAdmin 
 ? 'Akses penuh tanpa limitasi kuota gateway' 
 : isSubscription 
 ? 'Paket langganan kuota pesan kustom' 
 : 'Paket dasar pesan gratis gateway'}
 </p>
 </div>
 </div>
 <button
 onClick={onClose}
 className="p-1.5 text-ink-muted hover:text-surface rounded-md hover:bg-surface-alt transition cursor-pointer"
 >
 <X className="w-5 h-5" />
 </button>
 </div>

 {/* API Key Box */}
 <div className="space-y-2">
 <div className="flex items-center justify-between text-xs">
 <span className="text-ink-muted font-medium">Header Kredensial: <code className="text-pine font-mono">X-API-Key</code></span>
 <span className="text-[11px] text-ink-faint">Jangan bagikan key ini ke pihak luar</span>
 </div>

 <div className="flex items-center gap-2 p-2 bg-surface-sunken border border-line rounded-md">
 <div className="flex-1 px-2.5 font-mono text-xs text-ink truncate select-all">
 {showKey ? rawKey : maskedKey}
 </div>
 
 {/* Show/Hide */}
 <button
 onClick={() => setShowKey(!showKey)}
 className="p-2 text-ink-muted hover:text-ink hover:bg-surface-alt/80 rounded-md transition cursor-pointer"
 title={showKey ? 'Sembunyikan' : 'Tampilkan'}
 >
 {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
 </button>

 {/* Copy Button */}
 <button
 onClick={handleCopy}
 className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
 copied
 ? 'bg-pine text-surface'
 : 'bg-pine-wash/80 text-pine hover:bg-pine-wash border border-pine-line/60'
 }`}
 >
 {copied ? (
 <>
 <Check className="w-3.5 h-3.5" />
 <span>Tersalin!</span>
 </>
 ) : (
 <>
 <Copy className="w-3.5 h-3.5" />
 <span>Salin</span>
 </>
 )}
 </button>
 </div>

 {/* Tombol & Warning Rotasi Key */}
 <div className="pt-1 flex items-center justify-between">
 {confirmRotate ? (
 <div className="flex items-center gap-2 w-full bg-honey-wash/40 border border-honey-line/50 p-2.5 rounded-md animate-in fade-in">
 <AlertTriangle className="w-4 h-4 text-honey shrink-0" />
 <div className="text-[11px] text-honey-deep flex-1">
 Key lama akan langsung hangus! Yakin rotasi?
 </div>
 <button
 onClick={handleRotate}
 disabled={rotating}
 className="px-2.5 py-1 bg-honey hover:bg-honey text-surface font-bold rounded-lg text-xs transition disabled:opacity-50 cursor-pointer"
 >
 {rotating ? 'Memproses...' : 'Ya, Rotasi'}
 </button>
 <button
 onClick={() => setConfirmRotate(false)}
 className="px-2 py-1 bg-surface-alt hover:bg-surface-alt text-ink-soft rounded-lg text-xs transition cursor-pointer"
 >
 Batal
 </button>
 </div>
 ) : (
 <button
 onClick={handleRotate}
 className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-honey transition cursor-pointer"
 >
 <RotateCcw className="w-3.5 h-3.5" />
 <span>Rotasi API Key Baru</span>
 </button>
 )}
 </div>
 {error && <p className="text-xs text-clay">{error}</p>}
 </div>

 {/* Kuota Penggunaan */}
 <div className="bg-surface-sunken/60 border border-line/80 rounded-md p-4 space-y-3.5">
 <div className="flex items-center justify-between text-xs font-bold text-ink-soft">
 <span>Status Kuota Pengiriman</span>
 <span className="text-[11px] font-normal text-ink-muted font-mono">Reset jam 00:00 WIB</span>
 </div>

 {isAdmin ? (
 /* Tampilan Khusus Admin (Unlimited Bebas Kuota) */
 <div className="bg-sea-wash/30 border border-sea-line/40 rounded-md p-3.5 space-y-2">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2 text-xs font-semibold text-sea-deep">
 <InfinityIcon className="w-4 h-4 text-sea" />
 <span>Bebas Kuota (Unlimited Pesan)</span>
 </div>
 <span className="text-[11px] text-ink-muted font-mono">
 {usedToday} pesan terkirim hari ini
 </span>
 </div>
 <div className="w-full bg-surface-alt rounded-sm h-2 overflow-hidden">
 <div className="h-full rounded-sm bg-pine w-full" />
 </div>
 <p className="text-[11px] text-ink-muted">
 Sebagai Administrator, sistem tidak membatasi kuota kirim harian maupun mingguan.
 </p>
 </div>
 ) : (
 /* Tampilan User Subscription & Free */
 <div className="space-y-3">
 {/* Hari ini */}
 <div className="space-y-1.5">
 <div className="flex justify-between text-xs">
 <span className="text-ink-muted">Hari Ini:</span>
 <span className="font-semibold text-ink font-mono">
 {usedToday} <span className="text-ink-faint">/</span> {quotaPerDay.toLocaleString('id-ID')} <span className="text-ink-muted text-[11px]">pesan</span>
 </span>
 </div>
 <div className="w-full bg-surface-alt rounded-sm h-2 overflow-hidden">
 <div
 className={`h-full rounded-sm transition-all duration-500 ${
 todayPct > 90 ? 'bg-clay' : todayPct > 70 ? 'bg-honey' : isSubscription ? 'bg-honey' : 'bg-pine-soft'
 }`}
 style={{ width: `${todayPct}%` }}
 />
 </div>
 </div>

 {/* Minggu ini */}
 <div className="space-y-1.5">
 <div className="flex justify-between text-xs">
 <span className="text-ink-muted">Minggu Ini:</span>
 <span className="font-semibold text-ink font-mono">
 {usedWeek} <span className="text-ink-faint">/</span> {quotaWeek.toLocaleString('id-ID')} <span className="text-ink-muted text-[11px]">pesan</span>
 </span>
 </div>
 <div className="w-full bg-surface-alt rounded-sm h-2 overflow-hidden">
 <div
 className="h-full rounded-sm bg-sea-soft transition-all duration-500"
 style={{ width: `${weekPct}%` }}
 />
 </div>
 </div>

 {isSubscription && (
 <div className="pt-1 flex items-center gap-1.5 text-[11px] text-honey-deep/80">
 <Sparkles className="w-3.5 h-3.5 text-honey" />
 <span>Akun Anda terdaftar pada tier langganan kuota khusus.</span>
 </div>
 )}
 </div>
 )}
 </div>

 {/* Footer Shortcut */}
 <div className="pt-2 border-t border-line flex items-center justify-between">
 <button
 onClick={() => {
 onClose();
 onOpenDocs();
 }}
 className="flex items-center gap-1.5 text-xs text-pine hover:text-pine-deep font-medium transition cursor-pointer"
 >
 <span>Buka Dokumentasi & Contoh cURL</span>
 <ExternalLink className="w-3.5 h-3.5" />
 </button>
 
 <button
 onClick={onClose}
 className="px-4 py-2 bg-surface-alt hover:bg-surface-alt text-ink rounded-md text-xs font-semibold transition cursor-pointer"
 >
 Tutup
 </button>
 </div>

 </div>
 </div>
 );
};
