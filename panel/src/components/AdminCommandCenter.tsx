import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ShieldAlert, Zap, Pause, Play, RefreshCw, CheckCircle2, Clock,
  XCircle, Search, Filter, ChevronLeft, ChevronRight, Loader2,
  Users, Smartphone, Layers, AlertCircle, Trash2, CheckCheck
} from 'lucide-react';
import { type Session, type QueueItem } from '../dummyData';
import {
  apiGetSessionMessages,
  apiPauseBatch,
  apiResumeBatch,
  apiClearBatch,
  apiGetBatchStatus
} from '../api';

interface AdminCommandCenterProps {
  sessions: Session[];
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

interface BatchActionState {
  batchId: string;
  action: 'pause' | 'resume' | 'clear';
}

export const AdminCommandCenter: React.FC<AdminCommandCenterProps> = ({ sessions, showToast }) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Filter states
  const [selectedSessionId, setSelectedSessionId] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [batchFilter, setBatchFilter] = useState<string>('');
  const [phoneSearch, setPhoneSearch] = useState<string>('');

  // Pagination states
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState<BatchActionState | null>(null);

  // Fetch global messages
  const fetchGlobalQueue = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const statusParam = selectedStatus === 'all'
        ? undefined
        : selectedStatus === 'active'
        ? 'pending,pacing,sending'
        : selectedStatus;

      const res = await apiGetSessionMessages(selectedSessionId || 'all', {
        limit,
        offset,
        status: statusParam,
        batchId: batchFilter.trim() || undefined,
      });

      if (res) {
        if (typeof res.total === 'number') {
          setTotalCount(res.total);
        }
        if (Array.isArray(res.messages)) {
          let list = res.messages;
          if (phoneSearch.trim()) {
            const q = phoneSearch.trim().toLowerCase();
            list = list.filter((m: any) =>
              (m.to && m.to.includes(q)) ||
              (m.text && m.text.toLowerCase().includes(q)) ||
              (m.batchId && m.batchId.toLowerCase().includes(q))
            );
          }
          setMessages(list);
        }
      }
    } catch (err: any) {
      console.error('Command center fetch error:', err);
      showToast('Gagal memuat antrean global', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedSessionId, selectedStatus, batchFilter, phoneSearch, page, limit, showToast]);

  useEffect(() => {
    fetchGlobalQueue();
  }, [fetchGlobalQueue]);

  // Auto-refresh interval 5s
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      fetchGlobalQueue();
    }, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchGlobalQueue]);

  // Handler Kontrol Batch
  const handleExecuteBatchAction = async () => {
    if (!confirmModal) return;
    const { batchId, action } = confirmModal;
    setActionLoading(true);
    try {
      if (action === 'pause') {
        await apiPauseBatch(batchId, 'Dijeda dari Admin Command Center');
        showToast(`Batch ${batchId} berhasil dijeda`, 'success');
      } else if (action === 'resume') {
        await apiResumeBatch(batchId);
        showToast(`Batch ${batchId} dilanjutkan`, 'success');
      } else if (action === 'clear') {
        await apiClearBatch(batchId, 'Dibatalkan oleh Administrator');
        showToast(`Sisa antrean batch ${batchId} dibatalkan`, 'success');
      }
      setConfirmModal(null);
      await fetchGlobalQueue();
    } catch (err: any) {
      showToast(err?.message || `Gagal mengeksekusi aksi ${action} pada batch`, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Metrik Turunan dari Data
  const pendingCount = messages.filter((m) => m.status === 'pending' || m.status === 'pacing' || m.status === 'sending').length;
  const deliveredCount = messages.filter((m) => m.status === 'delivered' || m.status === 'read' || m.status === 'sent').length;
  const failedCount = messages.filter((m) => m.status === 'failed' || m.status === 'cancelled').length;

  const totalPages = Math.ceil(totalCount / limit) || 1;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
            <CheckCircle2 size={11} /> Sent
          </span>
        );
      case 'delivered':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <CheckCheck size={11} /> Delivered
          </span>
        );
      case 'read':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
            <CheckCheck size={11} /> Read
          </span>
        );
      case 'pacing':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            <Clock size={11} className="animate-spin" /> Pacing
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-surface-alt text-ink-muted border border-line">
            <Clock size={11} /> Antrean
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20">
            <XCircle size={11} /> Dibatalkan
          </span>
        );
      case 'failed':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
            <AlertCircle size={11} /> Gagal
          </span>
        );
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Status Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <Layers className="text-pine" size={18} />
            Admin Command Center: Global Queue & Batch Control
          </h2>
          <p className="text-xs text-ink-muted mt-0.5">
            Pengawasan terpusat antrean pesan dari semua sesi, user, dan batch pengiriman blast secara realtime.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
              autoRefresh
                ? 'bg-pine-wash text-pine border-pine-line/60'
                : 'bg-surface border-line text-ink-muted hover:text-ink'
            }`}
          >
            <RefreshCw size={12} className={autoRefresh && loading ? 'animate-spin' : ''} />
            <span>{autoRefresh ? 'Live Sync (5s)' : 'Sinkron Jeda'}</span>
          </button>

          <button
            type="button"
            onClick={() => fetchGlobalQueue()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface border border-line text-ink hover:border-line-strong transition disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Global Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-surface border border-line rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-ink-muted">Total Pesan Terdaftar</span>
            <Layers size={14} className="text-pine" />
          </div>
          <div className="text-2xl font-bold font-mono text-ink">{totalCount.toLocaleString('id-ID')}</div>
          <div className="text-[10px] text-ink-faint">Seluruh sesi dalam database</div>
        </div>

        <div className="bg-surface border border-amber-500/20 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">Aktif di Antrean</span>
            <Clock size={14} className="text-amber-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-ink">{pendingCount}</div>
          <div className="text-[10px] text-ink-faint">Halaman ini (pending & pacing)</div>
        </div>

        <div className="bg-surface border border-emerald-500/20 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Terkirim / Sampai</span>
            <CheckCircle2 size={14} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-ink">{deliveredCount}</div>
          <div className="text-[10px] text-ink-faint">Halaman ini (sent / delivered / read)</div>
        </div>

        <div className="bg-surface border border-rose-500/20 rounded-xl p-3.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">Gagal / Dibatalkan</span>
            <AlertCircle size={14} className="text-rose-500" />
          </div>
          <div className="text-2xl font-bold font-mono text-ink">{failedCount}</div>
          <div className="text-[10px] text-ink-faint">Halaman ini (failed / cancelled)</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-surface border border-line rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-ink border-b border-line pb-2.5">
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-pine" />
            <span>Filter & Pencarian Antrean Global</span>
          </div>
          {(selectedSessionId !== 'all' || selectedStatus !== 'all' || batchFilter || phoneSearch) && (
            <button
              type="button"
              onClick={() => {
                setSelectedSessionId('all');
                setSelectedStatus('all');
                setBatchFilter('');
                setPhoneSearch('');
                setPage(1);
              }}
              className="text-[11px] text-pine hover:underline font-medium"
            >
              Reset Semua Filter
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div>
            <label className="block text-[10px] font-semibold text-ink-muted uppercase mb-1">
              Sesi WhatsApp
            </label>
            <select
              value={selectedSessionId}
              onChange={(e) => {
                setSelectedSessionId(e.target.value);
                setPage(1);
              }}
              className="w-full h-8 px-2 text-xs rounded-lg bg-surface-alt border border-line text-ink focus:outline-none focus:border-pine cursor-pointer"
            >
              <option value="all">Semua Sesi Pengirim ({sessions.length})</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (+{s.phone}) - {s.status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-ink-muted uppercase mb-1">
              Status Pengiriman
            </label>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setPage(1);
              }}
              className="w-full h-8 px-2 text-xs rounded-lg bg-surface-alt border border-line text-ink focus:outline-none focus:border-pine cursor-pointer"
            >
              <option value="all">Semua Status</option>
              <option value="active">Antrean Aktif (Pending, Pacing, Sending)</option>
              <option value="pacing">Sedang Jeda Pacing</option>
              <option value="sent">Terkirim (Sent)</option>
              <option value="delivered">Diterima (Delivered)</option>
              <option value="read">Dibaca (Read)</option>
              <option value="cancelled">Dibatalkan (Cancelled)</option>
              <option value="failed">Gagal (Failed)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-ink-muted uppercase mb-1">
              Batch ID Blast
            </label>
            <input
              type="text"
              placeholder="Ketik batch ID (cmp_xxx)..."
              value={batchFilter}
              onChange={(e) => {
                setBatchFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-8 px-2.5 text-xs rounded-lg bg-surface-alt border border-line text-ink focus:outline-none focus:border-pine"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-ink-muted uppercase mb-1">
              Cari Nomor / Teks
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Nomor penerima atau kata..."
                value={phoneSearch}
                onChange={(e) => {
                  setPhoneSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full h-8 pl-7 pr-2.5 text-xs rounded-lg bg-surface-alt border border-line text-ink focus:outline-none focus:border-pine"
              />
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            </div>
          </div>
        </div>
      </div>

      {/* Global Queue Table */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-xs">
        <div className="p-3.5 border-b border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-ink uppercase tracking-wider">
              Daftar Antrean Pesan Gateway
            </h3>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-alt border border-line text-ink-muted">
              {totalCount.toLocaleString('id-ID')} total pesan
            </span>
          </div>

          {/* Page Size Selector */}
          <div className="flex items-center gap-2 text-xs text-ink-muted self-end sm:self-auto">
            <span>Tampilkan:</span>
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="h-7 px-2 text-xs rounded-md bg-surface-alt border border-line text-ink font-medium focus:outline-none focus:border-pine cursor-pointer"
            >
              <option value={10}>10 baris</option>
              <option value={25}>25 baris</option>
              <option value={50}>50 baris</option>
              <option value={100}>100 baris</option>
            </select>
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="p-12 text-center text-xs text-ink-faint space-y-1">
            <Layers size={24} className="mx-auto text-ink-faint/50 mb-2" />
            <p className="font-semibold text-ink">Tidak ada pesan yang sesuai filter</p>
            <p className="text-[11px]">Coba sesuaikan filter status, sesi, atau kata pencarian di atas.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[800px]">
              <thead className="bg-surface-sunken text-ink-muted uppercase tracking-wider text-[10px] font-semibold border-b border-line">
                <tr>
                  <th className="px-3.5 py-2.5">Waktu</th>
                  <th className="px-3.5 py-2.5">Sesi Pengirim</th>
                  <th className="px-3.5 py-2.5">Penerima</th>
                  <th className="px-3.5 py-2.5">Batch Blast</th>
                  <th className="px-3.5 py-2.5">Pesan</th>
                  <th className="px-3.5 py-2.5">Delay Pacing</th>
                  <th className="px-3.5 py-2.5">Status</th>
                  <th className="px-3.5 py-2.5 text-right">Kontrol Batch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {messages.map((m) => {
                  const hasBatch = Boolean(m.batchId);
                  const sessObj = sessions.find((s) => s.id === m.sessionId);
                  const timeStr = m.timestamp
                    ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    : '-';

                  return (
                    <tr key={m.id || `${m.to}_${m.timestamp}`} className="hover:bg-surface-alt/40 transition-colors">
                      <td className="px-3.5 py-2.5 text-ink-muted font-mono text-[11px] whitespace-nowrap">
                        {timeStr}
                      </td>
                      <td className="px-3.5 py-2.5">
                        <div className="font-semibold text-ink text-[11px]">
                          {sessObj?.name || m.sessionId || 'Auto-Pool'}
                        </div>
                        <div className="text-[10px] text-ink-faint font-mono">
                          {sessObj?.phone ? `+${sessObj.phone}` : m.sessionId}
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-ink whitespace-nowrap">
                        +{m.to}
                      </td>
                      <td className="px-3.5 py-2.5">
                        {hasBatch ? (
                          <button
                            type="button"
                            onClick={() => {
                              setBatchFilter(m.batchId);
                              setPage(1);
                            }}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-alt border border-line text-[10px] font-mono text-pine hover:border-pine cursor-pointer transition"
                            title="Filter hanya batch ini"
                          >
                            <Users size={10} />
                            <span className="truncate max-w-[110px]">{m.batchId}</span>
                          </button>
                        ) : (
                          <span className="text-[10px] text-ink-faint font-mono">-</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-ink-muted max-w-[200px] truncate text-[11px]">
                        {m.text || m.caption || m.name || '-'}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[11px] text-ink-faint whitespace-nowrap">
                        {m.jitterDelayMs ? `${(m.jitterDelayMs / 1000).toFixed(1)}s` : '-'}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        {getStatusBadge(m.status)}
                      </td>
                      <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                        {hasBatch ? (
                          <div className="inline-flex items-center gap-1 justify-end">
                            <button
                              type="button"
                              onClick={() => setConfirmModal({ batchId: m.batchId, action: 'pause' })}
                              className="p-1 rounded text-ink-muted hover:text-amber-600 hover:bg-amber-500/10 transition"
                              title={`Jeda antrean batch ${m.batchId}`}
                            >
                              <Pause size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmModal({ batchId: m.batchId, action: 'resume' })}
                              className="p-1 rounded text-ink-muted hover:text-emerald-600 hover:bg-emerald-500/10 transition"
                              title={`Lanjutkan antrean batch ${m.batchId}`}
                            >
                              <Play size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmModal({ batchId: m.batchId, action: 'clear' })}
                              className="p-1 rounded text-ink-muted hover:text-rose-600 hover:bg-rose-500/10 transition"
                              title={`Batalkan sisa antrean batch ${m.batchId}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
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
        <div className="p-3 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3 text-xs bg-surface-sunken/40">
          <div className="text-ink-muted text-[11px]">
            Menampilkan{' '}
            <strong className="text-ink font-mono">
              {totalCount === 0 ? 0 : (page - 1) * limit + 1}
            </strong>{' '}
            -{' '}
            <strong className="text-ink font-mono">
              {Math.min(page * limit, totalCount)}
            </strong>{' '}
            dari <strong className="text-ink font-mono">{totalCount.toLocaleString('id-ID')}</strong> pesan
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface border border-line text-ink-muted hover:text-ink disabled:opacity-40 disabled:pointer-events-none transition text-xs font-medium cursor-pointer"
            >
              <ChevronLeft size={13} />
              <span>Sebelumnya</span>
            </button>

            <span className="px-2.5 py-1 text-xs font-mono font-semibold text-ink">
              {page} / {totalPages}
            </span>

            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface border border-line text-ink-muted hover:text-ink disabled:opacity-40 disabled:pointer-events-none transition text-xs font-medium cursor-pointer"
            >
              <span>Selanjutnya</span>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Modal Konfirmasi Tindakan Batch */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface border border-line rounded-xl p-5 w-full max-w-sm space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg shrink-0 ${
                confirmModal.action === 'clear'
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                  : confirmModal.action === 'pause'
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }`}>
                {confirmModal.action === 'clear' ? <Trash2 size={18} /> : confirmModal.action === 'pause' ? <Pause size={18} /> : <Play size={18} />}
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-ink">
                  {confirmModal.action === 'clear'
                    ? 'Batalkan Sisa Batch?'
                    : confirmModal.action === 'pause'
                    ? 'Jeda Pengiriman Batch?'
                    : 'Lanjutkan Pengiriman Batch?'}
                </h4>
                <p className="text-xs text-ink-muted leading-relaxed">
                  {confirmModal.action === 'clear'
                    ? `Sisa antrean pesan untuk batch "${confirmModal.batchId}" akan langsung dihentikan dan ditandai cancelled.`
                    : confirmModal.action === 'pause'
                    ? `Antrean pengiriman untuk batch "${confirmModal.batchId}" akan ditangguhkan sementara waktu.`
                    : `Antrean pengiriman untuk batch "${confirmModal.batchId}" akan dilanjutkan kembali.`}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                disabled={actionLoading}
                onClick={() => setConfirmModal(null)}
                className="px-3 py-1.5 rounded-lg border border-line text-xs font-medium text-ink-muted hover:text-ink transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={actionLoading}
                onClick={handleExecuteBatchAction}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition flex items-center gap-1.5 cursor-pointer ${
                  confirmModal.action === 'clear'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : confirmModal.action === 'pause'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {actionLoading && <Loader2 size={12} className="animate-spin" />}
                <span>
                  {confirmModal.action === 'clear'
                    ? 'Ya, Batalkan Batch'
                    : confirmModal.action === 'pause'
                    ? 'Ya, Jeda Batch'
                    : 'Ya, Lanjutkan'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
