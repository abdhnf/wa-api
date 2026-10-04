import React, { useEffect, useState } from 'react';
import {
  Mail,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Send,
  PlugZap,
  Info,
} from 'lucide-react';
import {
  apiGetSettings,
  apiSimpanKonfigurasiMail,
  apiUjiKoneksiMail,
  apiKirimEmailUji,
} from '../api';

interface Preset {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
}

interface KonfigMail {
  enabled: boolean;
  provider: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  hasPass: boolean;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  resetTtlMenit: number;
  lengkap: boolean;
}

/**
 * Kartu pengaturan email.
 *
 * Provider hanya memengaruhi host dan port — semuanya lewat SMTP, jadi tidak ada
 * kode khusus per provider. Mengganti provider berarti memilih preset lalu
 * mengisi kredensialnya, tanpa perlu deploy ulang.
 *
 * Komponen ini memuat konfigurasinya sendiri agar tidak membebani SettingsPage
 * dengan belasan state tambahan.
 */
export const MailSettingsCard: React.FC<{
  onNotify: (msg: string, type: 'success' | 'error') => void;
}> = ({ onNotify }) => {
  const [memuat, setMemuat] = useState(true);
  const [menyimpan, setMenyimpan] = useState(false);
  const [menguji, setMenguji] = useState(false);
  const [mengirim, setMengirim] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [emailUji, setEmailUji] = useState('');

  const [enabled, setEnabled] = useState(true);
  const [provider, setProvider] = useState('brevo');
  const [host, setHost] = useState('');
  const [port, setPort] = useState(587);
  const [secure, setSecure] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [hasPass, setHasPass] = useState(false);
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [resetTtlMenit, setResetTtlMenit] = useState(30);
  const [lengkap, setLengkap] = useState(false);

  const terapkan = (m: KonfigMail) => {
    setEnabled(Boolean(m.enabled));
    setProvider(m.provider || 'brevo');
    setHost(m.host || '');
    setPort(Number(m.port) || 587);
    setSecure(Boolean(m.secure));
    setUser(m.user || '');
    // Password hanya diterima dalam bentuk bertopeng. Nilai aslinya tidak pernah
    // meninggalkan server, jadi tidak ada yang bisa ditampilkan di sini.
    setPass(m.pass || '');
    setHasPass(Boolean(m.hasPass));
    setFromAddress(m.fromAddress || '');
    setFromName(m.fromName || '');
    setReplyTo(m.replyTo || '');
    setResetTtlMenit(Number(m.resetTtlMenit) || 30);
    setLengkap(Boolean(m.lengkap));
  };

  useEffect(() => {
    apiGetSettings()
      .then((res) => {
        if (res?.settings?.mail) terapkan(res.settings.mail);
        if (Array.isArray(res?.mailPresets)) setPresets(res.mailPresets);
      })
      .catch((err) => onNotify(err?.message || 'Gagal memuat pengaturan email', 'error'))
      .finally(() => setMemuat(false));
    // onNotify sengaja tidak masuk daftar dependensi: ia dibuat ulang setiap
    // render induk dan akan memicu pemuatan berulang tanpa henti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pilih preset provider: isi host/port/secure, biarkan kredensial apa adanya. */
  const pilihPreset = (id: string) => {
    setProvider(id);
    const p = presets.find((x) => x.id === id);
    if (p) {
      setHost(p.host);
      setPort(p.port);
      setSecure(p.secure);
    }
  };

  const simpan = async () => {
    setMenyimpan(true);
    try {
      // Hanya kirim field yang memang dikelola kartu ini. Password dikirim apa
      // adanya — kalau masih bertopeng, backend mengabaikannya dan password lama
      // tetap tersimpan.
      const res = await apiSimpanKonfigurasiMail({
        enabled,
        provider,
        host,
        port,
        secure,
        user,
        pass,
        fromAddress,
        fromName,
        replyTo,
        resetTtlMenit,
      });
      onNotify(res?.message || 'Konfigurasi email disimpan', 'success');
      const ulang = await apiGetSettings();
      if (ulang?.settings?.mail) terapkan(ulang.settings.mail);
    } catch (err: any) {
      onNotify(err?.message || 'Gagal menyimpan konfigurasi email', 'error');
    } finally {
      setMenyimpan(false);
    }
  };

  const ujiKoneksi = async () => {
    setMenguji(true);
    try {
      const res = await apiUjiKoneksiMail();
      onNotify(res?.message || 'Koneksi berhasil', 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Koneksi gagal', 'error');
    } finally {
      setMenguji(false);
    }
  };

  const kirimUji = async () => {
    setMengirim(true);
    try {
      const res = await apiKirimEmailUji(emailUji.trim());
      onNotify(res?.message || 'Email uji terkirim', 'success');
    } catch (err: any) {
      onNotify(err?.message || 'Gagal mengirim email uji', 'error');
    } finally {
      setMengirim(false);
    }
  };

  if (memuat) {
    return (
      <div className='bg-surface/60 border border-line rounded-md p-5 flex items-center gap-3 text-xs text-ink-muted'>
        <Loader2 className='w-4 h-4 animate-spin text-pine' />
        <span>Memuat konfigurasi email...</span>
      </div>
    );
  }

  return (
    <div className='bg-surface/60 border border-line rounded-md p-5 space-y-5'>
      {/* Kepala kartu */}
      <div className='flex items-start justify-between gap-4'>
        <div className='flex items-start gap-3'>
          <div className='p-2.5 rounded-md bg-pine-wash/50 border border-pine-line/40 text-pine'>
            <Mail size={20} />
          </div>
          <div>
            <h3 className='text-sm font-semibold text-ink'>Email &amp; Reset Password</h3>
            <p className='text-xs text-ink-muted mt-0.5'>
              Pengiriman email untuk tautan reset password. Semua provider memakai SMTP.
            </p>
          </div>
        </div>
        <label className='relative inline-flex items-center cursor-pointer'>
          <input
            type='checkbox'
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className='sr-only peer'
          />
          <div className="w-11 h-6 bg-surface-alt peer-focus:outline-none rounded-sm peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-line-strong after:border after:rounded-sm after:h-5 after:w-5 after:transition-all peer-checked:bg-pine"></div>
        </label>
      </div>

      {/* Status kelengkapan konfigurasi */}
      <div
        className={
          'flex items-center gap-2 text-[11px] rounded-md p-2.5 border ' +
          (lengkap
            ? 'bg-pine-wash/40 border-pine-line/40 text-pine-strong'
            : 'bg-honey-wash/40 border-honey-line/40 text-honey-deep')
        }
      >
        {lengkap ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
        <span>
          {lengkap
            ? 'Konfigurasi lengkap — fitur lupa password aktif.'
            : 'Konfigurasi belum lengkap. Isi host, port, dan alamat pengirim.'}
        </span>
      </div>

      <div className='space-y-4 pt-2 border-t border-line/60'>
        {/* Provider */}
        <div>
          <label className='block text-xs font-semibold text-ink-soft mb-1.5'>Provider SMTP</label>
          <div className='flex flex-wrap gap-2'>
            {presets.map((p) => (
              <button
                key={p.id}
                type='button'
                onClick={() => pilihPreset(p.id)}
                className={
                  'px-3 py-1.5 text-[11px] font-semibold rounded-md border transition cursor-pointer ' +
                  (provider === p.id
                    ? 'bg-pine text-surface border-pine'
                    : 'bg-surface-sunken text-ink-muted border-line hover:border-line-strong hover:text-ink')
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className='text-[10px] text-ink-faint mt-1.5'>
            Memilih provider hanya mengisi host dan port. Kredensial tetap diisi manual.
          </p>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='block text-xs font-semibold text-ink-soft mb-1.5'>Host SMTP</label>
            <input
              type='text'
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder='smtp-relay.brevo.com'
              className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono'
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='block text-xs font-semibold text-ink-soft mb-1.5'>Port</label>
              <input
                type='number'
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                placeholder='587'
                className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono'
              />
            </div>
            <div>
              <label className='block text-xs font-semibold text-ink-soft mb-1.5'>TLS</label>
              <button
                type='button'
                onClick={() => setSecure(!secure)}
                className={
                  'w-full px-3 py-2 text-xs font-semibold rounded-md border transition cursor-pointer ' +
                  (secure
                    ? 'bg-pine text-surface border-pine'
                    : 'bg-surface-sunken text-ink-muted border-line hover:border-line-strong')
                }
                title={
                  secure
                    ? 'TLS langsung (biasanya port 465)'
                    : 'STARTTLS (biasanya port 587)'
                }
              >
                {secure ? 'Langsung' : 'STARTTLS'}
              </button>
            </div>
          </div>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='block text-xs font-semibold text-ink-soft mb-1.5'>Login SMTP</label>
            <input
              type='text'
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder='bc72d7001@smtp-brevo.com'
              className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono'
            />
          </div>
          <div>
            <label className='block text-xs font-semibold text-ink-soft mb-1.5 flex items-center justify-between'>
              <span>Kunci SMTP</span>
              {hasPass && <span className='text-[10px] text-pine'>Tersimpan</span>}
            </label>
            <input
              type='password'
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={hasPass ? '•••••••• (Biarkan jika tidak ingin ganti)' : 'Kunci SMTP dari provider'}
              className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono'
            />
          </div>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='block text-xs font-semibold text-ink-soft mb-1.5'>Alamat Pengirim</label>
            <input
              type='text'
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              placeholder='noreply@mail.srvx.my.id'
              className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono'
            />
            <p className='text-[10px] text-ink-faint mt-1'>
              Harus memakai domain yang SPF dan DKIM-nya sudah terpasang.
            </p>
          </div>
          <div>
            <label className='block text-xs font-semibold text-ink-soft mb-1.5'>Nama Pengirim</label>
            <input
              type='text'
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder='SRVX Apps'
              className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine'
            />
          </div>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
          <div>
            <label className='block text-xs font-semibold text-ink-soft mb-1.5'>
              Alamat Balasan (opsional)
            </label>
            <input
              type='text'
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder='support@domain.com'
              className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono'
            />
          </div>
          <div>
            <label className='block text-xs font-semibold text-ink-soft mb-1.5'>
              Masa Berlaku Tautan Reset (menit)
            </label>
            <input
              type='number'
              value={resetTtlMenit}
              onChange={(e) => setResetTtlMenit(Number(e.target.value))}
              placeholder='30'
              className='w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-pine font-mono'
            />
          </div>
        </div>

        {/* Tombol aksi */}
        <div className='flex flex-wrap gap-2 pt-2'>
          <button
            type='button'
            onClick={simpan}
            disabled={menyimpan}
            className='flex items-center gap-2 px-4 py-2 bg-pine hover:bg-pine-soft disabled:opacity-50 text-surface text-xs font-semibold rounded-md transition cursor-pointer'
          >
            {menyimpan ? <Loader2 className='w-3.5 h-3.5 animate-spin' /> : <CheckCircle2 className='w-3.5 h-3.5' />}
            Simpan Konfigurasi Email
          </button>

          <button
            type='button'
            onClick={ujiKoneksi}
            disabled={menguji}
            className='flex items-center gap-2 px-4 py-2 bg-surface-sunken hover:bg-surface-alt disabled:opacity-50 border border-line text-ink-soft text-xs font-semibold rounded-md transition cursor-pointer'
          >
            {menguji ? <Loader2 className='w-3.5 h-3.5 animate-spin' /> : <PlugZap size={13} />}
            Uji Koneksi
          </button>
        </div>

        {/* Kirim email uji */}
        <div className='bg-surface-sunken/70 border border-line rounded-md p-4 space-y-3'>
          <div className='flex items-center gap-2 text-xs font-semibold text-ink-soft'>
            <Send size={13} className='text-sea' />
            Kirim Email Uji
          </div>
          <p className='text-[11px] text-ink-muted leading-relaxed'>
            Mengirim email sungguhan untuk memastikan tautan reset benar-benar sampai ke kotak masuk,
            bukan hanya autentikasi yang berhasil.
          </p>
          <div className='flex flex-col sm:flex-row gap-2'>
            <input
              type='email'
              value={emailUji}
              onChange={(e) => setEmailUji(e.target.value)}
              placeholder='alamat@tujuan.com'
              className='flex-1 bg-surface border border-line rounded-md px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-sea font-mono'
            />
            <button
              type='button'
              onClick={kirimUji}
              disabled={mengirim || !emailUji.trim()}
              className='flex items-center justify-center gap-2 px-4 py-2 bg-sea hover:bg-sea-soft disabled:opacity-50 text-surface text-xs font-semibold rounded-md transition cursor-pointer'
            >
              {mengirim ? <Loader2 className='w-3.5 h-3.5 animate-spin' /> : <Send size={13} />}
              Kirim
            </button>
          </div>
        </div>

        <div className='bg-surface-sunken/80 border border-line rounded-md p-4 text-xs space-y-1.5 text-ink-muted'>
          <div className='flex items-center gap-2 text-ink-soft font-semibold'>
            <Info size={14} className='text-pine' />
            Catatan
          </div>
          <p className='text-[11px] leading-relaxed'>
            Alamat pengirim wajib memakai domain yang sudah punya catatan SPF dan DKIM. Untuk Brevo,
            gunakan subdomain pengirim (misalnya <b>mail.</b>domain Anda) — bukan domain utama, karena
            DKIM biasanya hanya terpasang di subdomain tersebut.
          </p>
        </div>
      </div>
    </div>
  );
};
