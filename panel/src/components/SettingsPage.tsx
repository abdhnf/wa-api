import React, { useState, useEffect } from 'react';
import { Settings, Shield, KeyRound, UserPlus, CheckCircle2, AlertCircle, Loader2, HelpCircle, Copy, Check } from 'lucide-react';
import { apiGetSettings, apiUpdateSettings } from '../api';

export const SettingsPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [googleAllowedDomains, setGoogleAllowedDomains] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [turnstileEnabled, setTurnstileEnabled] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
  const [turnstileSecretKey, setTurnstileSecretKey] = useState('');
  const [hasTurnstileSecret, setHasTurnstileSecret] = useState(false);
  const [copiedVal, setCopiedVal] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedVal(id);
    setTimeout(() => setCopiedVal(null), 2000);
  };

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => { loadSettings(); }, []);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await apiGetSettings();
      if (res?.settings) {
        setGoogleAuthEnabled(Boolean(res.settings.googleAuthEnabled));
        setGoogleClientId(res.settings.googleClientId || '');
        setGoogleClientSecret(res.settings.googleClientSecret || '');
        setGoogleAllowedDomains(res.settings.googleAllowedDomains || '');
        setHasSecret(Boolean(res.settings.hasClientSecret));
        setRegistrationEnabled(Boolean(res.settings.registrationEnabled));
        setTurnstileEnabled(Boolean(res.settings.turnstileEnabled));
        setTurnstileSiteKey(res.settings.turnstileSiteKey || '');
        setTurnstileSecretKey(res.settings.turnstileSecretKey || '');
        setHasTurnstileSecret(Boolean(res.settings.hasTurnstileSecret));
      }
    } catch (err: any) {
      showToast(err?.message || 'Gagal memuat pengaturan', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiUpdateSettings({ googleAuthEnabled, googleClientId, googleClientSecret, registrationEnabled, turnstileEnabled, turnstileSiteKey, turnstileSecretKey, googleAllowedDomains });
      showToast('Pengaturan sistem berhasil disimpan!', 'success');
      loadSettings();
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan pengaturan', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center py-20 text-gray-400'>
        <Loader2 className='w-7 h-7 animate-spin mr-3 text-emerald-500' />
        <span className='text-sm font-medium'>Memuat konfigurasi gateway...</span>
      </div>
    );
  }

  const originUrl = window.location.origin;

  return (
    <div className='max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200'>
      {toast && (
        <div className={'fixed bottom-5 right-5 z-[100] px-4 py-3 rounded-2xl shadow-2xl text-sm font-semibold flex items-center gap-2 ' + (toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white')}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}
      <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-800 pb-5'>
        <div>
          <h2 className='text-xl font-bold text-gray-100 flex items-center gap-2.5'>
            <Settings className='w-5 h-5 text-emerald-400' />
            Pengaturan Sistem & Autentikasi
          </h2>
          <p className='text-xs text-gray-400 mt-1'>
            Kelola autentikasi Google OAuth dan izin registrasi akun publik.
          </p>
        </div>
        <button onClick={handleSave} disabled={saving} className='flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer'>
          {saving ? <Loader2 className='w-4 h-4 animate-spin' /> : <CheckCircle2 className='w-4 h-4' />}
          Simpan Pengaturan
        </button>
      </div>

      <form onSubmit={handleSave} className='space-y-6'>
        <div className='bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-4'>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex items-start gap-3'>
              <div className='p-2.5 rounded-xl bg-emerald-950/50 border border-emerald-800/40 text-emerald-400'>
                <UserPlus size={20} />
              </div>
              <div>
                <h3 className='text-sm font-semibold text-gray-200'>Pendaftaran Akun Publik</h3>
                <p className='text-xs text-gray-400 mt-0.5'>Izinkan pengguna luar mendaftar akun baru melalui form panel.</p>
              </div>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input type='checkbox' checked={registrationEnabled} onChange={(e) => setRegistrationEnabled(e.target.checked)} className='sr-only peer' />
              <div className="w-11 h-6 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>
          <div className='text-xs text-gray-400 bg-gray-950/60 border border-gray-800/80 rounded-xl p-3'>
            <span className='font-semibold text-gray-300'>Info:</span> Jika dinonaktifkan, pembuatan akun hanya bisa dilakukan oleh Administrator via menu Users & Keys.
          </div>
        </div>

        <div className='bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-5'>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex items-start gap-3'>
              <div className='p-2.5 rounded-xl bg-blue-950/50 border border-blue-800/40 text-blue-400'>
                <Shield size={20} />
              </div>
              <div>
                <h3 className='text-sm font-semibold text-gray-200'>Google OAuth 2.0 Sign-In</h3>
                <p className='text-xs text-gray-400 mt-0.5'>Izinkan login langsung menggunakan akun Google.</p>
              </div>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input type='checkbox' checked={googleAuthEnabled} onChange={(e) => setGoogleAuthEnabled(e.target.checked)} className='sr-only peer' />
              <div className="w-11 h-6 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
            </label>
          </div>

          {googleAuthEnabled && (
            <div className='space-y-4 pt-2 border-t border-gray-800/60'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <div>
                  <label className='block text-xs font-semibold text-gray-300 mb-1.5'>Google Client ID</label>
                  <input type='text' value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} placeholder='xxxx.apps.googleusercontent.com' className='w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 font-mono' />
                </div>
                <div>
                  <label className='block text-xs font-semibold text-gray-300 mb-1.5 flex items-center justify-between'>
                    <span>Google Client Secret</span>
                    {hasSecret && <span className='text-[10px] text-emerald-400'>Tersimpan</span>}
                  </label>
                  <input type='password' value={googleClientSecret} onChange={(e) => setGoogleClientSecret(e.target.value)} placeholder={hasSecret ? '•••••••• (Biarkan jika tidak ingin ganti)' : 'GOCSPX-xxxx...'} className='w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 font-mono' />
                </div>
              </div>

              <div>
                <label className='block text-xs font-semibold text-gray-300 mb-1.5 flex items-center justify-between'>
                  <span>Email / Domain Whitelist (Opsional)</span>
                  <span className='text-[10px] text-gray-400'>Proteksi Akses Domain</span>
                </label>
                <input
                  type='text'
                  value={googleAllowedDomains}
                  onChange={(e) => setGoogleAllowedDomains(e.target.value)}
                  placeholder='abdhnf.com, kantor.id, vip@gmail.com'
                  className='w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 font-mono'
                />
                <p className='text-[11px] text-gray-400 mt-1'>
                  Batasi login Google hanya untuk domain atau email tertentu. Pisahkan dengan koma atau spasi (contoh: <span className='text-emerald-400 font-mono'>abdhnf.com, mitra.co.id</span>). Kosongkan jika ingin mengizinkan semua akun.
                </p>
              </div>
              <div className='bg-gray-950/90 border border-gray-800/80 rounded-xl p-4 text-xs space-y-3'>
                <div className='flex items-center gap-2 text-gray-200 font-semibold'>
                  <HelpCircle size={15} className='text-blue-400 shrink-0' />
                  <span>Panduan Konfigurasi di Google Cloud Console (OAuth 2.0 Client ID)</span>
                </div>
                <p className='text-[11px] text-gray-400 leading-relaxed'>
                  Saat membuat atau mengedit <span className='text-gray-200 font-medium'>OAuth 2.0 Client ID (Web application)</span> di Google Cloud Console, masukkan nilai-nilai berikut:
                </p>

                {/* 1. Authorized JavaScript origins */}
                <div className='space-y-1'>
                  <div className='flex items-center justify-between text-[11px]'>
                    <span className='text-gray-300 font-medium'>1. Authorized JavaScript origins:</span>
                    <button
                      type='button'
                      onClick={() => copyToClipboard(originUrl, 'origin')}
                      className='flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer text-[10px] font-medium'
                    >
                      {copiedVal === 'origin' ? <Check size={12} /> : <Copy size={12} />}
                      <span>{copiedVal === 'origin' ? 'Tersalin' : 'Salin'}</span>
                    </button>
                  </div>
                  <div className='font-mono text-[11px] bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-emerald-400 select-all break-all'>
                    {originUrl}
                  </div>
                </div>

                {/* 2. Authorized redirect URIs */}
                <div className='space-y-1.5 pt-1'>
                  <div className='text-gray-300 font-medium text-[11px]'>
                    2. Authorized redirect URIs (Masukkan kedua URI ini):
                  </div>

                  <div className='space-y-1.5'>
                    <div className='flex items-center justify-between font-mono text-[11px] bg-gray-900 border border-gray-800 rounded-lg px-3 py-2'>
                      <span className='text-gray-200 select-all break-all'>{originUrl}</span>
                      <button
                        type='button'
                        onClick={() => copyToClipboard(originUrl, 'redirect1')}
                        className='flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer text-[10px] font-medium shrink-0 ml-2'
                      >
                        {copiedVal === 'redirect1' ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedVal === 'redirect1' ? 'Tersalin' : 'Salin'}</span>
                      </button>
                    </div>

                    <div className='flex items-center justify-between font-mono text-[11px] bg-gray-900 border border-gray-800 rounded-lg px-3 py-2'>
                      <span className='text-gray-200 select-all break-all'>{`${originUrl}/api/v1/auth/google/callback`}</span>
                      <button
                        type='button'
                        onClick={() => copyToClipboard(`${originUrl}/api/v1/auth/google/callback`, 'redirect2')}
                        className='flex items-center gap-1 text-emerald-400 hover:text-emerald-300 cursor-pointer text-[10px] font-medium shrink-0 ml-2'
                      >
                        {copiedVal === 'redirect2' ? <Check size={12} /> : <Copy size={12} />}
                        <span>{copiedVal === 'redirect2' ? 'Tersalin' : 'Salin'}</span>
                      </button>
                    </div>
                  </div>
                  <p className='text-[10px] text-gray-500'>
                    Tip: Google Identity Services (GIS popup) membutuhkan origin URL di atas. URI callback backend disediakan sebagai pelengkap standar OAuth2.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      
        {/* Cloudflare Turnstile CAPTCHA */}
        <div className='bg-gray-900/60 border border-gray-800 rounded-2xl p-5 space-y-5'>
          <div className='flex items-start justify-between gap-4'>
            <div className='flex items-start gap-3'>
              <div className='p-2.5 rounded-xl bg-amber-950/50 border border-amber-800/40 text-amber-400'>
                <Shield size={20} />
              </div>
              <div>
                <h3 className='text-sm font-semibold text-gray-200'>Cloudflare Turnstile (CAPTCHA)</h3>
                <p className='text-xs text-gray-400 mt-0.5'>Proteksi form login dari bot otomatis dan brute force attack.</p>
              </div>
            </div>
            <label className='relative inline-flex items-center cursor-pointer'>
              <input
                type='checkbox'
                checked={turnstileEnabled}
                onChange={(e) => setTurnstileEnabled(e.target.checked)}
                className='sr-only peer'
              />
              <div className="w-11 h-6 bg-gray-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-600"></div>
            </label>
          </div>

          {turnstileEnabled && (
            <div className='space-y-4 pt-2 border-t border-gray-800/60'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <div>
                  <label className='block text-xs font-semibold text-gray-300 mb-1.5'>Site Key (Public)</label>
                  <input
                    type='text'
                    value={turnstileSiteKey}
                    onChange={(e) => setTurnstileSiteKey(e.target.value)}
                    placeholder='0x4AAAAAA...'
                    className='w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-amber-500 font-mono'
                  />
                </div>
                <div>
                  <label className='block text-xs font-semibold text-gray-300 mb-1.5 flex items-center justify-between'>
                    <span>Secret Key (Private)</span>
                    {hasTurnstileSecret && <span className='text-[10px] text-amber-400 font-mono'>Tersimpan</span>}
                  </label>
                  <input
                    type='password'
                    value={turnstileSecretKey}
                    onChange={(e) => setTurnstileSecretKey(e.target.value)}
                    placeholder={hasTurnstileSecret ? '•••••••• (Biarkan jika tidak ingin ganti)' : '0x4AAAAAA...'}
                    className='w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-xs text-gray-200 focus:outline-none focus:border-amber-500 font-mono'
                  />
                </div>
              </div>
              <div className='bg-gray-950/80 border border-gray-800 rounded-xl p-4 text-xs space-y-1.5 text-gray-400'>
                <div className='flex items-center gap-2 text-gray-300 font-semibold'>
                  <HelpCircle size={14} className='text-amber-400' />
                  Cara Mendapatkan Kunci Turnstile:
                </div>
                <p className='text-[11px] leading-relaxed'>
                  Buka <b>Cloudflare Dashboard &gt; Turnstile &gt; Add Site</b>. Pilih widget mode (<i>Managed</i> atau <i>Non-interactive</i>), lalu copy <b>Site Key</b> dan <b>Secret Key</b> ke kolom di atas.
                </p>
              </div>
            </div>
          )}
        </div>

      </form>
    </div>
  );
};
