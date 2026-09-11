import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, ShieldAlert, Zap, Pause, Play, RefreshCw,
  CheckCircle2, CheckCheck, Clock, AlertTriangle, Send, Sliders, Loader2,
  FileText, Image as ImageIcon, MapPin, Users,
  ArrowUpRight, ShieldCheck, UserCheck, Radio, Sparkles, Settings2, HelpCircle, ChevronDown, ChevronUp
} from 'lucide-react';
import { type QueueItem, type Session, EMPTY_SESSIONS, EMPTY_QUEUE } from '../dummyData';
import { apiGetSessions, apiGetSessionMessages, apiSendBulk, apiGetAntiBan, apiUpdateAntiBan, apiResetReplyRatioCooldown, apiRetryMessage, apiGetQueueStatus, apiPauseQueue, apiResumeQueue } from '../api';
import { Toast } from './Toast';
import { AutoRotateSettings } from './AutoRotateSettings';

export const RealtimeMonitor: React.FC = () => {
  const [subTab, setSubTab] = useState<'monitor' | 'autorotate'>('monitor');
  const [queue, setQueue] = useState<QueueItem[]>(EMPTY_QUEUE);
  const [sessions, setSessions] = useState<Session[]>(EMPTY_SESSIONS);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [bulkRecipientText, setBulkRecipientText] = useState('');
  const [bulkMessageText, setBulkMessageText] = useState('Pemberitahuan resmi: Server telah selesai diupdate ✅');
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sendingBulk, setSendingBulk] = useState(false);
  const [antiBanData, setAntiBanData] = useState<any>(null);
  const [queueStatus, setQueueStatus] = useState<{ isPaused: boolean; pauseReason?: string; pendingCount: number; vipPendingCount: number } | null>(null);
  const [pausingQueue, setPausingQueue] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // State Preset & Konfigurasi Anti-Ban Dinamis
  const [activePreset, setActivePreset] = useState<string>('balanced');
  const [customForm, setCustomForm] = useState({
    minDelaySec: 1.5,
    maxDelaySec: 5.0,
    maxPerMinute: 8,
    maxPerHour: 200,
    maxIdenticalMessages: 3,
    replyRatioEnabled: true,
    minRatioPercent: 10,
    minMessagesBeforeEnforce: 5,
    cooldownHours: 24,
  });
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [savingAntiBan, setSavingAntiBan] = useState(false);
  const [resettingCooldown, setResettingCooldown] = useState(false);

  const selectedSession = sessions.find(s => s.id === selectedSessionId) || sessions[0];

  // Metrik terpisah: Antrean, Delivered, dan Gagal
  const pendingCount = queue.filter(q => q.status === 'pending' || q.status === 'pacing' || q.status === 'sending').length;
  const deliveredCount = queue.filter(q => q.status === 'delivered' || q.status === 'read').length;
  const sentCount = queue.filter(q => q.status === 'sent').length;
  const failedCount = queue.filter(q => q.status === 'failed' || q.status === 'invalid_number' || q.status === 'not_registered').length;
  const totalCount = queue.length;

  // Fetch sessions real + auto-refresh 10s
  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const real = await apiGetSessions();
      if (Array.isArray(real) && real.length > 0) {
        const mapped: Session[] = real.map((s: any) => ({
          id: s.id,
          name: s.name,
          phone: s.phone,
          status: s.status,
          riskScore: s.riskScore || 0,
          warmupDay: s.warmupDay || 1,
          messagesSentToday: s.messagesSentToday || 0,
          deliveryRate: s.deliveryRate || 100,
          metrics: {
            totalSent: s.metrics?.totalSent || 0,
            totalDelivered: s.metrics?.totalDelivered || 0,
            totalFailed: s.metrics?.totalFailed || 0,
            avgPacingDelaySec: s.metrics?.avgPacingDelaySec || 0,
            uptimeHours: s.metrics?.uptimeHours || 0,
            batteryLevel: 85,
            deviceOS: 'Chrome (Linux)',
            waVersion: '2.3000.x',
            lastPing: 'baru saja',
            disconnectCountToday: s.metrics?.disconnectCountToday || 0,
            hourlyStats: s.metrics?.hourlyStats || [],
          },
        }));
        setSessions(mapped);
        if (!mapped.find((m: any) => m.id === selectedSessionId)) {
          setSelectedSessionId(mapped[0]?.id || '');
        }
      }
    } catch {
      // fallback kosong
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId]);

  // Fetch antrean pesan REAL dari backend (bukan simulasi)
  const fetchQueue = useCallback(async () => {
    if (!selectedSessionId) return;
    try {
      // Ambil status anti-ban aktual session
      try {
        const ab = await apiGetAntiBan(selectedSessionId);
        if (ab?.antiBan) {
          setAntiBanData(ab.antiBan);
          if (ab.antiBan.preset) setActivePreset(ab.antiBan.preset);
          if (ab.antiBan.currentConfig) {
            const rl = ab.antiBan.currentConfig.rateLimiter || {};
            const rr = ab.antiBan.currentConfig.replyRatio || {};
            setCustomForm({
              minDelaySec: (rl.minDelayMs || 1500) / 1000,
              maxDelaySec: (rl.maxDelayMs || 5000) / 1000,
              maxPerMinute: rl.maxPerMinute || 8,
              maxPerHour: rl.maxPerHour || 200,
              maxIdenticalMessages: rl.maxIdenticalMessages || 3,
              replyRatioEnabled: rr.enabled !== false,
              minRatioPercent: Math.round((rr.minRatio ?? 0.1) * 100),
              minMessagesBeforeEnforce: rr.minMessagesBeforeEnforce ?? 5,
              cooldownHours: rr.cooldownHoursOnViolation ?? 24,
            });
          }
        }
      } catch {}

      const msgs = await apiGetSessionMessages(selectedSessionId);
      if (msgs && Array.isArray(msgs.messages)) {
        setQueue(msgs.messages.map((m: any) => ({
          id: m.id,
          sessionId: m.sessionId,
          recipient: m.to,
          text: m.text || m.caption || m.name || m.mode,
          mode: m.mode,
          status: m.status || 'pending',
          jitterDelayMs: m.jitterDelayMs || 0,
          remainingDelayMs: 0,
          timestamp: m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
          isBulk: !!m.batchId,
        })));
      }
    } catch (e) {
      console.error('Gagal fetch queue', e);
    }
  }, [selectedSessionId]);

  // Polling sessions 10s
  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 10000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  // Polling queue 3s — status pesan real dari receipt WhatsApp di backend
  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000);
    return () => clearInterval(interval);
  }, [fetchQueue]);


  const handleToggleQueuePause = async () => {
    if (!selectedSessionId) return;
    setPausingQueue(true);
    try {
      if (queueStatus?.isPaused) {
        const res = await apiResumeQueue(selectedSessionId);
        if (res?.status) setQueueStatus(res.status);
        showToast('Antrean blast berhasil dilanjutkan! ▶️');
      } else {
        const res = await apiPauseQueue(selectedSessionId, 'Dijeda manual dari monitor panel');
        if (res?.status) setQueueStatus(res.status);
        showToast('Antrean blast berhasil dijeda! ⏸️', 'info');
      }
    } catch (err: any) {
      showToast(err.message || 'Gagal mengubah status antrean', 'error');
    } finally {
      setPausingQueue(false);
    }
  };

  const handleSelectPreset = async (presetId: string) => {
    if (!selectedSessionId) return;
    setActivePreset(presetId);
    if (presetId === 'custom') {
      setShowConfigModal(true);
      return;
    }
    setSavingAntiBan(true);
    try {
      const res = await apiUpdateAntiBan(selectedSessionId, { preset: presetId });
      if (res?.antiBan) setAntiBanData(res.antiBan);
      showToast(`Preset berhasil diubah ke: ${presetId.toUpperCase()}`);
    } catch (err: any) {
      showToast(`Gagal ubah preset: ${err.message}`, 'error');
    } finally {
      setSavingAntiBan(false);
    }
  };

  const handleSaveCustomConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSessionId) return;
    setSavingAntiBan(true);
    try {
      const payload = {
        preset: 'custom',
        config: {
          rateLimiter: {
            minDelayMs: Math.round(Number(customForm.minDelaySec) * 1000),
            maxDelayMs: Math.round(Number(customForm.maxDelaySec) * 1000),
            maxPerMinute: Number(customForm.maxPerMinute),
            maxPerHour: Number(customForm.maxPerHour),
            maxIdenticalMessages: Number(customForm.maxIdenticalMessages),
          },
          replyRatio: {
            enabled: Boolean(customForm.replyRatioEnabled),
            minRatio: Number(customForm.minRatioPercent) / 100,
            minMessagesBeforeEnforce: Number(customForm.minMessagesBeforeEnforce),
            cooldownHoursOnViolation: Number(customForm.cooldownHours),
          },
        },
      };
      const res = await apiUpdateAntiBan(selectedSessionId, payload);
      if (res?.antiBan) {
        setAntiBanData(res.antiBan);
        setActivePreset('custom');
      }
      setShowConfigModal(false);
      showToast('Parameter kustom anti-ban berhasil disimpan!');
    } catch (err: any) {
      showToast(`Gagal simpan konfigurasi: ${err.message}`, 'error');
    } finally {
      setSavingAntiBan(false);
    }
  };

  const handleResetCooldown = async () => {
    if (!selectedSessionId) return;
    setResettingCooldown(true);
    try {
      await apiResetReplyRatioCooldown(selectedSessionId);
      showToast('Seluruh cooldown Reply Ratio berhasil di-reset!');
      fetchQueue();
    } catch (err: any) {
      showToast(`Gagal reset cooldown: ${err.message}`, 'error');
    } finally {
      setResettingCooldown(false);
    }
  };

  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  const handleRetryMessage = async (messageId: string) => {
    setRetryingIds(prev => new Set(prev).add(messageId));
    try {
      await apiRetryMessage(messageId);
      showToast('Pesan berhasil dimasukkan kembali ke antrean!');
      fetchQueue();
    } catch (err: any) {
      showToast(`Gagal retry pesan: ${err.message}`, 'error');
    } finally {
      setRetryingIds(prev => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  };

  const handleEnqueueBulk = async () => {
    const lines = bulkRecipientText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0 || !bulkMessageText) return;

    setSendingBulk(true);
    try {
      const res = await apiSendBulk({
        sessionId: selectedSessionId,
        recipients: lines.map(r => r.replace(/[^0-9]/g, '')),
        text: bulkMessageText,
      });
      if (res?.totalQueued > 0) {
        setTimeout(fetchQueue, 1500);
      }
      setBulkRecipientText('');
      setShowBulkModal(false);
    } catch (err: any) {
      showToast(`Gagal bulk dispatch: ${err.message}`, 'error');
    } finally {
      setSendingBulk(false);
    }
  };

  const getStatusBadge = (status: QueueItem['status']) => {
    switch (status) {
      case 'delivered':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/50">
            <CheckCircle2 size={12} /> Delivered
          </span>
        );
      case 'sending':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/50 animate-pulse">
            <Zap size={12} /> Transmitting
          </span>
        );
      case 'pacing':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/50">
            <Clock size={12} /> Anti-Ban Pacing
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-gray-950 px-2 py-0.5 rounded border border-gray-800">
            Queued
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-red-400 bg-red-950/60 px-2 py-0.5 rounded border border-red-800/50">
            <AlertTriangle size={12} /> Blocked/Failed
          </span>
        );
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/50">
            <Send size={12} /> Sent (Server)
          </span>
        );
      case 'read':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 bg-blue-950/60 px-2 py-0.5 rounded border border-blue-800/50">
            <CheckCheck size={12} /> Read
          </span>
        );
      case 'invalid_number':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-orange-400 bg-orange-950/60 px-2 py-0.5 rounded border border-orange-800/50">
            <AlertTriangle size={12} /> Invalid Number
          </span>
        );
      case 'not_registered':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-red-400 bg-red-950/60 px-2 py-0.5 rounded border border-red-800/50">
            <AlertTriangle size={12} /> Not Registered
          </span>
        );
    }
  };

  const getModeIcon = (mode: string) => {
    switch (mode) {
      case 'media':
        return <ImageIcon size={12} className="text-purple-400" />;
      case 'location':
        return <MapPin size={12} className="text-sky-400" />;
      case 'bulk':
        return <Users size={12} className="text-pink-400" />;
      default:
        return <FileText size={12} className="text-gray-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-gray-800 pb-3">
        <button
          onClick={() => setSubTab('monitor')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
            subTab === 'monitor'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'
          }`}
        >
          <Activity size={14} />
          Live Monitor & Anti-Ban
        </button>
        <button
          onClick={() => setSubTab('autorotate')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
            subTab === 'autorotate'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'
          }`}
        >
          <RefreshCw size={14} />
          Auto-Rotate & Session Pool
        </button>
      </div>

      {subTab === 'autorotate' && <AutoRotateSettings showToast={showToast} />}

      {subTab === 'monitor' && (
        <div className="space-y-6">
      {/* Top Header & Action */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <Activity className="text-emerald-500" size={20} />
            Realtime Delivery & Anti-Ban Monitor
          </h2>
          <p className="text-xs text-gray-400">
            Pantau antrean pengiriman pesan dari backend (auto-refresh tiap 3 detik — status asli WhatsApp receipt).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fetchQueue()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 transition"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh Queue
          </button>

          <button
            onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            <Send size={13} />
            Test Bulk Dispatch
          </button>
        </div>
      </div>

      {/* 3 Metric Cards: Antrean, Delivered, dan Gagal */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Antrean (Pending / Pacing) */}
        <div className="bg-gray-900 border border-amber-900/40 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <Clock size={13} className="text-amber-400" />
                Masih Antrean
              </span>
              <div className="text-3xl font-extrabold font-mono text-gray-100 mt-2">
                {pendingCount}
              </div>
            </div>
            <span className="p-2.5 rounded-xl bg-amber-950/60 text-amber-400 border border-amber-800/40">
              <Zap size={18} className={pendingCount > 0 ? "animate-pulse" : ""} />
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-400">
            <span>Pacing Anti-Ban aktif</span>
            <span className="font-mono text-amber-300">{pendingCount > 0 ? "Sedang jalan" : "Antrean kosong"}</span>
          </div>
        </div>

        {/* Card 2: Delivered & Read */}
        <div className="bg-gray-900 border border-emerald-900/40 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                <CheckCheck size={14} className="text-emerald-400" />
                Delivery Sukses
              </span>
              <div className="text-3xl font-extrabold font-mono text-emerald-400 mt-2">
                {deliveredCount}
              </div>
            </div>
            <span className="p-2.5 rounded-xl bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
              <CheckCircle2 size={18} />
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-400">
            <span>Terkirim server: <strong className="text-cyan-400 font-mono">{sentCount}</strong></span>
            <span className="font-mono text-emerald-300">{totalCount > 0 ? `${Math.round(((deliveredCount + sentCount) / totalCount) * 100)}%` : "100%"}</span>
          </div>
        </div>

        {/* Card 3: Gagal & Invalid */}
        <div className="bg-gray-900 border border-red-900/40 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between shadow-sm">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-400 flex items-center gap-1.5">
                <AlertTriangle size={13} className="text-red-400" />
                Pesan Gagal
              </span>
              <div className="text-3xl font-extrabold font-mono text-red-400 mt-2">
                {failedCount}
              </div>
            </div>
            <span className="p-2.5 rounded-xl bg-red-950/60 text-red-400 border border-red-800/40">
              <ShieldAlert size={18} />
            </span>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[11px] text-gray-400">
            <span>Format salah / reachout limit</span>
            <span className="font-mono text-red-300">{failedCount > 0 ? "Periksa nomor" : "Nol kendala"}</span>
          </div>
        </div>

        {/* Card 4: Session & Anti-Ban Status */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between shadow-sm">
          <div>
            <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Session Target</div>
            {sessions.length === 0 ? (
              <div className="text-xs text-gray-500 py-1">{loading ? 'Memuat sesi...' : 'Belum ada sesi'}</div>
            ) : (
              <select
                value={selectedSessionId}
                onChange={e => setSelectedSessionId(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-xl px-2.5 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-emerald-500 font-medium"
              >
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.phone ? `+${s.phone}` : 'Belum pairing'})</option>
                ))}
              </select>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-800/80 flex items-center justify-between text-[11px]">
            <span className="text-gray-400">Anti-Ban Throttle:</span>
            <span className="text-emerald-400 font-mono font-semibold">Adaptif Dinamis</span>
          </div>
        </div>
      </div>

      {/* Anti-Ban Safety Parameters Drawer/Card */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-800">
          <div>
            <h3 className="text-xs font-bold text-gray-200 uppercase tracking-wider flex items-center gap-2">
              <Sliders size={14} className="text-emerald-400" />
              Parameter Anti-Ban Engine (baileys-antiban)
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              8 layer proteksi akun WhatsApp dengan isolasi risiko, reply ratio guard, dan human-like pacing.
            </p>
          </div>

          {/* Preset Selector & Custom Button */}
          <div className="flex items-center flex-wrap gap-2">
            <span className="text-[11px] text-gray-400 font-medium">Preset:</span>
            <div className="inline-flex rounded-lg bg-gray-950 p-1 border border-gray-800 text-xs">
              <button
                type="button"
                disabled={savingAntiBan || !selectedSessionId}
                onClick={() => handleSelectPreset('strict')}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  activePreset === 'strict'
                    ? 'bg-purple-900/60 text-purple-300 border border-purple-700/60 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Keamanan Maksimum: Delay 3-8s, max 5/min, Reply Ratio 10% (nomor baru)"
              >
                Strict
              </button>
              <button
                type="button"
                disabled={savingAntiBan || !selectedSessionId}
                onClick={() => handleSelectPreset('balanced')}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  activePreset === 'balanced'
                    ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/60 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Standar CRM Interaktif: Delay 1.5-5s, max 8/min, Reply Ratio 10%"
              >
                Balanced
              </button>
              <button
                type="button"
                disabled={savingAntiBan || !selectedSessionId}
                onClick={() => handleSelectPreset('broadcast')}
                className={`px-2.5 py-1 rounded-md font-medium transition ${
                  activePreset === 'broadcast'
                    ? 'bg-blue-900/60 text-blue-300 border border-blue-700/60 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Blast / Broadcast Notifikasi: Delay 2-5s, Reply Ratio Nonaktif (tidak kena cooldown)"
              >
                Broadcast
              </button>
              <button
                type="button"
                disabled={savingAntiBan || !selectedSessionId}
                onClick={() => handleSelectPreset('custom')}
                className={`px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1 ${
                  activePreset === 'custom'
                    ? 'bg-amber-900/60 text-amber-300 border border-amber-700/60 shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title="Kustomisasi manual seluruh parameter pacing & proteksi"
              >
                <Settings2 size={12} />
                Custom
              </button>
            </div>

            {antiBanData?.replyRatio?.contactsOnCooldown > 0 && (
              <button
                type="button"
                onClick={handleResetCooldown}
                disabled={resettingCooldown || !selectedSessionId}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/80 transition flex items-center gap-1"
                title="Buka blokir cooldown 24h untuk semua nomor yang tersangkut reply ratio"
              >
                {resettingCooldown ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Reset {antiBanData.replyRatio.contactsOnCooldown} Cooldown
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* 1. WarmUp */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1 group relative">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px] font-medium flex items-center gap-1">
                7-Day WarmUp
              </span>
              <span className="text-[10px] text-emerald-400 font-mono">Layer 1</span>
            </div>
            <div className="font-mono text-emerald-400 font-semibold text-sm">
              {antiBanData?.warmup ? `Hari ke-${antiBanData.warmup.day}/7 (${antiBanData.warmup.todaySent}/${antiBanData.warmup.todayLimit})` : 'Memuat...'}
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Membatasi volume kirim secara eksponensial di 7 hari awal agar nomor baru tidak langsung ditandai sebagai bot spammer.
            </p>
          </div>

          {/* 2. Rate Limiter & Jitter */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px] font-medium">Rate Limiter & Jitter</span>
              <span className="text-[10px] text-emerald-400 font-mono">Layer 2</span>
            </div>
            <div className="text-emerald-400 font-semibold font-mono text-sm">
              {antiBanData?.rateLimiter
                ? `${antiBanData.rateLimiter.lastMinute}/${antiBanData?.currentConfig?.rateLimiter?.maxPerMinute || 8} mnt • ${antiBanData.rateLimiter.lastHour}/${antiBanData?.currentConfig?.rateLimiter?.maxPerHour || 200} jam`
                : 'Memuat...'}
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Pacing Gaussian jitter antar-pesan ({((antiBanData?.currentConfig?.rateLimiter?.minDelayMs || 1500) / 1000).toFixed(1)}s - {((antiBanData?.currentConfig?.rateLimiter?.maxDelayMs || 5000) / 1000).toFixed(1)}s) serta blokir pesan identik berturut-turut.
            </p>
          </div>

          {/* 3. Reconnect Throttle */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px] font-medium">Reconnect Throttle</span>
              <span className="text-[10px] text-cyan-400 font-mono">Layer 3</span>
            </div>
            <div className="text-cyan-400 font-semibold font-mono text-sm">
              {antiBanData?.reconnectMultiplier !== undefined
                ? `${Math.round(antiBanData.reconnectMultiplier * 100)}% kecepatan`
                : '100% (Stabil)'}
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Memperlambat laju kirim menjadi 10% sesaat setelah koneksi pulih, lalu bertahap naik ke 100% guna menghindari kecurigaan lonjakan bot.
            </p>
          </div>

          {/* 4. Circadian Rhythm */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px] font-medium">Circadian Rhythm</span>
              <span className="text-[10px] text-cyan-400 font-mono">Layer 4</span>
            </div>
            <div className="text-cyan-400 font-semibold font-mono text-sm">
              {antiBanData?.circadianMultiplier
                ? `${antiBanData.circadianMultiplier.toFixed(2)}x kecepatan`
                : '1.0x normal'}
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Meniru siklus biologis manusia. Jam malam (23:00 - 05:00) otomatis diperlambat 4x - 6x dibanding jam kerja siang hari.
            </p>
          </div>

          {/* 5. Timelock Guard */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px] font-medium">Timelock Guard</span>
              <span className="text-[10px] text-amber-400 font-mono">Layer 5</span>
            </div>
            <div className={`font-semibold font-mono text-sm ${antiBanData?.timelock?.isActive ? 'text-amber-400' : 'text-emerald-400'}`}>
              {antiBanData?.timelock?.isActive ? 'TIMELOCKED (Blok Baru)' : 'Normal (Bebas 463)'}
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Perlindungan error 463 dari server WhatsApp. Kontak baru dibekukan sementara, kontak lama tetap diizinkan berkirim pesan.
            </p>
          </div>

          {/* 6. Ban Recovery Orchestrator */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px] font-medium">Recovery Orchestrator</span>
              <span className="text-[10px] text-purple-400 font-mono">Layer 6</span>
            </div>
            <div className={`font-semibold font-mono text-sm ${antiBanData?.recovery?.currentPhase === 'recovering' ? 'text-amber-400' : 'text-emerald-400'}`}>
              {antiBanData?.recovery?.currentPhase === 'recovering'
                ? `Recovery: ${antiBanData.recovery.banType || 'Active'}`
                : 'Fase: Normal'}
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Protokol pemulihan bertahap pasca akun dibuka dari blokir (jeda istirahat 24 jam → mulai 10% kuota → naik +15% per pekan).
            </p>
          </div>

          {/* 7. Reply Ratio Guard */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px] font-medium">Reply Ratio Guard</span>
              <span className="text-[10px] text-indigo-400 font-mono">Layer 7</span>
            </div>
            <div className="text-indigo-400 font-semibold font-mono text-sm flex items-center justify-between">
              <span>
                {antiBanData?.currentConfig?.replyRatio?.enabled === false
                  ? 'NONAKTIF (Mode Broadcast)'
                  : antiBanData?.replyRatio
                  ? `${Math.round(antiBanData.replyRatio.globalRatio * 100)}% (${antiBanData.replyRatio.globalReceived}/${antiBanData.replyRatio.globalSent} msg)`
                  : '0% (0/0)'}
              </span>
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Mencegah pola spam satu arah. Jika kontak tidak pernah membalas setelah {antiBanData?.currentConfig?.replyRatio?.minMessagesBeforeEnforce || 5} pesan, pengiriman ke nomor tersebut di-cooldown.
            </p>
          </div>

          {/* 8. Contact Graph Warmer */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px] font-medium">Contact Graph</span>
              <span className="text-[10px] text-pink-400 font-mono">Layer 8</span>
            </div>
            <div className="text-pink-400 font-semibold font-mono text-sm">
              {antiBanData?.contactGraph
                ? `${antiBanData.contactGraph.knownContacts} known • ${antiBanData.contactGraph.pendingHandshakes} pending`
                : 'Ready (Opt-in)'}
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Pemanasan grafik jejaring sosial WhatsApp: interaksi bertahap di grup sebelum mengirim pesan langsung ke anggota yang belum saling simpan kontak.
            </p>
          </div>
        </div>
      </div>

      {/* Delivery Queue Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-200 flex items-center gap-2">
              <Zap size={14} className="text-emerald-400" />
              Delivery Queue — {selectedSession?.name || 'Semua Session'}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Data asli dari backend (SQLite) — status berubah realtime sesuai delivery receipt WhatsApp.</p>
          </div>
          <div className="flex items-center gap-2">
            {queueStatus?.isPaused ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-950/60 border border-amber-800/80 text-amber-300">
                <Pause size={12} />
                Dijeda ({queueStatus.pauseReason || 'Manual'})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-950/50 border border-emerald-800/60 text-emerald-400">
                <Play size={12} />
                Antrean Berjalan
              </span>
            )}

            <button
              type="button"
              onClick={handleToggleQueuePause}
              disabled={pausingQueue || !selectedSessionId}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50 ${
                queueStatus?.isPaused
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-amber-600 hover:bg-amber-500 text-white'
              }`}
            >
              {pausingQueue ? (
                <Loader2 size={12} className="animate-spin" />
              ) : queueStatus?.isPaused ? (
                <>
                  <Play size={12} />
                  Lanjutkan Antrean
                </>
              ) : (
                <>
                  <Pause size={12} />
                  Jeda Antrean
                </>
              )}
            </button>

            <span className="text-[11px] text-gray-400 bg-gray-950 px-2.5 py-1 rounded-lg border border-gray-800 font-mono">
              {queue.length} pesan
            </span>
          </div>
        </div>

        {queue.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-xs text-gray-500">
              {loading ? 'Memuat antrean...' : 'Belum ada pesan di antrean untuk session ini. Kirim pesan lewat Playground dulu.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[650px]">
              <thead className="bg-gray-950 text-gray-400 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="px-4 py-3">Waktu</th>
                  <th className="px-4 py-3">Tujuan</th>
                  <th className="px-4 py-3">Mode</th>
                  <th className="px-4 py-3">Pesan</th>
                  <th className="px-4 py-3">Pacing Delay</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/70">
                {queue.map(item => {
                  const isFailed = item.status === 'failed' || item.status === 'invalid_number';
                  const isRetrying = retryingIds.has(item.id);
                  return (
                    <tr key={item.id} className="hover:bg-gray-800/40 transition">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{item.timestamp}</td>
                      <td className="px-4 py-3 font-mono text-gray-200 whitespace-nowrap">+{item.recipient}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-950 border border-gray-800 text-[10px] text-gray-300 uppercase">
                          {getModeIcon(item.mode)} {item.mode}
                        </span>
                        {item.isBulk && (
                          <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-pink-950/60 border border-pink-800/50 text-[10px] text-pink-300">
                            <Users size={10} /> Bulk
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-400 max-w-[220px] truncate">{item.text}</td>
                      <td className="px-4 py-3 font-mono text-gray-500">{(item.jitterDelayMs / 1000).toFixed(1)}s</td>
                      <td className="px-4 py-3">{getStatusBadge(item.status)}</td>
                      <td className="px-4 py-3 text-right">
                        {isFailed ? (
                          <button
                            type="button"
                            disabled={isRetrying}
                            onClick={() => handleRetryMessage(item.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-950/70 hover:bg-amber-900 border border-amber-800/70 text-amber-300 text-[11px] font-medium transition cursor-pointer disabled:opacity-50"
                            title="Kirim ulang pesan ini ke antrean"
                          >
                            {isRetrying ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                            <span>Retry</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-gray-600">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </div>
      )}

      {/* Bulk Dispatch Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-100 flex items-center gap-2">
                <Send size={16} className="text-emerald-400" />
                Test Bulk Dispatch
              </h3>
              <button onClick={() => setShowBulkModal(false)} className="text-gray-400 hover:text-white transition">✕</button>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Session
              </label>
              <select
                value={selectedSessionId}
                onChange={e => setSelectedSessionId(e.target.value)}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              >
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Nomor Tujuan (satu per baris)
              </label>
              <textarea
                value={bulkRecipientText}
                onChange={e => setBulkRecipientText(e.target.value)}
                rows={4}
                placeholder={'6281234567890\n6289876543210'}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Pesan
              </label>
              <textarea
                value={bulkMessageText}
                onChange={e => setBulkMessageText(e.target.value)}
                rows={3}
                className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              onClick={handleEnqueueBulk}
              disabled={sendingBulk || !bulkRecipientText.trim()}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-semibold text-sm transition flex items-center justify-center gap-2"
            >
              {sendingBulk ? (
                <>
                  <Loader2 size={15} className="animate-spin" /> Mengirim bulk...
                </>
              ) : (
                <>
                  <Send size={15} /> Kirim Bulk ke {bulkRecipientText.split('\n').filter(l => l.trim()).length} nomor
                </>
              )}
            </button>
          </div>
        </div>
      )}
      {/* Modal Kustomisasi Parameter Anti-Ban */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <Settings2 size={18} className="text-amber-400" />
                <h3 className="font-bold text-gray-200 text-sm">
                  Kustomisasi Parameter Anti-Ban (Sesi: {selectedSession?.name})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="text-gray-400 hover:text-white transition text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCustomConfig} className="space-y-4 text-xs">
              {/* Seksi Pacing Rate Limiter */}
              <div className="bg-gray-950 border border-gray-800/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                  <span className="font-semibold text-gray-200">Layer 2: Pacing & Rate Limiter</span>
                  <span className="text-[10px] text-emerald-400 font-mono">Pacing Mesin</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-400 mb-1">Min Delay (detik)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      max="60"
                      value={customForm.minDelaySec}
                      onChange={(e) => setCustomForm({ ...customForm, minDelaySec: parseFloat(e.target.value) || 1 })}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5 text-gray-200 font-mono focus:border-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-gray-500">Jeda acak terendah antar-pesan</span>
                  </div>
                  <div>
                    <label className="block text-gray-400 mb-1">Max Delay (detik)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      max="120"
                      value={customForm.maxDelaySec}
                      onChange={(e) => setCustomForm({ ...customForm, maxDelaySec: parseFloat(e.target.value) || 2 })}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5 text-gray-200 font-mono focus:border-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-gray-500">Jeda acak tertinggi antar-pesan</span>
                  </div>
                  <div>
                    <label className="block text-gray-400 mb-1">Max Pesan / Menit</label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      value={customForm.maxPerMinute}
                      onChange={(e) => setCustomForm({ ...customForm, maxPerMinute: parseInt(e.target.value, 10) || 5 })}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5 text-gray-200 font-mono focus:border-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-gray-500">Batas frekuensi dalam 60 detik</span>
                  </div>
                  <div>
                    <label className="block text-gray-400 mb-1">Max Pesan / Jam</label>
                    <input
                      type="number"
                      min="10"
                      max="1000"
                      value={customForm.maxPerHour}
                      onChange={(e) => setCustomForm({ ...customForm, maxPerHour: parseInt(e.target.value, 10) || 100 })}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5 text-gray-200 font-mono focus:border-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-gray-500">Batas kuota sliding window 1 jam</span>
                  </div>
                </div>
              </div>

              {/* Seksi Reply Ratio Guard */}
              <div className="bg-gray-950 border border-gray-800/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                  <span className="font-semibold text-gray-200">Layer 7: Reply Ratio Guard</span>
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={customForm.replyRatioEnabled}
                      onChange={(e) => setCustomForm({ ...customForm, replyRatioEnabled: e.target.checked })}
                      className="rounded border-gray-700 text-emerald-500 focus:ring-0"
                    />
                    <span className={customForm.replyRatioEnabled ? 'text-emerald-400' : 'text-gray-500'}>
                      {customForm.replyRatioEnabled ? 'Aktif' : 'Nonaktif (Mode Blast)'}
                    </span>
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-gray-400 mb-1">Min Pesan Awal</label>
                    <input
                      type="number"
                      disabled={!customForm.replyRatioEnabled}
                      min="1"
                      max="50"
                      value={customForm.minMessagesBeforeEnforce}
                      onChange={(e) => setCustomForm({ ...customForm, minMessagesBeforeEnforce: parseInt(e.target.value, 10) || 5 })}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5 text-gray-200 font-mono focus:border-emerald-500 focus:outline-none disabled:opacity-40"
                    />
                    <span className="text-[10px] text-gray-500">Pesan terkirim sebelum rasio dicek</span>
                  </div>
                  <div>
                    <label className="block text-gray-400 mb-1">Min Rasio Balasan (%)</label>
                    <input
                      type="number"
                      disabled={!customForm.replyRatioEnabled}
                      min="0"
                      max="100"
                      value={customForm.minRatioPercent}
                      onChange={(e) => setCustomForm({ ...customForm, minRatioPercent: parseInt(e.target.value, 10) || 0 })}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5 text-gray-200 font-mono focus:border-emerald-500 focus:outline-none disabled:opacity-40"
                    />
                    <span className="text-[10px] text-gray-500">Standar 10% (1 balasan per 10 kirim)</span>
                  </div>
                  <div>
                    <label className="block text-gray-400 mb-1">Durasi Cooldown (jam)</label>
                    <input
                      type="number"
                      disabled={!customForm.replyRatioEnabled}
                      min="1"
                      max="72"
                      value={customForm.cooldownHours}
                      onChange={(e) => setCustomForm({ ...customForm, cooldownHours: parseInt(e.target.value, 10) || 24 })}
                      className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2.5 py-1.5 text-gray-200 font-mono focus:border-emerald-500 focus:outline-none disabled:opacity-40"
                    />
                    <span className="text-[10px] text-gray-500">Lama penghentian jika melanggar</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfigModal(false)}
                  className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingAntiBan}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition flex items-center gap-1.5"
                >
                  {savingAntiBan ? <Loader2 size={13} className="animate-spin" /> : null}
                  Terapkan Parameter Kustom
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast auto-close */}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
};