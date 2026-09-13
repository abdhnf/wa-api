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
 const [googleLoading, setGoogleLoading] = useState(false);
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
 const googleTokenClientRef = useRef<any>(null);

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

 const setupGoogleAuth = () => {
 const google = (window as any).google;
 if (!google?.accounts) return;

 try {
 // 1. Inisialisasi OAuth2 Token Client untuk custom button click
 if (google.accounts.oauth2) {
 googleTokenClientRef.current = google.accounts.oauth2.initTokenClient({
 client_id: authConfig.googleClientId,
 scope: 'email profile openid',
 callback: async (tokenResponse: any) => {
 if (tokenResponse?.error) {
 setGoogleLoading(false);
 setError(`Autentikasi Google dibatalkan: ${tokenResponse.error}`);
 return;
 }
 if (tokenResponse?.access_token) {
 try {
 // Fetch profil user dari Google UserInfo API
 const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
 headers: {
 Authorization: `Bearer ${tokenResponse.access_token}`,
 },
 });
 if (!userInfoRes.ok) throw new Error('Gagal mengambil profil akun Google.');
 const profile = await userInfoRes.json();

 // Kirim data profil ke backend Fastify
 const res = await apiLoginGoogle({
 email: profile.email,
 name: profile.name || profile.given_name || 'Google User',
 googleId: profile.sub,
 avatarUrl: profile.picture,
 });

 if (res?.user) {
 onLoginSuccess(res.user);
 }
 } catch (err: any) {
 setError(err.message || 'Gagal login via Google');
 } finally {
 setGoogleLoading(false);
 }
 }
 },
 });
 }

 // 2. Inisialisasi Google One Tap jika browser mendukung
 if (google.accounts.id) {
 google.accounts.id.initialize({
 client_id: authConfig.googleClientId,
 callback: async (response: any) => {
 if (!response?.credential) return;
 try {
 setGoogleLoading(true);
 setError('');
 const res = await apiLoginGoogle({ credential: response.credential });
 if (res?.user) onLoginSuccess(res.user);
 } catch (err: any) {
 setError(err.message || 'Gagal login dengan Google One Tap');
 } finally {
 setGoogleLoading(false);
 }
 },
 auto_select: false,
 cancel_on_tap_outside: true,
 });
 google.accounts.id.prompt();
 }
 } catch (err: any) {
 console.error('[GSI Setup Error]', err);
 }
 };

 const interval = setInterval(() => {
 if ((window as any).google?.accounts) {
 clearInterval(interval);
 setupGoogleAuth();
 }
 }, 100);

 return () => clearInterval(interval);
 }, [authConfig.googleAuthEnabled, authConfig.googleClientId]);

 // Handler klik custom Google Button
 const handleGoogleSignInClick = () => {
 setError('');
 const google = (window as any).google;

 if (!authConfig.googleClientId) {
 setError('Google Client ID belum diatur di menu Settings Admin.');
 return;
 }

 if (googleTokenClientRef.current) {
 setGoogleLoading(true);
 googleTokenClientRef.current.requestAccessToken({ prompt: 'select_account' });
 } else if (google?.accounts?.id) {
 setGoogleLoading(true);
 google.accounts.id.prompt();
 } else {
 setError('Sedang memuat layanan Google Sign-In, silakan klik kembali dalam beberapa detik.');
 }
 };

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
 <div className='min-h-screen bg-surface-sunken flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-12 relative overflow-hidden'>
 <div className='absolute w-[450px] h-[450px] bg-pine/10 rounded-sm blur-3xl -top-24 -left-24 pointer-events-none' />
 <div className='absolute w-[450px] h-[450px] bg-sea/10 rounded-sm blur-3xl -bottom-24 -right-24 pointer-events-none' />

 <div className='w-full max-w-md space-y-6 relative z-10'>
 <div className='text-center space-y-2'>
 <div className='inline-flex items-center justify-center w-12 h-12 rounded-md bg-pine text-surface font-bold text-xl mb-2'>
 WA
 </div>
 <h2 className='text-2xl font-bold tracking-tight text-ink'>
 {isRegister ? 'Buat Akun Gateway' : 'Masuk ke WA Gateway'}
 </h2>
 <p className='text-xs text-ink-muted'>
 Sistem API WhatsApp Multi-Device dengan Anti-Ban Engine
 </p>
 </div>

 <div className='bg-surface border border-line rounded-md p-6 sm:p-8 space-y-5'>
 {error && (
 <div className='p-3 bg-clay-wash/70 border border-clay-line/80 rounded-md flex items-center gap-2 text-xs text-clay-deep'>
 <AlertCircle size={15} className='shrink-0' />
 <span>{error}</span>
 </div>
 )}

 {/* Custom Modern Google Sign-In Button */}
 {authConfig.googleAuthEnabled && (
 <div className='space-y-3'>
 <button
 type='button'
 onClick={handleGoogleSignInClick}
 disabled={loading || googleLoading}
 className='w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-surface-sunken hover:bg-surface-alt active:bg-surface-alt border border-line hover:border-line-strong rounded-md text-xs font-semibold text-ink transition disabled:opacity-50 cursor-pointer group'
 >
 {googleLoading ? (
 <>
 <Loader2 className='w-4 h-4 animate-spin text-pine' />
 <span>Menghubungkan ke Google...</span>
 </>
 ) : (
 <>
 <svg className='w-4 h-4 shrink-0 transition-transform group-hover:scale-105' viewBox='0 0 24 24'>
 <path fill='#4285F4' d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z' />
 <path fill='#34A853' d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z' />
 <path fill='#FBBC05' d='M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z' />
 <path fill='#EA4335' d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z' />
 </svg>
 <span>Lanjutkan dengan Google</span>
 </>
 )}
 </button>

 <div className='relative flex py-1 items-center'>
 <div className='grow border-t border-line'></div>
 <span className='shrink mx-3 text-[11px] text-ink-faint uppercase tracking-wider font-semibold'>
 atau via email
 </span>
 <div className='grow border-t border-line'></div>
 </div>
 </div>
 )}

 <form onSubmit={handleSubmit} className='space-y-4'>
 {isRegister && (
 <div>
 <label className='block text-xs font-semibold text-ink-muted mb-1'>Nama Lengkap</label>
 <input
 type='text'
 required
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder='Nama lengkap anda'
 className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2.5 text-xs text-ink focus:outline-none focus:border-pine transition'
 />
 </div>
 )}

 <div>
 <label className='block text-xs font-semibold text-ink-muted mb-1'>Email</label>
 <div className='relative'>
 <Mail className='absolute left-3.5 top-3 text-ink-faint' size={15} />
 <input
 type='email'
 required
 autoCapitalize='none'
 autoCorrect='off'
 spellCheck={false}
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 placeholder='nama@domain.com'
 className='w-full bg-surface-sunken border border-line rounded-md pl-10 pr-3.5 py-2.5 text-xs text-ink focus:outline-none focus:border-pine transition'
 />
 </div>
 </div>

 <div>
 <label className='block text-xs font-semibold text-ink-muted mb-1'>Password</label>
 <div className='relative'>
 <Lock className='absolute left-3.5 top-3 text-ink-faint' size={15} />
 <input
 type='password'
 required
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 placeholder='••••••••••••'
 className='w-full bg-surface-sunken border border-line rounded-md pl-10 pr-3.5 py-2.5 text-xs text-ink focus:outline-none focus:border-pine transition'
 />
 </div>
 </div>

 {/* Cloudflare Turnstile Widget */}
 {authConfig.turnstileEnabled && authConfig.turnstileSiteKey && (
 <div className='my-3 flex flex-col items-center justify-center space-y-1.5'>
 <div ref={turnstileWidgetRef} />
 {!turnstileToken && (
 <span className='text-[10px] text-ink-muted'>
 Selesaikan verifikasi keamanan di atas sebelum masuk
 </span>
 )}
 </div>
 )}

 <button
 type='submit'
 disabled={loading || googleLoading || (Boolean(authConfig.turnstileEnabled && authConfig.turnstileSiteKey) && !turnstileToken)}
 className='w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-pine hover:bg-pine-soft text-surface text-xs font-semibold rounded-md transition disabled:opacity-50 mt-2 cursor-pointer'
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
 className='text-xs text-ink-muted hover:text-ink transition cursor-pointer'
 >
 {isRegister ? (
 <>Sudah punya akun? <span className='text-pine font-semibold'>Masuk di sini</span></>
 ) : (
 <>Belum punya akun? <span className='text-pine font-semibold'>Daftar sekarang</span></>
 )}
 </button>
 </div>
 ) : (
 <div className='text-center pt-2 text-[11px] text-ink-faint'>
 Pendaftaran form publik ditutup. Gunakan Login with Google atau hubungi Administrator.
 </div>
 )}
 </div>

 <div className='flex items-center justify-center gap-2 text-[11px] text-ink-faint text-center'>
 <Shield size={13} className='text-pine' />
 <span>Kredensial disimpan lokal dengan proteksi SQLite & JWT</span>
 </div>
 </div>
 </div>
 );
};
