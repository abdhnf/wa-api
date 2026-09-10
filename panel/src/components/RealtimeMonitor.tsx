import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, ShieldAlert, Zap, Pause, Play, RefreshCw,
  CheckCircle2, CheckCheck, Clock, AlertTriangle, Send, Sliders, Loader2,
  FileText, Image as ImageIcon, MapPin, Users,
  ArrowUpRight, ShieldCheck, UserCheck, Radio, Sparkles
} from 'lucide-react';
import { type QueueItem, type Session, EMPTY_SESSIONS, EMPTY_QUEUE } from '../dummyData';
import { apiGetSessions, apiGetSessionMessages, apiSendBulk, apiGetAntiBan, apiGetQueueStatus, apiPauseQueue, apiResumeQueue } from '../api';
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

  // Anti-ban runtime config state (baca dari backend nanti)
  const [config] = useState({
    preset: 'moderate',
    minDelaySec: 1.5,
    maxDelaySec: 3.5,
    warmupActive: true,
    adaptiveThrottle: true,
    groupGuard: true,
    autoPauseOnFailure: true,
  });

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
        if (ab?.antiBan) setAntiBanData(ab.antiBan);
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
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
            <Sliders size={14} className="text-emerald-400" />
            Parameter Anti-Ban Engine (baileys-antiban)
          </h3>
          <span className="text-[11px] bg-emerald-950 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded font-mono">
            Preset: {config.preset}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* 1. WarmUp */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px]">7-Day WarmUp</span>
              <span className="text-[10px] text-emerald-400 font-mono">Layer 1</span>
            </div>
            <div className="font-mono text-emerald-400 font-semibold text-sm">
              {antiBanData?.warmup ? `Hari ke-${antiBanData.warmup.day}/7 (${antiBanData.warmup.todaySent}/${antiBanData.warmup.todayLimit})` : 'Memuat...'}
            </div>
            <p className="text-[10px] text-gray-500">Kuota bertahap eksponensial ~1.8x/hari mencegah flag nomor baru.</p>
          </div>

          {/* 2. Rate Limiter */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px]">Rate Limiter</span>
              <span className="text-[10px] text-emerald-400 font-mono">Layer 2</span>
            </div>
            <div className="text-emerald-400 font-semibold font-mono text-sm">
              {antiBanData?.rateLimiter ? `${antiBanData.rateLimiter.lastMinute}/8 mnt • ${antiBanData.rateLimiter.lastHour}/200 jam` : 'Memuat...'}
            </div>
            <p className="text-[10px] text-gray-500">Sliding window per m/h/d + blokir pesan identik berulang.</p>
          </div>

          {/* 3. Reconnect Throttle */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px]">Reconnect Throttle</span>
              <span className="text-[10px] text-cyan-400 font-mono">Layer 3</span>
            </div>
            <div className="text-cyan-400 font-semibold font-mono text-sm">
              {antiBanData?.reconnectMultiplier !== undefined
                ? `${Math.round(antiBanData.reconnectMultiplier * 100)}% kecepatan`
                : '100% (Stabil)'}
            </div>
            <p className="text-[10px] text-gray-500">Ramping 10%→100% pasca reconnect (cegah lonjakan bot).</p>
          </div>

          {/* 4. Circadian Rhythm */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px]">Circadian Rhythm</span>
              <span className="text-[10px] text-cyan-400 font-mono">Layer 4</span>
            </div>
            <div className="text-cyan-400 font-semibold font-mono text-sm">
              {antiBanData?.circadianMultiplier
                ? `${antiBanData.circadianMultiplier.toFixed(2)}x kecepatan`
                : '1.0x normal'}
            </div>
            <p className="text-[10px] text-gray-500">Malam 4-6x lebih santai, siang normal, meniru jam tidur manusia.</p>
          </div>

          {/* 5. Timelock Guard (463) */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px]">Timelock Guard</span>
              <span className="text-[10px] text-amber-400 font-mono">Layer 5</span>
            </div>
            <div className={`font-semibold font-mono text-sm ${antiBanData?.timelock?.isActive ? 'text-amber-400' : 'text-emerald-400'}`}>
              {antiBanData?.timelock?.isActive ? 'TIMELOCKED (Blok Baru)' : 'Normal (Bebas 463)'}
            </div>
            <p className="text-[10px] text-gray-500">Isolasi kontak baru saat error 463; izin kontak lama tetap jalan.</p>
          </div>

          {/* 6. Ban Recovery Orchestrator */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px]">Recovery Orchestrator</span>
              <span className="text-[10px] text-purple-400 font-mono">Layer 6</span>
            </div>
            <div className={`font-semibold font-mono text-sm ${antiBanData?.recovery?.currentPhase === 'recovering' ? 'text-amber-400' : 'text-emerald-400'}`}>
              {antiBanData?.recovery?.currentPhase === 'recovering'
                ? `Recovery: ${antiBanData.recovery.banType || 'Active'}`
                : 'Fase: Normal'}
            </div>
            <p className="text-[10px] text-gray-500">Pemulihan berjenjang pasca-ban (pause 24h → 10% → +15%/minggu).</p>
          </div>

          {/* 7. Reply Ratio Guard */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px]">Reply Ratio Guard</span>
              <span className="text-[10px] text-indigo-400 font-mono">Layer 7</span>
            </div>
            <div className="text-indigo-400 font-semibold font-mono text-sm">
              {antiBanData?.replyRatio
                ? `${Math.round(antiBanData.replyRatio.globalRatio * 100)}% (${antiBanData.replyRatio.globalReceived}/${antiBanData.replyRatio.globalSent} msg)`
                : '0% (0/0)'}
            </div>
            <p className="text-[10px] text-gray-500">Cooldown 24h jika rasio balasan kontak &lt;10% setelah 5 outbound.</p>
          </div>

          {/* 8. Contact Graph Warmer */}
          <div className="p-3 bg-gray-950 border border-gray-800 rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[11px]">Contact Graph</span>
              <span className="text-[10px] text-pink-400 font-mono">Layer 8</span>
            </div>
            <div className="text-pink-400 font-semibold font-mono text-sm">
              {antiBanData?.contactGraph
                ? `${antiBanData.contactGraph.knownContacts} known • ${antiBanData.contactGraph.pendingHandshakes} pending`
                : 'Ready (Opt-in)'}
            </div>
            <p className="text-[10px] text-gray-500">Social graph warmup: lurk grup 12h, cap 5 nomor baru/hari.</p>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/70">
                {queue.map(item => (
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
                  </tr>
                ))}
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
      {/* Toast auto-close */}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
};