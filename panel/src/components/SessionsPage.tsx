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
  apiRepairSession
} from '../api';
import { Toast } from './Toast';

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
  const [pairingLoading, setPairingLoading] = useState(false);
  const [qrCountdown, setQrCountdown] = useState(60);
  const [qrChecking, setQrChecking] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [savingRename, setSavingRename] = useState(false);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

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
      const res = await apiCreateSession(newSessionName, newSessionPhone);
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

  // ACTION: Putuskan untuk scan ulang (Logout credential lama + langsung buka modal QR baru)
  const handleDisconnectAndRescan = (session: Session) => {
    setConfirmModal({
      isOpen: true,
      title: 'Putuskan & Scan Ulang',
      message: `Sesi "${session.name}" akan diputus dan kredensial lama akan direset untuk membuat QR Code scan baru. Lanjutkan?`,
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
      message: `PERINGATAN: Sesi "${name}" (${id}) akan dihapus secara permanen beserta data autentikasi WhatsApp. Tindakan ini tidak dapat dibatalkan.`,
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gray-900 border border-gray-800 p-6 rounded-2xl">
        <div>
          <h2 className="text-xl font-bold text-gray-100 flex items-center gap-2">
            <Smartphone className="text-emerald-500" /> WhatsApp Sessions Pool
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Kelola multi-nomor WhatsApp, rotasi sesi, dan pemantauan status koneksi Baileys realtime.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchSessions(true)}
            disabled={refreshing || initialLoading}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
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
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-lg shadow-emerald-950"
          >
            <Plus size={16} /> Buat Sesi Baru
          </button>
        </div>
      </div>

      {/* Sessions Cards Container with Skeleton Loading */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-400 px-1">
          <span>Daftar Sesi Aktif ({sessions.length})</span>
          {initialLoading && <span className="text-emerald-400 font-mono text-[11px] animate-pulse">Memuat data sesi...</span>}
        </div>

        {initialLoading ? (
          /* Skeleton loading state */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-900/60 border border-gray-800/80 rounded-2xl p-5 space-y-4 animate-pulse">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <div className="h-4 w-32 bg-gray-800 rounded-md"></div>
                    <div className="h-3 w-24 bg-gray-800/60 rounded-md"></div>
                  </div>
                  <div className="h-5 w-20 bg-gray-800 rounded-full"></div>
                </div>
                <div className="space-y-2 pt-2 border-t border-gray-800/50">
                  <div className="h-3 w-full bg-gray-800/50 rounded"></div>
                  <div className="h-3 w-3/4 bg-gray-800/40 rounded"></div>
                </div>
                <div className="pt-2 flex justify-between items-center">
                  <div className="h-3 w-20 bg-gray-800/60 rounded"></div>
                  <div className="h-3 w-16 bg-gray-800/60 rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
            <Smartphone className="mx-auto text-gray-600 mb-3" size={36} />
            <p className="text-sm font-semibold text-gray-300">Belum ada sesi WhatsApp terdaftar</p>
            <p className="text-xs text-gray-500 mt-1">Klik "Buat Sesi Baru" untuk menautkan nomor pertama.</p>
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
                  className={`bg-gray-900 border transition cursor-pointer rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between ${
                    isSelected ? 'border-emerald-500 ring-1 ring-emerald-500/30' : 'border-gray-800 hover:border-gray-700'
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
                              className="bg-gray-950 border border-emerald-500 rounded-lg px-2 py-0.5 text-xs text-gray-100 focus:outline-none w-36"
                              autoFocus
                            />
                            <button
                              onClick={() => handleRename(s.id)}
                              disabled={savingRename}
                              className="p-1 text-emerald-400 hover:bg-gray-800 rounded"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => setRenamingId(null)}
                              className="p-1 text-gray-400 hover:bg-gray-800 rounded"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            <span className="font-bold text-sm text-gray-100 truncate">{s.name}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenamingId(s.id);
                                setRenameValue(s.name);
                              }}
                              className="text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition p-0.5"
                              title="Ganti nama"
                            >
                              <Pencil size={11} />
                            </button>
                          </div>
                        )}
                        <p className="text-xs text-gray-400 font-mono mt-0.5">
                          {s.phone ? `+${s.phone}` : 'Nomor belum tertaut'}
                        </p>
                      </div>

                      {/* Badge status */}
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-1 shrink-0 ${
                        isConnected
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                          : isConnecting
                          ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                          : 'bg-red-950 text-red-400 border border-red-800/60'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          isConnected ? 'bg-emerald-400' : isConnecting ? 'bg-amber-400 animate-ping' : 'bg-red-400'
                        }`} />
                        {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] bg-gray-950/60 p-2.5 rounded-xl border border-gray-800/60">
                      <div>
                        <span className="text-gray-500 block text-[10px]">Pesan Hari Ini</span>
                        <span className="font-mono font-bold text-gray-200">{s.messagesSentToday}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block text-[10px]">Terkirim Sukses</span>
                        <span className="font-mono font-bold text-emerald-400">{s.deliveryRate}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar Per Card */}
                  <div className="mt-4 pt-3 border-t border-gray-800/70 flex items-center justify-between gap-1.5">
                    <span className="text-[10px] text-gray-500 font-mono truncate">{s.id}</span>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleDisconnectAndRescan(s)}
                        disabled={isActionLoading}
                        className="px-2 py-1 bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 border border-amber-800/60 text-[10px] font-semibold rounded-lg transition flex items-center gap-1 disabled:opacity-50"
                        title="Putuskan koneksi dan generate QR baru untuk scan ulang"
                      >
                        <QrCode size={11} /> Scan Ulang
                      </button>
                      <button
                        onClick={() => handleDeleteSession(s.id, s.name)}
                        disabled={isActionLoading}
                        className="p-1 bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-800/50 rounded-lg transition disabled:opacity-50"
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
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-800 pb-4">
            <div>
              <div className="text-xs text-emerald-400 font-mono font-semibold uppercase tracking-wider flex items-center gap-2">
                <span>Laporan Detail Session Terpilih</span>
                {selectedSession.metrics.uptimeHours > 0 && (
                  <span className="text-gray-400 font-normal">
                    • Uptime: {selectedSession.metrics.uptimeHours} jam
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-gray-100 flex items-center gap-2 mt-0.5">
                {selectedSession.name} {selectedSession.phone && `(+${selectedSession.phone})`}
              </h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleReconnectSession(selectedSession.id)}
                disabled={reconnectingId === selectedSession.id}
                className="px-3 py-1.5 bg-gray-950 hover:bg-gray-800 text-emerald-400 border border-emerald-900/50 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw size={13} className={reconnectingId === selectedSession.id ? 'animate-spin' : ''} />
                {reconnectingId === selectedSession.id ? 'Re-syncing...' : 'Re-sync Socket'}
              </button>
              <button
                onClick={() => handleDisconnectAndRescan(selectedSession)}
                disabled={actionLoadingId === selectedSession.id}
                className="px-3 py-1.5 bg-amber-950/40 hover:bg-amber-950 text-amber-400 border border-amber-800/50 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <QrCode size={13} /> Putuskan & Scan Ulang
              </button>
              <button
                onClick={() => handleDeleteSession(selectedSession.id, selectedSession.name)}
                disabled={actionLoadingId === selectedSession.id}
                className="px-3 py-1.5 bg-red-950/40 hover:bg-red-950 text-red-400 border border-red-800/50 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 disabled:opacity-50"
                title="Hapus sesi secara permanen"
              >
                <Trash2 size={13} /> Hapus Sesi
              </button>
            </div>
          </div>

          {/* 4 Stat Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-1">
              <div className="text-[11px] text-gray-400 uppercase font-semibold">Total Pesan Lifetime</div>
              <div className="text-xl font-bold font-mono text-gray-100">{selectedSession.metrics.totalSent.toLocaleString()}</div>
              <div className="text-[10px] text-emerald-400">{selectedSession.metrics.totalDelivered.toLocaleString()} terkirim sukses</div>
            </div>

            <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-1">
              <div className="text-[11px] text-gray-400 uppercase font-semibold">Rata-Rata Delay Pacing</div>
              <div className="text-xl font-bold font-mono text-blue-400">{selectedSession.metrics.avgPacingDelaySec}s</div>
              <div className="text-[10px] text-gray-500">Anti-ban Adaptive Throttle</div>
            </div>

            <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-1">
              <div className="text-[11px] text-gray-400 uppercase font-semibold">Disconnect Hari Ini</div>
              <div className={`text-xl font-bold font-mono ${selectedSession.metrics.disconnectCountToday > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {selectedSession.metrics.disconnectCountToday} kali
              </div>
              <div className="text-[10px] text-gray-500">Auto-recovery socket aktif</div>
            </div>

            <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-1">
              <div className="text-[11px] text-gray-400 uppercase font-semibold">Delivery Success Rate</div>
              <div className="text-xl font-bold font-mono text-emerald-400">{selectedSession.deliveryRate}%</div>
              <div className="text-[10px] text-gray-500">Berdasarkan event ACK server</div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dialog Konfirmasi Custom (Pengganti confirm() konvensional) */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${
                confirmModal.confirmVariant === 'danger'
                  ? 'bg-red-950/80 text-red-400 border border-red-800/60'
                  : 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
              }`}>
                <AlertTriangle size={20} />
              </div>
              <h3 className="text-base font-bold text-gray-100">{confirmModal.title}</h3>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">{confirmModal.message}</p>
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-800">
              <button
                onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold transition"
              >
                Batal
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className={`px-4 py-2 text-white rounded-xl text-xs font-semibold transition ${
                  confirmModal.confirmVariant === 'danger'
                    ? 'bg-red-600 hover:bg-red-500 shadow-lg shadow-red-950'
                    : 'bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-950'
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-3xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl relative">
            <button
              onClick={handleCloseQRModal}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-100 transition p-1"
            >
              <X size={18} />
            </button>

            <div>
              <h3 className="text-base font-bold text-gray-100">
                {pairingSessionId ? `Scan QR WhatsApp (${pairingSessionId})` : 'Tautkan Sesi WhatsApp'}
              </h3>
              <p className="text-xs text-gray-400 mt-1">
                Buka WhatsApp &gt; Perangkat Tertaut &gt; Tautkan Perangkat
              </p>
            </div>

            {!qrCodeUrl ? (
              <div className="space-y-4 text-left py-2">
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 block mb-1">Nama Tampilan Sesi</label>
                  <input
                    type="text"
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500"
                    placeholder="Contoh: CS Marketing"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-400 block mb-1">Nomor WhatsApp (Opsional)</label>
                  <input
                    type="text"
                    value={newSessionPhone}
                    onChange={(e) => setNewSessionPhone(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-500"
                    placeholder="628xxxxxxxxxx"
                  />
                </div>
                <button
                  onClick={handleStartPairing}
                  disabled={pairingLoading}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-800 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950"
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
                <div className="bg-white p-3 rounded-2xl inline-block mx-auto shadow-inner relative">
                  <img src={qrCodeUrl} alt="WhatsApp QR Code" className="w-48 h-48 mx-auto" />
                  {qrChecking && (
                    <div className="absolute inset-0 bg-white/70 rounded-2xl flex items-center justify-center">
                      <Loader2 size={28} className="animate-spin text-emerald-600" />
                    </div>
                  )}
                </div>

                {/* Countdown timer */}
                <div className="flex items-center justify-center gap-2 text-[11px] font-mono">
                  <span className={`px-2 py-1 rounded-lg font-bold ${
                    qrCountdown <= 10 ? 'bg-red-950 text-red-400 border border-red-800/60' : 'bg-gray-950 text-gray-300 border border-gray-800'
                  }`}>
                    ⏱ {qrCountdown}s
                  </span>
                  <span className="text-gray-400">Menunggu scan HP...</span>
                </div>
                <p className="text-[11px] text-emerald-400 font-mono">Modal akan menutup otomatis begitu QR berhasil discan.</p>
              </div>
            )}

            <button 
              onClick={handleCloseQRModal}
              className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-xs font-semibold transition"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
