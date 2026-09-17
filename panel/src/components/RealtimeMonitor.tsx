import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Activity, ShieldAlert, Zap, Pause, Play, RefreshCw,
  CheckCircle2, CheckCheck, Clock, AlertTriangle, Send, Sliders, Loader2,
  FileText, Image as ImageIcon, MapPin, Users, XCircle,
  ArrowUpRight, ShieldCheck, UserCheck, Radio, Sparkles, Settings2, HelpCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Search
} from 'lucide-react';
import { type QueueItem, type Session, EMPTY_SESSIONS, EMPTY_QUEUE } from '../dummyData';
import { apiGetSessions, apiGetSessionMessages, apiSendBulk, apiGetAntiBan, apiUpdateAntiBan, apiResetReplyRatioCooldown, apiRetryMessage, apiGetQueueStatus, apiPauseQueue, apiResumeQueue, apiUpdateSessionProfile, apiGetBatchApproval, apiApproveBatchRecipients, apiRevokeBatchApproval } from '../api';
import { Toast } from './Toast';
import { AutoRotateSettings } from './AutoRotateSettings';
import { AdminCommandCenter } from './AdminCommandCenter';

export const RealtimeMonitor: React.FC<{ isAdmin?: boolean }> = ({ isAdmin = false }) => {
  const [subTab, setSubTab] = useState<'monitor' | 'autorotate' | 'command_center'>('monitor');
  const [queue, setQueue] = useState<QueueItem[]>(EMPTY_QUEUE);
  const [queuePage, setQueuePage] = useState(1);
  const [queueLimit, setQueueLimit] = useState(10);
  const [queueTotal, setQueueTotal] = useState(0);
 const [sessions, setSessions] = useState<Session[]>(EMPTY_SESSIONS);
 const [isPaused, setIsPaused] = useState(false);
 const [selectedSessionId, setSelectedSessionId] = useState('');
 const [bulkRecipientText, setBulkRecipientText] = useState('');
 const [bulkMessageText, setBulkMessageText] = useState('Pemberitahuan resmi: Server telah selesai diupdate ✅');
 const [showBulkModal, setShowBulkModal] = useState(false);
 const [loading, setLoading] = useState(true);
 const [sendingBulk, setSendingBulk] = useState(false);
 const [antiBanData, setAntiBanData] = useState<any>(null);
 // Whitelist penerima kampanye (contactGraph). Terikat pasangan (batchId, nomor).
 const [batchApprovalBatchId, setBatchApprovalBatchId] = useState('');
 const [batchApprovalData, setBatchApprovalData] = useState<{ batchId: string; count: number; recipients: string[] } | null>(null);
 const [batchApprovalInput, setBatchApprovalInput] = useState('');
 const [batchApprovalBusy, setBatchApprovalBusy] = useState(false);
 const [showContactGraphModal, setShowContactGraphModal] = useState(false);
 const [recipientSearchQuery, setRecipientSearchQuery] = useState('');

 const detectedCount = useMemo(() => {
   if (!batchApprovalInput.trim()) return 0;
   const parts = batchApprovalInput.split(/[\r\n,;\s]+/).filter((p) => p.replace(/\D/g, '').length >= 7);
   return new Set(parts).size;
 }, [batchApprovalInput]);

 const filteredRecipients = useMemo(() => {
   if (!batchApprovalData?.recipients) return [];
   if (!recipientSearchQuery.trim()) return batchApprovalData.recipients;
   const q = recipientSearchQuery.trim().toLowerCase();
   return batchApprovalData.recipients.filter((jid) => jid.toLowerCase().includes(q));
 }, [batchApprovalData, recipientSearchQuery]);
 const [queueStatus, setQueueStatus] = useState<{ isPaused: boolean; pauseReason?: string; pendingCount: number; priorityPendingCount?: number; vipPendingCount?: number } | null>(null);
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

 const offset = (queuePage - 1) * queueLimit;
      const msgs = await apiGetSessionMessages(selectedSessionId, { limit: queueLimit, offset });
      if (msgs && typeof msgs.total === 'number') {
        setQueueTotal(msgs.total);
      }
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
 }, [selectedSessionId, queuePage, queueLimit]);

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

 // --- Whitelist penerima kampanye (contactGraph) ---
 const handleLoadBatchApproval = useCallback(async (batchId?: string) => {
 const bid = (batchId ?? batchApprovalBatchId).trim();
 if (!selectedSessionId || !bid) return;
 setBatchApprovalBusy(true);
 try {
 const res = await apiGetBatchApproval(selectedSessionId, bid);
 setBatchApprovalData({ batchId: res.batchId, count: res.count, recipients: res.recipients || [] });
 } catch (err: any) {
 showToast(`Gagal muat whitelist batch: ${err.message}`, 'error');
 } finally {
 setBatchApprovalBusy(false);
 }
 }, [selectedSessionId, batchApprovalBatchId]);

 const handleApproveBatch = async () => {
 const bid = batchApprovalBatchId.trim();
 if (!selectedSessionId || !bid) {
 showToast('Isi Session ID dan Batch ID terlebih dahulu.', 'error');
 return;
 }
 const recipients = batchApprovalInput
 .split(/[\s,;\n]+/)
 .map((s) => s.trim())
 .filter(Boolean);
 if (recipients.length === 0) {
 showToast('Masukkan minimal satu nomor penerima.', 'error');
 return;
 }
 setBatchApprovalBusy(true);
 try {
 const res = await apiApproveBatchRecipients(selectedSessionId, bid, recipients);
 setBatchApprovalData({ batchId: bid, count: res.total, recipients: [] });
 await handleLoadBatchApproval(bid);
 setBatchApprovalInput('');
 const skipped = Array.isArray(res.invalid) && res.invalid.length > 0
 ? ` (${res.invalid.length} nomor tidak valid dilewati)`
 : '';
 showToast(`${res.added} penerima didaftarkan untuk batch ini${skipped}`);
 } catch (err: any) {
 showToast(`Gagal daftarkan penerima: ${err.message}`, 'error');
 } finally {
 setBatchApprovalBusy(false);
 }
 };

 const handleRevokeBatchRecipient = async (jid: string) => {
 const bid = (batchApprovalData?.batchId || batchApprovalBatchId).trim();
 if (!selectedSessionId || !bid) return;
 setBatchApprovalBusy(true);
 try {
 await apiRevokeBatchApproval(selectedSessionId, bid, jid.replace(/@s\.whatsapp\.net$/, ''));
 await handleLoadBatchApproval(bid);
 showToast('Nomor dikeluarkan dari whitelist — wajib handshake lagi.');
 } catch (err: any) {
 showToast(`Gagal cabut nomor: ${err.message}`, 'error');
 } finally {
 setBatchApprovalBusy(false);
 }
 };

 const handleRevokeBatchAll = async () => {
 const bid = (batchApprovalData?.batchId || batchApprovalBatchId).trim();
 if (!selectedSessionId || !bid) return;
 setBatchApprovalBusy(true);
 try {
 const res = await apiRevokeBatchApproval(selectedSessionId, bid);
 setBatchApprovalData({ batchId: bid, count: 0, recipients: [] });
 showToast(`${res.removed} penerima dicabut dari whitelist batch ini.`);
 } catch (err: any) {
 showToast(`Gagal cabut batch: ${err.message}`, 'error');
 } finally {
 setBatchApprovalBusy(false);
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
         <span className="inline-flex items-center gap-1 text-[11px] text-pine bg-pine-wash/60 px-2 py-0.5 rounded border border-pine-line/50">
           <CheckCircle2 size={12} /> Sampai
         </span>
       );
     case 'sending':
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-sea bg-sea-wash/60 px-2 py-0.5 rounded border border-sea-line/50 animate-pulse">
           <Zap size={12} /> Sedang Dikirim
         </span>
       );
     case 'pacing':
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-honey bg-honey-wash/60 px-2 py-0.5 rounded border border-honey-line/50">
           <Clock size={12} /> Jeda Anti-Ban
         </span>
       );
     case 'pending':
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-honey bg-honey-wash/60 px-2 py-0.5 rounded border border-honey-line/50">
           <Clock size={12} /> Antrean Gateway
         </span>
       );
     case 'cancelled':
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted bg-surface-sunken px-2 py-0.5 rounded border border-line">
           <XCircle size={12} /> Dibatalkan
         </span>
       );
     case 'failed':
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-clay bg-clay-wash/60 px-2 py-0.5 rounded border border-clay-line/50">
           <AlertTriangle size={12} /> Gagal
         </span>
       );
     case 'sent':
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-sea bg-sea-wash/60 px-2 py-0.5 rounded border border-sea-line/50">
           <Send size={12} /> Terkirim
         </span>
       );
     case 'read':
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-sea bg-sea-wash/60 px-2 py-0.5 rounded border border-sea-line/50">
           <CheckCheck size={12} /> Dibaca
         </span>
       );
     case 'invalid_number':
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-honey bg-honey-wash/60 px-2 py-0.5 rounded border border-honey-line/50">
           <AlertTriangle size={12} /> Nomor Invalid
         </span>
       );
     case 'not_registered':
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-clay bg-clay-wash/60 px-2 py-0.5 rounded border border-clay-line/50">
           <AlertTriangle size={12} /> Tidak Terdaftar
         </span>
       );
     default:
       return (
         <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted bg-surface-sunken px-2 py-0.5 rounded border border-line">
           {status}
         </span>
       );
   }
 };

 const getModeIcon = (mode: string) => {
 switch (mode) {
 case 'media':
 return <ImageIcon size={12} className="text-sea" />;
 case 'location':
 return <MapPin size={12} className="text-sky-400" />;
 case 'bulk':
 return <Users size={12} className="text-clay" />;
 default:
 return <FileText size={12} className="text-ink-muted" />;
 }
 };

 return (
 <div className="space-y-6">
 {/* Sub-Tab Navigation */}
 <div className="flex items-center gap-2 border-b border-line pb-3">
 <button
 onClick={() => setSubTab('monitor')}
 className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition cursor-pointer ${
 subTab === 'monitor'
 ? 'bg-pine text-surface '
 : 'text-ink-muted hover:text-ink hover:bg-surface'
 }`}
 >
 <Activity size={14} />
 Live Monitor & Anti-Ban
 </button>
 <button
 onClick={() => setSubTab('autorotate')}
 className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition cursor-pointer ${
 subTab === 'autorotate'
 ? 'bg-pine text-surface '
 : 'text-ink-muted hover:text-ink hover:bg-surface'
 }`}
 >
 <RefreshCw size={14} />
 Auto-Rotate & Session Pool
 </button>
 {isAdmin && (
 <button
   onClick={() => setSubTab('command_center')}
   className={`flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition cursor-pointer ${
     subTab === 'command_center'
       ? 'bg-pine text-surface '
       : 'text-ink-muted hover:text-ink hover:bg-surface'
   }`}
 >
   <ShieldCheck size={14} />
   Command Center
 </button>
 )}
 </div>

 {subTab === 'autorotate' && <AutoRotateSettings showToast={showToast} />}

 {subTab === 'command_center' && isAdmin && (
 <AdminCommandCenter sessions={sessions} showToast={showToast} />
 )}

 {subTab === 'monitor' && (
 <div className="space-y-6">
 {/* Top Header & Action */}
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
 <div>
 <h2 className="text-xl font-bold text-ink flex items-center gap-2">
 <Activity className="text-pine" size={20} />
 Realtime Delivery & Anti-Ban Monitor
 </h2>
 <p className="text-xs text-ink-muted">
 Pantau antrean pengiriman pesan dari backend (auto-refresh tiap 3 detik — status asli WhatsApp receipt).
 </p>
 </div>

 <div className="flex flex-wrap items-center gap-2">
 <button
 onClick={() => fetchQueue()}
 className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-line-strong text-ink-soft hover:bg-surface-alt transition"
 >
 <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
 Refresh Queue
 </button>

 <button
 onClick={() => setShowBulkModal(true)}
 className="flex items-center gap-1.5 px-3.5 py-1.5 bg-pine hover:bg-pine-soft text-surface text-xs font-semibold rounded-lg transition"
 >
 <Send size={13} />
 Test Bulk Dispatch
 </button>
 </div>
 </div>

 {/* 3 Metric Cards: Antrean, Delivered, dan Gagal */}
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
 {/* Card 1: Antrean (Pending / Pacing) */}
 <div className="bg-surface border border-honey-line/40 rounded-md p-5 relative overflow-hidden flex flex-col justify-between">
 <div className="flex justify-between items-start">
 <div>
 <span className="text-[11px] font-bold uppercase tracking-wider text-honey flex items-center gap-1.5">
 <Clock size={13} className="text-honey" />
 Masih Antrean
 </span>
 <div className="text-3xl font-extrabold font-mono text-ink mt-2">
 {pendingCount}
 </div>
 </div>
 <span className="p-2.5 rounded-md bg-honey-wash/60 text-honey border border-honey-line/40">
 <Zap size={18} className={pendingCount > 0 ?"animate-pulse" :""} />
 </span>
 </div>
 <div className="mt-3 pt-3 border-t border-line/80 flex items-center justify-between text-[11px] text-ink-muted">
 <span>Pacing Anti-Ban aktif</span>
 <span className="font-mono text-honey-deep">{pendingCount > 0 ?"Sedang jalan" :"Antrean kosong"}</span>
 </div>
 </div>

 {/* Card 2: Delivered & Read */}
 <div className="bg-surface border border-pine-line/40 rounded-md p-5 relative overflow-hidden flex flex-col justify-between">
 <div className="flex justify-between items-start">
 <div>
 <span className="text-[11px] font-bold uppercase tracking-wider text-pine flex items-center gap-1.5">
 <CheckCheck size={14} className="text-pine" />
 Delivery Sukses
 </span>
 <div className="text-3xl font-extrabold font-mono text-pine mt-2">
 {deliveredCount}
 </div>
 </div>
 <span className="p-2.5 rounded-md bg-pine-wash/60 text-pine border border-pine-line/40">
 <CheckCircle2 size={18} />
 </span>
 </div>
 <div className="mt-3 pt-3 border-t border-line/80 flex items-center justify-between text-[11px] text-ink-muted">
 <span>Terkirim server: <strong className="text-sea font-mono">{sentCount}</strong></span>
 <span className="font-mono text-pine-deep">{totalCount > 0 ? `${Math.round(((deliveredCount + sentCount) / totalCount) * 100)}%` :"100%"}</span>
 </div>
 </div>

 {/* Card 3: Gagal & Invalid */}
 <div className="bg-surface border border-clay-line/40 rounded-md p-5 relative overflow-hidden flex flex-col justify-between">
 <div className="flex justify-between items-start">
 <div>
 <span className="text-[11px] font-bold uppercase tracking-wider text-clay flex items-center gap-1.5">
 <AlertTriangle size={13} className="text-clay" />
 Pesan Gagal
 </span>
 <div className="text-3xl font-extrabold font-mono text-clay mt-2">
 {failedCount}
 </div>
 </div>
 <span className="p-2.5 rounded-md bg-clay-wash/60 text-clay border border-clay-line/40">
 <ShieldAlert size={18} />
 </span>
 </div>
 <div className="mt-3 pt-3 border-t border-line/80 flex items-center justify-between text-[11px] text-ink-muted">
 <span>Format salah / reachout limit</span>
 <span className="font-mono text-clay-deep">{failedCount > 0 ?"Periksa nomor" :"Nol kendala"}</span>
 </div>
 </div>

 {/* Card 4: Session & Anti-Ban Status */}
 <div className="bg-surface border border-line rounded-md p-5 relative overflow-hidden flex flex-col justify-between">
 <div>
 <div className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-1.5">Session Target</div>
 {sessions.length === 0 ? (
 <div className="text-xs text-ink-faint py-1">{loading ? 'Memuat sesi...' : 'Belum ada sesi'}</div>
 ) : (
 <select
   value={selectedSessionId}
   onChange={e => {
     setSelectedSessionId(e.target.value);
     setQueuePage(1);
   }}
   className="w-full bg-surface-sunken border border-line rounded-md px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-pine font-medium"
 >
 {sessions.map(s => (
 <option key={s.id} value={s.id}>{s.name} ({s.phone ? `+${s.phone}` : 'Belum pairing'})</option>
 ))}
 </select>
 )}
 </div>
 <div className="mt-3 pt-3 border-t border-line/80 flex items-center justify-between text-[11px]">
 <span className="text-ink-muted">Anti-Ban Throttle:</span>
 <span className="text-pine font-mono font-semibold">Adaptif Dinamis</span>
 </div>
 </div>
 </div>

 {/* Anti-Ban Safety Parameters Drawer/Card */}
 <div className="bg-surface border border-line rounded-md p-5 space-y-4">
 <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
 <div>
 <h3 className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-2">
 <Sliders size={14} className="text-pine" />
 Parameter Anti-Ban Engine (baileys-antiban)
 </h3>
 <p className="text-[11px] text-ink-faint mt-0.5">
 8 layer proteksi akun WhatsApp dengan isolasi risiko, reply ratio guard, dan human-like pacing.
 </p>
 </div>

 {/* Preset Selector & Custom Button */}
 <div className="flex items-center flex-wrap gap-2">
 <span className="text-[11px] text-ink-muted font-medium">Preset:</span>
 <div className="inline-flex rounded-lg bg-surface-sunken p-1 border border-line text-xs">
 <button
 type="button"
 disabled={savingAntiBan || !selectedSessionId}
 onClick={() => handleSelectPreset('strict')}
 className={`px-2.5 py-1 rounded-md font-medium transition ${
 activePreset === 'strict'
 ? 'bg-sea-wash/60 text-sea-deep border border-sea-line/60 '
 : 'text-ink-muted hover:text-ink'
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
 ? 'bg-pine-wash/60 text-pine-deep border border-pine-line/60 '
 : 'text-ink-muted hover:text-ink'
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
 ? 'bg-sea-wash/60 text-sea-deep border border-sea-line/60 '
 : 'text-ink-muted hover:text-ink'
 }`}
 title="Blast / Broadcast Notifikasi: Delay 2-5s, Reply Ratio Nonaktif (tidak kena cooldown)"
 >
 Broadcast
 </button>
 {isAdmin && (
 <button
 type="button"
 disabled={savingAntiBan || !selectedSessionId}
 onClick={() => handleSelectPreset('custom')}
 className={`px-2.5 py-1 rounded-md font-medium transition flex items-center gap-1 ${
 activePreset === 'custom'
 ? 'bg-honey-wash/60 text-honey-deep border border-honey-line/60 '
 : 'text-ink-muted hover:text-ink'
 }`}
 title="Kustomisasi manual seluruh parameter pacing & proteksi (Khusus Admin)"
 >
 <Settings2 size={12} />
 Custom
 </button>
 )}
 </div>

 {antiBanData?.replyRatio?.contactsOnCooldown > 0 && (
 <button
 type="button"
 onClick={handleResetCooldown}
 disabled={resettingCooldown || !selectedSessionId}
 className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-clay-wash/80 hover:bg-clay-wash text-clay-deep border border-clay-line/80 transition flex items-center gap-1"
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
 <div className="p-3 bg-surface-sunken border border-line rounded-md space-y-1 group relative">
 <div className="flex items-center justify-between">
 <span className="text-ink-muted text-[11px] font-medium flex items-center gap-1.5 flex-wrap">
   <span>7-Day WarmUp</span>
   {antiBanData?.numberProfile === 'fresh' || selectedSession?.numberProfile === 'fresh' ? (
     <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-honey-wash text-honey-deep border border-honey-line/60">
       🟡 Nomor Baru (Fresh)
     </span>
   ) : (
     <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-pine-wash text-pine border border-pine-line/60">
       🟢 Nomor Lama (Mature)
     </span>
   )}
 </span>
 <span className="text-[10px] text-pine font-mono">Layer 1</span>
 </div>
 <div className="font-mono text-pine font-semibold text-sm">
 {antiBanData?.warmup ? (
   antiBanData.warmup.phase === 'graduated' || antiBanData?.numberProfile === 'mature'
     ? 'Graduated (Uncapped ∞)'
     : `Hari ke-${antiBanData.warmup.day}/7 (${antiBanData.warmup.todaySent}/${antiBanData.warmup.todayLimit})`
 ) : 'Memuat...'}
 </div>
 <p className="text-[10px] text-ink-faint leading-relaxed">
 {antiBanData?.numberProfile === 'mature' || antiBanData?.warmup?.phase === 'graduated'
   ? 'Nomor matang / mature. Batas kuota warm-up dinonaktifkan (siap broadcast volume penuh).'
   : 'Membatasi volume kirim secara bertahap di 7 hari awal agar nomor baru tidak langsung kena banned.'}
 </p>
 </div>

 {/* 2. Rate Limiter & Jitter */}
 <div className="p-3 bg-surface-sunken border border-line rounded-md space-y-1">
 <div className="flex items-center justify-between">
 <span className="text-ink-muted text-[11px] font-medium">Rate Limiter & Jitter</span>
 <span className="text-[10px] text-pine font-mono">Layer 2</span>
 </div>
 <div className="text-pine font-semibold font-mono text-sm">
 {antiBanData?.rateLimiter
 ? `${antiBanData.rateLimiter.lastMinute}/${antiBanData?.currentConfig?.rateLimiter?.maxPerMinute || 8} mnt • ${antiBanData.rateLimiter.lastHour}/${antiBanData?.currentConfig?.rateLimiter?.maxPerHour || 200} jam`
 : 'Memuat...'}
 </div>
 <p className="text-[10px] text-ink-faint leading-relaxed">
 Pacing Gaussian jitter antar-pesan ({((antiBanData?.currentConfig?.rateLimiter?.minDelayMs || 1500) / 1000).toFixed(1)}s - {((antiBanData?.currentConfig?.rateLimiter?.maxDelayMs || 5000) / 1000).toFixed(1)}s) serta blokir pesan identik berturut-turut.
 </p>
 </div>

 {/* 3. Reconnect Throttle */}
 <div className="p-3 bg-surface-sunken border border-line rounded-md space-y-1">
 <div className="flex items-center justify-between">
 <span className="text-ink-muted text-[11px] font-medium">Reconnect Throttle</span>
 <span className="text-[10px] text-sea font-mono">Layer 3</span>
 </div>
 <div className="text-sea font-semibold font-mono text-sm">
 {antiBanData?.reconnectMultiplier !== undefined
 ? `${Math.round(antiBanData.reconnectMultiplier * 100)}% kecepatan`
 : '100% (Stabil)'}
 </div>
 <p className="text-[10px] text-ink-faint leading-relaxed">
 Memperlambat laju kirim menjadi 10% sesaat setelah koneksi pulih, lalu bertahap naik ke 100% guna menghindari kecurigaan lonjakan bot.
 </p>
 </div>

 {/* 4. Circadian Rhythm */}
 <div className="p-3 bg-surface-sunken border border-line rounded-md space-y-1">
 <div className="flex items-center justify-between">
 <span className="text-ink-muted text-[11px] font-medium">Circadian Rhythm</span>
 <span className="text-[10px] text-sea font-mono">Layer 4</span>
 </div>
 <div className="text-sea font-semibold font-mono text-sm">
 {antiBanData?.circadianMultiplier
 ? `${antiBanData.circadianMultiplier.toFixed(2)}x kecepatan`
 : '1.0x normal'}
 </div>
 <p className="text-[10px] text-ink-faint leading-relaxed">
 Meniru siklus biologis manusia. Jam malam (23:00 - 05:00) otomatis diperlambat 4x - 6x dibanding jam kerja siang hari.
 </p>
 </div>

 {/* 5. Timelock Guard */}
 <div className="p-3 bg-surface-sunken border border-line rounded-md space-y-1">
 <div className="flex items-center justify-between">
 <span className="text-ink-muted text-[11px] font-medium">Timelock Guard</span>
 <span className="text-[10px] text-honey font-mono">Layer 5</span>
 </div>
 <div className={`font-semibold font-mono text-sm ${antiBanData?.timelock?.isActive ? 'text-honey' : 'text-pine'}`}>
 {antiBanData?.timelock?.isActive ? 'TIMELOCKED (Blok Baru)' : 'Normal (Bebas 463)'}
 </div>
 <p className="text-[10px] text-ink-faint leading-relaxed">
 Perlindungan error 463 dari server WhatsApp. Kontak baru dibekukan sementara, kontak lama tetap diizinkan berkirim pesan.
 </p>
 </div>

 {/* 6. Ban Recovery Orchestrator */}
 <div className="p-3 bg-surface-sunken border border-line rounded-md space-y-1">
 <div className="flex items-center justify-between">
 <span className="text-ink-muted text-[11px] font-medium">Recovery Orchestrator</span>
 <span className="text-[10px] text-sea font-mono">Layer 6</span>
 </div>
 <div className={`font-semibold font-mono text-sm ${antiBanData?.recovery?.currentPhase === 'recovering' ? 'text-honey' : 'text-pine'}`}>
 {antiBanData?.recovery?.currentPhase === 'recovering'
 ? `Recovery: ${antiBanData.recovery.banType || 'Active'}`
 : 'Fase: Normal'}
 </div>
 <p className="text-[10px] text-ink-faint leading-relaxed">
 Protokol pemulihan bertahap pasca akun dibuka dari blokir (jeda istirahat 24 jam → mulai 10% kuota → naik +15% per pekan).
 </p>
 </div>

 {/* 7. Reply Ratio Guard */}
 <div className="p-3 bg-surface-sunken border border-line rounded-md space-y-1">
 <div className="flex items-center justify-between">
 <span className="text-ink-muted text-[11px] font-medium">Reply Ratio Guard</span>
 <span className="text-[10px] text-sea font-mono">Layer 7</span>
 </div>
 <div className="text-sea font-semibold font-mono text-sm flex items-center justify-between">
 <span>
 {antiBanData?.currentConfig?.replyRatio?.enabled === false
 ? 'NONAKTIF (Mode Broadcast)'
 : antiBanData?.replyRatio
 ? `${Math.round(antiBanData.replyRatio.globalRatio * 100)}% (${antiBanData.replyRatio.globalReceived}/${antiBanData.replyRatio.globalSent} msg)`
 : '0% (0/0)'}
 </span>
 </div>
 <p className="text-[10px] text-ink-faint leading-relaxed">
 Mencegah pola spam satu arah. Jika kontak tidak pernah membalas setelah {antiBanData?.currentConfig?.replyRatio?.minMessagesBeforeEnforce || 5} pesan, pengiriman ke nomor tersebut di-cooldown.
 </p>
 </div>

 {/* 8. Contact Graph Warmer */}
 <div className="p-3 bg-surface-sunken border border-line rounded-md space-y-2">
 <div className="flex items-center justify-between">
 <span className="text-ink-muted text-[11px] font-medium">Contact Graph</span>
 <span className="text-[10px] text-clay font-mono">Layer 8</span>
 </div>
 <div className="flex items-center justify-between gap-2">
 <span className={`font-semibold font-mono text-sm ${antiBanData?.currentConfig?.contactGraph?.enabled ? 'text-pine' : 'text-ink-muted'}`}>
 {antiBanData?.currentConfig?.contactGraph?.enabled ? 'AKTIF' : 'NONAKTIF'}
 </span>
 <span className="text-[10px] text-ink-faint font-mono">
 {antiBanData?.contactGraph
 ? `${antiBanData.contactGraph.knownContacts ?? 0} known • ${antiBanData.contactGraph.pendingHandshakes ?? 0} pending`
 : '0 known • 0 pending'}
 </span>
 </div>

 {/* Peringatan kontekstual: kondisi paling berbahaya adalah guard menyala tanpa
     whitelist, karena setiap penerima kampanye akan tertahan handshake. */}
 {antiBanData?.currentConfig?.contactGraph?.enabled && antiBanData?.currentConfig?.contactGraph?.batchWhitelist === false && (
 <div className="flex items-start gap-1.5 text-[10px] text-honey leading-relaxed">
 <AlertTriangle size={11} className="mt-0.5 shrink-0" />
 <span>Whitelist penerima nonaktif — setiap penerima blast akan tertahan handshake.</span>
 </div>
 )}

 {/* Ringkasan status whitelist batch */}
 <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-line font-mono">
 <span className="text-ink-faint">Batch Whitelist:</span>
 <span className={Array.isArray(antiBanData?.contactGraph?.batchApprovals) && antiBanData.contactGraph.batchApprovals.length > 0 ? 'text-pine font-semibold' : 'text-ink-muted'}>
 {Array.isArray(antiBanData?.contactGraph?.batchApprovals) && antiBanData.contactGraph.batchApprovals.length > 0
 ? `${antiBanData.contactGraph.batchApprovals.length} kampanye (${antiBanData.contactGraph.batchApprovals.reduce((s: number, b: any) => s + (b.count || 0), 0)} no)`
 : 'Belum ada'}
 </span>
 </div>

 <p className="text-[10px] text-ink-faint leading-relaxed">
 Pemanasan grafik jejaring sosial WhatsApp: interaksi bertahap di grup sebelum mengirim pesan langsung ke anggota yang belum saling simpan kontak.
 </p>

 {/* Tombol kelola whitelist via Dedicated Modal (mencegah layout memanjang ke bawah) */}
 {isAdmin && (
 <button
 type="button"
 onClick={() => setShowContactGraphModal(true)}
 className="w-full mt-1 py-1.5 px-2 rounded border border-line bg-surface hover:bg-surface-sunken hover:border-pine text-[10px] font-medium text-ink flex items-center justify-center gap-1.5 transition-colors"
 >
 <ShieldCheck size={12} className="text-pine" />
 <span>Kelola Whitelist Penerima...</span>
 </button>
 )}
 </div>
 </div>
 </div>

 {/* Delivery Queue Table */}
 <div className="bg-surface border border-line rounded-md overflow-hidden">
   <div className="p-3.5 sm:p-4 border-b border-line flex flex-col lg:flex-row lg:items-center justify-between gap-3">
     <div className="min-w-0">
       <h3 className="text-sm font-bold text-ink flex items-center gap-2">
         <Zap size={14} className="text-pine shrink-0" />
         <span className="truncate">Delivery Queue — {selectedSession?.name || 'Semua Session'}</span>
       </h3>
       <p className="text-[11px] text-ink-faint mt-0.5 leading-relaxed">Data asli dari backend (SQLite) — status berubah realtime sesuai delivery receipt WhatsApp.</p>
     </div>

     <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2.5 pt-1 lg:pt-0 border-t lg:border-t-0 border-line/60">
       {/* Action & Status Controls */}
       <div className="flex items-center gap-2">
         {queueStatus?.isPaused ? (
           <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-honey-wash/60 border border-honey-line/80 text-honey-deep whitespace-nowrap">
             <Pause size={12} />
             Dijeda ({queueStatus.pauseReason || 'Manual'})
           </span>
         ) : (
           <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-pine-wash/50 border border-pine-line/60 text-pine whitespace-nowrap">
             <Play size={12} />
             Antrean Berjalan
           </span>
         )}

         <button
           type="button"
           onClick={handleToggleQueuePause}
           disabled={pausingQueue || !selectedSessionId}
           className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition cursor-pointer disabled:opacity-50 whitespace-nowrap ${
             queueStatus?.isPaused
               ? 'bg-pine hover:bg-pine-soft text-surface'
               : 'bg-honey hover:bg-honey text-surface'
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
       </div>

       {/* Page Size Selector & Total Messages Counter */}
       <div className="flex items-center gap-2 text-xs text-ink-muted ml-auto lg:ml-0">
         <span className="text-[11px] font-medium text-ink-muted whitespace-nowrap">Tampilkan:</span>
         <select
           value={queueLimit}
           onChange={(e) => {
             setQueueLimit(Number(e.target.value));
             setQueuePage(1);
           }}
           className="h-7.5 px-2 text-xs rounded-md bg-surface-alt border border-line text-ink font-medium focus:outline-none focus:border-pine cursor-pointer"
         >
           <option value={10}>10 baris</option>
           <option value={25}>25 baris</option>
           <option value={50}>50 baris</option>
           <option value={100}>100 baris</option>
         </select>
         <span className="text-[11px] text-ink-muted bg-surface-sunken px-2.5 py-1 rounded-lg border border-line font-mono whitespace-nowrap">
           {queueTotal.toLocaleString('id-ID')} pesan
         </span>
       </div>
     </div>
   </div>

 {queue.length === 0 ? (
 <div className="p-10 text-center">
 <p className="text-xs text-ink-faint">
   {loading ? 'Memuat antrean...' : 'Belum ada pesan di antrean untuk session ini. Kirim pesan lewat Playground dulu.'}
 </p>
 </div>
 ) : (
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs min-w-[650px]">
   <thead className="bg-surface-sunken text-ink-muted uppercase tracking-wider text-[11px]">
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
   <tbody className="divide-y divide-line/70">
     {queue.map(item => {
       const isFailed = item.status === 'failed' || item.status === 'invalid_number';
       const isRetrying = retryingIds.has(item.id);
       return (
         <tr key={item.id} className="hover:bg-surface-alt/40 transition">
           <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{item.timestamp}</td>
           <td className="px-4 py-3 font-mono text-ink whitespace-nowrap">+{item.recipient}</td>
           <td className="px-4 py-3">
             <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-sunken border border-line text-[10px] text-ink-soft uppercase">
               {getModeIcon(item.mode)} {item.mode}
             </span>
             {item.isBulk && (
               <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-clay-wash/60 border border-clay-line/50 text-[10px] text-clay-deep">
                 <Users size={10} /> Bulk
               </span>
             )}
           </td>
           <td className="px-4 py-3 text-ink-muted max-w-[220px] truncate">{item.text}</td>
           <td className="px-4 py-3 font-mono text-ink-faint">{(item.jitterDelayMs / 1000).toFixed(1)}s</td>
           <td className="px-4 py-3">{getStatusBadge(item.status)}</td>
           <td className="px-4 py-3 text-right">
             {isFailed ? (
               <button
                 type="button"
                 disabled={isRetrying}
                 onClick={() => handleRetryMessage(item.id)}
                 className="inline-flex items-center gap-1 px-2 py-1 rounded bg-honey-wash/70 hover:bg-honey-wash border border-honey-line/70 text-honey-deep text-[11px] font-medium transition cursor-pointer disabled:opacity-50"
                 title="Kirim ulang pesan ini ke antrean"
               >
                 {isRetrying ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                 <span>Retry</span>
               </button>
             ) : (
               <span className="text-[10px] text-ink-faint">-</span>
             )}
           </td>
         </tr>
       );
     })}
   </tbody>
 </table>
 </div>
 )}

 {/* Footer Pagination */}
 <div className="p-3 sm:p-3.5 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-surface-sunken/40">
   <div className="text-ink-muted text-[11px] text-center sm:text-left w-full sm:w-auto">
     Menampilkan{' '}
     <strong className="text-ink font-mono">
       {queueTotal === 0 ? 0 : (queuePage - 1) * queueLimit + 1}
     </strong>{' '}
     -{' '}
     <strong className="text-ink font-mono">
       {Math.min(queuePage * queueLimit, queueTotal)}
     </strong>{' '}
     dari <strong className="text-ink font-mono">{queueTotal.toLocaleString('id-ID')}</strong> pesan
   </div>

   <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
     <button
       type="button"
       disabled={queuePage <= 1 || loading}
       onClick={() => setQueuePage((p) => Math.max(1, p - 1))}
       className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg bg-surface border border-line text-ink-muted hover:text-ink disabled:opacity-40 disabled:pointer-events-none transition text-xs font-medium cursor-pointer"
     >
       <ChevronLeft size={13} />
       <span>Sebelumnya</span>
     </button>

     <span className="px-3 py-1 text-xs font-mono font-semibold text-ink bg-surface-alt/60 rounded-md border border-line/60">
       {queuePage} / {Math.ceil(queueTotal / queueLimit) || 1}
     </span>

     <button
       type="button"
       disabled={queuePage >= (Math.ceil(queueTotal / queueLimit) || 1) || loading}
       onClick={() => setQueuePage((p) => Math.min(Math.ceil(queueTotal / queueLimit) || 1, p + 1))}
       className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg bg-surface border border-line text-ink-muted hover:text-ink disabled:opacity-40 disabled:pointer-events-none transition text-xs font-medium cursor-pointer"
     >
       <span>Selanjutnya</span>
       <ChevronRight size={13} />
     </button>
   </div>
 </div>
 </div>

 </div>
 )}

 {/* Bulk Dispatch Modal */}
 {showBulkModal && (
 <div className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm flex items-center justify-center p-4">
 <div className="bg-surface border border-line rounded-md p-6 w-full max-w-lg space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="text-base font-bold text-ink flex items-center gap-2">
 <Send size={16} className="text-pine" />
 Test Bulk Dispatch
 </h3>
 <button onClick={() => setShowBulkModal(false)} className="text-ink-muted hover:text-surface transition">✕</button>
 </div>

 <div>
 <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
 Session
 </label>
 <select
   value={selectedSessionId}
   onChange={e => {
     setSelectedSessionId(e.target.value);
     setQueuePage(1);
   }}
   className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-pine"
 >
 {sessions.map(s => (
 <option key={s.id} value={s.id}>{s.name}</option>
 ))}
 </select>
 </div>

 <div>
 <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
 Nomor Tujuan (satu per baris)
 </label>
 <textarea
 value={bulkRecipientText}
 onChange={e => setBulkRecipientText(e.target.value)}
 rows={4}
 placeholder={'6281234567890\n6289876543210'}
 className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:border-pine"
 />
 </div>

 <div>
 <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1">
 Pesan
 </label>
 <textarea
 value={bulkMessageText}
 onChange={e => setBulkMessageText(e.target.value)}
 rows={3}
 className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-pine"
 />
 </div>

 <button
 onClick={handleEnqueueBulk}
 disabled={sendingBulk || !bulkRecipientText.trim()}
 className="w-full py-2.5 bg-pine hover:bg-pine-soft disabled:opacity-50 text-surface rounded-lg font-semibold text-sm transition flex items-center justify-center gap-2"
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
 <div className="fixed inset-0 z-50 bg-ink/75 backdrop-blur-sm flex items-center justify-center p-4">
 <div className="bg-surface border border-line rounded-md w-full max-w-xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between pb-3 border-b border-line">
 <div className="flex items-center gap-2">
 <Settings2 size={18} className="text-honey" />
 <h3 className="font-bold text-ink text-sm">
 Kustomisasi Parameter Anti-Ban (Sesi: {selectedSession?.name})
 </h3>
 </div>
 <button
 type="button"
 onClick={() => setShowConfigModal(false)}
 className="text-ink-muted hover:text-surface transition text-sm"
 >
 ✕
 </button>
 </div>

 <form onSubmit={handleSaveCustomConfig} className="space-y-4 text-xs">
 {/* Seksi Pacing Rate Limiter */}
 <div className="bg-surface-sunken border border-line/80 rounded-md p-4 space-y-3">
 <div className="flex items-center justify-between border-b border-line pb-2">
 <span className="font-semibold text-ink">Layer 2: Pacing & Rate Limiter</span>
 <span className="text-[10px] text-pine font-mono">Pacing Mesin</span>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="block text-ink-muted mb-1">Min Delay (detik)</label>
 <input
 type="number"
 step="0.1"
 min="0.5"
 max="60"
 value={customForm.minDelaySec}
 onChange={(e) => setCustomForm({ ...customForm, minDelaySec: parseFloat(e.target.value) || 1 })}
 className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-ink font-mono focus:border-pine focus:outline-none"
 />
 <span className="text-[10px] text-ink-faint">Jeda acak terendah antar-pesan</span>
 </div>
 <div>
 <label className="block text-ink-muted mb-1">Max Delay (detik)</label>
 <input
 type="number"
 step="0.1"
 min="1"
 max="120"
 value={customForm.maxDelaySec}
 onChange={(e) => setCustomForm({ ...customForm, maxDelaySec: parseFloat(e.target.value) || 2 })}
 className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-ink font-mono focus:border-pine focus:outline-none"
 />
 <span className="text-[10px] text-ink-faint">Jeda acak tertinggi antar-pesan</span>
 </div>
 <div>
 <label className="block text-ink-muted mb-1">Max Pesan / Menit</label>
 <input
 type="number"
 min="1"
 max="60"
 value={customForm.maxPerMinute}
 onChange={(e) => setCustomForm({ ...customForm, maxPerMinute: parseInt(e.target.value, 10) || 5 })}
 className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-ink font-mono focus:border-pine focus:outline-none"
 />
 <span className="text-[10px] text-ink-faint">Batas frekuensi dalam 60 detik</span>
 </div>
 <div>
 <label className="block text-ink-muted mb-1">Max Pesan / Jam</label>
 <input
 type="number"
 min="10"
 max="1000"
 value={customForm.maxPerHour}
 onChange={(e) => setCustomForm({ ...customForm, maxPerHour: parseInt(e.target.value, 10) || 100 })}
 className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-ink font-mono focus:border-pine focus:outline-none"
 />
 <span className="text-[10px] text-ink-faint">Batas kuota sliding window 1 jam</span>
 </div>
 </div>
 </div>

 {/* Seksi Reply Ratio Guard */}
 <div className="bg-surface-sunken border border-line/80 rounded-md p-4 space-y-3">
 <div className="flex items-center justify-between border-b border-line pb-2">
 <span className="font-semibold text-ink">Layer 7: Reply Ratio Guard</span>
 <label className="flex items-center gap-1.5 cursor-pointer text-xs">
 <input
 type="checkbox"
 checked={customForm.replyRatioEnabled}
 onChange={(e) => setCustomForm({ ...customForm, replyRatioEnabled: e.target.checked })}
 className="rounded border-line-strong text-pine focus:ring-0"
 />
 <span className={customForm.replyRatioEnabled ? 'text-pine' : 'text-ink-faint'}>
 {customForm.replyRatioEnabled ? 'Aktif' : 'Nonaktif (Mode Blast)'}
 </span>
 </label>
 </div>
 <div className="grid grid-cols-3 gap-3">
 <div>
 <label className="block text-ink-muted mb-1">Min Pesan Awal</label>
 <input
 type="number"
 disabled={!customForm.replyRatioEnabled}
 min="1"
 max="50"
 value={customForm.minMessagesBeforeEnforce}
 onChange={(e) => setCustomForm({ ...customForm, minMessagesBeforeEnforce: parseInt(e.target.value, 10) || 5 })}
 className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-ink font-mono focus:border-pine focus:outline-none disabled:opacity-40"
 />
 <span className="text-[10px] text-ink-faint">Pesan terkirim sebelum rasio dicek</span>
 </div>
 <div>
 <label className="block text-ink-muted mb-1">Min Rasio Balasan (%)</label>
 <input
 type="number"
 disabled={!customForm.replyRatioEnabled}
 min="0"
 max="100"
 value={customForm.minRatioPercent}
 onChange={(e) => setCustomForm({ ...customForm, minRatioPercent: parseInt(e.target.value, 10) || 0 })}
 className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-ink font-mono focus:border-pine focus:outline-none disabled:opacity-40"
 />
 <span className="text-[10px] text-ink-faint">Standar 10% (1 balasan per 10 kirim)</span>
 </div>
 <div>
 <label className="block text-ink-muted mb-1">Durasi Cooldown (jam)</label>
 <input
 type="number"
 disabled={!customForm.replyRatioEnabled}
 min="1"
 max="72"
 value={customForm.cooldownHours}
 onChange={(e) => setCustomForm({ ...customForm, cooldownHours: parseInt(e.target.value, 10) || 24 })}
 className="w-full bg-surface border border-line rounded-lg px-2.5 py-1.5 text-ink font-mono focus:border-pine focus:outline-none disabled:opacity-40"
 />
 <span className="text-[10px] text-ink-faint">Lama penghentian jika melanggar</span>
 </div>
 </div>
 </div>

 <div className="flex items-center justify-end gap-2 pt-2">
 <button
 type="button"
 onClick={() => setShowConfigModal(false)}
 className="px-4 py-2 rounded-lg bg-surface-alt hover:bg-surface-alt text-ink-soft font-medium transition"
 >
 Batal
 </button>
 <button
 type="submit"
 disabled={savingAntiBan}
 className="px-4 py-2 rounded-lg bg-pine hover:bg-pine-soft text-surface font-semibold transition flex items-center gap-1.5"
 >
 {savingAntiBan ? <Loader2 size={13} className="animate-spin" /> : null}
 Terapkan Parameter Kustom
 </button>
 </div>
 </form>
 </div>
 </div>
 )}

 {/* Modal Dedicated: Whitelist Penerima Contact Graph */}
 {showContactGraphModal && (
 <div 
   className="fixed inset-0 z-50 bg-ink/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
   onClick={(e) => {
     if (e.target === e.currentTarget) setShowContactGraphModal(false);
   }}
 >
   <div className="bg-surface border border-line rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
     {/* Modal Header */}
     <div className="p-4 border-b border-line flex items-center justify-between gap-3 bg-surface-sunken/40">
       <div className="flex items-center gap-2.5">
         <div className="p-1.5 rounded-md bg-pine/10 border border-pine/20 text-pine">
           <ShieldCheck size={20} />
         </div>
         <div>
           <h3 className="text-sm font-bold text-ink flex items-center gap-2">
             Whitelist Penerima Contact Graph
           </h3>
           <p className="text-[11px] text-ink-muted mt-0.5">
             Sesi: <span className="font-semibold text-ink">{selectedSession?.name || selectedSessionId || 'Semua Sesi'}</span> • Lewati handshake anti-ban per batch kampanye
           </p>
         </div>
       </div>
       <button
         type="button"
         onClick={() => setShowContactGraphModal(false)}
         className="text-ink-muted hover:text-ink p-1.5 rounded-md hover:bg-surface-sunken transition-colors"
         title="Tutup (Esc)"
       >
         ✕
       </button>
     </div>

     {/* Modal Body */}
     <div className="p-4 overflow-y-auto space-y-4 flex-1">
       {/* Quick Batch Selector / Kampanye Aktif */}
       {Array.isArray(antiBanData?.contactGraph?.batchApprovals) && antiBanData.contactGraph.batchApprovals.length > 0 && (
         <div className="p-3 bg-surface-sunken/60 border border-line rounded-md space-y-2">
           <div className="flex items-center justify-between">
             <span className="text-[10px] text-ink-faint font-semibold uppercase tracking-wider">
               Kampanye Terdaftar dengan Whitelist ({antiBanData.contactGraph.batchApprovals.length})
             </span>
             <span className="text-[10px] text-pine font-mono font-medium">
               {antiBanData.contactGraph.batchApprovals.reduce((s: number, b: any) => s + (b.count || 0), 0)} total nomor
             </span>
           </div>
           <div className="flex flex-wrap gap-1.5">
             {antiBanData.contactGraph.batchApprovals.map((b: any) => (
               <button
                 key={b.batchId}
                 type="button"
                 onClick={() => {
                   setBatchApprovalBatchId(b.batchId);
                   handleLoadBatchApproval(b.batchId);
                 }}
                 className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono border transition-all ${
                   batchApprovalBatchId === b.batchId
                     ? 'bg-pine text-surface border-pine font-semibold shadow-sm'
                     : 'bg-surface border-line text-ink hover:border-pine'
                 }`}
               >
                 <span className="truncate max-w-[150px]">{b.batchId}</span>
                 <span className={`text-[10px] px-1.5 py-0.2 rounded font-sans ${
                   batchApprovalBatchId === b.batchId ? 'bg-surface/25 text-surface' : 'bg-surface-sunken text-pine'
                 }`}>
                   {b.count} no
                 </span>
               </button>
             ))}
           </div>
         </div>
       )}

       {/* Input Batch ID & Action */}
       <div className="space-y-1.5">
         <label className="text-xs font-semibold text-ink flex items-center justify-between">
           <span>Target Batch ID</span>
           <span className="text-[10px] text-ink-faint font-normal font-sans">
             ID kampanye pengiriman blast
           </span>
         </label>
         <div className="flex gap-2">
           <input
             type="text"
             value={batchApprovalBatchId}
             onChange={(e) => setBatchApprovalBatchId(e.target.value)}
             placeholder="Masukkan Batch ID (contoh: batch_178959... atau cmp_broadcast)"
             className="flex-1 min-w-0 px-3 py-1.5 text-xs font-mono bg-surface border border-line rounded-md text-ink placeholder:text-ink-faint focus:outline-none focus:border-pine"
           />
           <button
             type="button"
             onClick={() => handleLoadBatchApproval()}
             disabled={batchApprovalBusy || !batchApprovalBatchId.trim()}
             className="px-3 py-1.5 text-xs font-medium rounded-md border border-line text-ink bg-surface hover:bg-surface-sunken hover:border-pine transition-colors disabled:opacity-40 flex items-center gap-1.5 shrink-0"
           >
             {batchApprovalBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
             <span>Muat Nomor</span>
           </button>
         </div>
       </div>

       {/* Form Input Nomor Whitelist Baru */}
       <div className="p-3.5 border border-line rounded-md bg-surface-sunken/30 space-y-2.5">
         <div className="flex items-center justify-between">
           <label className="text-xs font-semibold text-ink">
             Daftarkan Nomor Penerima Baru
           </label>
           {detectedCount > 0 && (
             <span className="text-[11px] text-pine font-medium font-mono">
               {detectedCount} nomor terdeteksi
             </span>
           )}
         </div>
         <textarea
           value={batchApprovalInput}
           onChange={(e) => setBatchApprovalInput(e.target.value)}
           rows={3}
           placeholder="628111111111, 628122222222&#10;(pisahkan dengan koma, spasi, atau baris baru)"
           className="w-full px-3 py-2 text-xs font-mono bg-surface border border-line rounded-md text-ink placeholder:text-ink-faint focus:outline-none focus:border-pine resize-y"
         />
         <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
           <button
             type="button"
             onClick={handleApproveBatch}
             disabled={batchApprovalBusy || !batchApprovalBatchId.trim() || !batchApprovalInput.trim()}
             className="px-3.5 py-1.5 text-xs rounded-md bg-pine text-surface font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-1.5 shadow-sm"
           >
             <CheckCircle2 size={13} />
             <span>Daftarkan ke Whitelist</span>
           </button>

           {batchApprovalData && batchApprovalData.count > 0 && (
             <button
               type="button"
               onClick={handleRevokeBatchAll}
               disabled={batchApprovalBusy}
               className="px-3 py-1.5 text-xs rounded-md border border-line text-ink-muted hover:text-rose-500 hover:border-rose-500/40 hover:bg-rose-500/5 transition-colors disabled:opacity-40 flex items-center gap-1.5 ml-auto"
             >
               <XCircle size={13} />
               <span>Cabut Seluruh Whitelist Batch Ini</span>
             </button>
           )}
         </div>
       </div>

       {/* Daftar Nomor Penerima yang Di-whitelist */}
       {batchApprovalData && (
         <div className="space-y-2.5 border-t border-line pt-3.5">
           <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
             <div className="flex items-center gap-2">
               <span className="text-xs font-bold text-ink">
                 Daftar Nomor Terdaftar:
               </span>
               <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-pine/10 text-pine border border-pine/20">
                 {batchApprovalData.count} penerima
               </span>
             </div>

             {/* Filter / Search Input */}
             {batchApprovalData.count > 0 && (
               <div className="relative w-full sm:w-56">
                 <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
                 <input
                   type="text"
                   value={recipientSearchQuery}
                   onChange={(e) => setRecipientSearchQuery(e.target.value)}
                   placeholder="Cari nomor telepon..."
                   className="w-full pl-8 pr-2.5 py-1 text-xs font-mono bg-surface border border-line rounded-md text-ink placeholder:text-ink-faint focus:outline-none focus:border-pine"
                 />
               </div>
             )}
           </div>

           {batchApprovalData.count === 0 ? (
             <div className="py-6 text-center text-xs text-ink-faint bg-surface-sunken/40 rounded-md border border-line">
               Belum ada nomor penerima yang didaftarkan pada batch <span className="font-mono text-ink-muted font-medium">{batchApprovalData.batchId}</span>.
             </div>
           ) : (
             <div className="max-h-56 overflow-y-auto border border-line rounded-md bg-surface p-2 divide-y divide-line/60">
               {filteredRecipients.length === 0 ? (
                 <div className="py-5 text-center text-xs text-ink-faint">
                   Tidak ada nomor yang cocok dengan &quot;{recipientSearchQuery}&quot;
                 </div>
               ) : (
                 filteredRecipients.map((jid) => {
                   const phone = jid.replace(/@s\.whatsapp\.net$/, '');
                   return (
                     <div key={jid} className="py-1.5 px-2.5 flex items-center justify-between text-xs font-mono hover:bg-surface-sunken/50 rounded transition-colors">
                       <div className="flex items-center gap-2.5">
                         <span className="text-pine font-medium">+{phone}</span>
                         <span className="text-[10px] text-ink-faint font-sans px-1.5 py-0.5 bg-surface-sunken rounded border border-line">
                           Bypass Handshake
                         </span>
                       </div>
                       <button
                         type="button"
                         onClick={() => handleRevokeBatchRecipient(jid)}
                         disabled={batchApprovalBusy}
                         className="text-ink-faint hover:text-rose-500 p-1 rounded hover:bg-rose-500/10 transition-colors disabled:opacity-40 flex items-center gap-1 text-[11px]"
                         title="Keluarkan nomor ini dari whitelist"
                       >
                         <XCircle size={13} />
                         <span className="text-[10px] font-sans">Cabut</span>
                       </button>
                     </div>
                   );
                 })
               )}
             </div>
           )}
         </div>
       )}
     </div>

     {/* Modal Footer */}
     <div className="p-3 sm:px-4 bg-surface-sunken/60 border-t border-line flex items-center justify-between text-[11px] text-ink-faint">
       <span className="hidden sm:inline">
         Penerima yang di-whitelist lolos handshake Contact Graph khusus pada batch ini.
       </span>
       <button
         type="button"
         onClick={() => setShowContactGraphModal(false)}
         className="ml-auto px-4 py-1.5 rounded-md border border-line bg-surface text-ink hover:bg-surface-sunken font-medium transition-colors text-xs"
       >
         Tutup
       </button>
     </div>
   </div>
 </div>
 )}

 {/* Toast auto-close */}
 <Toast toast={toast} onClose={() => setToast(null)} />
 </div>
 );
};