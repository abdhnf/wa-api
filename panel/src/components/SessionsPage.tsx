import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
 Smartphone, Plus, QrCode, Power, RefreshCw, Trash2, BarChart2, 
 ShieldCheck, ShieldAlert, Cpu, HardDrive, Wifi, Clock, ArrowUpRight, Loader2, Pencil, Check, X, AlertTriangle
} from 'lucide-react';
import { type Session, EMPTY_SESSIONS } from '../dummyData';
import { 
 apiGetSessions, 
 apiCreateSession, 
 apiGetSessionQr, 
 apiLogoutSession, 
 apiReconnectSession, 
 apiDeleteSession, 
 apiGetSession, 
 apiRenameSession,
 apiRepairSession,
 apiUpdateSessionProfile
} from '../api';
import { Toast } from './Toast';
import { RiskBadge, RiskBar, RiskDetail, scoreToRisk, type HealthStatus } from '../lib/sessionHealth';
import { apiGetAntiBan } from '../api';

export const SessionsPage: React.FC = () => {
 const [sessions, setSessions] = useState<Session[]>(EMPTY_SESSIONS);
 const [selectedSession, setSelectedSession] = useState<Session | null>(null);
 const [showQRModal, setShowQRModal] = useState(false);
 const [initialLoading, setInitialLoading] = useState(true);
 const [refreshing, setRefreshing] = useState(false);
 const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
 const [pairingSessionId, setPairingSessionId] = useState<string | null>(null);
 const [newSessionName, setNewSessionName] = useState('Nomor Baru');
 const [newSessionPhone, setNewSessionPhone] = useState('628');
 const [newSessionProfile, setNewSessionProfile] = useState<'fresh' | 'mature'>('mature');
 const [pairingLoading, setPairingLoading] = useState(false);
 const [qrCountdown, setQrCountdown] = useState(60);
 const [qrChecking, setQrChecking] = useState(false);
 const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
 const [renamingId, setRenamingId] = useState<string | null>(null);
 const [renameValue, setRenameValue] = useState('');
 const [savingRename, setSavingRename] = useState(false);
 const [reconnectingId, setReconnectingId] = useState<string | null>(null);
 const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
 /** Kesehatan sesi terpilih, dimuat dari endpoint antiban yang sudah ada. */
 const [selectedHealth, setSelectedHealth] = useState<HealthStatus | null>(null);

 // Modal konfirmasi pengganti confirm()
 const [confirmModal, setConfirmModal] = useState<{
 isOpen: boolean;
 title: string;
 message: string;
 confirmText: string;
 confirmVariant: 'danger' | 'warning' | 'primary';
 onConfirm: () => void;
 }>({
 isOpen: false,
 title: '',
 message: '',
 confirmText: 'Lanjutkan',
 confirmVariant: 'primary',
 onConfirm: () => {},
 });

 // polling timer untuk deteksi QR discan
 const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
 const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

 const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
 setToast({ msg, type });
 }, []);

 const stopPolling = useCallback(() => {
 if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
 if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
 }, []);

 const fetchSessions = async (isManualRefresh = false) => {
 if (isManualRefresh) setRefreshing(true);
 try {
 const real = await apiGetSessions();
 if (Array.isArray(real)) {
 const mapped: Session[] = real.map((s: any) => ({
 id: s.id,
 name: s.name,
 phone: s.phone,
 status: s.status,
 riskScore: s.riskScore || 0,
 warmupDay: s.warmupDay || 1,
 numberProfile: s.numberProfile || 'mature',
 messagesSentToday: s.messagesSentToday || 0,
 deliveryRate: s.deliveryRate || 100,
 metrics: {
 totalSent: s.metrics?.totalSent || 0,
 totalDelivered: s.metrics?.totalDelivered || 0,
 totalFailed: s.metrics?.totalFailed || 0,
 avgPacingDelaySec: s.metrics?.avgPacingDelaySec || 0,
 uptimeHours: s.metrics?.uptimeHours || 0,
 disconnectCountToday: s.metrics?.disconnectCountToday || 0,
 hourlyStats: s.metrics?.hourlyStats || [],
 },
 }));
 setSessions(mapped);
 setSelectedSession((prev) => {
 if (!prev) return mapped[0] || null;
 const found = mapped.find((m) => m.id === prev.id);
 return found || mapped[0] || null;
 });
 }
 } catch {
 showToast('Gagal memuat daftar sesi dari backend.', 'error');
 } finally {
 setInitialLoading(false);
 if (isManualRefresh) setRefreshing(false);
 }
 };

 // Hanya fetch sekali saat halaman dibuka / mounted (TIDAK polling tiap detik)
 useEffect(() => {
 fetchSessions();
 }, []);

 // Deteksi QR discan: polling status session tiap 2 detik saat QR modal aktif
 const startQrStatusPolling = useCallback((sessionId: string) => {
 if (pollingRef.current) clearInterval(pollingRef.current);
 pollingRef.current = setInterval(async () => {
 try {
 setQrChecking(true);
 const s: any = await apiGetSession(sessionId);
 const status = s?.status || s?.session?.status;
 if (status === 'connected') {
 stopPolling();
 setShowQRModal(false);
 setQrCodeUrl(null);
 setPairingSessionId(null);
 setQrChecking(false);
 showToast('WhatsApp berhasil ditautkan! Session login sukses terhubung.', 'success');
 await fetchSessions();
 }
 } catch {
 // Abaikan error sementara saat proses koneksi
 } finally {
 setQrChecking(false);
 }
 }, 1500);
 }, [stopPolling, showToast]);

 const handleStartPairing = async () => {
 setPairingLoading(true);
 setQrCodeUrl(null);
 setQrChecking(false);
 setQrCountdown(60);
 try {
 const res = await apiCreateSession(newSessionName, newSessionPhone, newSessionProfile);
 const sessionId = res?.sessionId;
 if (!sessionId) throw new Error('Session ID tidak ditemukan di respons');
 setPairingSessionId(sessionId);
 let qr = res?.qr;
 if (!qr) {
 // Polling QR jika belum ada
 for (let i = 0; i < 6; i++) {
 try {
 qr = await apiGetSessionQr(sessionId);
 if (qr) break;
 } catch {}
 await new Promise((r) => setTimeout(r, 600));
 }
 }
 if (!qr) throw new Error('QR tidak muncul dalam 5 detik. Silakan coba lagi.');
 setQrCodeUrl(qr);

 // Countdown 60 detik (QR expired dari WhatsApp)
 if (countdownRef.current) clearInterval(countdownRef.current);
 countdownRef.current = setInterval(() => {
 setQrCountdown((prev) => {
 if (prev <= 1) {
 stopPolling();
 setShowQRModal(false);
 setQrCodeUrl(null);
 setPairingSessionId(null);
 showToast('QR kedaluwarsa. Silakan generate ulang.', 'error');
 return 0;
 }
 return prev - 1;
 });
 }, 1000);

 startQrStatusPolling(sessionId);
 await fetchSessions();
 } catch (err: any) {
 showToast(`Gagal pairing: ${err.message}`, 'error');
 } finally {
 setPairingLoading(false);
 }
 };

 // Bersihkan polling saat modal ditutup / unmount
 useEffect(() => {
 return () => {
 stopPolling();
 };
 }, [stopPolling]);

 // Muat kesehatan sesi terpilih dari endpoint antiban yang sudah ada.
 // Field `health` ditambahkan ke response itu, jadi tidak perlu endpoint baru.
 // Gagal memuat bukan error fatal — panel akan menampilkan pesan "belum tersedia".
 useEffect(() => {
   if (!selectedSession?.id) {
     setSelectedHealth(null);
     return;
   }
   let cancelled = false;
   apiGetAntiBan(selectedSession.id)
     .then((res: any) => {
       if (!cancelled) setSelectedHealth(res?.health ?? null);
     })
     .catch(() => {
       if (!cancelled) setSelectedHealth(null);
     });
   return () => {
     cancelled = true;
   };
 }, [selectedSession?.id]);

 // ACTION: Putuskan untuk scan ulang (Logout credential lama + langsung buka modal QR baru)
 const handleDisconnectAndRescan = (session: Session) => {
 setConfirmModal({
 isOpen: true,
 title: 'Putuskan & Scan Ulang',
 message: `Sesi"${session.name}" akan diputus dan kredensial lama akan direset untuk membuat QR Code scan baru. Lanjutkan?`,
 confirmText: 'Ya, Putuskan & Scan',
 confirmVariant: 'warning',
 onConfirm: async () => {
 setConfirmModal((prev) => ({ ...prev, isOpen: false }));
 setActionLoadingId(session.id);
 try {
 // Buka modal QR
 setShowQRModal(true);
 setPairingSessionId(session.id);
 setNewSessionName(session.name);
 setNewSessionPhone(session.phone || '628');
 setPairingLoading(true);
 setQrCodeUrl(null);
 setQrChecking(false);
 setQrCountdown(60);

 const res = await apiRepairSession(session.id, session.name, session.phone);
 let qr = res?.qr;
 if (!qr) {
 for (let i = 0; i < 6; i++) {
 try {
 qr = await apiGetSessionQr(session.id);
 if (qr) break;
 } catch {}
 await new Promise((r) => setTimeout(r, 600));
 }
 }
 if (!qr) throw new Error('QR tidak berhasil dibuat. Coba beberapa saat lagi.');
 setQrCodeUrl(qr);

 if (countdownRef.current) clearInterval(countdownRef.current);
 countdownRef.current = setInterval(() => {
 setQrCountdown((prev) => {
 if (prev <= 1) {
 stopPolling();
 setShowQRModal(false);
 setQrCodeUrl(null);
 setPairingSessionId(null);
 showToast('QR kedaluwarsa. Silakan scan ulang.', 'error');
 return 0;
 }
 return prev - 1;
 });
 }, 1000);

 startQrStatusPolling(session.id);
 await fetchSessions();
 showToast('Sesi diputus. Silakan scan QR code WhatsApp yang baru.', 'info');
 } catch (err: any) {
 setShowQRModal(false);
 showToast(`Gagal menyiapkan scan ulang: ${err.message}`, 'error');
 } finally {
 setActionLoadingId(null);
 setPairingLoading(false);
 }
 },
 });
 };

 const handleReconnectSession = async (id: string) => {
 setReconnectingId(id);
 try {
 const res = await apiReconnectSession(id);
 await fetchSessions();
 const st = res?.session?.status || res?.status || 'connected';
 if (st === 'connected') {
 showToast('Socket WhatsApp sinkron & terhubung normal.', 'success');
 } else {
 showToast(`Status socket saat ini: ${st}`, 'info');
 }
 } catch (err: any) {
 showToast(`Gagal re-sync socket: ${err.message}`, 'error');
 } finally {
 setReconnectingId(null);
 }
 };

 const handleDeleteSession = (id: string, name: string) => {
 setConfirmModal({
 isOpen: true,
 title: 'Hapus Sesi Permanen',
 message: `PERINGATAN: Sesi"${name}" (${id}) akan dihapus secara permanen beserta data autentikasi WhatsApp. Tindakan ini tidak dapat dibatalkan.`,
 confirmText: 'Hapus Permanen',
 confirmVariant: 'danger',
 onConfirm: async () => {
 setConfirmModal((prev) => ({ ...prev, isOpen: false }));
 setActionLoadingId(id);
 try {
 await apiDeleteSession(id);
 if (selectedSession?.id === id) {
 setSelectedSession(null);
 }
 await fetchSessions();
 showToast('Sesi WhatsApp berhasil dihapus permanen.', 'success');
 } catch (err: any) {
 showToast(`Gagal menghapus sesi: ${err.message}`, 'error');
 } finally {
 setActionLoadingId(null);
 }
 },
 });
 };

 const handleCloseQRModal = () => {
 stopPolling();
 setShowQRModal(false);
 setQrCodeUrl(null);
 setPairingSessionId(null);
 fetchSessions();
 };

 const handleRename = async (id: string) => {
 if (!renameValue.trim()) {
 showToast('Nama session tidak boleh kosong', 'error');
 return;
 }
 setSavingRename(true);
 try {
 await apiRenameSession(id, renameValue.trim());
 setRenamingId(null);
 await fetchSessions();
 showToast('Nama session berhasil diperbarui.', 'success');
 } catch (err: any) {
 showToast(`Gagal ganti nama: ${err.message}`, 'error');
 } finally {
 setSavingRename(false);
 }
 };

 return (
 <div className="space-y-6 max-w-7xl mx-auto pb-12 relative">
 {/* Toast floating component */}
 <Toast
 toast={toast}
 onClose={() => setToast(null)}
 />

 {/* Header */}
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface border border-line p-6 rounded-md">
 <div>
 <h2 className="text-xl font-bold text-ink flex items-center gap-2">
 <Smartphone className="text-pine" /> WhatsApp Sessions Pool
 </h2>
 <p className="text-xs text-ink-muted mt-1">
 Kelola multi-nomor WhatsApp, rotasi sesi, dan pemantauan status koneksi Baileys realtime.
 </p>
 </div>
 <div className="flex items-center gap-2">
 <button
 onClick={() => fetchSessions(true)}
 disabled={refreshing || initialLoading}
 className="px-3 py-2 bg-surface-alt hover:bg-surface-alt text-ink text-xs font-semibold rounded-md transition flex items-center gap-1.5 disabled:opacity-50"
 title="Refresh data dari server"
 >
 <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
 <span>{refreshing ? 'Memuat...' : 'Refresh'}</span>
 </button>
 <button
 onClick={() => {
 setNewSessionName(`Nomor ${sessions.length + 1}`);
 setNewSessionPhone('628');
 setQrCodeUrl(null);
 setShowQRModal(true);
 }}
 className="px-4 py-2 bg-pine hover:bg-pine-soft text-surface text-xs font-semibold rounded-md transition flex items-center gap-1.5"
 >
 <Plus size={16} /> Buat Sesi Baru
 </button>
 </div>
 </div>

 {/* Sessions Cards Container with Skeleton Loading */}
 <div className="space-y-3">
 <div className="flex items-center justify-between text-xs font-semibold text-ink-muted px-1">
 <span>Daftar Sesi Aktif ({sessions.length})</span>
 {initialLoading && <span className="text-pine font-mono text-[11px] animate-pulse">Memuat data sesi...</span>}
 </div>

 {initialLoading ? (
 /* Skeleton loading state */
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {[1, 2, 3].map((i) => (
 <div key={i} className="bg-surface/60 border border-line/80 rounded-md p-5 space-y-4 animate-pulse">
 <div className="flex justify-between items-start">
 <div className="space-y-2">
 <div className="h-4 w-32 bg-surface-alt rounded-md"></div>
 <div className="h-3 w-24 bg-surface-alt/60 rounded-md"></div>
 </div>
 <div className="h-5 w-20 bg-surface-alt rounded-sm"></div>
 </div>
 <div className="space-y-2 pt-2 border-t border-line/50">
 <div className="h-3 w-full bg-surface-alt/50 rounded"></div>
 <div className="h-3 w-3/4 bg-surface-alt/40 rounded"></div>
 </div>
 <div className="pt-2 flex justify-between items-center">
 <div className="h-3 w-20 bg-surface-alt/60 rounded"></div>
 <div className="h-3 w-16 bg-surface-alt/60 rounded"></div>
 </div>
 </div>
 ))}
 </div>
 ) : sessions.length === 0 ? (
 <div className="bg-surface border border-line rounded-md p-12 text-center">
 <Smartphone className="mx-auto text-ink-faint mb-3" size={36} />
 <p className="text-sm font-semibold text-ink-soft">Belum ada sesi WhatsApp terdaftar</p>
 <p className="text-xs text-ink-faint mt-1">Klik"Buat Sesi Baru" untuk menautkan nomor pertama.</p>
 </div>
 ) : (
 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
 {sessions.map((s) => {
 const isSelected = selectedSession?.id === s.id;
 const isConnected = s.status === 'connected';
 const isConnecting = s.status === 'connecting';
 const isActionLoading = actionLoadingId === s.id;

 return (
 <div
 key={s.id}
 onClick={() => setSelectedSession(s)}
 className={`bg-surface border transition cursor-pointer rounded-md p-5 relative overflow-hidden flex flex-col justify-between ${
 isSelected ? 'border-pine ring-1 ring-pine/30' : 'border-line hover:border-line-strong'
 }`}
 >
 <div>
 <div className="flex justify-between items-start gap-2">
 <div className="flex-1 min-w-0">
 {renamingId === s.id ? (
 <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
 <input
 type="text"
 value={renameValue}
 onChange={(e) => setRenameValue(e.target.value)}
 className="bg-surface-sunken border border-pine rounded-lg px-2 py-0.5 text-xs text-ink focus:outline-none w-36"
 autoFocus
 />
 <button
 onClick={() => handleRename(s.id)}
 disabled={savingRename}
 className="p-1 text-pine hover:bg-surface-alt rounded"
 >
 <Check size={12} />
 </button>
 <button
 onClick={() => setRenamingId(null)}
 className="p-1 text-ink-muted hover:bg-surface-alt rounded"
 >
 <X size={12} />
 </button>
 </div>
 ) : (
 <div className="flex items-center gap-1.5 group">
 <span className="font-bold text-sm text-ink truncate">{s.name}</span>
 <button
 onClick={(e) => {
 e.stopPropagation();
 setRenamingId(s.id);
 setRenameValue(s.name);
 }}
 className="text-ink-faint hover:text-ink-soft opacity-0 group-hover:opacity-100 transition p-0.5"
 title="Ganti nama"
 >
 <Pencil size={11} />
 </button>
 </div>
 )}
 <p className="text-xs text-ink-muted font-mono mt-0.5">
 {s.phone ? `+${s.phone}` : 'Nomor belum tertaut'}
 </p>
 </div>

 {/* Badge status */}
 <span className={`px-2 py-0.5 rounded-sm text-[10px] font-semibold flex items-center gap-1 shrink-0 ${
 isConnected
 ? 'bg-pine-wash text-pine border border-pine-line/60'
 : isConnecting
 ? 'bg-honey-wash text-honey border border-honey-line/60'
 : 'bg-clay-wash text-clay border border-clay-line/60'
 }`}>
 <span className={`w-1.5 h-1.5 rounded-sm ${
 isConnected ? 'bg-pine-soft' : isConnecting ? 'bg-honey animate-ping' : 'bg-clay'
 }`} />
 {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
 </span>
 </div>

 <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] bg-surface-sunken/60 p-2.5 rounded-md border border-line/60">
 <div>
 <span className="text-ink-faint block text-[10px]">Pesan Hari Ini</span>
 <span className="font-mono font-bold text-ink">{s.messagesSentToday}</span>
 </div>
 <div>
 <span className="text-ink-faint block text-[10px]">Terkirim Sukses</span>
 <span className="font-mono font-bold text-pine">{s.deliveryRate}%</span>
 </div>
 </div>

 {/* Kesehatan sesi: skor risiko ban dari HealthMonitor backend.
     Dihitung dari disconnect, error 403, timelock 463, dan pesan gagal. */}
 <div className="mt-2">
 <div className="flex items-center justify-between gap-2 mb-1">
 <span className="text-ink-faint text-[10px]">Kesehatan Sesi</span>
 <RiskBadge risk={scoreToRisk(s.riskScore || 0)} score={s.riskScore || 0} compact showScore />
 </div>
 <RiskBar score={s.riskScore || 0} risk={scoreToRisk(s.riskScore || 0)} />
 </div>

 <div className="mt-2 flex items-center justify-between text-[10px]">
 <span className="text-ink-faint">Profil Nomor:</span>
 <button
   type="button"
   onClick={async (e) => {
     e.stopPropagation();
     const nextProf = s.numberProfile === 'fresh' ? 'mature' : 'fresh';
     // Optimistic UI update agar langsung terlihat berubah tanpa jeda
     setSessions((prev) =>
       prev.map((item) => (item.id === s.id ? { ...item, numberProfile: nextProf } : item))
     );
     try {
       await apiUpdateSessionProfile(s.id, nextProf);
       showToast(`Profil ${s.name} diubah ke ${nextProf === 'mature' ? 'Nomor Matang (Uncapped)' : 'Nomor Fresh'}`, 'success');
       fetchSessions(false);
     } catch (err: any) {
       showToast(`Gagal update profil: ${err.message}`, 'error');
       fetchSessions(false);
     }
   }}
   className={`px-2 py-0.5 rounded-full font-medium transition cursor-pointer hover:opacity-85 ${
     s.numberProfile === 'fresh'
       ? 'bg-honey-wash text-honey-deep border border-honey-line/60'
       : 'bg-pine-wash text-pine border border-pine-line/60'
   }`}
   title="Klik untuk switch profil (Fresh <-> Mature)"
 >
   {s.numberProfile === 'fresh' ? `🟡 Fresh (Warm-up H-${s.warmupDay || 1}) ⇄` : '🟢 Mature (Uncapped) ⇄'}
 </button>
 </div>
 </div>

 {/* Actions Bar Per Card */}
 <div className="mt-4 pt-3 border-t border-line/70 flex items-center justify-between gap-1.5">
 <span className="text-[10px] text-ink-faint font-mono truncate">{s.id}</span>
 <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
 <button
 onClick={() => handleDisconnectAndRescan(s)}
 disabled={isActionLoading}
 className="px-2 py-1 bg-honey-wash/50 hover:bg-honey-wash/60 text-honey-deep border border-honey-line/60 text-[10px] font-semibold rounded-lg transition flex items-center gap-1 disabled:opacity-50"
 title="Putuskan koneksi dan generate QR baru untuk scan ulang"
 >
 <QrCode size={11} /> Scan Ulang
 </button>
 <button
 onClick={() => handleDeleteSession(s.id, s.name)}
 disabled={isActionLoading}
 className="p-1 bg-clay-wash/40 hover:bg-clay-wash/50 text-clay border border-clay-line/50 rounded-lg transition disabled:opacity-50"
 title="Hapus sesi permanen"
 >
 <Trash2 size={11} />
 </button>
 </div>
 </div>
 </div>
 );
 })}
 </div>
 )}
 </div>

 {/* Selected Session Deep Report Section */}
 {selectedSession && (
 <div className="bg-surface border border-line rounded-md p-6 space-y-6">
 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-line pb-4">
 <div>
 <div className="text-xs text-pine font-mono font-semibold uppercase tracking-wider flex items-center gap-2">
 <span>Laporan Detail Session Terpilih</span>
 {selectedSession.metrics.uptimeHours > 0 && (
 <span className="text-ink-muted font-normal">
 • Uptime: {selectedSession.metrics.uptimeHours} jam
 </span>
 )}
 </div>
 <h3 className="text-lg font-bold text-ink flex items-center gap-2 mt-0.5">
 {selectedSession.name} {selectedSession.phone && `(+${selectedSession.phone})`}
 </h3>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <button
 onClick={() => handleReconnectSession(selectedSession.id)}
 disabled={reconnectingId === selectedSession.id}
 className="px-3 py-1.5 bg-surface-sunken hover:bg-surface-alt text-pine border border-pine-line/50 text-xs font-semibold rounded-md transition flex items-center gap-1.5 disabled:opacity-50"
 >
 <RefreshCw size={13} className={reconnectingId === selectedSession.id ? 'animate-spin' : ''} />
 {reconnectingId === selectedSession.id ? 'Re-syncing...' : 'Re-sync Socket'}
 </button>
 <button
 onClick={() => handleDisconnectAndRescan(selectedSession)}
 disabled={actionLoadingId === selectedSession.id}
 className="px-3 py-1.5 bg-honey-wash/40 hover:bg-honey-wash text-honey border border-honey-line/50 text-xs font-semibold rounded-md transition flex items-center gap-1.5 disabled:opacity-50"
 >
 <QrCode size={13} /> Putuskan & Scan Ulang
 </button>
 <button
 onClick={() => handleDeleteSession(selectedSession.id, selectedSession.name)}
 disabled={actionLoadingId === selectedSession.id}
 className="px-3 py-1.5 bg-clay-wash/40 hover:bg-clay-wash text-clay border border-clay-line/50 text-xs font-semibold rounded-md transition flex items-center gap-1.5 disabled:opacity-50"
 title="Hapus sesi secara permanen"
 >
 <Trash2 size={13} /> Hapus Sesi
 </button>
 </div>
 </div>

 {/* 4 Stat Metric Cards */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <div className="bg-surface-sunken border border-line rounded-md p-4 space-y-1">
 <div className="text-[11px] text-ink-muted uppercase font-semibold">Total Pesan Lifetime</div>
 <div className="text-xl font-bold font-mono text-ink">{selectedSession.metrics.totalSent.toLocaleString()}</div>
 <div className="text-[10px] text-pine">{selectedSession.metrics.totalDelivered.toLocaleString()} terkirim sukses</div>
 </div>

 <div className="bg-surface-sunken border border-line rounded-md p-4 space-y-1">
 <div className="text-[11px] text-ink-muted uppercase font-semibold">Rata-Rata Delay Pacing</div>
 <div className="text-xl font-bold font-mono text-sea">{selectedSession.metrics.avgPacingDelaySec}s</div>
 <div className="text-[10px] text-ink-faint">Anti-ban Adaptive Throttle</div>
 </div>

 <div className="bg-surface-sunken border border-line rounded-md p-4 space-y-1">
 <div className="text-[11px] text-ink-muted uppercase font-semibold">Disconnect Hari Ini</div>
 <div className={`text-xl font-bold font-mono ${selectedSession.metrics.disconnectCountToday > 0 ? 'text-honey' : 'text-pine'}`}>
 {selectedSession.metrics.disconnectCountToday} kali
 </div>
 <div className="text-[10px] text-ink-faint">Auto-recovery socket aktif</div>
 </div>

 <div className="bg-surface-sunken border border-line rounded-md p-4 space-y-1">
 <div className="text-[11px] text-ink-muted uppercase font-semibold">Delivery Success Rate</div>
 <div className="text-xl font-bold font-mono text-pine">{selectedSession.deliveryRate}%</div>
 <div className="text-[10px] text-ink-faint">Berdasarkan event ACK server</div>
 </div>
 </div>

 {/* Panel kesehatan sesi: alasan risiko + rekomendasi tindakan dari
     HealthMonitor backend. Dimuat dari endpoint antiban yang sudah ada. */}
 <div>
 <div className="text-[11px] text-ink-muted uppercase font-semibold mb-2">
 Kesehatan Sesi &amp; Risiko Ban
 </div>
 <RiskDetail health={selectedHealth} />
 </div>
 </div>
 )}

 {/* Modal Dialog Konfirmasi Custom (Pengganti confirm() konvensional) */}
 {confirmModal.isOpen && (
 <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
 <div className="bg-surface border border-line rounded-md max-w-md w-full p-6 space-y-4">
 <div className="flex items-center gap-3">
 <div className={`p-2.5 rounded-md ${
 confirmModal.confirmVariant === 'danger'
 ? 'bg-clay-wash/80 text-clay border border-clay-line/60'
 : 'bg-honey-wash/80 text-honey border border-honey-line/60'
 }`}>
 <AlertTriangle size={20} />
 </div>
 <h3 className="text-base font-bold text-ink">{confirmModal.title}</h3>
 </div>
 <p className="text-xs text-ink-soft leading-relaxed">{confirmModal.message}</p>
 <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-line">
 <button
 onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
 className="px-4 py-2 bg-surface-alt hover:bg-surface-alt text-ink-soft rounded-md text-xs font-semibold transition"
 >
 Batal
 </button>
 <button
 onClick={confirmModal.onConfirm}
 className={`px-4 py-2 text-surface rounded-md text-xs font-semibold transition ${
 confirmModal.confirmVariant === 'danger'
 ? 'bg-clay hover:bg-clay shadow-red-950'
 : 'bg-honey hover:bg-honey shadow-amber-950'
 }`}
 >
 {confirmModal.confirmText}
 </button>
 </div>
 </div>
 </div>
 )}

 {/* Modal QR Code Pairing */}
 {showQRModal && (
 <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
 <div className="bg-surface border border-line rounded-md max-w-sm w-full p-6 text-center space-y-4 relative">
 <button
 onClick={handleCloseQRModal}
 className="absolute top-4 right-4 text-ink-muted hover:text-ink transition p-1"
 >
 <X size={18} />
 </button>

 <div>
 <h3 className="text-base font-bold text-ink">
 {pairingSessionId ? `Scan QR WhatsApp (${pairingSessionId})` : 'Tautkan Sesi WhatsApp'}
 </h3>
 <p className="text-xs text-ink-muted mt-1">
 Buka WhatsApp &gt; Perangkat Tertaut &gt; Tautkan Perangkat
 </p>
 </div>

 {!qrCodeUrl ? (
 <div className="space-y-4 text-left py-2">
 <div>
 <label className="text-[11px] font-semibold text-ink-muted block mb-1">Nama Tampilan Sesi</label>
 <input
 type="text"
 value={newSessionName}
 onChange={(e) => setNewSessionName(e.target.value)}
 className="w-full bg-surface-sunken border border-line rounded-md px-3 py-2 text-xs text-ink focus:outline-none focus:border-pine"
 placeholder="Contoh: CS Marketing"
 />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-ink-muted block mb-1">Nomor WhatsApp (Opsional)</label>
 <input
 type="text"
 value={newSessionPhone}
 onChange={(e) => setNewSessionPhone(e.target.value)}
 className="w-full bg-surface-sunken border border-line rounded-md px-3 py-2 text-xs text-ink focus:outline-none focus:border-pine"
 placeholder="628xxxxxxxxxx"
 />
 </div>
 <div>
 <label className="text-[11px] font-semibold text-ink-muted block mb-1">Profil Nomor & Anti-Ban Warm-up</label>
 <div className="grid grid-cols-2 gap-2">
   <button
     type="button"
     onClick={() => setNewSessionProfile('mature')}
     className={`p-2.5 rounded-md border text-left transition flex flex-col justify-between ${
       newSessionProfile === 'mature'
         ? 'border-pine bg-pine-wash/40 text-pine-deep'
         : 'border-line bg-surface-sunken text-ink-muted hover:text-ink'
     }`}
   >
     <span className="text-xs font-bold flex items-center gap-1.5">
       🟢 Nomor Matang
     </span>
     <span className="text-[10px] text-ink-faint mt-1 leading-snug">
       Nomor lama / sering chat. Tanpa pembatasan warm-up harian.
     </span>
   </button>

   <button
     type="button"
     onClick={() => setNewSessionProfile('fresh')}
     className={`p-2.5 rounded-md border text-left transition flex flex-col justify-between ${
       newSessionProfile === 'fresh'
         ? 'border-honey bg-honey-wash/50 text-honey-deep'
         : 'border-line bg-surface-sunken text-ink-muted hover:text-ink'
     }`}
   >
     <span className="text-xs font-bold flex items-center gap-1.5">
       🟡 Nomor Fresh
     </span>
     <span className="text-[10px] text-ink-faint mt-1 leading-snug">
       Nomor baru beli / perdana. Eskalasi kuota bertahap 7 hari.
     </span>
   </button>
 </div>
 </div>
 <button
 onClick={handleStartPairing}
 disabled={pairingLoading}
 className="w-full py-2.5 bg-pine hover:bg-pine-soft disabled:bg-surface-alt text-surface rounded-md text-xs font-semibold transition flex items-center justify-center gap-2"
 >
 {pairingLoading ? (
 <>
 <Loader2 size={14} className="animate-spin" />
 Membuat Sesi Baileys...
 </>
 ) : (
 'Generate QR WhatsApp'
 )}
 </button>
 </div>
 ) : (
 <div className="space-y-3">
 <div className="bg-surface p-3 rounded-md inline-block mx-auto relative">
 <img src={qrCodeUrl} alt="WhatsApp QR Code" className="w-48 h-48 mx-auto" />
 {qrChecking && (
 <div className="absolute inset-0 bg-surface/70 rounded-md flex items-center justify-center">
 <Loader2 size={28} className="animate-spin text-pine" />
 </div>
 )}
 </div>

 {/* Countdown timer */}
 <div className="flex items-center justify-center gap-2 text-[11px] font-mono">
 <span className={`px-2 py-1 rounded-lg font-bold ${
 qrCountdown <= 10 ? 'bg-clay-wash text-clay border border-clay-line/60' : 'bg-surface-sunken text-ink-soft border border-line'
 }`}>
 ⏱ {qrCountdown}s
 </span>
 <span className="text-ink-muted">Menunggu scan HP...</span>
 </div>
 <p className="text-[11px] text-pine font-mono">Modal akan menutup otomatis begitu QR berhasil discan.</p>
 </div>
 )}

 <button 
 onClick={handleCloseQRModal}
 className="w-full py-2 bg-surface-alt hover:bg-surface-alt text-ink-soft rounded-md text-xs font-semibold transition"
 >
 Tutup
 </button>
 </div>
 </div>
 )}
 </div>
 );
};
