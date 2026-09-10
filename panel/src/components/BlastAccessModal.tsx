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
        className="fixed inset-0 bg-black/80 backdrop-blur-xs"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-800 rounded-3xl shadow-2xl p-5 sm:p-6 space-y-5 z-10 animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg bg-blue-950/80 border border-blue-800/60 text-blue-400 shadow-blue-950/50">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-100">Akses WhatsApp Blast Dashboard</h3>
              <p className="text-xs text-gray-400">
                Masuk ke dashboard broadcast via Single-Use Token &amp; PIN
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white rounded-xl hover:bg-gray-800 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Section 1: Cek Status PIN Keamanan */}
        {!hasPin ? (
          <div className="bg-amber-950/30 border border-amber-800/40 rounded-2xl p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-amber-300">Belum Mengatur PIN Keamanan</h4>
                <p className="text-[11px] text-amber-200/80 mt-0.5">
                  Demi keamanan pengiriman pesan blast, Anda wajib membuat 6-digit PIN terlebih dahulu sebelum mendapatkan link akses dashboard.
                </p>
              </div>
            </div>

            <form onSubmit={handleSavePin} className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-gray-400 font-medium block mb-1">
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
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-center text-sm font-mono text-white tracking-widest focus:outline-hidden focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400 font-medium block mb-1">
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
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-center text-sm font-mono text-white tracking-widest focus:outline-hidden focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              {pinError && (
                <p className="text-xs text-rose-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{pinError}</span>
                </p>
              )}

              <button
                type="submit"
                disabled={isSavingPin || pin.length !== 6 || confirmPin.length !== 6}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>{isSavingPin ? 'Menyimpan PIN...' : 'Simpan PIN & Buat Link Akses'}</span>
              </button>
            </form>
          </div>
        ) : (
          <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-2xl p-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <span className="text-xs font-bold text-emerald-300 block">PIN Keamanan Aktif</span>
                <span className="text-[11px] text-gray-400">Dashboard diproteksi dengan 6-digit PIN Anda</span>
              </div>
            </div>
            <button
              onClick={() => setHasPin(false)}
              className="text-[11px] text-gray-400 hover:text-white px-2.5 py-1 rounded-lg hover:bg-gray-800 transition cursor-pointer"
            >
              Ganti PIN
            </button>
          </div>
        )}

        {/* Section 2: Link Akses Unik (Launch Link) */}
        {hasPin && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-300 font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                <span>One-Time Login Link (Sekali Pakai)</span>
              </span>
              <span className="text-[11px] text-amber-400 font-mono">
                Kedaluwarsa dlm 10 menit
              </span>
            </div>

            {isLoadingLaunch ? (
              <div className="p-4 bg-gray-950 border border-gray-800 rounded-2xl flex items-center justify-center gap-2 text-xs text-gray-400">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                <span>Membuat URL akses terenkripsi...</span>
              </div>
            ) : launchError ? (
              <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-2xl text-xs text-rose-300 flex items-center justify-between">
                <span>{launchError}</span>
                <button
                  onClick={generateLaunchLink}
                  className="px-2.5 py-1 bg-rose-800 hover:bg-rose-700 text-white rounded-lg text-[11px] cursor-pointer"
                >
                  Coba Lagi
                </button>
              </div>
            ) : launchUrl ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 p-2 bg-gray-950 border border-gray-800 rounded-2xl">
                  <div className="flex-1 px-2.5 font-mono text-xs text-blue-300 truncate select-all">
                    {launchUrl}
                  </div>
                  
                  {/* Tombol Copy */}
                  <button
                    onClick={handleCopyLink}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
                      copied
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
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
                  className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl text-xs transition shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Buka Blast Dashboard Sekarang</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            ) : null}

            <p className="text-[11px] text-gray-400 leading-relaxed">
              💡 <strong>Tips Alur:</strong> Klik link di atas untuk membuka Blast Dashboard. Masukkan 6-digit PIN yang telah Anda buat. Setelah lolos, kredensial API Key & kuota akun Anda akan otomatis terhubung tanpa perlu copy-paste manual.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <KeyRound className="w-3.5 h-3.5 text-blue-400" />
            <span>Target Host: <code className="text-gray-300 font-mono">172.30.30.229:8085</code></span>
          </div>
          
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
