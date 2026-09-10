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
  const googleBtnContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    apiGetAuthConfig()
      .then(cfg => {
        if (cfg) setAuthConfig(cfg);
      })
      .catch(() => {});
  }, []);

  // ============ Google Identity Services (GSI) ============
  useEffect(() => {
    if (!authConfig.googleAuthEnabled || !authConfig.googleClientId) return;

    const scriptId = 'google-gsi-client-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    const setupGoogleGsi = () => {
      const google = (window as any).google;
      if (!google?.accounts?.id) return;

      try {
        google.accounts.id.initialize({
          client_id: authConfig.googleClientId,
          callback: async (response: any) => {
            if (!response?.credential) return;
            try {
              setLoading(true);
              setError('');
              const res = await apiLoginGoogle({ credential: response.credential });
              if (res?.user) {
                onLoginSuccess(res.user);
              }
            } catch (err: any) {
              setError(err.message || 'Gagal login dengan Google');
            } finally {
              setLoading(false);
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        // Render tombol Google Sign-In resmi ke container
        if (googleBtnContainerRef.current) {
          googleBtnContainerRef.current.innerHTML = '';
          google.accounts.id.renderButton(googleBtnContainerRef.current, {
            theme: 'filled_black',
            size: 'large',
            type: 'standard',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: googleBtnContainerRef.current.clientWidth || 340,
          });
        }

        // Tampilkan One Tap popup jika memungkinkan
        google.accounts.id.prompt();
      } catch (err: any) {
        console.error('[GSI Setup Error]', err);
      }
    };

    const interval = setInterval(() => {
      if ((window as any).google?.accounts?.id) {
        clearInterval(interval);
        setupGoogleGsi();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [authConfig.googleAuthEnabled, authConfig.googleClientId]);

  // ============ Cloudflare Turnstile ============
  useEffect(() => {
    if (!authConfig.turnstileEnabled || !authConfig.turnstileSiteKey) return;

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

          {/* Google Sign-In Container */}
          {authConfig.googleAuthEnabled && (
            <div className='space-y-3'>
              <div
                ref={googleBtnContainerRef}
                className='w-full flex items-center justify-center min-h-[44px] overflow-hidden rounded-xl'
              >
                <div className='flex items-center gap-2 text-xs text-gray-500 py-2'>
                  <Loader2 className='w-3.5 h-3.5 animate-spin' />
                  <span>Memuat Google Login...</span>
                </div>
              </div>

              <div className='relative flex py-1 items-center'>
                <div className='grow border-t border-gray-800'></div>
                <span className='shrink mx-3 text-[11px] text-gray-500 uppercase tracking-wider font-semibold'>
                  atau via email
                </span>
                <div className='grow border-t border-gray-800'></div>
              </div>
            </div>
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
