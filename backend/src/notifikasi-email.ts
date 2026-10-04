/**
 * Notifikasi email untuk peristiwa akun.
 *
 * Dipisahkan dari password-reset.ts karena peruntukannya berbeda: modul ini
 * mengirim pemberitahuan setelah akun dibuat, bukan tautan pemulihan.
 *
 * ATURAN PENTING: kegagalan kirim email TIDAK BOLEH menggagalkan pendaftaran.
 * Akun sudah terbentuk di database sebelum fungsi ini dipanggil; kalau SMTP
 * sedang mati, pengguna tetap harus bisa masuk. Karena itu semua galat di sini
 * ditelan dan hanya dicatat di log.
 */

import { getSetting } from './db.js';
import { kirimEmail, konfigurasiLengkap } from './mailer.js';
import {
  templateRegistrasiBerhasil,
  templateRegistrasiBerhasilTeks,
} from './mail-templates.js';

/**
 * Alamat panel yang bisa dibuka pengguna.
 *
 * Diambil dari pengaturan dulu supaya admin bisa mengubahnya tanpa deploy,
 * baru jatuh ke env, lalu ke alamat pengembangan.
 */
export function ambilBasisPanel(): string {
  const dariPengaturan = (getSetting('panel_base_url') || '').trim();
  if (dariPengaturan) return dariPengaturan.replace(/\/+$/, '');

  const dariEnv = (process.env.PANEL_BASE_URL || '').trim();
  if (dariEnv) return dariEnv.replace(/\/+$/, '');

  return 'http://172.30.30.229:5174';
}

export interface HasilKirimNotifikasi {
  terkirim: boolean;
  alasan?: string;
}

/**
 * Kirim email selamat datang setelah pendaftaran berhasil.
 *
 * `butuhNomorWa` menentukan tujuan tombol di email: pendaftar lewat Google
 * diarahkan ke halaman onboarding, pendaftar manual langsung ke dashboard.
 */
export async function kirimEmailRegistrasi(params: {
  email: string;
  nama?: string;
  metode: 'manual' | 'google';
  kuotaPerHari: number;
  kuotaPerMinggu: number;
  butuhNomorWa: boolean;
}): Promise<HasilKirimNotifikasi> {
  const cfg = konfigurasiLengkap();
  if (!cfg) {
    return { terkirim: false, alasan: 'SMTP belum dikonfigurasi' };
  }

  const basis = ambilBasisPanel();
  const tautanPanel = params.butuhNomorWa ? `${basis}/onboarding` : basis;

  const data = {
    namaPenerima: params.nama,
    email: params.email,
    metode: params.metode,
    kuotaPerHari: params.kuotaPerHari,
    kuotaPerMinggu: params.kuotaPerMinggu,
    tautanPanel,
    butuhNomorWa: params.butuhNomorWa,
  };

  try {
    const hasil = await kirimEmail({
      tujuan: params.email,
      subjek: params.butuhNomorWa
        ? 'Akun Anda dibuat — lengkapi nomor WhatsApp'
        : 'Akun Anda berhasil dibuat',
      html: templateRegistrasiBerhasil(data),
      teks: templateRegistrasiBerhasilTeks(data),
    });

    if (!hasil.ok) {
      console.warn(`[registrasi] email selamat datang gagal untuk ${params.email}: ${hasil.pesan}`);
      return { terkirim: false, alasan: hasil.pesan };
    }

    return { terkirim: true };
  } catch (err) {
    // Sengaja tidak dilempar: pendaftaran sudah selesai dan tidak boleh batal
    // hanya karena email gagal.
    const pesan = err instanceof Error ? err.message : String(err);
    console.warn(`[registrasi] email selamat datang error untuk ${params.email}: ${pesan}`);
    return { terkirim: false, alasan: pesan };
  }
}
