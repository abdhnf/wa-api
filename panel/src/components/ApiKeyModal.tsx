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
        className="fixed inset-0 bg-black/80 backdrop-blur-xs"
        onClick={onClose}
      />

      {/* Modal Box */}
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl shadow-2xl p-5 sm:p-6 space-y-5 z-10 animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg ${
              isAdmin 
                ? 'bg-purple-950/80 border border-purple-800/60 text-purple-300 shadow-purple-950/50' 
                : isSubscription 
                  ? 'bg-amber-950/80 border border-amber-800/60 text-amber-300 shadow-amber-950/50'
                  : 'bg-emerald-950/80 border border-emerald-800/60 text-emerald-400 shadow-emerald-950/50'
            }`}>
              {isAdmin ? <ShieldCheck className="w-5 h-5" /> : isSubscription ? <Sparkles className="w-5 h-5" /> : <KeyRound className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-gray-100">API Key & Kuota Akun</h3>
                {isAdmin ? (
                  <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800/60 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                    Super Admin
                  </span>
                ) : isSubscription ? (
                  <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800/60 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-2.5 h-2.5" /> Subscription
                  </span>
                ) : (
                  <span className="text-[10px] bg-blue-950 text-blue-300 border border-blue-800/60 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                    Free Tier
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400">
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
            className="p-1.5 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* API Key Box */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400 font-medium">Header Kredensial: <code className="text-emerald-400 font-mono">X-API-Key</code></span>
            <span className="text-[11px] text-gray-500">Jangan bagikan key ini ke pihak luar</span>
          </div>

          <div className="flex items-center gap-2 p-2 bg-gray-950 border border-gray-800 rounded-2xl">
            <div className="flex-1 px-2.5 font-mono text-xs text-gray-200 truncate select-all">
              {showKey ? rawKey : maskedKey}
            </div>
            
            {/* Show/Hide */}
            <button
              onClick={() => setShowKey(!showKey)}
              className="p-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800/80 rounded-xl transition cursor-pointer"
              title={showKey ? 'Sembunyikan' : 'Tampilkan'}
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>

            {/* Copy Button */}
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition shadow-xs cursor-pointer ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-950/80 text-emerald-400 hover:bg-emerald-900 border border-emerald-800/60'
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
              <div className="flex items-center gap-2 w-full bg-amber-950/40 border border-amber-800/50 p-2.5 rounded-xl animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="text-[11px] text-amber-200 flex-1">
                  Key lama akan langsung hangus! Yakin rotasi?
                </div>
                <button
                  onClick={handleRotate}
                  disabled={rotating}
                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs transition disabled:opacity-50 cursor-pointer"
                >
                  {rotating ? 'Memproses...' : 'Ya, Rotasi'}
                </button>
                <button
                  onClick={() => setConfirmRotate(false)}
                  className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs transition cursor-pointer"
                >
                  Batal
                </button>
              </div>
            ) : (
              <button
                onClick={handleRotate}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-amber-400 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Rotasi API Key Baru</span>
              </button>
            )}
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>

        {/* Kuota Penggunaan */}
        <div className="bg-gray-950/60 border border-gray-800/80 rounded-2xl p-4 space-y-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-gray-300">
            <span>Status Kuota Pengiriman</span>
            <span className="text-[11px] font-normal text-gray-400 font-mono">Reset jam 00:00 WIB</span>
          </div>

          {isAdmin ? (
            /* Tampilan Khusus Admin (Unlimited Bebas Kuota) */
            <div className="bg-purple-950/30 border border-purple-800/40 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-purple-300">
                  <InfinityIcon className="w-4 h-4 text-purple-400" />
                  <span>Bebas Kuota (Unlimited Pesan)</span>
                </div>
                <span className="text-[11px] text-gray-400 font-mono">
                  {usedToday} pesan terkirim hari ini
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-emerald-400 w-full" />
              </div>
              <p className="text-[11px] text-gray-400">
                Sebagai Administrator, sistem tidak membatasi kuota kirim harian maupun mingguan.
              </p>
            </div>
          ) : (
            /* Tampilan User Subscription & Free */
            <div className="space-y-3">
              {/* Hari ini */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Hari Ini:</span>
                  <span className="font-semibold text-gray-200 font-mono">
                    {usedToday} <span className="text-gray-500">/</span> {quotaPerDay.toLocaleString('id-ID')} <span className="text-gray-400 text-[11px]">pesan</span>
                  </span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      todayPct > 90 ? 'bg-rose-500' : todayPct > 70 ? 'bg-amber-500' : isSubscription ? 'bg-amber-400' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${todayPct}%` }}
                  />
                </div>
              </div>

              {/* Minggu ini */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Minggu Ini:</span>
                  <span className="font-semibold text-gray-200 font-mono">
                    {usedWeek} <span className="text-gray-500">/</span> {quotaWeek.toLocaleString('id-ID')} <span className="text-gray-400 text-[11px]">pesan</span>
                  </span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${weekPct}%` }}
                  />
                </div>
              </div>

              {isSubscription && (
                <div className="pt-1 flex items-center gap-1.5 text-[11px] text-amber-300/80">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>Akun Anda terdaftar pada tier langganan kuota khusus.</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Shortcut */}
        <div className="pt-2 border-t border-gray-800 flex items-center justify-between">
          <button
            onClick={() => {
              onClose();
              onOpenDocs();
            }}
            className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-medium transition cursor-pointer"
          >
            <span>Buka Dokumentasi & Contoh cURL</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl text-xs font-semibold transition cursor-pointer"
          >
            Tutup
          </button>
        </div>

      </div>
    </div>
  );
};
