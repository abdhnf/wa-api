import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Webhook, Plus, Trash2, Send, RefreshCw, Loader2, CheckCircle2,
  XCircle, Clock, AlertTriangle, Copy, Check, Power, KeyRound, Pencil, History,
} from 'lucide-react';
import {
  apiGetWebhooks, apiCreateWebhook, apiDeleteWebhook, apiUpdateWebhook,
  apiTestWebhook, apiGetWebhookDeliveries, apiRetryWebhookDelivery,
  apiRotateWebhookSecret, apiGetSessions, type WebhookMatchType,
} from '../api';
import { Modal, ConfirmDialog } from './ui/Modal';

interface WebhookItem {
  id: string;
  url: string;
  events: string[];
  /** Sudah disamarkan server; nilai asli hanya muncul sekali saat dibuat. */
  secret: string;
  status: 'active' | 'disabled';
  sessionId?: string | null;
  chatTypes?: string[] | null;
  matchType?: 'exact' | 'contains' | 'keyword' | 'regex' | null;
  matchValue?: string | null;
  lastSuccessAt?: string | null;
  failureCount?: number;
}

interface DeliveryItem {
  id: string;
  event: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  /** Body yang benar-benar dikirim. Disimpan server, jadi bisa diperiksa ulang. */
  payload?: string;
  /** Kunci idempotensi yang dikirim di header, untuk dicocokkan dengan log penerima. */
  idempotencyKey?: string | null;
}

const SEMUA_EVENT = ['message.received', 'message.status', 'session.status'];

/**
 * Rapikan body JSON untuk ditampilkan.
 *
 * Body yang tersimpan adalah string apa adanya. Kalau bukan JSON yang sah
 * (misalnya terpotong), tampilkan mentahnya — lebih baik daripada kosong.
 * String kosong berarti body sudah dibersihkan sesuai masa simpan, bukan
 * "tidak pernah ada".
 */
function formatPayload(payload: string | undefined): string {
  if (!payload) return '(body sudah dibersihkan sesuai masa simpan)';
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

const JENIS_CHAT: Array<{ value: string; label: string; hint: string }> = [
  { value: 'private', label: 'Chat pribadi', hint: 'pesan dari nomor pelanggan' },
  { value: 'group', label: 'Grup', hint: 'pesan dari grup WhatsApp' },
  { value: 'broadcast', label: 'Status/broadcast', hint: 'pesan status @broadcast' },
];

/**
 * Pilihan filter isi pesan.
 *
 * Istilahnya sengaja sama dengan aturan chatbot — `exact`, `contains`,
 * `keyword`, `regex` — supaya aturan yang sudah terbukti di chatbot bisa
 * dipindahkan ke sini tanpa menerjemahkan apa pun.
 */
const FILTER_PESAN: Array<{ value: string; label: string; hint: string; contoh: string }> = [
  { value: '', label: 'Tanpa filter', hint: 'semua pesan diteruskan', contoh: '' },
  { value: 'exact', label: 'Sama persis', hint: 'seluruh teks harus sama', contoh: 'menu' },
  { value: 'contains', label: 'Mengandung', hint: 'teks memuat rangkaian ini', contoh: 'harga' },
  { value: 'keyword', label: 'Kata kunci', hint: 'pisahkan dengan koma, salah satu cocok', contoh: 'harga,ongkir,stok' },
  { value: 'regex', label: 'Regex', hint: 'pola lanjutan, tidak peka huruf besar', contoh: '^(pesan|order)\\s+\\d+' },
];

const formKosong: {
  url: string;
  events: string[];
  sessionId: string;
  chatTypes: string[];
  matchType: PilihanFilter;
  matchValue: string;
} = {
  url: '',
  events: ['message.received'],
  sessionId: '',
  chatTypes: ['private'],
  matchType: '',
  matchValue: '',
};

interface Props {
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

/** Nilai `<select>` filter. String kosong = tanpa filter; cast ke tipe API di satu titik. */
type PilihanFilter = '' | WebhookMatchType;

/**
 * Halaman Webhook.
 *
 * Tiga hal yang membuat integrasi bisa dipercaya ditampilkan di sini:
 * konfigurasi, hasil uji kirim, dan riwayat percobaan. Sebelum halaman ini ada,
 * endpoint `/webhooks` hanya menyimpan konfigurasi dan tidak pernah mengirim
 * apa pun.
 */
export const WebhooksPage: React.FC<Props> = ({ showToast }) => {
  /**
   * `showToast` disimpan di ref supaya pemuat data tidak bergantung pada
   * identitas prop. Lihat catatan lengkap di `ChatbotPage`: prop yang berubah
   * identitas + pemanggilan toast di jalur galat membentuk loop permintaan.
   */
  const toastRef = useRef(showToast);
  useEffect(() => { toastRef.current = showToast; }, [showToast]);

  const [hooks, setHooks] = useState<WebhookItem[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Formulir: satu state untuk tambah dan ubah. `editId` null = menambah.
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...formKosong });
  const [hapusTarget, setHapusTarget] = useState<WebhookItem | null>(null);
  const [rotasiTarget, setRotasiTarget] = useState<WebhookItem | null>(null);

  const [secretBaru, setSecretBaru] = useState<string | null>(null);
  const [disalin, setDisalin] = useState(false);

  const [aktif, setAktif] = useState<WebhookItem | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [memuatRiwayat, setMemuatRiwayat] = useState(false);
  const [payloadLihat, setPayloadLihat] = useState<DeliveryItem | null>(null);

  /**
   * Dua tab, mengikuti pola sub-tab di halaman Monitor.
   *
   * Riwayat dipisah dari daftar karena keduanya menjawab pertanyaan berbeda:
   * daftar menjawab "endpoint mana yang aktif", riwayat menjawab "kenapa
   * kiriman ini gagal". Menyatukannya membuat satu halaman berisi dua tabel
   * yang saling mendorong ke bawah.
   */
  const [tab, setTab] = useState<'webhook' | 'riwayat'>('webhook');

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      const [res, sesi] = await Promise.all([apiGetWebhooks(), apiGetSessions()]);
      setHooks(res?.webhooks || []);
      setSessions(sesi || []);
    } catch (err: any) {
      toastRef.current(err?.message || 'Gagal memuat webhook', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  const muatRiwayat = useCallback(async (hook: WebhookItem) => {
    setMemuatRiwayat(true);
    try {
      const res = await apiGetWebhookDeliveries(hook.id, { limit: 25 });
      setDeliveries(res?.deliveries || []);
    } catch (err: any) {
      toastRef.current(err?.message || 'Gagal memuat riwayat', 'error');
    } finally {
      setMemuatRiwayat(false);
    }
  }, []);

  const bukaRiwayat = (hook: WebhookItem) => {
    setAktif(hook);
    setTab('riwayat');
    void muatRiwayat(hook);
  };

  /** Pilih webhook dari dropdown di tab Riwayat. */
  const pilihRiwayat = (id: string) => {
    const hook = hooks.find((h) => h.id === id) || null;
    setAktif(hook);
    if (hook) void muatRiwayat(hook);
    else setDeliveries([]);
  };

  const bukaFormTambah = () => {
    setEditId(null);
    setForm({ ...formKosong });
    setFormOpen(true);
  };

  const bukaFormUbah = (hook: WebhookItem) => {
    setEditId(hook.id);
    setForm({
      url: hook.url,
      events: [...hook.events],
      sessionId: hook.sessionId || '',
      chatTypes: hook.chatTypes && hook.chatTypes.length ? [...hook.chatTypes] : ['private'],
      matchType: hook.matchType || '',
      matchValue: hook.matchValue || '',
    });
    setFormOpen(true);
  };

  const simpan = async () => {
    if (!form.url.trim()) return showToast('URL wajib diisi', 'error');
    if (form.events.length === 0) return showToast('Pilih minimal satu event', 'error');
    if (form.chatTypes.length === 0) return showToast('Pilih minimal satu jenis chat', 'error');
    // Setengah filter lebih berbahaya daripada tidak ada filter: tanpa nilai,
    // operator mengira pesannya sudah tersaring padahal semuanya lolos.
    if (form.matchType && !form.matchValue.trim()) {
      return showToast('Isi nilai filter, atau pilih "Tanpa filter"', 'error');
    }

    setBusy('simpan');
    try {
      if (editId) {
        await apiUpdateWebhook(editId, {
          url: form.url.trim(),
          events: form.events,
          sessionId: form.sessionId || null,
          chatTypes: form.chatTypes,
          // `null` eksplisit melepas filter; tanpa ini filter lama bertahan
          // meskipun operator sudah memilih "Tanpa filter".
          matchType: form.matchType || null,
          matchValue: form.matchType ? form.matchValue.trim() : null,
        });
        showToast('Webhook diperbarui', 'success');
      } else {
        const res = await apiCreateWebhook(form.url.trim(), form.events, {
          sessionId: form.sessionId || null,
          chatTypes: form.chatTypes,
          matchType: form.matchType || null,
          matchValue: form.matchType ? form.matchValue.trim() : null,
        });
        // Secret hanya dikembalikan sekali saat pendaftaran. Disimpan di state
        // supaya operator sempat menyalinnya sebelum menutup dialog.
        setSecretBaru(res?.secret || null);
        showToast('Webhook terdaftar', 'success');
      }
      setFormOpen(false);
      setEditId(null);
      setForm({ ...formKosong });
      await muat();
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan webhook', 'error');
    } finally {
      setBusy(null);
    }
  };

  const uji = async (hook: WebhookItem) => {
    setBusy(hook.id);
    try {
      const res = await apiTestWebhook(hook.id);
      if (res?.success) {
        showToast(`Berhasil (HTTP ${res.statusCode}, ${res.durationMs}ms)`, 'success');
      } else {
        showToast(`Gagal: ${res?.error || `HTTP ${res?.statusCode}`}`, 'error');
      }
      if (aktif?.id === hook.id) void muatRiwayat(hook);
    } catch (err: any) {
      showToast(err?.message || 'Uji kirim gagal', 'error');
    } finally {
      setBusy(null);
    }
  };

  const ubahStatus = async (hook: WebhookItem) => {
    setBusy(hook.id);
    try {
      await apiUpdateWebhook(hook.id, { status: hook.status === 'active' ? 'disabled' : 'active' });
      await muat();
      showToast(hook.status === 'active' ? 'Webhook dinonaktifkan' : 'Webhook diaktifkan', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengubah status', 'error');
    } finally {
      setBusy(null);
    }
  };

  const konfirmasiHapus = async () => {
    if (!hapusTarget) return;
    setBusy(hapusTarget.id);
    try {
      await apiDeleteWebhook(hapusTarget.id);
      if (aktif?.id === hapusTarget.id) setAktif(null);
      setHapusTarget(null);
      await muat();
      showToast('Webhook dihapus', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghapus', 'error');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Ganti secret untuk webhook yang sudah ada.
   *
   * Diperlukan karena secret hanya bisa dibaca sekali — webhook yang dibuat
   * sebelum salinannya disimpan tidak punya jalan lain selain didaftar ulang,
   * yang ikut menghapus riwayat pengirimannya.
   */
  const konfirmasiRotasi = async () => {
    if (!rotasiTarget) return;
    setBusy(rotasiTarget.id);
    try {
      const res = await apiRotateWebhookSecret(rotasiTarget.id);
      setSecretBaru(res?.secret || null);
      setRotasiTarget(null);
      await muat();
      showToast('Secret diganti. Salin nilainya sekarang', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengganti secret', 'error');
    } finally {
      setBusy(null);
    }
  };

  const salinSecret = async () => {
    if (!secretBaru) return;
    try {
      await navigator.clipboard.writeText(secretBaru);
      setDisalin(true);
      setTimeout(() => setDisalin(false), 2000);
    } catch {
      showToast('Gagal menyalin. Salin manual dari kotak di atas', 'error');
    }
  };

  const statusIkon = (s: DeliveryItem['status']) => {
    if (s === 'success') return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
    if (s === 'failed') return <XCircle className="w-4 h-4 text-red-600" />;
    return <Clock className="w-4 h-4 text-amber-600" />;
  };

  const namaSesi = (id: string) => sessions.find((s) => s.id === id)?.name || id;

  /** Label pendek untuk jenis filter, dipakai di badge daftar. */
  const labelFilter = (tipe: string) => FILTER_PESAN.find((f) => f.value === tipe)?.label || tipe;

  const ulangiPengiriman = async (d: DeliveryItem) => {
    try {
      await apiRetryWebhookDelivery(d.id);
      showToast('Dimasukkan kembali ke antrean', 'success');
      const hook = aktif;
      if (hook) setTimeout(() => void muatRiwayat(hook), 1500);
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengulang', 'error');
    }
  };

  /**
   * Aksi "ulangi" untuk satu pengiriman.
   *
   * Tombolnya hanya muncul bila body-nya masih ada. Setelah masa simpan lewat,
   * body dibersihkan dan mengulang akan mengirim string kosong ke penerima.
   * Server menolaknya dengan 409, tetapi menyembunyikan tombolnya lebih jujur
   * daripada menawarkan aksi yang pasti gagal.
   */
  const tombolUlangi = (d: DeliveryItem) => {
    if (d.status !== 'failed') return null;
    if (!d.payload) {
      return (
        <span className="text-ink-soft" title="Body sudah dibersihkan sesuai masa simpan">
          body dibersihkan
        </span>
      );
    }
    return (
      <button onClick={() => void ulangiPengiriman(d)} className="underline">
        ulangi
      </button>
    );
  };

  return (
    <div className="space-y-6 wa-page">
      {/*
        Header mengikuti pola halaman Playground dan API Logs: satu kartu
        berisi ikon, judul, keterangan, dan aksi.
      */}
      <div className="bg-surface border border-line rounded-md p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-md bg-pine-wash text-pine border border-pine-line/60 flex items-center justify-center shrink-0">
            <Webhook className="w-5 h-5" />
          </div>
          {/*
            `min-w-0` wajib di dua tingkat: tanpa itu teks keterangan menolak
            menyusut, dan pada lebar 640-1024px tombol di kanan terdorong
            keluar kartu (terukur 6px di 753px).
          */}
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink">Webhook</h2>
            <p className="text-xs text-ink-muted">
              Kirim event ke aplikasi lain. Setiap kiriman ditandatangani HMAC-SHA256 dan dicoba ulang bila gagal.
            </p>
          </div>
        </div>
        {/*
          `flex-wrap` pada grup aksi: pada lebar 640-1024px ruang untuk judul
          dan tombol sama-sama sempit. Membiarkan tombol membungkus lebih baik
          daripada mendorongnya keluar kartu.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void muat()}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-ink-soft bg-surface-sunken hover:bg-surface-alt rounded-md border border-line transition shrink-0 disabled:opacity-50"
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Muat ulang</span>
          </button>
          <button
            onClick={bukaFormTambah}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-pine hover:bg-pine-soft rounded-md transition shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah</span>
          </button>
        </div>
      </div>

      {/* Sub-tab, pola yang sama dengan halaman Monitor. */}
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <button
          onClick={() => setTab('webhook')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition ${
            tab === 'webhook' ? 'bg-pine text-surface' : 'text-ink-muted hover:text-ink hover:bg-surface'
          }`}
        >
          <Webhook className="w-3.5 h-3.5" /> Endpoint
          {hooks.length > 0 && <span className="opacity-70">({hooks.length})</span>}
        </button>
        <button
          onClick={() => {
            setTab('riwayat');
            // Buka tab tanpa pilihan: pakai webhook pertama supaya tabelnya
            // tidak kosong hanya karena operator belum memilih apa pun.
            if (!aktif && hooks.length > 0) pilihRiwayat(hooks[0].id);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition ${
            tab === 'riwayat' ? 'bg-pine text-surface' : 'text-ink-muted hover:text-ink hover:bg-surface'
          }`}
        >
          <History className="w-3.5 h-3.5" /> Riwayat pengiriman
        </button>
      </div>

      {secretBaru && (
        <div className="rounded-md border border-honey-line bg-honey-wash p-4 space-y-2">
          <div className="flex items-center gap-2 text-honey-deep font-medium text-sm">
            <AlertTriangle className="w-4 h-4" /> Simpan secret ini sekarang
          </div>
          <p className="text-xs text-honey-deep/80">
            Nilainya tidak akan ditampilkan lagi. Penerima memakainya untuk memverifikasi tanda tangan.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-surface border border-honey-line rounded px-2 py-1.5 break-all">
              {secretBaru}
            </code>
            <button onClick={() => void salinSecret()} className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-line bg-surface text-sm shrink-0">
              {disalin ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {disalin ? 'Tersalin' : 'Salin'}
            </button>
          </div>
          <button onClick={() => setSecretBaru(null)} className="text-xs text-honey-deep underline">
            Saya sudah menyimpannya
          </button>
        </div>
      )}

      {tab === 'webhook' && (
        <>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <Loader2 className="w-4 h-4 animate-spin" /> Memuat…
            </div>
          ) : hooks.length === 0 ? (
            <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-ink-soft">
              Belum ada webhook. Tambahkan satu untuk mulai menerima event.
            </div>
          ) : (
            <div className="space-y-2">
              {hooks.map((hook) => (
                <div key={hook.id} className="rounded-md border border-line bg-surface p-3 sm:p-4">
                  {/*
                    Mobile: isi kartu dulu, aksi di baris sendiri di bawah.
                    Enam tombol aksi tidak muat sebaris dengan badge status di
                    360px, dan memaksanya membuat URL terhimpit jadi satu kata
                    per baris. Di sm ke atas aksi kembali ke kanan.
                  */}
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded ${hook.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-sunken text-ink-soft'}`}>
                          {hook.status === 'active' ? 'aktif' : 'nonaktif'}
                        </span>
                        {hook.sessionId ? (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-pine-wash text-pine-deep">
                            sesi {namaSesi(hook.sessionId)}
                          </span>
                        ) : (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-sunken text-ink-soft">semua sesi</span>
                        )}
                      </div>

                      <code className="block mt-1.5 text-xs break-all">{hook.url}</code>

                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {hook.events.map((e) => (
                          <span key={e} className="text-[11px] px-1.5 py-0.5 rounded bg-shell text-ink-soft">{e}</span>
                        ))}
                        {(hook.chatTypes || []).map((c) => (
                          <span key={c} className="text-[11px] px-1.5 py-0.5 rounded bg-sea-wash text-sea-deep">{c}</span>
                        ))}
                        {/* Filter isi pesan ditampilkan menonjol: inilah yang menentukan
                            apakah integrasi menerima semua pesan atau hanya sebagian. */}
                        {hook.matchType && hook.matchValue ? (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-honey-wash text-honey-deep border border-honey-line">
                            {labelFilter(hook.matchType)}: <code className="font-mono">{hook.matchValue}</code>
                          </span>
                        ) : (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-sunken text-ink-soft">semua pesan</span>
                        )}
                      </div>

                      <p className="text-[11px] text-ink-soft mt-1.5 break-words">
                        secret <code>{hook.secret}</code>
                        {hook.lastSuccessAt ? ` · sukses terakhir ${hook.lastSuccessAt}` : ' · belum pernah sukses'}
                        {hook.failureCount ? ` · ${hook.failureCount} kegagalan beruntun` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1.5 sm:shrink-0">
                      <button
                        onClick={() => void uji(hook)}
                        className="inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-sunken transition disabled:opacity-50"
                        disabled={busy === hook.id}
                        title="Kirim payload uji"
                        aria-label="Kirim payload uji"
                      >
                        {busy === hook.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        <span className="hidden sm:inline">Uji</span>
                      </button>
                      <button
                        onClick={() => bukaRiwayat(hook)}
                        className="inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-sunken transition"
                        title="Lihat riwayat pengiriman"
                        aria-label="Lihat riwayat pengiriman"
                      >
                        <History className="w-4 h-4" />
                        <span className="hidden sm:inline">Riwayat</span>
                      </button>
                      <button onClick={() => bukaFormUbah(hook)} className="inline-flex items-center justify-center px-2.5 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-sunken transition" title="Ubah webhook" aria-label="Ubah webhook">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setRotasiTarget(hook)}
                        className="inline-flex items-center justify-center px-2.5 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-sunken transition disabled:opacity-50"
                        disabled={busy === hook.id}
                        title="Ganti secret webhook"
                        aria-label="Ganti secret webhook"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button onClick={() => void ubahStatus(hook)} className="inline-flex items-center justify-center px-2.5 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-sunken transition disabled:opacity-50" disabled={busy === hook.id} title={hook.status === 'active' ? 'Nonaktifkan' : 'Aktifkan'} aria-label={hook.status === 'active' ? 'Nonaktifkan webhook' : 'Aktifkan webhook'}>
                        <Power className="w-4 h-4" />
                      </button>
                      <button onClick={() => setHapusTarget(hook)} className="inline-flex items-center justify-center px-2.5 h-9 rounded-md border border-line bg-surface text-red-600 hover:bg-clay-wash transition disabled:opacity-50" disabled={busy === hook.id} title="Hapus webhook" aria-label="Hapus webhook">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'riwayat' && (
        <div className="bg-surface border border-line rounded-md overflow-hidden">
          <div className="p-3.5 sm:p-4 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                <History className="w-3.5 h-3.5 text-pine shrink-0" />
                <span className="truncate">Riwayat pengiriman</span>
              </h3>
              <p className="text-[11px] text-ink-faint mt-0.5 leading-relaxed">
                Satu baris per percobaan kirim. Body yang sudah lewat masa simpan dikosongkan.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={aktif?.id || ''}
                onChange={(e) => pilihRiwayat(e.target.value)}
                className="min-w-0 flex-1 sm:flex-none sm:w-64 px-3 h-9 rounded-md border border-line bg-surface text-sm"
                aria-label="Pilih webhook"
              >
                {hooks.length === 0 && <option value="">Belum ada webhook</option>}
                {hooks.map((h) => (
                  <option key={h.id} value={h.id}>{h.url}</option>
                ))}
              </select>
              <button
                onClick={() => aktif && void muatRiwayat(aktif)}
                disabled={!aktif || memuatRiwayat}
                className="inline-flex items-center justify-center px-3 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-sunken transition disabled:opacity-50"
                title="Muat ulang riwayat"
                aria-label="Muat ulang riwayat"
              >
                <RefreshCw className={`w-4 h-4 ${memuatRiwayat ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {!aktif ? (
            <div className="p-10 text-center text-sm text-ink-soft">
              Pilih webhook di atas untuk melihat riwayatnya.
            </div>
          ) : deliveries.length === 0 ? (
            <div className="p-10 text-center text-sm text-ink-soft">
              {memuatRiwayat ? 'Memuat riwayat…' : 'Belum ada pengiriman tercatat untuk webhook ini.'}
            </div>
          ) : (
            /*
              Tabel, bukan kartu. Di layar sempit tabel menggeser ke samping di
              dalam kartunya sendiri (min-w + overflow-x-auto), pola yang sama
              dengan tabel Delivery Queue di halaman Monitor. Kolom Waktu
              diletakkan paling kiri karena itu yang dicari lebih dulu saat
              menelusuri kegagalan.
            */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[720px]">
                <thead className="bg-surface-sunken text-ink-muted uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="px-4 py-3">Waktu</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">HTTP</th>
                    <th className="px-4 py-3">Percobaan</th>
                    <th className="px-4 py-3">Body</th>
                    <th className="px-4 py-3">Galat</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{d.createdAt}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1">{statusIkon(d.status)} {d.status}</span>
                      </td>
                      <td className="px-4 py-3"><code>{d.event}</code></td>
                      <td className="px-4 py-3">{d.lastStatusCode ?? '-'}</td>
                      <td className="px-4 py-3">{d.attempts}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setPayloadLihat(d)}
                          className="underline text-ink-soft hover:text-ink"
                          title="Lihat body yang dikirim"
                        >
                          payload
                        </button>
                      </td>
                      <td className="px-4 py-3 text-red-600 max-w-[280px]">
                        <span className="block truncate" title={d.lastError || ''}>{d.lastError || '-'}</span>
                        <span className="text-xs">{tombolUlangi(d)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Formulir tambah/ubah — satu modal untuk keduanya. */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditId(null); }}
        title={editId ? 'Ubah webhook' : 'Tambah webhook'}
        description={
          editId
            ? 'Secret tidak berubah. Gunakan tombol kunci untuk menggantinya.'
            : 'Secret baru ditampilkan sekali setelah webhook dibuat.'
        }
        icon={<div className="p-2.5 rounded-md bg-sea-wash border border-sea-line/60 text-sea-deep"><Webhook className="w-5 h-5" /></div>}
        size="xl"
        busy={busy === 'simpan'}
        footer={
          <>
            <button
              type="button"
              onClick={() => { setFormOpen(false); setEditId(null); }}
              disabled={busy === 'simpan'}
              className="px-4 py-2 bg-surface-alt text-ink-soft rounded-md text-xs font-semibold disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => void simpan()}
              disabled={busy === 'simpan'}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-pine text-white rounded-md text-xs font-semibold disabled:opacity-50"
            >
              {busy === 'simpan' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {editId ? 'Simpan perubahan' : 'Daftarkan'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">URL penerima</label>
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://dashboard.example.com/api/wa/webhook"
              className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm focus:outline-none focus:border-pine"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Event</label>
            <div className="flex flex-wrap gap-3">
              {SEMUA_EVENT.map((e) => (
                <label key={e} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.events.includes(e)}
                    onChange={(ev) =>
                      setForm((p) => ({
                        ...p,
                        events: ev.target.checked ? [...p.events, e] : p.events.filter((x) => x !== e),
                      }))
                    }
                  />
                  <code className="text-xs">{e}</code>
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1">Berlaku untuk sesi</label>
              <select
                value={form.sessionId}
                onChange={(e) => setForm({ ...form, sessionId: e.target.value })}
                className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm"
              >
                <option value="">Semua sesi</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name || s.id}</option>
                ))}
              </select>
              <p className="text-[11px] text-ink-soft mt-1">
                Pilih satu sesi bila endpoint ini hanya menangani nomor tersebut.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Jenis chat yang dikirim</label>
              <div className="flex flex-col gap-1.5 pt-1">
                {JENIS_CHAT.map((j) => (
                  <label key={j.value} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={form.chatTypes.includes(j.value)}
                      onChange={(ev) =>
                        setForm((p) => ({
                          ...p,
                          chatTypes: ev.target.checked
                            ? [...p.chatTypes, j.value]
                            : p.chatTypes.filter((x) => x !== j.value),
                        }))
                      }
                    />
                    <span>
                      {j.label}
                      <span className="text-[11px] text-ink-soft">: {j.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Filter isi pesan: batas antara "semua pesan" dan "hanya yang cocok". */}
          <div className="rounded-md border border-line bg-surface-sunken p-3 space-y-2">
            <div>
              <label className="block text-sm font-medium">Filter isi pesan</label>
              <p className="text-[11px] text-ink-soft">
                Tanpa filter, setiap pesan masuk diteruskan. Dengan filter, hanya pesan yang cocok
                yang dikirim. Penghematan terbesar ada di sini, bukan di cakupan sesi.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_1fr]">
              <div>
                <label className="block text-xs font-medium mb-1 text-ink-soft">Cara cocok</label>
                <select
                  value={form.matchType}
                  onChange={(e) => setForm({ ...form, matchType: e.target.value as PilihanFilter })}
                  className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm"
                >
                  {FILTER_PESAN.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1 text-ink-soft">Nilai</label>
                <input
                  value={form.matchValue}
                  onChange={(e) => setForm({ ...form, matchValue: e.target.value })}
                  disabled={!form.matchType}
                  placeholder={FILTER_PESAN.find((f) => f.value === form.matchType)?.contoh || 'Pilih cara cocok dulu'}
                  className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm focus:outline-none focus:border-pine disabled:opacity-50 disabled:bg-surface-sunken"
                />
              </div>
            </div>
            <p className="text-[11px] text-ink-soft">
              {FILTER_PESAN.find((f) => f.value === form.matchType)?.hint}
              {form.matchType === 'keyword' ? ' · contoh: harga,ongkir,stok' : ''}
              {form.matchType && form.matchType !== 'regex' ? ' · tidak peka huruf besar/kecil' : ''}
            </p>
            {form.matchType && form.matchType !== 'regex' && (
              <p className="text-[11px] text-ink-soft">
                Pesan bergambar ikut dinilai dari caption-nya.
              </p>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(hapusTarget)}
        title="Hapus webhook?"
        message={
          <>
            Webhook ke <strong className="break-all">{hapusTarget?.url}</strong> akan dihapus beserta
            seluruh riwayat pengirimannya. Event yang sedang menunggu di antrean ikut hilang.
          </>
        }
        confirmLabel="Hapus webhook"
        busy={Boolean(hapusTarget && busy === hapusTarget.id)}
        onConfirm={() => void konfirmasiHapus()}
        onCancel={() => setHapusTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(rotasiTarget)}
        title="Ganti secret?"
        message={
          <>
            Penerima akan menolak <strong>semua</strong> kiriman sampai secret baru dipasang di
            sana. Secret lama langsung tidak berlaku. Salinan secret baru ditampilkan sekali
            setelah ini.
          </>
        }
        confirmLabel="Ganti secret"
        busy={Boolean(rotasiTarget && busy === rotasiTarget.id)}
        onConfirm={() => void konfirmasiRotasi()}
        onCancel={() => setRotasiTarget(null)}
      />

      {/*
        Body yang benar-benar dikirim. Tanpa ini, "HTTP 500" hanya memberi tahu
        bahwa penerima menolak, bukan apa yang ditolaknya. Payload sudah
        tersimpan di baris antrean, jadi tidak ada request tambahan.
      */}
      <Modal
        open={Boolean(payloadLihat)}
        onClose={() => setPayloadLihat(null)}
        title="Body yang dikirim"
        description={
          payloadLihat
            ? `${payloadLihat.event} · percobaan ${payloadLihat.attempts} · ${payloadLihat.createdAt}`
            : undefined
        }
        size="xl"
        footer={
          <button
            type="button"
            onClick={() => setPayloadLihat(null)}
            className="px-4 py-2 bg-surface-alt text-ink-soft rounded-md text-xs font-semibold"
          >
            Tutup
          </button>
        }
      >
        <div className="space-y-3">
          {payloadLihat?.idempotencyKey && (
            <p className="text-xs text-ink-soft">
              <code>X-WA-Idempotency-Key</code>: <code className="break-all">{payloadLihat.idempotencyKey}</code>
            </p>
          )}
          <pre className="text-xs bg-surface-sunken border border-line rounded-md p-3 overflow-auto max-h-80 whitespace-pre-wrap break-all">
            {formatPayload(payloadLihat?.payload)}
          </pre>
        </div>
      </Modal>
    </div>
  );
};