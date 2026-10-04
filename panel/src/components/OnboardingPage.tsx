import React, { useState } from 'react';
import { Phone, MessageSquare, CalendarDays, ArrowRight, Loader2, AlertCircle, CheckCircle2, SkipForward } from 'lucide-react';
import { apiUpdateProfilSaya } from '../api';

interface OnboardingPageProps {
  /** Profil hasil login, dipakai untuk menyapa pengguna dan mengisi kuota awal. */
  user: {
    name?: string;
    email?: string;
    quotaPerDay?: number;
    usedToday?: number;
    quotaPerWeek?: number;
    usedThisWeek?: number;
    phone?: string;
  } | null;
  /** Dipanggil setelah nomor tersimpan atau pengguna melewati langkah ini. */
  onSelesai: () => void;
}

/** Format angka dengan pemisah ribuan gaya Indonesia (700000 -> "700.000"). */
function angka(nilai?: number): string {
  if (typeof nilai !== 'number' || !Number.isFinite(nilai)) return '0';
  return nilai.toLocaleString('id-ID');
}

/**
 * Halaman pengenalan setelah pendaftaran lewat Google.
 *
 * Pendaftaran lewat Google tidak melewati formulir mana pun, jadi akun baru
 * langsung terbentuk tanpa nomor WhatsApp dan tanpa gambaran batas pemakaian.
 * Halaman ini menutup dua hal itu: menampilkan kuota yang berlaku, dan meminta
 * nomor WhatsApp yang belum sempat diisi.
 *
 * Nomor bersifat opsional. Pengguna yang tidak ingin mengisinya sekarang bisa
 * melewati, dan nomor masih dapat dilengkapi kapan saja dari halaman profil.
 */
export const OnboardingPage: React.FC<OnboardingPageProps> = ({ user, onSelesai }) => {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const kuotaHarian = user?.quotaPerDay ?? 0;
  const kuotaMingguan = user?.quotaPerWeek ?? 0;
  const dipakaiHariIni = user?.usedToday ?? 0;
  const dipakaiMingguIni = user?.usedThisWeek ?? 0;

  const sisaHarian = Math.max(kuotaHarian - dipakaiHariIni, 0);
  const sisaMingguan = Math.max(kuotaMingguan - dipakaiMingguIni, 0);

  const simpan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Nomor kosong diperlakukan sebagai "lewati", bukan sebagai galat. Ini
    // menjaga tombol simpan tetap bisa ditekan tanpa mengisi apa pun.
    if (!phone.trim()) {
      onSelesai();
      return;
    }

    setLoading(true);
    try {
      const res = await apiUpdateProfilSaya({ phone: phone.trim() });
      if (res?.error) throw new Error(res.error);
      onSelesai();
    } catch (err: any) {
      setError(err.message || 'Gagal menyimpan nomor WhatsApp.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='min-h-screen bg-canvas flex items-center justify-center p-4'>
      <div className='w-full max-w-lg space-y-6'>
        <div className='text-center space-y-2'>
          <div className='inline-flex items-center justify-center w-12 h-12 rounded-full bg-pine-wash'>
            <CheckCircle2 className='w-6 h-6 text-pine' />
          </div>
          <h1 className='text-lg font-semibold text-ink'>
            Akun anda siap{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className='text-xs text-ink-muted'>
            Pendaftaran lewat Google selesai. Berikut batas pemakaian yang berlaku untuk akun anda.
          </p>
        </div>

        {/* Ringkasan kuota */}
        <div className='bg-surface border border-line rounded-md p-6 sm:p-8 space-y-5'>
          <div>
            <h2 className='text-sm font-semibold text-ink'>Kuota Pesan</h2>
            <p className='text-xs text-ink-muted mt-0.5'>
              Dihitung otomatis dan disetel ulang pada awal periode.
            </p>
          </div>

          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
            <div className='bg-surface-sunken border border-line rounded-md p-4 space-y-2'>
              <div className='flex items-center gap-2 text-ink-muted'>
                <MessageSquare size={14} className='text-pine' />
                <span className='text-[11px] font-semibold uppercase tracking-wider'>Per Hari</span>
              </div>
              <div className='text-xl font-semibold text-ink'>{angka(sisaHarian)}</div>
              <div className='text-[11px] text-ink-muted'>
                Sisa dari {angka(kuotaHarian)} pesan
              </div>
            </div>

            <div className='bg-surface-sunken border border-line rounded-md p-4 space-y-2'>
              <div className='flex items-center gap-2 text-ink-muted'>
                <CalendarDays size={14} className='text-pine' />
                <span className='text-[11px] font-semibold uppercase tracking-wider'>Per Minggu</span>
              </div>
              <div className='text-xl font-semibold text-ink'>{angka(sisaMingguan)}</div>
              <div className='text-[11px] text-ink-muted'>
                Sisa dari {angka(kuotaMingguan)} pesan
              </div>
            </div>
          </div>

          {kuotaHarian === 0 && kuotaMingguan === 0 && (
            <div className='p-3 bg-clay-wash/70 border border-clay-line/80 rounded-md flex items-start gap-2 text-xs text-clay-deep'>
              <AlertCircle size={15} className='shrink-0 mt-0.5' />
              <span>
                Kuota akun anda belum disetel. Hubungi Administrator agar batas pemakaian dapat ditentukan.
              </span>
            </div>
          )}

          {/* Langkah melengkapi nomor WhatsApp */}
          <div className='border-t border-line pt-5 space-y-4'>
            <div>
              <h2 className='text-sm font-semibold text-ink'>Nomor WhatsApp</h2>
              <p className='text-xs text-ink-muted mt-0.5'>
                Dipakai sebagai data kontak akun. Boleh dikosongkan dan dilengkapi nanti.
              </p>
            </div>

            {error && (
              <div className='p-3 bg-clay-wash/70 border border-clay-line/80 rounded-md flex items-center gap-2 text-xs text-clay-deep'>
                <AlertCircle size={15} className='shrink-0' />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={simpan} className='space-y-4'>
              <div>
                <label className='block text-xs font-semibold text-ink-muted mb-1'>
                  Nomor WhatsApp <span className='font-normal text-ink-faint'>(opsional)</span>
                </label>
                <div className='relative'>
                  <Phone className='absolute left-3.5 top-3 text-ink-faint' size={15} />
                  <input
                    type='tel'
                    inputMode='tel'
                    autoComplete='tel'
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder='08123456789'
                    className='w-full bg-surface-sunken border border-line rounded-md pl-10 pr-3.5 py-2.5 text-xs text-ink focus:outline-none focus:border-pine transition'
                  />
                </div>
                <p className='text-[11px] text-ink-faint mt-1.5'>
                  Format yang diterima: 08123456789 atau +628123456789.
                </p>
              </div>

              <div className='flex flex-col sm:flex-row gap-2'>
                <button
                  type='submit'
                  disabled={loading}
                  className='flex-1 flex items-center justify-center gap-2 py-2.5 px-4 bg-pine hover:bg-pine-soft text-surface text-xs font-semibold rounded-md transition disabled:opacity-50 cursor-pointer'
                >
                  {loading ? (
                    <>
                      <Loader2 className='w-4 h-4 animate-spin' />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <>
                      <span>{phone.trim() ? 'Simpan & Lanjutkan' : 'Lanjutkan'}</span>
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>

                {phone.trim() !== '' && (
                  <button
                    type='button'
                    onClick={onSelesai}
                    disabled={loading}
                    className='flex items-center justify-center gap-2 py-2.5 px-4 bg-surface-sunken hover:bg-surface-alt border border-line hover:border-line-strong text-xs font-semibold text-ink-muted rounded-md transition disabled:opacity-50 cursor-pointer'
                  >
                    <SkipForward size={14} />
                    <span>Lewati</span>
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

        <div className='text-center text-[11px] text-ink-faint'>
          Nomor WhatsApp dapat diubah kapan saja dari halaman profil.
        </div>
      </div>
    </div>
  );
};
