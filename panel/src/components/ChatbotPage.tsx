import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot, Plus, Trash2, RefreshCw, Loader2, Play, Power, MessageSquare,
  ChevronDown, ChevronRight, ShieldOff, Send, Pencil, ArrowLeft, User, Search,
} from 'lucide-react';
import {
  apiGetChatbotFlows, apiCreateChatbotFlow, apiUpdateChatbotFlow, apiDeleteChatbotFlow,
  apiTestChatbot, apiGetChatbotSessions, apiGetChatbotOptouts, apiDeleteChatbotOptout,
  apiGetSessions, apiGetInboundConversations, apiGetInboundConversation,
} from '../api';
import { Modal, ConfirmDialog } from './ui/Modal';

interface Step {
  id: string;
  reply: string;
  next?: Record<string, string>;
  end?: boolean;
}

interface Flow {
  id: string;
  sessionId: string | null;
  name: string;
  enabled: boolean;
  priority: number;
  matchType: 'exact' | 'contains' | 'regex' | 'keyword';
  matchValue: string;
  replyText: string | null;
  steps: Step[] | null;
  cooldownSeconds: number;
}

interface SesiBot {
  sessionId: string;
  contactPhone: string;
  currentStep: string | null;
  flowName: string | null;
  botPausedUntil: number | null;
  lastActivityAt: string;
}

interface Optout {
  sessionId: string;
  contactPhone: string;
  reason: string | null;
  createdAt: string;
}

interface Percakapan {
  sessionId: string;
  fromPhone: string;
  pushName: string | null;
  lastText: string | null;
  lastAt: string;
  total: number;
}

interface Bubble {
  id: string;
  type: string;
  text: string | null;
  caption?: string | null;
  mime?: string | null;
  at: string | null;
}

interface Props {
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const TIPE_COCOK: Array<{ value: Flow['matchType']; label: string; contoh: string }> = [
  { value: 'keyword', label: 'Kata kunci', contoh: 'harga,biaya,price' },
  { value: 'contains', label: 'Mengandung', contoh: 'jam buka' },
  { value: 'exact', label: 'Persis sama', contoh: 'menu' },
  { value: 'regex', label: 'Regex', contoh: '^(halo|hai)\\b' },
];

const formKosong = {
  name: '',
  matchType: 'keyword' as Flow['matchType'],
  matchValue: '',
  replyText: '',
  priority: 100,
  cooldownSeconds: 0,
  sessionId: '',
};

/**
 * Label sesi yang bisa dibaca manusia: nama nomor + status koneksi.
 *
 * `id` mentah (`sess-mu7l7bol`) tidak berarti apa-apa bagi operator yang punya
 * lebih dari satu nomor, dan itulah satu-satunya cara membedakan sesi di
 * daftar. Status ikut ditampilkan karena aturan untuk nomor yang sedang
 * terputus tidak akan pernah berbunyi.
 */
function labelSesi(s: any): string {
  const nama = s?.name || s?.id || 'tanpa nama';
  return s?.status ? `${nama} (${s.status})` : nama;
}

/** Jam pendek untuk bubble: cukup `HH:MM`, tanggal sudah dipisah pemisah hari. */
function jam(waktu: string | null): string {
  if (!waktu) return '';
  const d = new Date(waktu);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function labelHari(waktu: string | null): string {
  if (!waktu) return '';
  const d = new Date(waktu);
  if (Number.isNaN(d.getTime())) return '';
  const hariIni = new Date();
  const kemarin = new Date(Date.now() - 86400000);
  const samaHari = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (samaHari(d, hariIni)) return 'Hari ini';
  if (samaHari(d, kemarin)) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Halaman Chatbot.
 *
 * Empat bagian yang dipisah karena dipakai pada saat berbeda: aturan (saat
 * menyiapkan), uji coba (sebelum mengaktifkan), percakapan (saat memantau), dan
 * opt-out. Menggabungkannya dalam satu tabel akan membuat penyusunan aturan
 * bercampur dengan pemantauan.
 */
export const ChatbotPage: React.FC<Props> = ({ showToast }) => {
  /**
   * `showToast` disimpan di ref, bukan dipakai langsung di dalam `useCallback`.
   *
   * Alasannya bukan gaya penulisan. Kalau `showToast` masuk daftar dependensi,
   * setiap kali induk mengirim fungsi baru (mis. arrow inline di JSX), callback
   * pemuat data ikut berubah identitas, effect-nya jalan lagi, dan bila
   * permintaan itu gagal ia memanggil `showToast` lagi — yang memicu render
   * induk dan mengulang siklus. Itu persis yang membuat halaman ini membanjiri
   * API sampai kena 429.
   */
  const toastRef = useRef(showToast);
  useEffect(() => { toastRef.current = showToast; }, [showToast]);

  const [tab, setTab] = useState<'aturan' | 'uji' | 'percakapan' | 'optout'>('aturan');
  const [flows, setFlows] = useState<Flow[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Formulir: satu state untuk tambah dan ubah. `editId` null = menambah.
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...formKosong });
  const [hapusTarget, setHapusTarget] = useState<Flow | null>(null);

  const [ujiSession, setUjiSession] = useState('');
  const [ujiTeks, setUjiTeks] = useState('halo');
  const [ujiHasil, setUjiHasil] = useState<any>(null);
  const [ujiJalan, setUjiJalan] = useState(false);

  const [botSessions, setBotSessions] = useState<SesiBot[]>([]);
  const [optouts, setOptouts] = useState<Optout[]>([]);
  const [lepasTarget, setLepasTarget] = useState<Optout | null>(null);

  const [percakapan, setPercakapan] = useState<Percakapan[]>([]);
  const [cariPercakapan, setCariPercakapan] = useState('');
  const [aktifChat, setAktifChat] = useState<Percakapan | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [memuatChat, setMemuatChat] = useState(false);
  const [bukaAturan, setBukaAturan] = useState<Record<string, boolean>>({});

  const muat = useCallback(async () => {
    setLoading(true);
    try {
      const [f, s] = await Promise.all([apiGetChatbotFlows(), apiGetSessions()]);
      setFlows(f?.flows || []);
      setSessions(s || []);
      // `ujiSession` sengaja TIDAK jadi dependensi: nilainya hanya dipakai untuk
      // mengisi pilihan awal, dan memasukkannya membuat setiap perubahan pilihan
      // memicu pemuatan ulang seluruh daftar.
      setUjiSession((prev) => prev || s?.[0]?.id || '');
    } catch (err: any) {
      toastRef.current(err?.message || 'Gagal memuat aturan', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void muat(); }, [muat]);

  const muatPercakapan = useCallback(async () => {
    try {
      const [s, o, c] = await Promise.all([
        apiGetChatbotSessions(50),
        apiGetChatbotOptouts(),
        apiGetInboundConversations(100),
      ]);
      setBotSessions(s?.sessions || []);
      setOptouts(o?.optouts || []);
      setPercakapan(c?.conversations || []);
    } catch (err: any) {
      toastRef.current(err?.message || 'Gagal memuat percakapan', 'error');
    }
  }, []);

  useEffect(() => {
    if (tab === 'percakapan' || tab === 'optout') void muatPercakapan();
  }, [tab, muatPercakapan]);

  const bukaChat = useCallback(async (conv: Percakapan) => {
    setAktifChat(conv);
    setMemuatChat(true);
    setBubbles([]);
    try {
      const res = await apiGetInboundConversation(conv.sessionId, conv.fromPhone, 200);
      setBubbles(res?.messages || []);
    } catch (err: any) {
      toastRef.current(err?.message || 'Gagal memuat riwayat', 'error');
    } finally {
      setMemuatChat(false);
    }
  }, []);

  const bukaFormTambah = () => {
    setEditId(null);
    setForm({ ...formKosong });
    setFormOpen(true);
  };

  const bukaFormUbah = (flow: Flow) => {
    setEditId(flow.id);
    setForm({
      name: flow.name,
      matchType: flow.matchType,
      matchValue: flow.matchValue,
      replyText: flow.replyText || '',
      priority: flow.priority,
      cooldownSeconds: flow.cooldownSeconds,
      sessionId: flow.sessionId || '',
    });
    setFormOpen(true);
  };

  const simpan = async () => {
    if (!form.name.trim()) return showToast('Nama aturan wajib diisi', 'error');
    if (!form.matchValue.trim()) return showToast('Nilai pencocokan wajib diisi', 'error');
    if (!form.replyText.trim()) return showToast('Balasan wajib diisi', 'error');

    const payload = {
      name: form.name.trim(),
      matchType: form.matchType,
      matchValue: form.matchValue.trim(),
      replyText: form.replyText,
      priority: Number(form.priority) || 100,
      cooldownSeconds: Number(form.cooldownSeconds) || 0,
      sessionId: form.sessionId || null,
    };

    setBusy('simpan');
    try {
      if (editId) {
        await apiUpdateChatbotFlow(editId, payload);
        showToast('Aturan diperbarui', 'success');
      } else {
        await apiCreateChatbotFlow(payload);
        showToast('Aturan ditambahkan', 'success');
      }
      setFormOpen(false);
      setEditId(null);
      setForm({ ...formKosong });
      await muat();
    } catch (err: any) {
      showToast(err?.message || 'Gagal menyimpan aturan', 'error');
    } finally {
      setBusy(null);
    }
  };

  const ubahAktif = async (flow: Flow) => {
    setBusy(flow.id);
    try {
      await apiUpdateChatbotFlow(flow.id, { enabled: !flow.enabled });
      await muat();
      showToast(flow.enabled ? 'Aturan dinonaktifkan' : 'Aturan diaktifkan', 'success');
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
      await apiDeleteChatbotFlow(hapusTarget.id);
      setHapusTarget(null);
      await muat();
      showToast('Aturan dihapus', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghapus', 'error');
    } finally {
      setBusy(null);
    }
  };

  const jalankanUji = async () => {
    if (!ujiSession) return showToast('Pilih sesi dulu', 'error');
    if (!ujiTeks.trim()) return showToast('Tulis pesan contoh', 'error');
    setUjiJalan(true);
    try {
      const res = await apiTestChatbot({ sessionId: ujiSession, text: ujiTeks });
      setUjiHasil(res);
    } catch (err: any) {
      showToast(err?.message || 'Uji gagal', 'error');
    } finally {
      setUjiJalan(false);
    }
  };

  const konfirmasiLepasOptout = async () => {
    if (!lepasTarget) return;
    setBusy(lepasTarget.contactPhone);
    try {
      await apiDeleteChatbotOptout(lepasTarget.sessionId, lepasTarget.contactPhone);
      setLepasTarget(null);
      await muatPercakapan();
      showToast('Opt-out dicabut', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Gagal mencabut opt-out', 'error');
    } finally {
      setBusy(null);
    }
  };

  const tabBtn = (id: typeof tab, label: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      className={`px-4 py-2 rounded-md text-xs font-semibold transition ${
        tab === id ? 'bg-pine text-surface' : 'text-ink-muted hover:text-ink hover:bg-surface'
      }`}
    >
      {label}
    </button>
  );

  const percakapanTersaring = percakapan.filter((c) => {
    if (!cariPercakapan.trim()) return true;
    const q = cariPercakapan.toLowerCase();
    return (c.fromPhone || '').includes(q) || (c.pushName || '').toLowerCase().includes(q);
  });

  const namaSesi = (id: string) => sessions.find((s) => s.id === id)?.name || id;

  return (
    <div className="space-y-6 wa-page">
      {/*
        Header mengikuti pola halaman Playground dan API Logs: satu kartu
        berisi ikon, judul, keterangan, dan aksi. Sebelumnya header di sini
        telanjang tanpa kartu, sehingga halaman ini terasa berbeda kelas
        dengan halaman lain di panel yang sama.
      */}
      <div className="bg-surface border border-line rounded-md p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-md bg-pine-wash text-pine border border-pine-line/60 flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          {/*
            `min-w-0` wajib di dua tingkat: tanpa itu teks keterangan menolak
            menyusut, dan pada lebar 640-1024px tombol di kanan terdorong
            keluar kartu (terukur 6px di 753px).
          */}
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink">Chatbot</h2>
            <p className="text-xs text-ink-muted">
              Balas otomatis pesan masuk berdasarkan aturan. Hanya berlaku di chat pribadi.
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
          {tab === 'aturan' && (
            <button
              onClick={bukaFormTambah}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-pine hover:bg-pine-soft rounded-md transition shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah aturan</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 border-b border-line pb-3">
        {tabBtn('aturan', 'Aturan')}
        {tabBtn('uji', 'Uji coba')}
        {tabBtn('percakapan', 'Percakapan')}
        {tabBtn('optout', `Opt-out${optouts.length ? ` (${optouts.length})` : ''}`)}
      </div>

      {tab === 'aturan' && (
        <>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              <Loader2 className="w-4 h-4 animate-spin" /> Memuat…
            </div>
          ) : flows.length === 0 ? (
            <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-ink-soft">
              Belum ada aturan. Tambahkan satu untuk mulai membalas otomatis.
            </div>
          ) : (
            <div className="space-y-2">
              {flows.map((flow) => (
                <div key={flow.id} className="rounded-md border border-line bg-surface p-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                          flow.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-surface-sunken text-ink-soft'
                        }`}>
                          {flow.enabled ? 'aktif' : 'nonaktif'}
                        </span>
                        <span className="font-medium text-sm">{flow.name}</span>
                        <span className="text-[11px] text-ink-soft">prioritas {flow.priority}</span>
                        {flow.sessionId && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-pine-wash text-pine-deep">
                            {namaSesi(flow.sessionId)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-soft mt-1">
                        <code>{flow.matchType}</code> · <code>{flow.matchValue}</code>
                        {flow.steps ? ` · alur ${flow.steps.length} langkah` : ''}
                        {flow.cooldownSeconds ? ` · jeda ${flow.cooldownSeconds}s` : ''}
                      </p>
                      {flow.replyText && (
                        <p className="text-xs mt-1.5 whitespace-pre-wrap text-ink-soft line-clamp-2">
                          {flow.replyText}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => bukaFormUbah(flow)}
                        className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-sunken transition"
                        title="Ubah aturan"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => void ubahAktif(flow)}
                        className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-sunken transition"
                        disabled={busy === flow.id}
                        title={flow.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                      >
                        <Power className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setHapusTarget(flow)}
                        className="inline-flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-line bg-surface text-red-600 text-sm hover:bg-clay-wash transition"
                        disabled={busy === flow.id}
                        title="Hapus aturan"
                      >
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

      {tab === 'uji' && (
        <div className="rounded-md border border-line bg-surface p-4 space-y-3">
          <p className="text-sm text-ink-soft">
            Uji aturan tanpa mengirim WhatsApp. Tidak ada pesan yang masuk antrean.
          </p>
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div>
              <label className="block text-sm font-medium mb-1">Sesi</label>
              <select
                value={ujiSession}
                onChange={(e) => setUjiSession(e.target.value)}
                className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm"
              >
                {sessions.length === 0 && <option value="">Belum ada sesi</option>}
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{labelSesi(s)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Pesan contoh</label>
              <div className="flex gap-2">
                <input
                  value={ujiTeks}
                  onChange={(e) => setUjiTeks(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void jalankanUji(); }}
                  className="flex-1 px-3 h-9 rounded-md border border-line bg-surface text-sm focus:outline-none focus:border-pine"
                />
                <button
                  onClick={() => void jalankanUji()}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-pine text-white text-sm disabled:opacity-50"
                  disabled={ujiJalan}
                >
                  {ujiJalan ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Uji
                </button>
              </div>
            </div>
          </div>

          {ujiHasil && (
            <div className="rounded-md border border-line bg-surface-sunken p-3 space-y-2 text-sm">
              {ujiHasil.optOut && (
                <p className="text-amber-800 flex items-center gap-1.5">
                  <ShieldOff className="w-4 h-4" /> Pesan ini dikenali sebagai permintaan berhenti.
                </p>
              )}
              {ujiHasil.matched ? (
                <>
                  <p className="text-xs text-ink-soft">
                    Cocok dengan aturan <code>{ujiHasil.flowId}</code>
                    {ujiHasil.nextStep ? ` · langkah berikutnya ${ujiHasil.nextStep}` : ''}
                    {ujiHasil.selesai ? ' · alur selesai' : ''}
                  </p>
                  <div className="rounded-md bg-white border border-line p-3 whitespace-pre-wrap">
                    {ujiHasil.reply}
                  </div>
                </>
              ) : (
                <p className="text-ink-soft">
                  Tidak ada aturan yang cocok. {ujiHasil.totalAturanDiperiksa} aturan diperiksa.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'percakapan' && (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/*
            Di mobile hanya satu panel yang tampil: daftar ATAU jendela chat.
            Menumpuk keduanya membuat halaman setinggi 120vh dan pengguna harus
            menggulir melewati daftar setiap kali membuka satu percakapan.
            Di lg ke atas keduanya tampil berdampingan seperti sebelumnya.
          */}
          <div className={`rounded-md border border-line bg-surface overflow-hidden ${aktifChat ? 'hidden lg:block' : ''}`}>
            <div className="p-2 border-b border-line">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft" />
                <input
                  value={cariPercakapan}
                  onChange={(e) => setCariPercakapan(e.target.value)}
                  placeholder="Cari nomor atau nama"
                  className="w-full pl-8 pr-2 h-9 rounded-md border border-line bg-surface text-sm focus:outline-none focus:border-pine"
                />
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto wa-chat-scroll">
              {percakapan.length === 0 ? (
                <div className="p-6 text-center text-sm text-ink-soft">
                  Belum ada pesan masuk.
                </div>
              ) : percakapanTersaring.length === 0 ? (
                <div className="p-6 text-center text-sm text-ink-soft">
                  Tidak ada yang cocok dengan pencarian.
                </div>
              ) : (
                percakapanTersaring.map((c) => {
                  const aktif = aktifChat?.sessionId === c.sessionId && aktifChat?.fromPhone === c.fromPhone;
                  return (
                    <button
                      key={`${c.sessionId}:${c.fromPhone}`}
                      onClick={() => void bukaChat(c)}
                      className={`w-full text-left px-3 py-2.5 border-b border-line last:border-0 transition ${
                        aktif ? 'bg-surface-sunken' : 'hover:bg-surface-sunken'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm truncate">{c.pushName || c.fromPhone}</span>
                        <span className="text-[11px] text-ink-soft shrink-0">{jam(c.lastAt)}</span>
                      </div>
                      <p className="text-xs text-ink-soft truncate mt-0.5">
                        {c.lastText || '[media]'}
                      </p>
                      <p className="text-[11px] text-ink-faint mt-0.5 truncate">
                        {namaSesi(c.sessionId)} · {c.total} pesan
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Jendela chat */}
          <div className={`rounded-md border border-line bg-surface min-h-[380px] flex-col overflow-hidden ${aktifChat ? 'flex' : 'hidden lg:flex'}`}>
            {!aktifChat ? (
              <div className="flex-1 flex flex-col items-center justify-center text-sm text-ink-soft p-8 text-center gap-2">
                <MessageSquare className="w-8 h-8 opacity-40" />
                Pilih percakapan untuk membaca riwayatnya.
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-line flex items-center gap-2">
                  <button
                    onClick={() => { setAktifChat(null); setBubbles([]); }}
                    className="lg:hidden text-ink-muted hover:text-ink p-1"
                    aria-label="Kembali ke daftar"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {aktifChat.pushName || aktifChat.fromPhone}
                    </p>
                    <p className="text-[11px] text-ink-soft truncate">
                      {aktifChat.fromPhone} · sesi {namaSesi(aktifChat.sessionId)}
                    </p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[60vh] bg-surface-sunken wa-chat-scroll">
                  {memuatChat ? (
                    <div className="flex items-center gap-2 text-sm text-ink-soft">
                      <Loader2 className="w-4 h-4 animate-spin" /> Memuat riwayat…
                    </div>
                  ) : bubbles.length === 0 ? (
                    <p className="text-sm text-ink-soft">Belum ada pesan pada percakapan ini.</p>
                  ) : (
                    bubbles.map((m, i) => {
                      const hari = labelHari(m.at);
                      const hariSebelum = i > 0 ? labelHari(bubbles[i - 1].at) : null;
                      const tampilkanHari = hari && hari !== hariSebelum;
                      return (
                        <React.Fragment key={m.id}>
                          {tampilkanHari && (
                            <div className="flex justify-center py-1">
                              <span className="text-[11px] text-ink-faint bg-surface border border-line px-2 py-0.5 rounded-full">
                                {hari}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-start">
                            <div className="max-w-[80%] rounded-lg px-3 py-2 wa-bubble-in">
                              {m.text && <p className="text-sm whitespace-pre-wrap break-words">{m.text}</p>}
                              {m.caption && <p className="text-sm whitespace-pre-wrap break-words">{m.caption}</p>}
                              {!m.text && !m.caption && (
                                <p className="text-sm italic text-ink-soft">
                                  [{m.type}{m.mime ? ` · ${m.mime}` : ''}]
                                </p>
                              )}
                              <p className="text-[10px] text-ink-faint mt-1 text-right">{jam(m.at)}</p>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })
                  )}
                </div>

                <div className="px-4 py-2 border-t border-line text-[11px] text-ink-muted">
                  Riwayat pesan masuk. Untuk membalas, gunakan Playground atau balas manual dari
                  WhatsApp. Balasan manual otomatis menjeda bot 24 jam untuk kontak ini.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'optout' && (
        <div className="space-y-2">
          <p className="text-sm text-ink-soft">
            Kontak yang menulis STOP/BERHENTI. Bot tidak membalas mereka, dan nomornya sebaiknya
            dikeluarkan dari kampanye blast.
          </p>
          {optouts.length === 0 ? (
            <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-ink-soft">
              Belum ada kontak yang berhenti.
            </div>
          ) : (
            optouts.map((o) => (
              <div key={`${o.sessionId}:${o.contactPhone}`} className="rounded-md border border-line bg-surface p-3 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="font-medium text-sm">{o.contactPhone}</span>
                  <p className="text-xs text-ink-soft mt-0.5">
                    {o.reason || 'tanpa alasan'} · {o.createdAt} ·{' '}
                    <code>{namaSesi(o.sessionId)}</code>
                  </p>
                </div>
                <button
                  onClick={() => setLepasTarget(o)}
                  className="inline-flex items-center gap-1.5 px-3 h-9 rounded-md border border-line bg-surface text-sm hover:bg-surface-sunken transition"
                >
                  <Send className="w-4 h-4" /> Cabut
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Formulir tambah/ubah — satu modal untuk keduanya. */}
      <Modal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditId(null); }}
        title={editId ? 'Ubah aturan' : 'Tambah aturan'}
        description={editId ? 'Perubahan berlaku untuk pesan berikutnya, bukan pesan yang sudah dibalas.' : 'Aturan diperiksa berurutan sesuai prioritas.'}
        icon={<div className="p-2.5 rounded-md bg-pine-wash border border-pine-line/60 text-pine"><Bot className="w-5 h-5" /></div>}
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
              {editId ? 'Simpan perubahan' : 'Tambah aturan'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Nama aturan</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Menu utama"
              className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm focus:outline-none focus:border-pine"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Berlaku untuk</label>
            <select
              value={form.sessionId}
              onChange={(e) => setForm({ ...form, sessionId: e.target.value })}
              className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm"
            >
              <option value="">Semua sesi</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{labelSesi(s)}</option>
              ))}
            </select>
            <p className="text-[11px] text-ink-soft mt-1">
              {form.sessionId
                ? 'Aturan ini hanya aktif untuk nomor yang dipilih.'
                : 'Aturan ini aktif di semua nomor. Aturan khusus per nomor diperiksa lebih dulu.'}
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Cara mencocokkan</label>
            <select
              value={form.matchType}
              onChange={(e) => setForm({ ...form, matchType: e.target.value as Flow['matchType'] })}
              className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm"
            >
              {TIPE_COCOK.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Nilai pencocokan
              <span className="text-ink-soft font-normal">
                {': '}{TIPE_COCOK.find((t) => t.value === form.matchType)?.contoh}
              </span>
            </label>
            <input
              value={form.matchValue}
              onChange={(e) => setForm({ ...form, matchValue: e.target.value })}
              className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm focus:outline-none focus:border-pine"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Prioritas (kecil = diperiksa dulu)</label>
            <input
              type="number"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
              className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Jeda minimal (detik)</label>
            <input
              type="number"
              value={form.cooldownSeconds}
              onChange={(e) => setForm({ ...form, cooldownSeconds: Number(e.target.value) })}
              className="w-full px-3 h-9 rounded-md border border-line bg-surface text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-1">Balasan</label>
            <textarea
              value={form.replyText}
              onChange={(e) => setForm({ ...form, replyText: e.target.value })}
              rows={5}
              placeholder={'Halo! Ada yang bisa dibantu?\n\nKetik MENU untuk melihat pilihan.'}
              className="w-full px-3 py-2 rounded-md border border-line bg-surface text-sm focus:outline-none focus:border-pine"
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(hapusTarget)}
        title="Hapus aturan?"
        message={
          <>
            Aturan <strong>{hapusTarget?.name}</strong> akan dihapus permanen. Percakapan yang
            sedang berjalan di aturan ini akan berhenti tanpa pemberitahuan ke pelanggan.
          </>
        }
        confirmLabel="Hapus aturan"
        busy={Boolean(hapusTarget && busy === hapusTarget.id)}
        onConfirm={() => void konfirmasiHapus()}
        onCancel={() => setHapusTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(lepasTarget)}
        title="Cabut opt-out?"
        message={
          <>
            Nomor <strong>{lepasTarget?.contactPhone}</strong> akan kembali menerima balasan bot.
            Pastikan kontak ini memang bersedia dihubungi lagi.
          </>
        }
        confirmLabel="Cabut opt-out"
        variant="warning"
        busy={Boolean(lepasTarget && busy === lepasTarget.contactPhone)}
        onConfirm={() => void konfirmasiLepasOptout()}
        onCancel={() => setLepasTarget(null)}
      />
    </div>
  );
};