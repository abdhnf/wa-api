import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, ExternalLink, Copy, Check, Sparkles, KeyRound, AlertCircle, RefreshCw, Smartphone } from 'lucide-react';
import { apiSetBlastPin, apiGetBlastLaunchUrl } from '../api';

interface BlastAccessModalProps {
 isOpen: boolean;
 onClose: () => void;
 user: any;
 onUserUpdated?: () => void;
}

export const BlastAccessModal: React.FC<BlastAccessModalProps> = ({
 isOpen,
 onClose,
 user,
 onUserUpdated,
}) => {
 const [hasPin, setHasPin] = useState<boolean>(!!user?.hasBlastPin);
 const [pin, setPin] = useState('');
 const [confirmPin, setConfirmPin] = useState('');
 const [isSavingPin, setIsSavingPin] = useState(false);
 const [pinError, setPinError] = useState<string | null>(null);
 const [pinSuccess, setPinSuccess] = useState<string | null>(null);

 const [launchUrl, setLaunchUrl] = useState<string | null>(null);
 const [isLoadingLaunch, setIsLoadingLaunch] = useState(false);
 const [launchError, setLaunchError] = useState<string | null>(null);
 const [copied, setCopied] = useState(false);
 const [expiresIn, setExpiresIn] = useState<number>(600);

 useEffect(() => {
 if (isOpen) {
 setHasPin(!!user?.hasBlastPin);
 setPin('');
 setConfirmPin('');
 setPinError(null);
 setPinSuccess(null);
 setLaunchUrl(null);
 setLaunchError(null);

 // Jika user sudah punya PIN, langsung coba load launch link
 if (user?.hasBlastPin) {
 generateLaunchLink();
 }
 }
 }, [isOpen, user]);

 if (!isOpen) return null;

 const handleSavePin = async (e: React.FormEvent) => {
 e.preventDefault();
 setPinError(null);
 setPinSuccess(null);

 if (!/^\d{6}$/.test(pin)) {
 setPinError('PIN wajib terdiri dari tepat 6 digit angka.');
 return;
 }

 if (pin !== confirmPin) {
 setPinError('Konfirmasi PIN tidak cocok dengan PIN yang dimasukkan.');
 return;
 }

 setIsSavingPin(true);
 try {
 const res = await apiSetBlastPin(pin);
 if (res && res.success) {
 setHasPin(true);
 setPinSuccess('PIN keamanan Blast berhasil disimpan!');
 setPin('');
 setConfirmPin('');
 if (onUserUpdated) onUserUpdated();
 // Langsung generate launch link
 generateLaunchLink();
 } else {
 setPinError(res?.error || 'Gagal menyimpan PIN keamanan.');
 }
 } catch (err: any) {
 setPinError(err.message || 'Terjadi kesalahan sistem saat menyimpan PIN.');
 } finally {
 setIsSavingPin(false);
 }
 };

 const generateLaunchLink = async () => {
 setIsLoadingLaunch(true);
 setLaunchError(null);
 try {
 const res = await apiGetBlastLaunchUrl();
 if (res && res.success && res.launchUrl) {
 setLaunchUrl(res.launchUrl);
 setExpiresIn(res.expiresInSeconds || 600);
 } else {
 setLaunchError(res?.error || 'Gagal membuat URL akses peluncuran blast.');
 }
 } catch (err: any) {
 setLaunchError(err.message || 'Koneksi ke backend gateway bermasalah.');
 } finally {
 setIsLoadingLaunch(false);
 }
 };

 const handleCopyLink = () => {
 if (!launchUrl) return;
 navigator.clipboard.writeText(launchUrl);
 setCopied(true);
 setTimeout(() => setCopied(false), 2000);
 };

 return (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
 {/* Backdrop */}
 <div 
 className="fixed inset-0 bg-ink/80 backdrop-blur-xs"
 onClick={onClose}
 />

 {/* Modal Content */}
 <div className="relative w-full max-w-lg bg-surface border border-line rounded-md p-5 sm:p-6 space-y-5 z-10 animate-in zoom-in-95 duration-150">
 
 {/* Header */}
 <div className="flex items-center justify-between pb-3 border-b border-line">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-md flex items-center justify-center bg-sea-wash/80 border border-sea-line/60 text-sea shadow-blue-950/50">
 <Smartphone className="w-5 h-5" />
 </div>
 <div>
 <h3 className="text-base font-bold text-ink">Akses WhatsApp Blast Dashboard</h3>
 <p className="text-xs text-ink-muted">
 Masuk ke dashboard broadcast via Single-Use Token &amp; PIN
 </p>
 </div>
 </div>
 <button
 onClick={onClose}
 className="p-1.5 text-ink-muted hover:text-surface rounded-md hover:bg-surface-alt transition cursor-pointer"
 >
 ✕
 </button>
 </div>

 {/* Section 1: Cek Status PIN Keamanan */}
 {!hasPin ? (
 <div className="bg-honey-wash/30 border border-honey-line/40 rounded-md p-4 space-y-3">
 <div className="flex items-start gap-2.5">
 <AlertCircle className="w-5 h-5 text-honey shrink-0 mt-0.5" />
 <div>
 <h4 className="text-xs font-bold text-honey-deep">Belum Mengatur PIN Keamanan</h4>
 <p className="text-[11px] text-honey-deep/80 mt-0.5">
 Demi keamanan pengiriman pesan blast, Anda wajib membuat 6-digit PIN terlebih dahulu sebelum mendapatkan link akses dashboard.
 </p>
 </div>
 </div>

 <form onSubmit={handleSavePin} className="space-y-3 pt-2">
 <div className="grid grid-cols-2 gap-2">
 <div>
 <label className="text-[11px] text-ink-muted font-medium block mb-1">
 Buat PIN (6 Angka)
 </label>
 <input
 type="password"
 maxLength={6}
 inputMode="numeric"
 pattern="[0-9]*"
 placeholder="Contoh: 123456"
 value={pin}
 onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
 className="w-full bg-surface-sunken border border-line rounded-md px-3 py-2 text-center text-sm font-mono text-surface tracking-widest focus:outline-hidden focus:border-sea-line"
 required
 />
 </div>
 <div>
 <label className="text-[11px] text-ink-muted font-medium block mb-1">
 Ulangi PIN
 </label>
 <input
 type="password"
 maxLength={6}
 inputMode="numeric"
 pattern="[0-9]*"
 placeholder="Konfirmasi"
 value={confirmPin}
 onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
 className="w-full bg-surface-sunken border border-line rounded-md px-3 py-2 text-center text-sm font-mono text-surface tracking-widest focus:outline-hidden focus:border-sea-line"
 required
 />
 </div>
 </div>

 {pinError && (
 <p className="text-xs text-clay flex items-center gap-1">
 <AlertCircle className="w-3.5 h-3.5 shrink-0" />
 <span>{pinError}</span>
 </p>
 )}

 <button
 type="submit"
 disabled={isSavingPin || pin.length !== 6 || confirmPin.length !== 6}
 className="w-full py-2.5 bg-sea hover:bg-sea-soft disabled:opacity-50 text-surface font-semibold rounded-md text-xs transition flex items-center justify-center gap-2 cursor-pointer"
 >
 <Lock className="w-4 h-4" />
 <span>{isSavingPin ? 'Menyimpan PIN...' : 'Simpan PIN & Buat Link Akses'}</span>
 </button>
 </form>
 </div>
 ) : (
 <div className="bg-pine-wash/30 border border-pine-line/40 rounded-md p-3.5 flex items-center justify-between">
 <div className="flex items-center gap-2.5">
 <ShieldCheck className="w-5 h-5 text-pine shrink-0" />
 <div>
 <span className="text-xs font-bold text-pine-deep block">PIN Keamanan Aktif</span>
 <span className="text-[11px] text-ink-muted">Dashboard diproteksi dengan 6-digit PIN Anda</span>
 </div>
 </div>
 <button
 onClick={() => setHasPin(false)}
 className="text-[11px] text-ink-muted hover:text-surface px-2.5 py-1 rounded-lg hover:bg-surface-alt transition cursor-pointer"
 >
 Ganti PIN
 </button>
 </div>
 )}

 {/* Section 2: Link Akses Unik (Launch Link) */}
 {hasPin && (
 <div className="space-y-3">
 <div className="flex items-center justify-between text-xs">
 <span className="text-ink-soft font-medium flex items-center gap-1.5">
 <Sparkles className="w-3.5 h-3.5 text-sea" />
 <span>One-Time Login Link (Sekali Pakai)</span>
 </span>
 <span className="text-[11px] text-honey font-mono">
 Kedaluwarsa dlm 10 menit
 </span>
 </div>

 {isLoadingLaunch ? (
 <div className="p-4 bg-surface-sunken border border-line rounded-md flex items-center justify-center gap-2 text-xs text-ink-muted">
 <RefreshCw className="w-4 h-4 animate-spin text-sea" />
 <span>Membuat URL akses terenkripsi...</span>
 </div>
 ) : launchError ? (
 <div className="p-3 bg-clay-wash/40 border border-clay-line/50 rounded-md text-xs text-clay-deep flex items-center justify-between">
 <span>{launchError}</span>
 <button
 onClick={generateLaunchLink}
 className="px-2.5 py-1 bg-clay-wash hover:bg-clay text-surface rounded-lg text-[11px] cursor-pointer"
 >
 Coba Lagi
 </button>
 </div>
 ) : launchUrl ? (
 <div className="space-y-2.5">
 <div className="flex items-center gap-2 p-2 bg-surface-sunken border border-line rounded-md">
 <div className="flex-1 px-2.5 font-mono text-xs text-sea-deep truncate select-all">
 {launchUrl}
 </div>
 
 {/* Tombol Copy */}
 <button
 onClick={handleCopyLink}
 className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
 copied
 ? 'bg-pine text-surface'
 : 'bg-surface-alt hover:bg-surface-alt text-ink'
 }`}
 >
 {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
 <span>{copied ? 'Tersalin' : 'Salin'}</span>
 </button>
 </div>

 {/* Tombol Langsung Buka Dashboard */}
 <a
 href={launchUrl}
 target="_blank"
 rel="noopener noreferrer"
 className="w-full py-2.5 bg-sea hover:bg-sea-soft text-surface font-bold rounded-md text-xs transition shadow-blue-900/30 flex items-center justify-center gap-2 cursor-pointer"
 >
 <span>Buka Blast Dashboard Sekarang</span>
 <ExternalLink className="w-4 h-4" />
 </a>
 </div>
 ) : null}

 <p className="text-[11px] text-ink-muted leading-relaxed">
 💡 <strong>Tips Alur:</strong> Klik link di atas untuk membuka Blast Dashboard. Masukkan 6-digit PIN yang telah Anda buat. Setelah lolos, kredensial API Key & kuota akun Anda akan otomatis terhubung tanpa perlu copy-paste manual.
 </p>
 </div>
 )}

 {/* Footer */}
 <div className="pt-2 border-t border-line flex items-center justify-between">
 <div className="flex items-center gap-1.5 text-xs text-ink-muted">
 <KeyRound className="w-3.5 h-3.5 text-sea" />
 <span>Target Host: <code className="text-ink-soft font-mono">172.30.30.229:8085</code></span>
 </div>
 
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
