import React, { useState, useEffect, useRef } from 'react';
import { Lock, Mail, Shield, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { apiLogin, apiRegister, apiGetAuthConfig, apiLoginGoogle } from '../api';

interface AuthPageProps {
  onLoginSuccess: (user: { name: string; email: string }) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onLoginSuccess }) => {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authConfig, setAuthConfig] = useState<{
    googleAuthEnabled: boolean;
    googleClientId: string;
    registrationEnabled: boolean;
    turnstileEnabled?: boolean;
    turnstileSiteKey?: string;
  }>({
    googleAuthEnabled: false,
    googleClientId: '',
    registrationEnabled: true,
    turnstileEnabled: false,
    turnstileSiteKey: '',
  });
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileWidgetRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    apiGetAuthConfig()
      .then(cfg => {
        if (cfg) setAuthConfig(cfg);
      })
      .catch(() => {});
  }, []);


  // Load & render Cloudflare Turnstile widget
  useEffect(() => {
    if (!authConfig.turnstileEnabled || !authConfig.turnstileSiteKey) return;

    // Load Turnstile script jika belum ada
    const scriptId = 'cf-turnstile-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    const renderWidget = () => {
      const w = (window as any).turnstile;
      if (w && turnstileWidgetRef.current && !widgetIdRef.current) {
        try {
          widgetIdRef.current = w.render(turnstileWidgetRef.current, {
            sitekey: authConfig.turnstileSiteKey,
            theme: 'dark',
            callback: (token: string) => {
              setTurnstileToken(token);
            },
            'expired-callback': () => {
              setTurnstileToken('');
            },
            'error-callback': () => {
              setTurnstileToken('');
            },
          });
        } catch (e) {
          console.error('Turnstile render error', e);
        }
      }
    };

    const interval = setInterval(() => {
      if ((window as any).turnstile) {
        clearInterval(interval);
        renderWidget();
      }
    }, 150);

    return () => {
      clearInterval(interval);
      if (widgetIdRef.current && (window as any).turnstile) {
        try {
          (window as any).turnstile.remove(widgetIdRef.current);
        } catch {}
        widgetIdRef.current = null;
      }
    };
  }, [authConfig.turnstileEnabled, authConfig.turnstileSiteKey, isRegister]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isRegister) {
        if (!authConfig.registrationEnabled) {
          throw new Error('Pendaftaran akun baru ditutup oleh Administrator.');
        }
        await apiRegister(name, email, password);
      }
      const res = await apiLogin(email.trim().toLowerCase(), password, turnstileToken || undefined);
      setLoading(false);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Gagal masuk. Periksa email dan password.');
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      if (!authConfig.googleClientId) {
        throw new Error('Google Client ID belum dikonfigurasi di menu Settings Admin.');
      }
      // Demo placeholder / trigger google OAuth
      throw new Error('Silakan pasang Google Client ID yang valid di panel Settings.');
    } catch (err: any) {
      setLoading(false);
      setError(err.message);
    }
  };

  return (
    <div className='min-h-screen bg-gray-950 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-12 relative overflow-hidden'>
      <div className='absolute w-[450px] h-[450px] bg-emerald-600/10 rounded-full blur-3xl -top-24 -left-24 pointer-events-none' />
      <div className='absolute w-[450px] h-[450px] bg-blue-600/10 rounded-full blur-3xl -bottom-24 -right-24 pointer-events-none' />

      <div className='w-full max-w-md space-y-6 relative z-10'>
        <div className='text-center space-y-2'>
          <div className='inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-600 text-white font-bold text-xl shadow-lg shadow-emerald-950/80 mb-2'>
            WA
          </div>
          <h2 className='text-2xl font-bold tracking-tight text-gray-100'>
            {isRegister ? 'Buat Akun Gateway' : 'Masuk ke WA Gateway'}
          </h2>
          <p className='text-xs text-gray-400'>
            Sistem API WhatsApp Multi-Device dengan Anti-Ban Engine
          </p>
        </div>

        <div className='bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 shadow-xl space-y-5'>
          {error && (
            <div className='p-3 bg-red-950/70 border border-red-800/80 rounded-xl flex items-center gap-2 text-xs text-red-300'>
              <AlertCircle size={15} className='shrink-0' />
              <span>{error}</span>
            </div>
          )}

          {authConfig.googleAuthEnabled && (
            <>
              <button
                type='button'
                onClick={handleGoogleLogin}
                disabled={loading}
                className='w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-gray-950 hover:bg-gray-800/80 border border-gray-800 rounded-xl text-xs font-semibold text-gray-200 transition shadow-xs disabled:opacity-50 cursor-pointer'
              >
                <svg className='w-4 h-4' viewBox='0 0 24 24'>
                  <path fill='#4285F4' d='M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z' />
                  <path fill='#34A853' d='M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z' />
                  <path fill='#FBBC05' d='M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.02 0 12s.45 3.82 1.25 5.42l4.03-3.15z' />
                  <path fill='#EA4335' d='M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z' />
                </svg>
                Lanjutkan dengan Google
              </button>

              <div className='relative flex py-1 items-center'>
                <div className='grow border-t border-gray-800'></div>
                <span className='shrink mx-3 text-[11px] text-gray-500 uppercase tracking-wider font-semibold'>
                  atau via email
                </span>
                <div className='grow border-t border-gray-800'></div>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className='space-y-4'>
            {isRegister && (
              <div>
                <label className='block text-xs font-semibold text-gray-400 mb-1'>Nama Lengkap</label>
                <input
                  type='text'
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder='Nama lengkap anda'
                  className='w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 transition'
                />
              </div>
            )}

            <div>
              <label className='block text-xs font-semibold text-gray-400 mb-1'>Email</label>
              <div className='relative'>
                <Mail className='absolute left-3.5 top-3 text-gray-500' size={15} />
                <input
                  type='email'
                  required
                  autoCapitalize='none'
                  autoCorrect='off'
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder='nama@domain.com'
                  className='w-full bg-gray-950 border border-gray-800 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 transition'
                />
              </div>
            </div>

            <div>
              <label className='block text-xs font-semibold text-gray-400 mb-1'>Password</label>
              <div className='relative'>
                <Lock className='absolute left-3.5 top-3 text-gray-500' size={15} />
                <input
                  type='password'
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder='••••••••••••'
                  className='w-full bg-gray-950 border border-gray-800 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 transition'
                />
              </div>
            </div>

            {/* Cloudflare Turnstile Widget */}
            {authConfig.turnstileEnabled && authConfig.turnstileSiteKey && (
              <div className='my-3 flex flex-col items-center justify-center space-y-1.5'>
                <div ref={turnstileWidgetRef} />
                {!turnstileToken && (
                  <span className='text-[10px] text-gray-400'>
                    Selesaikan verifikasi keamanan di atas sebelum masuk
                  </span>
                )}
              </div>
            )}

            <button
              type='submit'
              disabled={loading || (Boolean(authConfig.turnstileEnabled && authConfig.turnstileSiteKey) && !turnstileToken)}
              className='w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-emerald-950/80 transition disabled:opacity-50 mt-2 cursor-pointer'
            >
              {loading ? (
                <>
                  <Loader2 className='w-4 h-4 animate-spin' />
                  <span>Memverifikasi...</span>
                </>
              ) : (
                <>
                  <span>{isRegister ? 'Daftar Akun Baru' : 'Masuk ke Dashboard'}</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>

          {authConfig.registrationEnabled ? (
            <div className='text-center pt-2'>
              <button
                type='button'
                onClick={() => setIsRegister(!isRegister)}
                className='text-xs text-gray-400 hover:text-gray-200 transition cursor-pointer'
              >
                {isRegister ? (
                  <>Sudah punya akun? <span className='text-emerald-400 font-semibold'>Masuk di sini</span></>
                ) : (
                  <>Belum punya akun? <span className='text-emerald-400 font-semibold'>Daftar sekarang</span></>
                )}
              </button>
            </div>
          ) : (
            <div className='text-center pt-2 text-[11px] text-gray-500'>
              Pendaftaran publik ditutup. Hubungi administrator untuk membuat akun.
            </div>
          )}
        </div>

        <div className='flex items-center justify-center gap-2 text-[11px] text-gray-500 text-center'>
          <Shield size={13} className='text-emerald-500' />
          <span>Kredensial disimpan lokal dengan proteksi SQLite & JWT</span>
        </div>
      </div>
    </div>
  );
};
