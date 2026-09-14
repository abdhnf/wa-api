import React, { useState, useEffect } from 'react';
import { Smartphone, Lock, Check, Copy, AlertCircle, RefreshCw, KeyRound, ExternalLink, ShieldCheck, Sparkles, RotateCcw } from 'lucide-react';
import { apiSetBlastPin, apiGetBlastLaunchUrl, apiRegenerateBlastLaunchUrl } from '../api';

interface BlastAccessModalProps {
  isOpen?: boolean;
  onClose: () => void;
  user?: any;
  userHasPin?: boolean;
  onUserUpdated?: () => void;
}

export const BlastAccessModal: React.FC<BlastAccessModalProps> = ({
  isOpen = true,
  onClose,
  user,
  userHasPin,
  onUserUpdated,
}) => {
  const effectiveHasPin = userHasPin ?? user?.hasBlastPin ?? false;
  const [hasPin, setHasPin] = useState(effectiveHasPin);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState<string | null>(null);

  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [isLoadingLaunch, setIsLoadingLaunch] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [regenerateSuccess, setRegenerateSuccess] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && (userHasPin !== undefined || user?.hasBlastPin !== undefined)) {
      setHasPin(userHasPin ?? user?.hasBlastPin ?? false);
    }
  }, [isOpen, userHasPin, user?.hasBlastPin]);

  useEffect(() => {
    if (isOpen && hasPin) {
      loadLaunchLink();
    }
  }, [isOpen, hasPin]);

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
        loadLaunchLink();
      } else {
        setPinError(res?.error || 'Gagal menyimpan PIN keamanan.');
      }
    } catch (err: any) {
      setPinError(err.message || 'Terjadi kesalahan sistem saat menyimpan PIN.');
    } finally {
      setIsSavingPin(false);
    }
  };

  const loadLaunchLink = async () => {
    setIsLoadingLaunch(true);
    setLaunchError(null);
    try {
      const res = await apiGetBlastLaunchUrl();
      if (res && res.success && res.launchUrl) {
        setLaunchUrl(res.launchUrl);
      } else {
        setLaunchError(res?.error || 'Gagal mengambil URL akses peluncuran blast.');
      }
    } catch (err: any) {
      setLaunchError(err.message || 'Koneksi ke backend gateway bermasalah.');
    } finally {
      setIsLoadingLaunch(false);
    }
  };

  const handleRegenerateLink = async () => {
    if (!window.confirm('Apakah Anda yakin ingin membuat ulang link akses? Link akses yang lama tidak akan bisa digunakan lagi.')) {
      return;
    }
    setIsRegenerating(true);
    setLaunchError(null);
    setRegenerateSuccess(null);
    try {
      const res = await apiRegenerateBlastLaunchUrl();
      if (res && res.success && res.launchUrl) {
        setLaunchUrl(res.launchUrl);
        setRegenerateSuccess('Link akses berhasil diperbarui!');
        setTimeout(() => setRegenerateSuccess(null), 3500);
      } else {
        setLaunchError(res?.error || 'Gagal memperbarui URL akses.');
      }
    } catch (err: any) {
      setLaunchError(err.message || 'Terjadi kesalahan saat memperbarui link.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleCopyLink = () => {
    if (!launchUrl) return;
    navigator.clipboard.writeText(launchUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

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
                Link akses terpadu berlaku seterusnya &amp; diproteksi PIN
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-ink-muted hover:text-ink rounded-md hover:bg-surface-alt transition cursor-pointer"
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
                    className="w-full bg-surface-sunken border border-line rounded-md px-3 py-2 text-center text-sm font-mono text-ink tracking-widest focus:outline-hidden focus:border-sea-line"
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
                    className="w-full bg-surface-sunken border border-line rounded-md px-3 py-2 text-center text-sm font-mono text-ink tracking-widest focus:outline-hidden focus:border-sea-line"
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
                <span>{isSavingPin ? 'Menyimpan PIN...' : 'Simpan PIN & Ambil Link Akses'}</span>
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
              className="text-[11px] text-ink-muted hover:text-ink px-2.5 py-1 rounded-md hover:bg-surface-alt transition cursor-pointer"
            >
              Ganti PIN
            </button>
          </div>
        )}

        {/* Section 2: Link Akses Unik (Persistent Launch Link) */}
        {hasPin && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-ink font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-sea" />
                <span>Link Akses WhatsApp Blast</span>
              </span>
              <span className="text-[11px] text-pine font-semibold px-2 py-0.5 rounded-sm bg-pine-wash border border-pine-line/60">
                Berlaku Seterusnya
              </span>
            </div>

            {isLoadingLaunch ? (
              <div className="p-4 bg-surface-sunken border border-line rounded-md flex items-center justify-center gap-2 text-xs text-ink-muted">
                <RefreshCw className="w-4 h-4 animate-spin text-sea" />
                <span>Memuat link akses WhatsApp Blast...</span>
              </div>
            ) : launchError ? (
              <div className="p-3 bg-clay-wash/40 border border-clay-line/50 rounded-md text-xs text-clay-deep flex items-center justify-between">
                <span>{launchError}</span>
                <button
                  onClick={loadLaunchLink}
                  className="px-2.5 py-1 bg-clay-wash hover:bg-clay text-surface rounded-md text-[11px] cursor-pointer"
                >
                  Coba Lagi
                </button>
              </div>
            ) : launchUrl ? (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 p-2 bg-surface-sunken border border-line rounded-md">
                  <div className="flex-1 px-2.5 font-mono text-xs text-ink truncate select-all">
                    {launchUrl}
                  </div>
                  
                  {/* Tombol Copy */}
                  <button
                    onClick={handleCopyLink}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer shrink-0 ${
                      copied
                        ? 'bg-pine text-surface'
                        : 'bg-surface-alt hover:bg-surface-alt text-ink'
                    }`}
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Tersalin' : 'Salin'}</span>
                  </button>
                </div>

                {regenerateSuccess && (
                  <p className="text-xs text-pine font-medium flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    <span>{regenerateSuccess}</span>
                  </p>
                )}

                <div className="flex items-center gap-2 pt-1">
                  {/* Tombol Langsung Buka Dashboard */}
                  <a
                    href={launchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2.5 bg-sea hover:bg-sea-soft text-surface font-bold rounded-md text-xs transition shadow-blue-900/30 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Buka Blast Dashboard</span>
                    <ExternalLink className="w-4 h-4" />
                  </a>

                  {/* Tombol Generate Ulang */}
                  <button
                    type="button"
                    onClick={handleRegenerateLink}
                    disabled={isRegenerating}
                    title="Generate ulang jika link bocor atau ingin membatalkan akses lama"
                    className="px-3 py-2.5 bg-surface-alt hover:bg-surface-alt text-ink text-xs font-medium rounded-md border border-line transition flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                    <span>{isRegenerating ? 'Memperbarui...' : 'Generate Ulang'}</span>
                  </button>
                </div>
              </div>
            ) : null}

            <p className="text-[11px] text-ink-muted leading-relaxed">
              💡 <strong>Cara Kerja:</strong> Simpan atau bookmark link di atas. Link ini berlaku seterusnya dan dapat dibuka kapan saja. Saat dibuka pertama kali di browser baru, masukkan 6-digit PIN untuk otentikasi. Jika link dirasa bocor, cukup klik <strong>Generate Ulang</strong> untuk membatalkan akses sebelumnya.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="pt-2 border-t border-line flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-ink-muted">
            <KeyRound className="w-3.5 h-3.5 text-sea" />
            <span>Host: <code className="text-ink font-mono">172.30.30.229:8085</code></span>
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