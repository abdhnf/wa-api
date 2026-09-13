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
 const [blastDashboardUrl, setBlastDashboardUrl] = useState('http://172.30.30.229:8085');
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
 if (res.settings.blastDashboardUrl) {
 setBlastDashboardUrl(res.settings.blastDashboardUrl);
 }
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
 await apiUpdateSettings({
 googleAuthEnabled,
 googleClientId,
 googleClientSecret,
 registrationEnabled,
 turnstileEnabled,
 turnstileSiteKey,
 turnstileSecretKey,
 googleAllowedDomains,
 blastDashboardUrl,
 });
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
 <div className='flex items-center justify-center py-20 text-ink-muted'>
 <Loader2 className='w-7 h-7 animate-spin mr-3 text-pine' />
 <span className='text-sm font-medium'>Memuat konfigurasi gateway...</span>
 </div>
 );
 }

 const originUrl = window.location.origin;

 return (
 <div className='max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200'>
 {toast && (
 <div className={'fixed bottom-5 right-5 z-[100] px-4 py-3 rounded-md text-sm font-semibold flex items-center gap-2 ' + (toast.type === 'success' ? 'bg-pine text-surface' : 'bg-clay text-surface')}>
 {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
 {toast.msg}
 </div>
 )}
 <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-5'>
 <div>
 <h2 className='text-xl font-bold text-ink flex items-center gap-2.5'>
 <Settings className='w-5 h-5 text-pine' />
 Pengaturan Sistem & Autentikasi
 </h2>
 <p className='text-xs text-ink-muted mt-1'>
 Kelola autentikasi Google OAuth dan izin registrasi akun publik.
 </p>
 </div>
 <button onClick={handleSave} disabled={saving} className='flex items-center justify-center gap-2 px-5 py-2.5 bg-pine hover:bg-pine-soft disabled:opacity-50 text-surface text-xs font-semibold rounded-md transition-all cursor-pointer'>
 {saving ? <Loader2 className='w-4 h-4 animate-spin' /> : <CheckCircle2 className='w-4 h-4' />}
 Simpan Pengaturan
 </button>
 </div>

 <form onSubmit={handleSave} className='space-y-6'>
 <div className='bg-surface/60 border border-line rounded-md p-5 space-y-4'>
 <div className='flex items-start justify-between gap-4'>
 <div className='flex items-start gap-3'>
 <div className='p-2.5 rounded-md bg-pine-wash/50 border border-pine-line/40 text-pine'>
 <UserPlus size={20} />
 </div>
 <div>
 <h3 className='text-sm font-semibold text-ink'>Pendaftaran Akun Publik</h3>
 <p className='text-xs text-ink-muted mt-0.5'>Izinkan pengguna luar mendaftar akun baru melalui form panel.</p>
 </div>
 </div>
 <label className='relative inline-flex items-center cursor-pointer'>
 <input type='checkbox' checked={registrationEnabled} onChange={(e) => setRegistrationEnabled(e.target.checked)} className='sr-only peer' />
 <div className="w-11 h-6 bg-surface-alt peer-focus:outline-none rounded-sm peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-line-strong after:border after:rounded-sm after:h-5 after:w-5 after:transition-all peer-checked:bg-pine"></div>
 </label>
 </div>
 <div className='text-xs text-ink-muted bg-surface-sunken/60 border border-line/80 rounded-md p-3'>
 <span className='font-semibold text-ink-soft'>Info:</span> Jika dinonaktifkan, pembuatan akun hanya bisa dilakukan oleh Administrator via menu Users & Keys.
 </div>
 </div>

 <div className='bg-surface/60 border border-line rounded-md p-5 space-y-5'>
 <div className='flex items-start justify-between gap-4'>
 <div className='flex items-start gap-3'>
 <div className='p-2.5 rounded-md bg-sea-wash/50 border border-sea-line/40 text-sea'>
 <Shield size={20} />
 </div>
 <div>
 <h3 className='text-sm font-semibold text-ink'>Google OAuth 2.0 Sign-In</h3>
 <p className='text-xs text-ink-muted mt-0.5'>Izinkan login langsung menggunakan akun Google.</p>
 </div>
 </div>
 <label className='relative inline-flex items-center cursor-pointer'>
 <input type='checkbox' checked={googleAuthEnabled} onChange={(e) => setGoogleAuthEnabled(e.target.checked)} className='sr-only peer' />
 <div className="w-11 h-6 bg-surface-alt peer-focus:outline-none rounded-sm peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-line-strong after:border after:rounded-sm after:h-5 after:w-5 after:transition-all peer-checked:bg-pine"></div>
 </label>
 </div>

 {googleAuthEnabled && (
 <div className='space-y-4 pt-2 border-t border-line/60'>
 <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
 <div>
 <label className='block text-xs font-semibold text-ink-soft mb-1.5'>Google Client ID</label>
 <input type='text' value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} placeholder='xxxx.apps.googleusercontent.com' className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono' />
 </div>
 <div>
 <label className='block text-xs font-semibold text-ink-soft mb-1.5 flex items-center justify-between'>
 <span>Google Client Secret</span>
 {hasSecret && <span className='text-[10px] text-pine'>Tersimpan</span>}
 </label>
 <input type='password' value={googleClientSecret} onChange={(e) => setGoogleClientSecret(e.target.value)} placeholder={hasSecret ? '•••••••• (Biarkan jika tidak ingin ganti)' : 'GOCSPX-xxxx...'} className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono' />
 </div>
 </div>

 <div>
 <label className='block text-xs font-semibold text-ink-soft mb-1.5 flex items-center justify-between'>
 <span>Email / Domain Whitelist (Opsional)</span>
 <span className='text-[10px] text-ink-muted'>Proteksi Akses Domain</span>
 </label>
 <input
 type='text'
 value={googleAllowedDomains}
 onChange={(e) => setGoogleAllowedDomains(e.target.value)}
 placeholder='abdhnf.com, kantor.id, vip@gmail.com'
 className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono'
 />
 <p className='text-[11px] text-ink-muted mt-1'>
 Batasi login Google hanya untuk domain atau email tertentu. Pisahkan dengan koma atau spasi (contoh: <span className='text-pine font-mono'>abdhnf.com, mitra.co.id</span>). Kosongkan jika ingin mengizinkan semua akun.
 </p>
 </div>
 <div className='bg-surface-sunken/90 border border-line/80 rounded-md p-4 text-xs space-y-3'>
 <div className='flex items-center gap-2 text-ink font-semibold'>
 <HelpCircle size={15} className='text-sea shrink-0' />
 <span>Panduan Konfigurasi di Google Cloud Console (OAuth 2.0 Client ID)</span>
 </div>
 <p className='text-[11px] text-ink-muted leading-relaxed'>
 Saat membuat atau mengedit <span className='text-ink font-medium'>OAuth 2.0 Client ID (Web application)</span> di Google Cloud Console, masukkan nilai-nilai berikut:
 </p>

 {/* 1. Authorized JavaScript origins */}
 <div className='space-y-1'>
 <div className='flex items-center justify-between text-[11px]'>
 <span className='text-ink-soft font-medium'>1. Authorized JavaScript origins:</span>
 <button
 type='button'
 onClick={() => copyToClipboard(originUrl, 'origin')}
 className='flex items-center gap-1 text-pine hover:text-pine-deep cursor-pointer text-[10px] font-medium'
 >
 {copiedVal === 'origin' ? <Check size={12} /> : <Copy size={12} />}
 <span>{copiedVal === 'origin' ? 'Tersalin' : 'Salin'}</span>
 </button>
 </div>
 <div className='font-mono text-[11px] bg-surface border border-line rounded-lg px-3 py-2 text-pine select-all break-all'>
 {originUrl}
 </div>
 </div>

 {/* 2. Authorized redirect URIs */}
 <div className='space-y-1.5 pt-1'>
 <div className='text-ink-soft font-medium text-[11px]'>
 2. Authorized redirect URIs (Masukkan kedua URI ini):
 </div>

 <div className='space-y-1.5'>
 <div className='flex items-center justify-between font-mono text-[11px] bg-surface border border-line rounded-lg px-3 py-2'>
 <span className='text-ink select-all break-all'>{originUrl}</span>
 <button
 type='button'
 onClick={() => copyToClipboard(originUrl, 'redirect1')}
 className='flex items-center gap-1 text-pine hover:text-pine-deep cursor-pointer text-[10px] font-medium shrink-0 ml-2'
 >
 {copiedVal === 'redirect1' ? <Check size={12} /> : <Copy size={12} />}
 <span>{copiedVal === 'redirect1' ? 'Tersalin' : 'Salin'}</span>
 </button>
 </div>

 <div className='flex items-center justify-between font-mono text-[11px] bg-surface border border-line rounded-lg px-3 py-2'>
 <span className='text-ink select-all break-all'>{`${originUrl}/api/v1/auth/google/callback`}</span>
 <button
 type='button'
 onClick={() => copyToClipboard(`${originUrl}/api/v1/auth/google/callback`, 'redirect2')}
 className='flex items-center gap-1 text-pine hover:text-pine-deep cursor-pointer text-[10px] font-medium shrink-0 ml-2'
 >
 {copiedVal === 'redirect2' ? <Check size={12} /> : <Copy size={12} />}
 <span>{copiedVal === 'redirect2' ? 'Tersalin' : 'Salin'}</span>
 </button>
 </div>
 </div>
 <p className='text-[10px] text-ink-faint'>
 Tip: Google Identity Services (GIS popup) membutuhkan origin URL di atas. URI callback backend disediakan sebagai pelengkap standar OAuth2.
 </p>
 </div>
 </div>
 </div>
 )}
 </div>
 
 {/* WhatsApp Blast Dashboard Integration Host */}
 <div className='bg-surface/60 border border-line rounded-md p-5 space-y-4'>
 <div className='flex items-start gap-3'>
 <div className='p-2.5 rounded-md bg-sea-wash/50 border border-sea-line/40 text-sea'>
 <KeyRound size={20} />
 </div>
 <div>
 <h3 className='text-sm font-semibold text-ink'>Integrasi Target Host WhatsApp Blast Dashboard</h3>
 <p className='text-xs text-ink-muted mt-0.5'>
 URL basis aplikasi WhatsApp Blast Dashboard yang dituju saat membuat Magic Launch Link.
 </p>
 </div>
 </div>

 <div className='space-y-1.5 pt-2 border-t border-line/60'>
 <label className='block text-xs font-semibold text-ink-soft'>Target Host URL</label>
 <input
 type='url'
 value={blastDashboardUrl}
 onChange={(e) => setBlastDashboardUrl(e.target.value)}
 placeholder='http://172.30.30.229:8085'
 className='w-full px-3.5 py-2.5 bg-surface-sunken/60 border border-line rounded-md text-xs font-mono text-ink focus:outline-none focus:border-sea-line transition'
 required
 />
 <p className='text-[11px] text-ink-faint'>
 Contoh: <code className='text-ink-muted font-mono'>http://172.30.30.229:8085</code> atau domain kustom Anda.
 </p>
 </div>
 </div>

 {/* Cloudflare Turnstile CAPTCHA */}
 <div className='bg-surface/60 border border-line rounded-md p-5 space-y-5'>
 <div className='flex items-start justify-between gap-4'>
 <div className='flex items-start gap-3'>
 <div className='p-2.5 rounded-md bg-honey-wash/50 border border-honey-line/40 text-honey'>
 <Shield size={20} />
 </div>
 <div>
 <h3 className='text-sm font-semibold text-ink'>Cloudflare Turnstile (CAPTCHA)</h3>
 <p className='text-xs text-ink-muted mt-0.5'>Proteksi form login dari bot otomatis dan brute force attack.</p>
 </div>
 </div>
 <label className='relative inline-flex items-center cursor-pointer'>
 <input
 type='checkbox'
 checked={turnstileEnabled}
 onChange={(e) => setTurnstileEnabled(e.target.checked)}
 className='sr-only peer'
 />
 <div className="w-11 h-6 bg-surface-alt peer-focus:outline-none rounded-sm peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-line-strong after:border after:rounded-sm after:h-5 after:w-5 after:transition-all peer-checked:bg-honey"></div>
 </label>
 </div>

 {turnstileEnabled && (
 <div className='space-y-4 pt-2 border-t border-line/60'>
 <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
 <div>
 <label className='block text-xs font-semibold text-ink-soft mb-1.5'>Site Key (Public)</label>
 <input
 type='text'
 value={turnstileSiteKey}
 onChange={(e) => setTurnstileSiteKey(e.target.value)}
 placeholder='0x4AAAAAA...'
 className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-honey-line font-mono'
 />
 </div>
 <div>
 <label className='block text-xs font-semibold text-ink-soft mb-1.5 flex items-center justify-between'>
 <span>Secret Key (Private)</span>
 {hasTurnstileSecret && <span className='text-[10px] text-honey font-mono'>Tersimpan</span>}
 </label>
 <input
 type='password'
 value={turnstileSecretKey}
 onChange={(e) => setTurnstileSecretKey(e.target.value)}
 placeholder={hasTurnstileSecret ? '•••••••• (Biarkan jika tidak ingin ganti)' : '0x4AAAAAA...'}
 className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-honey-line font-mono'
 />
 </div>
 </div>
 <div className='bg-surface-sunken/80 border border-line rounded-md p-4 text-xs space-y-1.5 text-ink-muted'>
 <div className='flex items-center gap-2 text-ink-soft font-semibold'>
 <HelpCircle size={14} className='text-honey' />
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
