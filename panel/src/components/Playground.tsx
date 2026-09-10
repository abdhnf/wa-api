import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send, Smartphone, Zap, ShieldCheck, CheckCircle2, Clock, AlertTriangle,
  FileText, Image as ImageIcon, MapPin, Users, Download, Upload,
  Paperclip, RefreshCw, X, Loader2, Bold, Italic, Strikethrough,
  Code, Smile, CheckCheck
} from 'lucide-react';
import {
  apiSendMessage, apiSendMedia, apiSendLocation, apiSendBulk,
  apiGetSessions, apiGetSessionMessages, apiGetAutoRotateStatus
} from '../api';
import { Toast } from './Toast';

type PlaygroundMode = 'text' | 'media' | 'location' | 'bulk';

interface MessageLog {
  id: string;
  recipient: string;
  mode: string;
  status: 'pending' | 'pacing' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'invalid_number' | 'not_registered';
  errorDetail?: string;
  delay: string;
  timestamp: string;
  detail?: string;
}

const COMMON_EMOJIS = ['👍', '👋', '🔥', '✅', '⚠️', '🎉', '🚀', '💡', '🤖', '📱', '💬', '🕒', '❤️', '🙏', '💯', '✨'];

export const Playground: React.FC = () => {
  const [sessions, setSessions] = useState<any[]>([]);
  const [autoRotateStatus, setAutoRotateStatus] = useState<any | null>(null);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [mode, setMode] = useState<PlaygroundMode>('text');
  const [loading, setLoading] = useState(false);
  const [refreshingLogs, setRefreshingLogs] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  const [logs, setLogs] = useState<MessageLog[]>([]);

  // Form states
  const [priority, setPriority] = useState<'normal' | 'high'>('normal');
  const [to, setTo] = useState('628');
  const [text, setText] = useState('Halo! Ini pesan uji coba dari *Baileys WhatsApp API*. 👋\n_Silakan reply pesan ini ya!_');
  const [showEmoji, setShowEmoji] = useState(false);

  // Media state
  const [mediaType, setMediaType] = useState<'image' | 'document' | 'audio' | 'video'>('image');
  const [mediaFile, setMediaFile] = useState<{ name: string; size: number; base64: string; mime: string } | null>(null);
  const [caption, setCaption] = useState('');
  const [showCaptionEmoji, setShowCaptionEmoji] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Location state
  const [latitude, setLatitude] = useState('-6.2088');
  const [longitude, setLongitude] = useState('106.8456');
  const [locName, setLocName] = useState('Monas Jakarta');
  const [locAddress, setLocAddress] = useState('Gambir, Kecamatan Gambir, Kota Jakarta Pusat');

  // Bulk state
  const [bulkMode, setBulkMode] = useState<'manual' | 'file'>('manual');
  const [bulkRecipientsText, setBulkRecipientsText] = useState('628123456789\n628987654321');
  const [bulkText, setBulkText] = useState('Halo {nama}, ini pengumuman resmi via *Baileys Gateway*. 🚀');
  const [showBulkEmoji, setShowBulkEmoji] = useState(false);
  const [bulkParsedRecipients, setBulkParsedRecipients] = useState<string[]>([]);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  // Helper formatting WhatsApp: *bold*, _italic_, ~strikethrough~, ```code```
  const insertFormat = (target: 'text' | 'caption' | 'bulk', prefix: string, suffix: string) => {
    const textareaId = target === 'caption' ? 'wa-caption-input' : target === 'bulk' ? 'wa-bulk-textarea' : 'wa-textarea';
    const el = document.getElementById(textareaId) as HTMLTextAreaElement | HTMLInputElement;
    if (!el) return;

    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const currentVal = el.value;
    const selected = currentVal.substring(start, end);
    const replacement = `${prefix}${selected || 'teks'}${suffix}`;
    const newVal = currentVal.substring(0, start) + replacement + currentVal.substring(end);

    if (target === 'caption') setCaption(newVal);
    else if (target === 'bulk') setBulkText(newVal);
    else setText(newVal);

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + (selected ? selected.length : 4));
    }, 15);
  };

  const insertEmoji = (target: 'text' | 'caption' | 'bulk', emoji: string) => {
    if (target === 'caption') setCaption(prev => prev + emoji);
    else if (target === 'bulk') setBulkText(prev => prev + emoji);
    else setText(prev => prev + emoji);
  };

  // Parser WhatsApp Markdown ke HTML aman untuk live preview
  const renderFormattedWA = (str: string) => {
    if (!str) return { __html: '' };
    const formatted = str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/```([\s\S]*?)```/g, '<code class="bg-black/40 text-emerald-300 px-1 py-0.5 rounded font-mono text-xs block my-1">$1</code>')
      .replace(/\*([^\*\n]+)\*/g, '<strong>$1</strong>')
      .replace(/_([^_\n]+)_/g, '<em>$1</em>')
      .replace(/~([^~\n]+)~/g, '<del>$1</del>')
      .replace(/\n/g, '<br/>');

    return { __html: formatted };
  };

  // Ref untuk menjaga sesi yang dipilih tetap stabil
  const selectedSessionIdRef = useRef<string | null>(null);

  // Fetch sessions HANYA saat halaman dibuka pertama kali (tidak auto polling)
  const fetchSessions = async () => {
    try {
      const [data, arStatus] = await Promise.all([
        apiGetSessions(),
        apiGetAutoRotateStatus().catch(() => null)
      ]);
      const list = Array.isArray(data) ? data : [];
      setSessions(list);
      if (arStatus) setAutoRotateStatus(arStatus);

      // Pertahankan sesi yang dipilih sebelumnya (dari sessionStorage atau ref), atau pilih pertama jika belum ada
      if (list.length > 0) {
        let savedId = selectedSessionIdRef.current;
        if (!savedId) {
          try { savedId = sessionStorage.getItem('wa_selected_session_id'); } catch {}
        }
        const matched = savedId ? list.find((s: any) => s.id === savedId) : null;
        const target = matched || list[0];
        selectedSessionIdRef.current = target.id;
        setSelectedSession(target);
      }
    } catch (e) {
      console.error('Gagal fetch sessions', e);
    }
  };

  // Fetch message logs (realtime polling HANYA untuk riwayat pesan)
  const fetchLogs = async (silent = true) => {
    const targetId = selectedSessionIdRef.current || selectedSession?.id;
    if (!targetId) return;
    if (!silent) setRefreshingLogs(true);
    try {
      const res = await apiGetSessionMessages(targetId);
      if (res && res.messages) {
        const mapped: MessageLog[] = res.messages.map((m: any) => ({
          id: m.id,
          recipient: m.to,
          mode: m.mode,
          status: m.status,
          delay: `${(m.jitterDelayMs / 1000).toFixed(1)}s`,
          timestamp: new Date(m.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          detail: m.text || m.fileName || m.name || m.mode,
        }));
        setLogs(mapped);
      }
    } catch (e) {
      console.error('Gagal fetch logs', e);
    } finally {
      if (!silent) setRefreshingLogs(false);
    }
  };

  // Fetch session list HANYA sekali saat mount
  useEffect(() => {
    fetchSessions();
  }, []);

  // Polling riwayat logs tiap 3 detik (tanpa refresh session atau input form)
  useEffect(() => {
    if (!selectedSession?.id) return;
    selectedSessionIdRef.current = selectedSession.id;
    fetchLogs(false); // Fetch awal saat ganti session
    const interval = setInterval(() => {
      fetchLogs(true); // Polling silent di background
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedSession?.id]);

  // Handle file select for media
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('image/')) setMediaType('image');
    else if (file.type.startsWith('audio/')) setMediaType('audio');
    else if (file.type.startsWith('video/')) setMediaType('video');
    else setMediaType('document');

    const reader = new FileReader();
    reader.onload = () => {
      setMediaFile({
        name: file.name,
        size: file.size,
        base64: reader.result as string,
        mime: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
  };

  // Handle file import for bulk (CSV/TXT)
  const handleBulkFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const lines = content.split(/\r?\n/);
      const numbers: string[] = [];

      for (const line of lines) {
        const clean = line.replace(/[^0-9]/g, '');
        if (clean.length >= 9) {
          const normalized = clean.startsWith('0') ? `62${clean.slice(1)}` : clean;
          numbers.push(normalized);
        }
      }
      setBulkParsedRecipients([...new Set(numbers)]);
    };
    reader.readAsText(file);
  };

  // Unduh Template CSV untuk Bulk
  const downloadTemplate = () => {
    const csvContent = "data:text/csv;charset=utf-8,nomor,nama\n6281234567890,Budi\n6289876543210,Siti\n6285712345678,Ahmad";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "template_bulk_whatsapp.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Send handler
  const handleSend = async () => {
    if (!selectedSession) {
      showToast('Pilih WhatsApp Session dulu (tab Sessions → buat pairing)', 'info');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'text') {
        const cleanTo = to.replace(/[^0-9]/g, '');
        await apiSendMessage({ sessionId: selectedSession.id, to: cleanTo, text, priority });
      } else if (mode === 'media') {
        if (!mediaFile) {
          showToast('Pilih file media terlebih dahulu', 'info');
          setLoading(false);
          return;
        }
        const cleanTo = to.replace(/[^0-9]/g, '');
        await apiSendMedia({
          sessionId: selectedSession.id,
          to: cleanTo,
          mediaType,
          mediaBase64: mediaFile.base64,
          mediaMimeType: mediaFile.mime,
          fileName: mediaFile.name,
          caption: caption || undefined,
          priority,
        });
      } else if (mode === 'location') {
        const cleanTo = to.replace(/[^0-9]/g, '');
        await apiSendLocation({
          sessionId: selectedSession.id,
          to: cleanTo,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          name: locName || undefined,
          address: locAddress || undefined,
        });
      } else if (mode === 'bulk') {
        let recipients: string[] = [];
        if (bulkMode === 'manual') {
          recipients = bulkRecipientsText
            .split(/\r?\n|,|;/)
            .map(n => n.replace(/[^0-9]/g, ''))
            .filter(n => n.length >= 9)
            .map(n => n.startsWith('0') ? `62${n.slice(1)}` : n);
        } else {
          recipients = bulkParsedRecipients;
        }

        if (recipients.length === 0) {
          showToast('Masukkan minimal 1 nomor tujuan yang valid', 'info');
          setLoading(false);
          return;
        }

        await apiSendBulk({
          sessionId: selectedSession.id,
          recipients,
          text: bulkText,
          priority,
        });
      }

      await fetchLogs();
      showToast('Pesan berhasil dimasukkan ke antrean! ✅');
    } catch (e: any) {
      showToast(`Gagal mengirim: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Refresh */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-950 text-emerald-400 border border-emerald-800/60 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-100">Playground Uji Pengiriman</h2>
            <p className="text-xs text-gray-400">Kirim pesan interaktif, simulasi failover & pantau receipt delivery live</p>
          </div>
        </div>

        <button
          onClick={() => { fetchSessions(); fetchLogs(); }}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-gray-300 hover:text-white bg-gray-950 hover:bg-gray-800 rounded-xl border border-gray-800 transition shrink-0 cursor-pointer shadow-xs"
          title="Refresh sesi & antrean"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshingLogs ? 'animate-spin text-emerald-400' : ''}`} />
          <span className="hidden sm:inline">Refresh Data</span>
        </button>
      </div>

      {/* Dedicated Session & Pool Status Control Bar */}
      <div className="bg-gray-900/90 border border-gray-800/90 rounded-2xl p-3 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
        {/* Kolom Kiri: Pemilihan Sesi */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-300 shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>Nomor Pengirim:</span>
          </div>
          <div className="relative flex-1 min-w-0 max-w-full md:max-w-md">
            <select
              value={selectedSession?.id || ''}
              onChange={(e) => {
                if (e.target.value === 'auto') {
                  const autoSess = { id: 'auto', name: '⚡ Auto-Rotate Pool (Nomor Akun)', phone: 'multi-device', status: 'connected' };
                  setSelectedSession(autoSess);
                  selectedSessionIdRef.current = 'auto';
                  try { sessionStorage.setItem('wa_selected_session_id', 'auto'); } catch {}
                  return;
                }
                const s = sessions.find((item) => item.id === e.target.value);
                setSelectedSession(s || null);
                if (s?.id) {
                  selectedSessionIdRef.current = s.id;
                  try { sessionStorage.setItem('wa_selected_session_id', s.id); } catch {}
                }
              }}
              className="w-full bg-gray-950 border border-gray-800 text-gray-200 text-xs rounded-xl px-3 py-2.5 focus:ring-1 focus:ring-emerald-500 focus:outline-none truncate"
            >
              {autoRotateStatus?.enabled && sessions.length >= 2 && (
                <option value="auto">⚡ [AUTO ROTATE] Otomatis Pilih Nomor Akun yang Sehat</option>
              )}
              {sessions.length === 0 ? (
                <option value="">Belum ada nomor WhatsApp terdaftar pada akun Anda</option>
              ) : (
                sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.phone || 'no phone'}) [{s.status}]
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* Kolom Kanan: Status Pooling Multi-Tenant yang Rapi */}
        <div className="shrink-0 flex items-center">
          {sessions.length >= 2 && autoRotateStatus?.enabled ? (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/25 text-xs text-indigo-300">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <Zap className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="font-semibold text-slate-100">Pool Aktif:</span>
              <span className="text-indigo-300 text-[11px]">
                {autoRotateStatus.activePoolCount || 0}/{sessions.length} nomor akun • {autoRotateStatus.strategy}
              </span>
            </div>
          ) : sessions.length === 1 ? (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0"></span>
              <Zap className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="font-medium text-gray-300">Sesi Tunggal</span>
              <span className="text-gray-400 text-[11px]">(Pool butuh ≥ 2 nomor)</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
              <span className="font-medium">Belum Ada Nomor</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-950 border border-gray-800 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0"></span>
              <Zap className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>Pool: Nonaktif</span>
            </div>
          )}
        </div>
      </div>

      {/* Mode Selector Tabs (Mobile Scrollable) */}
      <div className="flex overflow-x-auto gap-2 p-1.5 bg-gray-900 border border-gray-800 rounded-2xl no-scrollbar">
        <button
          onClick={() => setMode('text')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition shrink-0 ${
            mode === 'text'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
          }`}
        >
          <FileText className="w-3.5 h-3.5" /> Pesan Teks
        </button>

        <button
          onClick={() => setMode('media')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition shrink-0 ${
            mode === 'media'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
          }`}
        >
          <Paperclip className="w-3.5 h-3.5" /> Media / File
        </button>

        <button
          onClick={() => setMode('location')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition shrink-0 ${
            mode === 'location'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
          }`}
        >
          <MapPin className="w-3.5 h-3.5" /> Lokasi GPS
        </button>

        <button
          onClick={() => setMode('bulk')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition shrink-0 ${
            mode === 'bulk'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
          }`}
        >
          <Users className="w-3.5 h-3.5" /> Bulk Broadcast
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Input Form */}
        <div className="lg:col-span-7 bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          {/* Target number (kecuali bulk) */}
          {mode !== 'bulk' && (
            <div>
              <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                Nomor WhatsApp Tujuan
              </label>
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="628123456789"
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-gray-100 text-xs sm:text-sm font-mono focus:border-emerald-500 focus:outline-none"
              />
              <span className="text-[11px] text-gray-500 mt-1 block">Format: 628xxx tanpa simbol plus, spasi, atau strip</span>
            </div>
          )}

          {/* Form: TEXT */}
          {mode === 'text' && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                  Isi Pesan Teks
                </label>

                {/* Format Bar: Bold, Italic, Strikethrough, Code, Emoji */}
                <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-xl border border-gray-800">
                  <button
                    type="button"
                    onClick={() => insertFormat('text', '*', '*')}
                    title="Bold (*teks*)"
                    className="p-1.5 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                  >
                    <Bold size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormat('text', '_', '_')}
                    title="Italic (_teks_)"
                    className="p-1.5 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                  >
                    <Italic size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormat('text', '~', '~')}
                    title="Strikethrough (~teks~)"
                    className="p-1.5 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                  >
                    <Strikethrough size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertFormat('text', '```', '```')}
                    title="Monospace (```teks```)"
                    className="p-1.5 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                  >
                    <Code size={13} />
                  </button>
                  <div className="w-px h-3.5 bg-gray-800 mx-0.5" />
                  <button
                    type="button"
                    onClick={() => setShowEmoji(!showEmoji)}
                    title="Emoji Picker"
                    className={`p-1.5 rounded-lg transition ${showEmoji ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'}`}
                  >
                    <Smile size={13} />
                  </button>
                </div>
              </div>

              {/* Emoji Picker Popover */}
              {showEmoji && (
                <div className="mb-2.5 p-2 bg-gray-950 border border-gray-800 rounded-xl flex flex-wrap gap-1.5 animate-in fade-in duration-150 shadow-lg">
                  {COMMON_EMOJIS.map(em => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => insertEmoji('text', em)}
                      className="text-lg hover:scale-125 transition p-1 rounded hover:bg-gray-800"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}

              <textarea
                id="wa-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder="Ketik pesan WhatsApp di sini..."
                className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-gray-100 text-xs sm:text-sm font-sans leading-relaxed focus:border-emerald-500 focus:outline-none"
              />
              <div className="text-[11px] text-gray-500 mt-1 flex justify-between">
                <span>Tips: Gunakan format WhatsApp untuk mempertegas pesan</span>
                <span>{text.length} karakter</span>
              </div>
            </div>
          )}

          {/* Form: MEDIA */}
          {mode === 'media' && (
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  Unggah File Media
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip"
                />

                {!mediaFile ? (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-800 hover:border-emerald-500/50 rounded-2xl p-6 text-center cursor-pointer transition bg-gray-950/60"
                  >
                    <Upload className="w-7 h-7 text-gray-400 mx-auto mb-2" />
                    <p className="text-xs sm:text-sm text-gray-200 font-medium">Klik untuk upload file media</p>
                    <p className="text-[11px] text-gray-500 mt-1">Mendukung Gambar (PNG, JPG), Dokumen (PDF, Word, Excel), Audio, Video</p>
                  </div>
                ) : (
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2 bg-emerald-950 text-emerald-400 border border-emerald-800/60 rounded-lg shrink-0">
                        {mediaType === 'image' ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm text-gray-200 font-medium truncate">{mediaFile.name}</p>
                        <p className="text-[10px] text-gray-500">{(mediaFile.size / 1024).toFixed(1)} KB &bull; {mediaFile.mime}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setMediaFile(null)}
                      className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-gray-800 rounded-lg transition shrink-0 ml-2"
                      title="Hapus file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Caption / Keterangan (Opsional)
                  </label>

                  {/* Format Bar untuk Caption */}
                  <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-xl border border-gray-800">
                    <button
                      type="button"
                      onClick={() => insertFormat('caption', '*', '*')}
                      title="Bold (*teks*)"
                      className="p-1 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                    >
                      <Bold size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormat('caption', '_', '_')}
                      title="Italic (_teks_)"
                      className="p-1 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                    >
                      <Italic size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormat('caption', '~', '~')}
                      title="Strikethrough (~teks~)"
                      className="p-1 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                    >
                      <Strikethrough size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormat('caption', '```', '```')}
                      title="Monospace (```teks```)"
                      className="p-1 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                    >
                      <Code size={12} />
                    </button>
                    <div className="w-px h-3 bg-gray-800 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => setShowCaptionEmoji(!showCaptionEmoji)}
                      title="Emoji Picker"
                      className={`p-1 rounded-lg transition ${showCaptionEmoji ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'}`}
                    >
                      <Smile size={12} />
                    </button>
                  </div>
                </div>

                {showCaptionEmoji && (
                  <div className="mb-2.5 p-2 bg-gray-950 border border-gray-800 rounded-xl flex flex-wrap gap-1.5 animate-in fade-in duration-150 shadow-lg">
                    {COMMON_EMOJIS.map(em => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => insertEmoji('caption', em)}
                        className="text-base hover:scale-125 transition p-1 rounded hover:bg-gray-800"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                )}

                <input
                  id="wa-caption-input"
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Ketik caption untuk berkas media..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2 text-gray-100 text-xs sm:text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Form: LOCATION */}
          {mode === 'location' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    Latitude
                  </label>
                  <input
                    type="text"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-gray-100 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    Longitude
                  </label>
                  <input
                    type="text"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-gray-100 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Nama Tempat (Point of Interest)
                </label>
                <input
                  type="text"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-gray-100 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Alamat Lengkap
                </label>
                <input
                  type="text"
                  value={locAddress}
                  onChange={(e) => setLocAddress(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-gray-100 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Form: BULK */}
          {mode === 'bulk' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setBulkMode('manual')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      bulkMode === 'manual'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                    }`}
                  >
                    Ketik Manual
                  </button>
                  <button
                    onClick={() => setBulkMode('file')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                      bulkMode === 'file'
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                    }`}
                  >
                    Import CSV / TXT
                  </button>
                </div>

                <button
                  onClick={downloadTemplate}
                  className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 underline font-medium"
                >
                  <Download className="w-3.5 h-3.5" /> Unduh Template CSV
                </button>
              </div>

              {bulkMode === 'manual' ? (
                <div>
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                    Daftar Nomor Tujuan (1 baris per nomor atau pisah koma)
                  </label>
                  <textarea
                    value={bulkRecipientsText}
                    onChange={(e) => setBulkRecipientsText(e.target.value)}
                    rows={4}
                    placeholder="628123456789&#10;628987654321"
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-gray-100 text-xs font-mono focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              ) : (
                <div>
                  <input
                    type="file"
                    ref={bulkFileRef}
                    onChange={handleBulkFileChange}
                    className="hidden"
                    accept=".csv,.txt"
                  />
                  <div
                    onClick={() => bulkFileRef.current?.click()}
                    className="border-2 border-dashed border-gray-800 hover:border-emerald-500/50 rounded-2xl p-5 text-center cursor-pointer transition bg-gray-950/60"
                  >
                    <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1.5" />
                    <p className="text-xs text-gray-200 font-medium">Klik untuk upload file .csv atau .txt</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Sistem akan otomatis mengekstrak nomor telepon</p>
                  </div>
                  {bulkParsedRecipients.length > 0 && (
                    <div className="mt-2 text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                      <CheckCircle2 size={13} /> Teridentifikasi {bulkParsedRecipients.length} nomor tujuan unik
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Pesan Siaran (Broadcast)
                  </label>

                  {/* Format Bar untuk Bulk */}
                  <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-xl border border-gray-800">
                    <button
                      type="button"
                      onClick={() => insertFormat('bulk', '*', '*')}
                      title="Bold (*teks*)"
                      className="p-1 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                    >
                      <Bold size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormat('bulk', '_', '_')}
                      title="Italic (_teks_)"
                      className="p-1 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                    >
                      <Italic size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormat('bulk', '~', '~')}
                      title="Strikethrough (~teks~)"
                      className="p-1 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                    >
                      <Strikethrough size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => insertFormat('bulk', '```', '```')}
                      title="Monospace (```teks```)"
                      className="p-1 text-gray-400 hover:text-gray-100 hover:bg-gray-800 rounded-lg transition"
                    >
                      <Code size={12} />
                    </button>
                    <div className="w-px h-3 bg-gray-800 mx-0.5" />
                    <button
                      type="button"
                      onClick={() => setShowBulkEmoji(!showBulkEmoji)}
                      title="Emoji Picker"
                      className={`p-1 rounded-lg transition ${showBulkEmoji ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'}`}
                    >
                      <Smile size={12} />
                    </button>
                  </div>
                </div>

                {showBulkEmoji && (
                  <div className="mb-2.5 p-2 bg-gray-950 border border-gray-800 rounded-xl flex flex-wrap gap-1.5 animate-in fade-in duration-150 shadow-lg">
                    {COMMON_EMOJIS.map(em => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => insertEmoji('bulk', em)}
                        className="text-base hover:scale-125 transition p-1 rounded hover:bg-gray-800"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                )}

                <textarea
                  id="wa-bulk-textarea"
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={4}
                  placeholder="Ketik pesan broadcast..."
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-gray-100 text-xs sm:text-sm focus:border-emerald-500 focus:outline-none font-sans leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSend}
            disabled={loading || !selectedSession}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Memproses Pengiriman...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" /> {mode === 'bulk' ? 'Kirim Siaran Broadcast' : 'Kirim Pesan Sekarang'}
              </>
            )}
          </button>
        </div>

        {/* Right: Preview WhatsApp Screen */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 sm:p-5 shadow-sm">
            <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Preview Layar WhatsApp
            </h3>

            {/* WA Mockup Screen */}
            <div className="bg-[#0b141a] rounded-2xl p-3 sm:p-4 border border-gray-800 shadow-inner min-h-[240px] flex flex-col justify-end bg-radial-gradient">
              <div className="bg-[#005c4b] text-white p-3 rounded-2xl rounded-tr-xs text-xs sm:text-sm max-w-[90%] sm:max-w-[85%] ml-auto space-y-2 shadow-md leading-relaxed">
                {mode === 'text' && (
                  <div
                    className="break-words"
                    dangerouslySetInnerHTML={renderFormattedWA(text || 'Preview pesan...')}
                  />
                )}

                {mode === 'media' && (
                  <div className="space-y-1.5">
                    {mediaFile && mediaType === 'image' && (
                      <img src={mediaFile.base64} alt="Preview" className="rounded-lg max-h-48 object-cover w-full shadow-inner" />
                    )}
                    {mediaFile && mediaType !== 'image' && (
                      <div className="p-2.5 bg-black/20 rounded-xl flex items-center gap-2.5 text-xs">
                        <FileText className="w-4 h-4 text-emerald-300 shrink-0" />
                        <span className="truncate">{mediaFile.name}</span>
                      </div>
                    )}
                    {caption && (
                      <div
                        className="text-xs text-white/95 pt-0.5 break-words"
                        dangerouslySetInnerHTML={renderFormattedWA(caption)}
                      />
                    )}
                    {!mediaFile && <p className="text-xs text-white/50 italic">Belum ada file dipilih</p>}
                  </div>
                )}

                {mode === 'location' && (
                  <div className="space-y-1.5">
                    <div className="h-20 bg-emerald-950/60 rounded-xl border border-emerald-800/40 flex items-center justify-center text-xs text-emerald-300 gap-1.5">
                      <MapPin className="w-4 h-4" /> Peta GPS ({latitude}, {longitude})
                    </div>
                    <p className="font-bold text-xs">{locName}</p>
                    <p className="text-[11px] text-white/80">{locAddress}</p>
                  </div>
                )}

                {mode === 'bulk' && (
                  <div
                    className="break-words"
                    dangerouslySetInnerHTML={renderFormattedWA(bulkText || 'Preview pesan siaran...')}
                  />
                )}

                <div className="text-[10px] text-white/70 text-right flex items-center justify-end gap-1 pt-1">
                  <span>12:00</span>
                  <CheckCheck className="w-3.5 h-3.5 text-emerald-300" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Realtime Delivery History Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 sm:p-5 border-b border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-100">Riwayat Pengiriman & Delivery Status</h3>
            <p className="text-xs text-gray-400">Status update otomatis (polling receipt WhatsApp tiap 3 detik)</p>
          </div>
          <button
            onClick={() => fetchLogs(false)}
            disabled={refreshingLogs}
            className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 px-3 py-1.5 bg-emerald-950/60 border border-emerald-800/50 rounded-xl transition self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshingLogs ? 'animate-spin' : ''}`} />
            <span>Segarkan Riwayat</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-gray-300 min-w-[640px]">
            <thead className="bg-gray-950 text-gray-400 uppercase tracking-wider text-[10px] font-semibold border-b border-gray-800">
              <tr>
                <th className="p-3.5">Waktu</th>
                <th className="p-3.5">Tujuan</th>
                <th className="p-3.5">Mode / Detail</th>
                <th className="p-3.5">Delay Pacing</th>
                <th className="p-3.5">Status Pengiriman</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/60 font-sans">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    Belum ada riwayat pengiriman untuk session ini
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-800/30 transition">
                    <td className="p-3.5 whitespace-nowrap text-gray-400 font-mono text-[11px]">{log.timestamp}</td>
                    <td className="p-3.5 font-mono text-gray-100 font-medium">+{log.recipient}</td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-gray-300 mr-2 uppercase tracking-wide">
                        {log.mode}
                      </span>
                      <span className="text-gray-400 truncate max-w-xs inline-block align-bottom">{log.detail}</span>
                    </td>
                    <td className="p-3.5 font-mono text-gray-400">{log.delay}</td>
                    <td className="p-3.5 whitespace-nowrap">
                      {log.status === 'delivered' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Terkirim (Delivered)
                        </span>
                      ) : log.status === 'read' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-950/60 text-blue-400 border border-blue-800/50">
                          <CheckCheck className="w-3.5 h-3.5" /> Dibaca (Read)
                        </span>
                      ) : log.status === 'sent' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-cyan-950/60 text-cyan-400 border border-cyan-800/50">
                          <Send className="w-3.5 h-3.5" /> Terkirim ke Server (Sent)
                        </span>
                      ) : log.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-950/60 text-rose-400 border border-rose-800/50">
                          <AlertTriangle className="w-3.5 h-3.5" /> Gagal
                        </span>
                      ) : log.status === 'invalid_number' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-orange-950/60 text-orange-400 border border-orange-800/50">
                          <AlertTriangle className="w-3.5 h-3.5" /> Nomor Tidak Valid
                        </span>
                      ) : log.status === 'not_registered' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-950/60 text-red-400 border border-red-800/50">
                          <AlertTriangle className="w-3.5 h-3.5" /> Tidak Terdaftar di WA
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-950/60 text-amber-400 border border-amber-800/50">
                          <Clock className="w-3.5 h-3.5 animate-spin" /> Menunggu Pacing (Pending)
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/* Toast auto-close */}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
};
