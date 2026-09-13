import React, { useState, useEffect, useCallback } from 'react';
import {
 Activity, RefreshCw, Trash2, CheckSquare, Square,
 Filter, AlertCircle, AlertTriangle, CheckCircle2, Clock, Globe, ShieldAlert,
 ChevronLeft, ChevronRight, Loader2, ArrowUpDown
} from 'lucide-react';
import { apiGetApiLogs, apiDeleteApiLogs, apiClearApiLogs } from '../api';

interface ApiLogItem {
 id: string;
 userId: string;
 userName?: string;
 userEmail?: string;
 method: string;
 endpoint: string;
 statusCode: number;
 ip: string;
 durationMs: number;
 errorMessage?: string | null;
 createdAt: string;
}

interface ApiLogsPageProps {
 isAdmin: boolean;
 showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const ApiLogsPage: React.FC<ApiLogsPageProps> = ({ isAdmin, showToast }) => {
 const [logs, setLogs] = useState<ApiLogItem[]>([]);
 const [loading, setLoading] = useState(false);
 const [deleting, setDeleting] = useState(false);
 const [page, setPage] = useState(1);
 const [limit, setLimit] = useState(25);
 const [total, setTotal] = useState(0);
 const [totalPages, setTotalPages] = useState(1);
 const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
 const [selectedIds, setSelectedIds] = useState<string[]>([]);
 const [showClearModal, setShowClearModal] = useState(false);
 const [confirmModal, setConfirmModal] = useState<{
 isOpen: boolean;
 title: string;
 message: string;
 confirmText: string;
 confirmVariant: 'danger' | 'warning';
 onConfirm: () => void;
 }>({
 isOpen: false,
 title: '',
 message: '',
 confirmText: 'Konfirmasi',
 confirmVariant: 'danger',
 onConfirm: () => {},
 });

 const fetchLogs = useCallback(async () => {
 setLoading(true);
 try {
 const res = await apiGetApiLogs({ page, limit, status: statusFilter });
 if (res) {
 setLogs(res.logs || []);
 setTotal(res.total || 0);
 setTotalPages(res.totalPages || 1);
 setSelectedIds([]); // reset seleksi saat halaman berganti
 }
 } catch (err: any) {
 showToast(err?.message || 'Gagal memuat log API', 'error');
 } finally {
 setLoading(false);
 }
 }, [page, limit, statusFilter, showToast]);

 useEffect(() => {
 fetchLogs();
 }, [fetchLogs]);

 const handleSelectAll = () => {
 if (selectedIds.length === logs.length) {
 setSelectedIds([]);
 } else {
 setSelectedIds(logs.map((l) => l.id));
 }
 };

 const handleToggleRow = (id: string) => {
 setSelectedIds((prev) =>
 prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
 );
 };

 const handleDeleteSelected = () => {
 if (selectedIds.length === 0) return;
 setConfirmModal({
 isOpen: true,
 title: `Hapus ${selectedIds.length} Log Terpilih`,
 message: `Riwayat ${selectedIds.length} entri log API terpilih akan dihapus permanen dari database. Tindakan ini tidak dapat dibatalkan.`,
 confirmText: 'Ya, Hapus Log',
 confirmVariant: 'danger',
 onConfirm: async () => {
 setConfirmModal((prev) => ({ ...prev, isOpen: false }));
 setDeleting(true);
 try {
 const res = await apiDeleteApiLogs(selectedIds);
 showToast(res.message || `${selectedIds.length} log berhasil dihapus`, 'success');
 fetchLogs();
 } catch (err: any) {
 showToast(err?.message || 'Gagal menghapus log terpilih', 'error');
 } finally {
 setDeleting(false);
 }
 },
 });
 };

 const handleDeleteSingle = async (id: string) => {
 setDeleting(true);
 try {
 await apiDeleteApiLogs([id]);
 showToast('1 log berhasil dihapus', 'success');
 fetchLogs();
 } catch (err: any) {
 showToast(err?.message || 'Gagal menghapus log', 'error');
 } finally {
 setDeleting(false);
 }
 };

 const handleClearAll = async (olderThanDays?: number) => {
 setDeleting(true);
 setShowClearModal(false);
 try {
 const res = await apiClearApiLogs(olderThanDays, isAdmin);
 showToast(res.message || 'Pembersihan log berhasil', 'success');
 setPage(1);
 fetchLogs();
 } catch (err: any) {
 showToast(err?.message || 'Gagal membersihkan log', 'error');
 } finally {
 setDeleting(false);
 }
 };

 const formatWib = (dateStr: string) => {
 if (!dateStr) return '-';
 try {
 const d = new Date(dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`);
 return d.toLocaleString('id-ID', {
 timeZone: 'Asia/Jakarta',
 day: '2-digit',
 month: 'short',
 year: 'numeric',
 hour: '2-digit',
 minute: '2-digit',
 second: '2-digit',
 }) + ' WIB';
 } catch {
 return dateStr;
 }
 };

 const getMethodBadge = (m: string) => {
 switch (m.toUpperCase()) {
 case 'POST':
 return <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-sea/10 text-sea border border-sea-line/20">POST</span>;
 case 'PATCH':
 return <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-sea/10 text-sea border border-sea-line/20">PATCH</span>;
 case 'DELETE':
 return <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-clay/10 text-clay border border-clay-line/20">DELETE</span>;
 case 'GET':
 return <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-pine-soft/10 text-pine border border-pine/20">GET</span>;
 default:
 return <span className="px-2 py-0.5 text-[11px] font-bold rounded-md bg-surface-alt/10 text-ink-muted border border-line/20">{m}</span>;
 }
 };

 const getStatusBadge = (code: number) => {
 if (code >= 200 && code < 300) {
 return (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-md bg-pine-soft/10 text-pine border border-pine/20">
 <CheckCircle2 className="w-3 h-3" /> {code} OK
 </span>
 );
 }
 if (code === 401 || code === 403) {
 return (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-md bg-honey/10 text-honey border border-honey-line/20">
 <ShieldAlert className="w-3 h-3" /> {code} Denied
 </span>
 );
 }
 if (code === 429) {
 return (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-md bg-sea/10 text-sea border border-sea-line/20">
 <Clock className="w-3 h-3" /> 429 Rate Limit
 </span>
 );
 }
 return (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold rounded-md bg-clay/10 text-clay border border-clay-line/20">
 <AlertCircle className="w-3 h-3" /> {code} Error
 </span>
 );
 };

 const isAllSelected = logs.length > 0 && selectedIds.length === logs.length;

 return (
 <div className="space-y-6">
 {/* Top Header */}
 <div className="bg-surface border border-line rounded-md p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-md bg-sea-wash text-sea border border-sea-line/60 flex items-center justify-center shrink-0">
 <Activity className="w-5 h-5" />
 </div>
 <div>
 <h2 className="text-base font-bold text-ink">Riwayat & Log Request API</h2>
 <p className="text-xs text-ink-muted">Audit mutasi API, pantau waktu respon, status error & keamanan token</p>
 </div>
 </div>

 <div className="flex items-center gap-2">
 <button
 onClick={() => fetchLogs()}
 disabled={loading}
 className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-ink-soft hover:text-surface bg-surface-sunken hover:bg-surface-alt rounded-md border border-line transition shrink-0 cursor-pointer disabled:opacity-50"
 title="Refresh log"
 >
 <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sea' : ''}`} />
 <span>Refresh</span>
 </button>

 <button
 onClick={() => setShowClearModal(true)}
 disabled={loading || total === 0}
 className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-clay hover:text-clay-deep bg-clay-wash/30 hover:bg-clay-wash/60 rounded-md border border-clay-line/50 transition shrink-0 cursor-pointer disabled:opacity-50"
 title="Bersihkan log"
 >
 <Trash2 className="w-3.5 h-3.5" />
 <span>Pembersihan Log</span>
 </button>
 </div>
 </div>

 {/* Filter & Bulk Action Bar */}
 <div className="bg-surface/90 border border-line/90 rounded-md p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
 <div className="flex flex-wrap items-center gap-2">
 <div className="flex items-center gap-1.5 text-xs text-ink-muted mr-2">
 <Filter className="w-3.5 h-3.5 text-ink-faint" />
 <span>Filter Status:</span>
 </div>

 <button
 onClick={() => { setStatusFilter('all'); setPage(1); }}
 className={`px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
 statusFilter === 'all'
 ? 'bg-sea text-surface '
 : 'bg-surface-sunken text-ink-muted hover:text-ink border border-line'
 }`}
 >
 Semua
 </button>

 <button
 onClick={() => { setStatusFilter('success'); setPage(1); }}
 className={`px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
 statusFilter === 'success'
 ? 'bg-pine text-surface '
 : 'bg-surface-sunken text-ink-muted hover:text-ink border border-line'
 }`}
 >
 Sukses (2xx)
 </button>

 <button
 onClick={() => { setStatusFilter('error'); setPage(1); }}
 className={`px-3 py-1.5 rounded-md text-xs font-semibold transition cursor-pointer ${
 statusFilter === 'error'
 ? 'bg-clay text-surface '
 : 'bg-surface-sunken text-ink-muted hover:text-ink border border-line'
 }`}
 >
 Gagal (4xx / 5xx)
 </button>
 </div>

 {/* Selected Rows Action Button */}
 {selectedIds.length > 0 && (
 <div className="flex items-center gap-3 bg-clay-wash/40 border border-clay-line/60 px-3 py-1.5 rounded-md animate-in fade-in">
 <span className="text-xs font-medium text-clay-deep">
 {selectedIds.length} log terpilih
 </span>
 <button
 onClick={handleDeleteSelected}
 disabled={deleting}
 className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-surface bg-clay hover:bg-clay rounded-lg transition cursor-pointer disabled:opacity-50"
 >
 {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
 <span>Hapus Terpilih</span>
 </button>
 </div>
 )}
 </div>

 {/* Universal Responsive Table */}
 <div className="bg-surface border border-line rounded-md overflow-hidden">
 <div className="w-full overflow-x-auto">
 <table className="w-full text-left border-collapse min-w-[850px]">
 <thead>
 <tr className="border-b border-line bg-surface-sunken/70 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
 <th className="py-3 px-4 w-10 text-center">
 <button
 onClick={handleSelectAll}
 className="text-ink-muted hover:text-surface cursor-pointer"
 title={isAllSelected ? 'Batalkan pilihan' : 'Pilih semua di halaman ini'}
 >
 {isAllSelected ? (
 <CheckSquare className="w-4 h-4 text-sea" />
 ) : (
 <Square className="w-4 h-4 text-ink-faint" />
 )}
 </button>
 </th>
 <th className="py-3 px-4 w-24">Method</th>
 <th className="py-3 px-4">Endpoint</th>
 <th className="py-3 px-4 w-32">Status</th>
 <th className="py-3 px-4 w-24">Latency</th>
 <th className="py-3 px-4 w-36">IP Asal</th>
 {isAdmin && <th className="py-3 px-4 w-40">User</th>}
 <th className="py-3 px-4 w-44">Waktu (WIB)</th>
 <th className="py-3 px-4 w-12 text-center">Aksi</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-line/60 text-xs">
 {loading && logs.length === 0 ? (
 <tr>
 <td colSpan={isAdmin ? 9 : 8} className="py-12 text-center text-ink-muted">
 <Loader2 className="w-6 h-6 animate-spin mx-auto text-sea mb-2" />
 <span>Memuat log aktivitas...</span>
 </td>
 </tr>
 ) : logs.length === 0 ? (
 <tr>
 <td colSpan={isAdmin ? 9 : 8} className="py-12 text-center text-ink-muted">
 <Activity className="w-8 h-8 mx-auto text-ink-faint mb-2" />
 <p className="font-semibold text-ink-soft">Belum ada riwayat log API</p>
 <p className="text-[11px] text-ink-faint mt-0.5">
 Log request mutasi (POST, PATCH, DELETE) dan error akan tercatat secara otomatis di sini.
 </p>
 </td>
 </tr>
 ) : (
 logs.map((log) => {
 const isSelected = selectedIds.includes(log.id);
 return (
 <tr
 key={log.id}
 className={`hover:bg-surface-alt/40 transition ${
 isSelected ? 'bg-sea-wash/20' : ''
 }`}
 >
 <td className="py-3 px-4 text-center">
 <button
 onClick={() => handleToggleRow(log.id)}
 className="text-ink-muted hover:text-surface cursor-pointer"
 >
 {isSelected ? (
 <CheckSquare className="w-4 h-4 text-sea" />
 ) : (
 <Square className="w-4 h-4 text-ink-faint" />
 )}
 </button>
 </td>
 <td className="py-3 px-4 font-mono">{getMethodBadge(log.method)}</td>
 <td className="py-3 px-4 font-mono text-[11px] text-ink">
 <div className="truncate max-w-[280px]" title={log.endpoint}>
 {log.endpoint}
 </div>
 </td>
 <td className="py-3 px-4">{getStatusBadge(log.statusCode)}</td>
 <td className="py-3 px-4 font-mono text-ink-muted">
 <span className={log.durationMs > 1000 ? 'text-honey' : 'text-ink-soft'}>
 {log.durationMs}ms
 </span>
 </td>
 <td className="py-3 px-4 font-mono text-ink-muted text-[11px]">
 {log.ip}
 </td>
 {isAdmin && (
 <td className="py-3 px-4 text-ink-soft">
 <div className="truncate max-w-[150px]" title={log.userEmail || log.userName}>
 <span className="font-medium text-ink">{log.userName}</span>
 </div>
 </td>
 )}
 <td className="py-3 px-4 text-ink-muted text-[11px] whitespace-nowrap">
 {formatWib(log.createdAt)}
 </td>
 <td className="py-3 px-4 text-center">
 <button
 onClick={() => handleDeleteSingle(log.id)}
 disabled={deleting}
 className="p-1.5 text-ink-faint hover:text-clay hover:bg-clay/10 rounded-lg transition cursor-pointer"
 title="Hapus baris log ini"
 >
 <Trash2 className="w-3.5 h-3.5" />
 </button>
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 </table>
 </div>

 {/* Pagination Bar */}
 <div className="border-t border-line px-4 py-3 bg-surface-sunken/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-ink-muted">
 <div className="flex items-center gap-3">
 <span>
 Total: <strong className="text-ink font-semibold">{total}</strong> log
 </span>
 <span className="text-ink-faint">•</span>
 <div className="flex items-center gap-1.5">
 <span>Baris:</span>
 <select
 value={limit}
 onChange={(e) => {
 setLimit(Number(e.target.value));
 setPage(1);
 }}
 className="bg-surface border border-line rounded-lg px-2 py-1 text-xs text-ink-soft focus:outline-none focus:border-sea-line"
 >
 <option value={10}>10</option>
 <option value={25}>25</option>
 <option value={50}>50</option>
 </select>
 </div>
 </div>

 <div className="flex items-center gap-2 self-end sm:self-auto">
 <span className="mr-2">
 Halaman <strong className="text-ink">{page}</strong> dari <strong className="text-ink">{totalPages}</strong>
 </span>

 <button
 onClick={() => setPage((p) => Math.max(1, p - 1))}
 disabled={page <= 1 || loading}
 className="p-1.5 rounded-lg border border-line bg-surface hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed text-ink-soft transition cursor-pointer"
 title="Halaman Sebelumnya"
 >
 <ChevronLeft className="w-4 h-4" />
 </button>

 <button
 onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
 disabled={page >= totalPages || loading}
 className="p-1.5 rounded-lg border border-line bg-surface hover:bg-surface-alt disabled:opacity-40 disabled:cursor-not-allowed text-ink-soft transition cursor-pointer"
 title="Halaman Selanjutnya"
 >
 <ChevronRight className="w-4 h-4" />
 </button>
 </div>
 </div>
 </div>

 {/* Modal Pembersihan Log */}
 {showClearModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/70 backdrop-blur-xs animate-in fade-in">
 <div className="bg-surface border border-line rounded-md max-w-md w-full p-5 space-y-4">
 <div className="flex items-center gap-3">
 <div className="w-9 h-9 rounded-md bg-clay-wash text-clay border border-clay-line/60 flex items-center justify-center shrink-0">
 <Trash2 className="w-4 h-4" />
 </div>
 <div>
 <h3 className="text-sm font-bold text-ink">Pembersihan Riwayat Log API</h3>
 <p className="text-xs text-ink-muted">Pilih opsi retensi untuk mengosongkan log</p>
 </div>
 </div>

 <p className="text-xs text-ink-soft">
 Pembersihan ini akan menghapus catatan request dari database secara permanen untuk menjaga ukuran SQLite tetap ramping.
 </p>

 <div className="space-y-2 pt-2">
 <button
 onClick={() => handleClearAll(7)}
 className="w-full flex items-center justify-between p-3 rounded-md bg-surface-sunken hover:bg-surface-alt/80 border border-line text-xs text-ink transition cursor-pointer"
 >
 <span>Hapus Log yang Lebih Lama dari <strong>7 Hari</strong></span>
 <span className="text-[11px] text-sea font-semibold">Rekomendasi</span>
 </button>

 <button
 onClick={() => handleClearAll(14)}
 className="w-full flex items-center justify-between p-3 rounded-md bg-surface-sunken hover:bg-surface-alt/80 border border-line text-xs text-ink transition cursor-pointer"
 >
 <span>Hapus Log yang Lebih Lama dari <strong>14 Hari</strong></span>
 <span className="text-[11px] text-ink-muted">Retensi 2 Minggu</span>
 </button>

 <button
 onClick={() => {
 setShowClearModal(false);
 setConfirmModal({
 isOpen: true,
 title: 'Hapus SELURUH Riwayat Log',
 message: 'PERINGATAN KRUSIAL: Tindakan ini akan mengosongkan seluruh tabel riwayat log API tanpa tersisa. Data audit sebelumnya tidak dapat dipulihkan!',
 confirmText: 'Hapus Semua Sekarang',
 confirmVariant: 'danger',
 onConfirm: () => handleClearAll(),
 });
 }}
 className="w-full flex items-center justify-between p-3 rounded-md bg-clay-wash/30 hover:bg-clay-wash/60 border border-clay-line/50 text-xs text-clay-deep transition cursor-pointer"
 >
 <span>Hapus <strong>Seluruh Log</strong> Sekarang</span>
 <span className="text-[11px] text-clay font-bold">Semua Data</span>
 </button>
 </div>

 <div className="pt-2 flex justify-end">
 <button
 onClick={() => setShowClearModal(false)}
 className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink bg-surface-sunken hover:bg-surface-alt rounded-md border border-line transition cursor-pointer"
 >
 Batal
 </button>
 </div>
 </div>
 </div>
 )}
 {/* Modal Dialog Konfirmasi Custom */}
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
 className="px-4 py-2 bg-surface-alt hover:bg-surface-alt text-ink-soft rounded-md text-xs font-semibold transition cursor-pointer"
 >
 Batal
 </button>
 <button
 onClick={confirmModal.onConfirm}
 className={`px-4 py-2 text-surface rounded-md text-xs font-semibold transition cursor-pointer ${
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
 </div>
 );
};
