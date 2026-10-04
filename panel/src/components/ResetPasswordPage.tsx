import React, { useEffect, useState } from 'react';
import {
  Mail,
  Lock,
  Shield,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  KeyRound,
} from 'lucide-react';
import { apiLupaPassword, apiVerifikasiTokenReset, apiResetPasswordDenganToken } from '../api';

/**
 * Halaman reset password.
 *
 * Dua mode dalam satu komponen karena keduanya berbagi tata letak yang sama —
 * memisahkannya hanya akan menggandakan gaya kartu, judul, dan pesan galat:
 *
 *   - `minta`  : pengguna memasukkan email untuk menerima tautan reset.
 *   - `atur`   : pengguna membuka tautan dari email dan memasang password baru.
 *
 * Halaman ini dirender SEBELUM autentikasi, jadi tidak ada token JWT yang bisa
 * dipakai. Semua endpoint yang dipanggil memang publik.
 */
interface ResetPasswordPageProps {
  mode: 'minta' | 'atur';
  /** Token dari query string. Hanya dipakai pada mode `atur`. */
  token?: string;
  /** Kembali ke halaman masuk dan bersihkan alamat URL. */
  onKembali: () => void;
  /** Dipanggil setelah password berhasil diubah — arahkan ke form masuk. */
  onSelesai: () => void;
}

export const ResetPasswordPage: React.FC<ResetPasswordPageProps> = ({
  mode,
  token,
  onKembali,
  onSelesai,
}) => {
  // ---------- Mode "minta" ----------
  const [email, setEmail] = useState('');
  const [terkirim, setTerkirim] = useState(false);

  // ---------- Mode "atur" ----------
  const [memeriksaToken, setMemeriksaToken] = useState(mode === 'atur');
  const [tokenValid, setTokenValid] = useState(false);
  const [namaPengguna, setNamaPengguna] = useState('');
  const [pesanToken, setPesanToken] = useState('');
  const [password, setPassword] = useState('');
  const [ulangiPassword, setUlangiPassword] = useState('');
  const [berhasil, setBerhasil] = useState(false);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Periksa token begitu halaman dibuka. Tanpa ini, pengguna mengisi password
  // baru dulu, baru diberi tahu tautannya sudah kedaluwarsa.
  useEffect(() => {
    if (mode !== 'atur') return;
    if (!token) {
      setMemeriksaToken(false);
      setTokenValid(false);
      setPesanToken('Tautan tidak memuat token reset. Pastikan alamat disalin lengkap dari email.');
      return;
    }
    let batal = false;
    apiVerifikasiTokenReset(token)
      .then((res) => {
        if (batal) return;
        setTokenValid(Boolean(res?.valid));
        setNamaPengguna(res?.name || '');
        setPesanToken(res?.message || '');
      })
      .catch((err) => {
        if (batal) return;
        setTokenValid(false);
        setPesanToken(err.message || 'Gagal memeriksa tautan.');
      })
      .finally(() => {
        if (!batal) setMemeriksaToken(false);
      });
    return () => {
      batal = true;
    };
  }, [mode, token]);

  const handleMinta = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiLupaPassword(email.trim().toLowerCase());
      setTerkirim(true);
    } catch (err: any) {
      // Backend sengaja tidak mengungkap apakah email terdaftar. Satu-satunya
      // galat yang tampil di sini adalah pembatasan laju (429), dan itu memang
      // perlu disampaikan supaya pengguna tahu harus menunggu.
      setError(err.message || 'Gagal mengirim permintaan. Coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  const handleAtur = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password minimal 6 karakter.');
      return;
    }
    if (password !== ulangiPassword) {
      setError('Ulangi password tidak cocok.');
      return;
    }

    setLoading(true);
    try {
      await apiResetPasswordDenganToken(token || '', password);
      setBerhasil(true);
    } catch (err: any) {
      setError(err.message || 'Gagal mengubah password. Coba ajukan tautan baru.');
    } finally {
      setLoading(false);
    }
  };

  // ============ Kerangka bersama ============
  const kerangka = (isi: React.ReactNode, judul: string, subjudul: string) => (
    <div className='min-h-screen bg-surface-sunken flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-12 relative overflow-hidden'>
      <div className='absolute w-[450px] h-[450px] bg-pine/10 rounded-sm blur-3xl -top-24 -left-24 pointer-events-none' />
      <div className='absolute w-[450px] h-[450px] bg-sea/10 rounded-sm blur-3xl -bottom-24 -right-24 pointer-events-none' />

      <div className='w-full max-w-md space-y-6 relative z-10'>
        <div className='text-center space-y-2'>
          <div className='inline-flex items-center justify-center w-12 h-12 rounded-md bg-pine text-surface font-bold text-xl mb-2'>
            WA
          </div>
          <h2 className='text-2xl font-bold tracking-tight text-ink'>{judul}</h2>
          <p className='text-xs text-ink-muted'>{subjudul}</p>
        </div>

        <div className='bg-surface border border-line rounded-md p-6 sm:p-8 space-y-5'>
          {error && (
            <div className='p-3 bg-clay-wash/70 border border-clay-line/80 rounded-md flex items-center gap-2 text-xs text-clay-deep'>
              <AlertCircle size={15} className='shrink-0' />
              <span>{error}</span>
            </div>
          )}
          {isi}
        </div>

        <div className='flex items-center justify-center gap-2 text-[11px] text-ink-faint text-center'>
          <Shield size={13} className='text-pine' />
          <span>Kredensial disimpan lokal dengan proteksi SQLite &amp; JWT</span>
        </div>
      </div>
    </div>
  );

  // ============ Mode "minta" ============
  if (mode === 'minta') {
    if (terkirim) {
      return kerangka(
        <div className='space-y-4'>
          <div className='flex items-start gap-3 p-4 bg-pine-wash/50 border border-pine-line/40 rounded-md'>
            <CheckCircle2 size={18} className='text-pine shrink-0 mt-0.5' />
            <div className='space-y-1'>
              <p className='text-xs font-semibold text-ink'>Permintaan sudah diproses</p>
              <p className='text-xs text-ink-muted leading-relaxed'>
                Kalau <span className='font-semibold text-ink-soft'>{email}</span> terdaftar di sistem ini,
                kami sudah mengirim tautan untuk mengatur ulang password. Periksa kotak masuk dan folder spam.
              </p>
            </div>
          </div>

          <div className='text-[11px] text-ink-muted bg-surface-sunken/60 border border-line/80 rounded-md p-3 leading-relaxed'>
            Tautan berlaku selama 30 menit dan hanya bisa dipakai sekali. Kalau emailnya tidak muncul,
            tunggu beberapa menit lalu ajukan ulang.
          </div>

          <button
            type='button'
            onClick={onKembali}
            className='w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-pine hover:bg-pine-soft text-surface text-xs font-semibold rounded-md transition cursor-pointer'
          >
            <ArrowLeft size={14} />
            <span>Kembali ke Halaman Masuk</span>
          </button>
        </div>,
        'Periksa Email Anda',
        'Langkah selanjutnya ada di kotak masuk Anda'
      );
    }

    return kerangka(
      <form onSubmit={handleMinta} className='space-y-4'>
        <div className='flex items-start gap-3 p-3 bg-sea-wash/40 border border-sea-line/40 rounded-md'>
          <KeyRound size={16} className='text-sea shrink-0 mt-0.5' />
          <p className='text-[11px] text-ink-muted leading-relaxed'>
            Masukkan email akun Anda. Kami akan mengirim tautan untuk membuat password baru.
          </p>
        </div>

        <div>
          <label className='block text-xs font-semibold text-ink-muted mb-1'>Email</label>
          <div className='relative'>
            <Mail size={15} className='absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint' />
            <input
              type='email'
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder='nama@domain.com'
              className='w-full bg-surface-sunken border border-line rounded-md pl-9 pr-3.5 py-2.5 text-xs text-ink focus:outline-none focus:border-pine'
            />
          </div>
        </div>

        <button
          type='submit'
          disabled={loading}
          className='w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-pine hover:bg-pine-soft text-surface text-xs font-semibold rounded-md transition disabled:opacity-50 mt-2 cursor-pointer'
        >
          {loading ? (
            <>
              <Loader2 className='w-4 h-4 animate-spin' />
              <span>Mengirim...</span>
            </>
          ) : (
            <>
              <span>Kirim Tautan Reset</span>
              <ArrowRight size={14} />
            </>
          )}
        </button>

        <div className='text-center pt-2'>
          <button
            type='button'
            onClick={onKembali}
            className='text-xs text-ink-muted hover:text-ink transition cursor-pointer'
          >
            Ingat password Anda? <span className='text-pine font-semibold'>Kembali masuk</span>
          </button>
        </div>
      </form>,
      'Lupa Password',
      'Masukkan email untuk menerima tautan reset'
    );
  }

  // ============ Mode "atur" ============

  if (memeriksaToken) {
    return kerangka(
      <div className='flex items-center justify-center gap-3 py-8 text-xs text-ink-muted'>
        <Loader2 className='w-4 h-4 animate-spin text-pine' />
        <span>Memeriksa tautan...</span>
      </div>,
      'Memeriksa Tautan',
      'Mohon tunggu sebentar'
    );
  }

  if (!tokenValid) {
    return kerangka(
      <div className='space-y-4'>
        <div className='flex items-start gap-3 p-4 bg-clay-wash/60 border border-clay-line/70 rounded-md'>
          <AlertCircle size={18} className='text-clay-deep shrink-0 mt-0.5' />
          <div className='space-y-1'>
            <p className='text-xs font-semibold text-ink'>Tautan tidak bisa dipakai</p>
            <p className='text-xs text-ink-muted leading-relaxed'>{pesanToken}</p>
          </div>
        </div>

        <button
          type='button'
          onClick={onKembali}
          className='w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-pine hover:bg-pine-soft text-surface text-xs font-semibold rounded-md transition cursor-pointer'
        >
          <span>Ajukan Tautan Baru</span>
          <ArrowRight size={14} />
        </button>
      </div>,
      'Tautan Kedaluwarsa',
      'Tautan reset sudah tidak berlaku'
    );
  }

  if (berhasil) {
    return kerangka(
      <div className='space-y-4'>
        <div className='flex items-start gap-3 p-4 bg-pine-wash/50 border border-pine-line/40 rounded-md'>
          <CheckCircle2 size={18} className='text-pine shrink-0 mt-0.5' />
          <div className='space-y-1'>
            <p className='text-xs font-semibold text-ink'>Password berhasil diubah</p>
            <p className='text-xs text-ink-muted leading-relaxed'>
              Silakan masuk menggunakan password baru Anda. Semua tautan reset lain untuk akun ini
              sudah dibatalkan.
            </p>
          </div>
        </div>

        <button
          type='button'
          onClick={onSelesai}
          className='w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-pine hover:bg-pine-soft text-surface text-xs font-semibold rounded-md transition cursor-pointer'
        >
          <span>Masuk ke Dashboard</span>
          <ArrowRight size={14} />
        </button>
      </div>,
      'Password Diubah',
      'Akun Anda siap digunakan kembali'
    );
  }

  return kerangka(
    <form onSubmit={handleAtur} className='space-y-4'>
      {namaPengguna && (
        <div className='flex items-start gap-3 p-3 bg-sea-wash/40 border border-sea-line/40 rounded-md'>
          <KeyRound size={16} className='text-sea shrink-0 mt-0.5' />
          <p className='text-[11px] text-ink-muted leading-relaxed'>
            Halo <span className='font-semibold text-ink-soft'>{namaPengguna}</span>, masukkan password
            baru untuk akun Anda.
          </p>
        </div>
      )}

      <div>
        <label className='block text-xs font-semibold text-ink-muted mb-1'>Password Baru</label>
        <div className='relative'>
          <Lock size={15} className='absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint' />
          <input
            type='password'
            required
            autoFocus
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder='Minimal 6 karakter'
            className='w-full bg-surface-sunken border border-line rounded-md pl-9 pr-3.5 py-2.5 text-xs text-ink focus:outline-none focus:border-pine'
          />
        </div>
      </div>

      <div>
        <label className='block text-xs font-semibold text-ink-muted mb-1'>Ulangi Password Baru</label>
        <div className='relative'>
          <Lock size={15} className='absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint' />
          <input
            type='password'
            required
            minLength={6}
            value={ulangiPassword}
            onChange={(e) => setUlangiPassword(e.target.value)}
            placeholder='Ketik ulang password baru'
            className='w-full bg-surface-sunken border border-line rounded-md pl-9 pr-3.5 py-2.5 text-xs text-ink focus:outline-none focus:border-pine'
          />
        </div>
      </div>

      <button
        type='submit'
        disabled={loading}
        className='w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-pine hover:bg-pine-soft text-surface text-xs font-semibold rounded-md transition disabled:opacity-50 mt-2 cursor-pointer'
      >
        {loading ? (
          <>
            <Loader2 className='w-4 h-4 animate-spin' />
            <span>Menyimpan...</span>
          </>
        ) : (
          <>
            <span>Simpan Password Baru</span>
            <ArrowRight size={14} />
          </>
        )}
      </button>
    </form>,
    'Atur Password Baru',
    'Buat password baru untuk akun Anda'
  );
};
