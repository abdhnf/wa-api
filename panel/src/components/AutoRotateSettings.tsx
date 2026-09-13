import React, { useState, useEffect } from 'react';
import { RefreshCw, Shield, Zap, CheckCircle2, Loader2, ArrowRightLeft, Users, ShieldAlert, Check } from 'lucide-react';
import { apiGetAutoRotateSettings, apiUpdateAutoRotateSettings, apiGetAutoRotateStatus } from '../api';

interface AutoRotateSettingsProps {
 showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const AutoRotateSettings: React.FC<AutoRotateSettingsProps> = ({ showToast }) => {
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [statusData, setStatusData] = useState<any>(null);

 // Form states
 const [enabled, setEnabled] = useState(false);
 const [strategy, setStrategy] = useState<'least_loaded' | 'round_robin' | 'warmup_priority'>('least_loaded');
 const [rotateOnLimit, setRotateOnLimit] = useState(true);
 const [rotateOnDisconnect, setRotateOnDisconnect] = useState(true);
 const [rotateOn463, setRotateOn463] = useState(true);
 const [stickySession, setStickySession] = useState(true);
 const [poolSessions, setPoolSessions] = useState<string[]>([]);

 const loadData = async () => {
 setLoading(true);
 try {
 const [settingsRes, statusRes] = await Promise.all([
 apiGetAutoRotateSettings(),
 apiGetAutoRotateStatus(),
 ]);

 if (settingsRes?.settings) {
 setEnabled(Boolean(settingsRes.settings.enabled));
 setStrategy(settingsRes.settings.strategy || 'least_loaded');
 setRotateOnLimit(Boolean(settingsRes.settings.rotateOnLimit));
 setRotateOnDisconnect(Boolean(settingsRes.settings.rotateOnDisconnect));
 setRotateOn463(Boolean(settingsRes.settings.rotateOn463));
 setStickySession(Boolean(settingsRes.settings.stickySession));
 setPoolSessions(Array.isArray(settingsRes.settings.poolSessions) ? settingsRes.settings.poolSessions : []);
 }

 if (statusRes) {
 setStatusData(statusRes);
 }
 } catch (err: any) {
 showToast(err?.message || 'Gagal memuat pengaturan Auto-Rotate', 'error');
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 loadData();
 }, []);

 const handleTogglePool = (sessionId: string) => {
 setPoolSessions((prev) => {
 const allIds = statusData?.roster?.map((r: any) => r.id) || [];
 const current = prev.length === 0 ? allIds : prev;
 if (current.includes(sessionId)) {
 return current.filter((id: string) => id !== sessionId);
 } else {
 return [...current, sessionId];
 }
 });
 };

 const handleSave = async (e: React.FormEvent) => {
 e.preventDefault();
 setSaving(true);
 try {
 await apiUpdateAutoRotateSettings({
 enabled,
 strategy,
 rotateOnLimit,
 rotateOnDisconnect,
 rotateOn463,
 stickySession,
 poolSessions,
 });
 showToast('Pengaturan Auto-Rotate & Session Pool berhasil disimpan!', 'success');
 loadData();
 } catch (err: any) {
 showToast(err?.message || 'Gagal menyimpan pengaturan', 'error');
 } finally {
 setSaving(false);
 }
 };

 if (loading) {
 return (
 <div className="flex items-center justify-center py-20 text-ink-muted">
 <Loader2 className="w-7 h-7 animate-spin mr-3 text-pine" />
 <span className="text-sm font-medium">Memuat status pool nomor & anti-ban...</span>
 </div>
 );
 }

 const roster = statusData?.roster || [];
 const activeCount = roster.filter((r: any) => r.status === 'connected').length;

 return (
 <div className="space-y-6 animate-in fade-in duration-200">
 {/* Top Banner Status */}
 <div className="bg-surface/80 border border-line rounded-md p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
 <div className="flex items-center gap-3.5">
 <div className={`p-3 rounded-md border ${enabled ? 'bg-pine-wash/60 border-pine-line/50 text-pine' : 'bg-surface-alt/60 border-line-strong text-ink-muted'}`}>
 <ArrowRightLeft size={22} className={enabled ? 'animate-pulse' : ''} />
 </div>
 <div>
 <div className="flex items-center gap-2">
 <h3 className="text-base font-bold text-ink">Status Session Pooling</h3>
 <span className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-sm border ${enabled ? 'bg-pine-wash text-pine border-pine-line/60' : 'bg-surface-alt text-ink-muted border-line-strong'}`}>
 {enabled ? 'Auto-Rotate Aktif' : 'Standby / Manual'}
 </span>
 </div>
 <p className="text-xs text-ink-muted mt-0.5">
 {activeCount} dari {roster.length} nomor WhatsApp siap menerima antrean pengiriman.
 </p>
 </div>
 </div>

 <button
 onClick={handleSave}
 disabled={saving}
 className="flex items-center gap-2 px-5 py-2.5 bg-pine hover:bg-pine-soft disabled:opacity-50 text-surface text-xs font-semibold rounded-md transition cursor-pointer"
 >
 {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
 Simpan Konfigurasi
 </button>
 </div>

 <form onSubmit={handleSave} className="space-y-6">
 {/* Card 1: Master Switch & Strategi */}
 <div className="bg-surface/60 border border-line rounded-md p-5 space-y-5">
 <div className="flex items-start justify-between gap-4 border-b border-line/70 pb-4">
 <div>
 <h4 className="text-sm font-semibold text-ink flex items-center gap-2">
 <Zap size={16} className="text-honey" />
 Aktifkan Auto-Rotate Pengiriman Pesan
 </h4>
 <p className="text-xs text-ink-muted mt-0.5">
 Jika aktif, pengiriman API akan otomatis memilih nomor WhatsApp yang sehat & tidak sedang limit.
 </p>
 </div>
 <label className="relative inline-flex items-center cursor-pointer">
 <input
 type="checkbox"
 checked={enabled}
 onChange={(e) => setEnabled(e.target.checked)}
 className="sr-only peer"
 />
 <div className="w-11 h-6 bg-surface-alt peer-focus:outline-none rounded-sm peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-line-strong after:border after:rounded-sm after:h-5 after:w-5 after:transition-all peer-checked:bg-pine"></div>
 </label>
 </div>

 <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
 {/* Strategi */}
 <div>
 <label className="block text-xs font-semibold text-ink-soft mb-1.5">
 Strategi Pembagian Beban (Load Balancing)
 </label>
 <select
 value={strategy}
 onChange={(e: any) => setStrategy(e.target.value)}
 className="w-full bg-surface-sunken border border-line rounded-md px-3.5 py-2.5 text-xs text-ink focus:outline-none focus:border-pine font-medium cursor-pointer"
 >
 <option value="least_loaded">Least Loaded (Prioritaskan nomor yang paling sedikit kirim hari ini) - Rekomendasi</option>
 <option value="round_robin">Round-Robin (Rotasi bergilir merata antar sesi connected)</option>
 <option value="warmup_priority">Warm-Up Priority (Prioritaskan nomor dengan masa warm-up tertinggi)</option>
 </select>
 <p className="text-[11px] text-ink-faint mt-1">
 Mencegah satu nomor kena lonjakan spam tiba-tiba dari antrean broadcast.
 </p>
 </div>

 {/* Sticky Session */}
 <div>
 <label className="block text-xs font-semibold text-ink-soft mb-1.5">
 Sticky Session untuk Kontak Lama
 </label>
 <div className="flex items-center justify-between bg-surface-sunken border border-line rounded-md px-3.5 py-2">
 <div className="pr-2">
 <span className="text-xs text-ink font-medium block">Pertahankan Nomor Sebelumnya</span>
 <span className="text-[10px] text-ink-faint">Jika penerima pernah chat dengan Nomor A, tetap kirim via Nomor A jika sehat.</span>
 </div>
 <input
 type="checkbox"
 checked={stickySession}
 onChange={(e) => setStickySession(e.target.checked)}
 className="rounded border-line-strong text-pine focus:ring-pine w-4 h-4 cursor-pointer"
 />
 </div>
 </div>
 </div>
 </div>

 {/* Card 2: Failover Triggers */}
 <div className="bg-surface/60 border border-line rounded-md p-5 space-y-4">
 <h4 className="text-sm font-semibold text-ink flex items-center gap-2">
 <Shield size={16} className="text-sea" />
 Kondisi Pemicu Rotasi Otomatis (Failover Triggers)
 </h4>
 <p className="text-xs text-ink-muted">
 Sistem akan otomatis memindahkan antrean pesan ke nomor berikutnya jika mendeteksi kondisi berikut:
 </p>

 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
 <label className="flex items-start gap-3 bg-surface-sunken/70 border border-line/80 rounded-md p-3.5 cursor-pointer hover:border-line-strong transition">
 <input
 type="checkbox"
 checked={rotateOnLimit}
 onChange={(e) => setRotateOnLimit(e.target.checked)}
 className="mt-0.5 rounded border-line-strong text-pine focus:ring-pine w-4 h-4 cursor-pointer"
 />
 <div className="text-xs">
 <span className="font-semibold text-ink block">Limit Harian Warm-Up</span>
 <span className="text-[11px] text-ink-muted mt-0.5 block">Pindah saat nomor mencapai batas kuota harian anti-ban.</span>
 </div>
 </label>

 <label className="flex items-start gap-3 bg-surface-sunken/70 border border-line/80 rounded-md p-3.5 cursor-pointer hover:border-line-strong transition">
 <input
 type="checkbox"
 checked={rotateOnDisconnect}
 onChange={(e) => setRotateOnDisconnect(e.target.checked)}
 className="mt-0.5 rounded border-line-strong text-pine focus:ring-pine w-4 h-4 cursor-pointer"
 />
 <div className="text-xs">
 <span className="font-semibold text-ink block">Socket Disconnected</span>
 <span className="text-[11px] text-ink-muted mt-0.5 block">Pindah saat nomor tiba-tiba terputus atau connecting.</span>
 </div>
 </label>

 <label className="flex items-start gap-3 bg-surface-sunken/70 border border-line/80 rounded-md p-3.5 cursor-pointer hover:border-line-strong transition">
 <input
 type="checkbox"
 checked={rotateOn463}
 onChange={(e) => setRotateOn463(e.target.checked)}
 className="mt-0.5 rounded border-line-strong text-pine focus:ring-pine w-4 h-4 cursor-pointer"
 />
 <div className="text-xs">
 <span className="font-semibold text-ink block">Timelock 463</span>
 <span className="text-[11px] text-ink-muted mt-0.5 block">Pindah jika nomor terkena isolasi kirim ke nomor asing.</span>
 </div>
 </label>
 </div>
 </div>

 {/* Card 3: Daftar Sesi dalam Pool */}
 <div className="bg-surface/60 border border-line rounded-md p-5 space-y-4">
 <div className="flex justify-between items-center">
 <div>
 <h4 className="text-sm font-semibold text-ink flex items-center gap-2">
 <Users size={16} className="text-pine" />
 Partisipasi Nomor dalam Pool (Session Roster)
 </h4>
 <p className="text-xs text-ink-muted mt-0.5">
 Tentukan nomor mana saja yang berpartisipasi dalam auto-rotate.
 </p>
 </div>
 <span className="text-xs text-pine font-mono font-medium">
 {poolSessions.length === 0 ? roster.length : poolSessions.length} sesi aktif di pool
 </span>
 </div>

 <div className="overflow-x-auto rounded-md border border-line">
 <table className="w-full text-left text-xs min-w-[640px]">
 <thead className="bg-surface-sunken text-ink-muted uppercase tracking-wider text-[11px]">
 <tr>
 <th className="px-4 py-3 text-center">Ikut Pool</th>
 <th className="px-4 py-3">Nama Sesi / ID</th>
 <th className="px-4 py-3">Nomor WA</th>
 <th className="px-4 py-3">Koneksi</th>
 <th className="px-4 py-3">Warm-Up Hari Ini</th>
 <th className="px-4 py-3">Timelock 463</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-line/60 bg-surface/40">
 {roster.map((s: any) => {
 const isIncluded = poolSessions.length === 0 || poolSessions.includes(s.id);
 const warmup = s.warmupStatus;
 const limitReached = warmup ? warmup.todaySent >= warmup.todayLimit : false;

 return (
 <tr key={s.id} className={`transition hover:bg-surface-alt/40 ${isIncluded ? '' : 'opacity-50'}`}>
 <td className="px-4 py-3 text-center">
 <input
 type="checkbox"
 checked={isIncluded}
 onChange={() => handleTogglePool(s.id)}
 className="rounded border-line-strong text-pine focus:ring-pine w-4 h-4 cursor-pointer"
 />
 </td>
 <td className="px-4 py-3 font-semibold text-ink">
 <div>{s.name}</div>
 <div className="text-[10px] text-ink-faint font-mono">{s.id}</div>
 </td>
 <td className="px-4 py-3 font-mono text-ink-soft">
 +{s.phone}
 </td>
 <td className="px-4 py-3">
 <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-sm text-[10px] font-semibold border ${
 s.status === 'connected'
 ? 'bg-pine-wash text-pine border-pine-line/60'
 : 'bg-clay-wash text-clay border-clay-line/60'
 }`}>
 <span className={`w-1.5 h-1.5 rounded-sm ${s.status === 'connected' ? 'bg-pine-soft' : 'bg-clay'}`} />
 {s.status}
 </span>
 </td>
 <td className="px-4 py-3">
 {warmup ? (
 <div className="space-y-1 w-32">
 <div className="flex justify-between text-[10px]">
 <span className={limitReached ? 'text-clay font-bold' : 'text-ink-soft'}>
 {warmup.todaySent} / {warmup.todayLimit} pesan
 </span>
 <span className="text-ink-faint font-mono">H-{warmup.day}</span>
 </div>
 <div className="w-full bg-surface-alt h-1.5 rounded-sm overflow-hidden">
 <div
 className={`h-full rounded-sm transition-all ${limitReached ? 'bg-clay' : 'bg-pine-soft'}`}
 style={{ width: Math.min(100, (warmup.todaySent / warmup.todayLimit) * 100) + '%' }}
 />
 </div>
 </div>
 ) : (
 <span className="text-ink-faint">-</span>
 )}
 </td>
 <td className="px-4 py-3">
 {s.timelockActive ? (
 <span className="text-[10px] text-honey bg-honey-wash/60 px-2 py-0.5 rounded border border-honey-line/50 flex items-center gap-1 w-fit">
 <ShieldAlert size={12} /> Restricted
 </span>
 ) : (
 <span className="text-[10px] text-pine bg-pine-wash/60 px-2 py-0.5 rounded border border-pine-line/50 flex items-center gap-1 w-fit">
 <Check size={12} /> Clear
 </span>
 )}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 </div>

 </form>
 </div>
 );
};
