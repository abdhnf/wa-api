import React, { useState, useEffect } from 'react';
import {
 Users,
 Sparkles,
 Shield,
 ShieldCheck,
 Key,
 RefreshCw,
 UserPlus,
 Edit3,
 Trash2,
 FileText,
 MessageSquare,
 Smartphone,
 CheckCircle2,
 XCircle,
 Clock,
 Search,
 AlertCircle,
 AlertTriangle,
 Calendar,
 Globe,
 Eye,
 Lock,
 X,
 ChevronRight,
 Send,
 Sliders
} from 'lucide-react';
import {
 apiGetUsers,
 apiCreateUser,
 apiUpdateUser,
 apiDeleteUser,
 apiRotateApiKey,
 apiResetPassword,
 apiGetUserLogs,
 getStoredUser
} from '../api';

interface UserItem {
 id: string;
 name: string;
 email: string;
 role: 'admin' | 'subscription' | 'user';
 apiKey: string;
 quotaPerDay?: number;
 usedToday?: number;
 quotaPerWeek?: number;
 usedThisWeek?: number;
 quotaLimit?: number;
 usedInPeriod?: number;
 quotaPeriod?: 'daily' | 'weekly' | 'monthly';
 quotaResetAt?: string;
 status: 'active' | 'suspended';
 assignedSessionId?: string;
 authProvider?: 'local' | 'google';
 avatarUrl?: string;
}

interface UserLogsData {
 user: UserItem;
 sessions: any[];
 messages: any[];
}

interface UsersPageProps {
 onNotify?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export const UsersPage: React.FC<UsersPageProps> = ({ onNotify }) => {
 const [users, setUsers] = useState<UserItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [searchQuery, setSearchQuery] = useState('');
 const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'subscription' | 'user'>('all');

 // Modal State
 const [showCreateModal, setShowCreateModal] = useState(false);
 const [showEditModal, setShowEditModal] = useState(false);
 const [showResetModal, setShowResetModal] = useState(false);
 const [showLogsModal, setShowLogsModal] = useState(false);
 const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);

 // Modal Konfirmasi Custom Pengganti window.confirm()
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

 // Message Detail Inspector Modal
 const [selectedMsg, setSelectedMsg] = useState<any | null>(null);

 // Logs Modal State
 const [logsLoading, setLogsLoading] = useState(false);
 const [logsData, setLogsData] = useState<UserLogsData | null>(null);
 const [logsTab, setLogsTab] = useState<'messages' | 'sessions'>('messages');

 // Form State
 const [createForm, setCreateForm] = useState({
 name: '',
 email: '',
 password: '',
 role: 'user' as 'admin' | 'subscription' | 'user',
 quotaPeriod: 'weekly' as 'daily' | 'weekly' | 'monthly',
 quotaLimit: 100,
 });

 const [editForm, setEditForm] = useState({
 name: '',
 role: 'user' as 'admin' | 'subscription' | 'user',
 status: 'active' as 'active' | 'suspended',
 quotaPeriod: 'weekly' as 'daily' | 'weekly' | 'monthly',
 quotaLimit: 100,
 });

 const [newPassword, setNewPassword] = useState('');
 const currentUser = getStoredUser();

 const notify = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
 if (onNotify) onNotify(msg, type);
 else console.log(msg);
 };

 const fetchUsers = async () => {
 try {
 setLoading(true);
 const data = await apiGetUsers();
 setUsers(data);
 } catch (err: any) {
 notify(err.message || 'Gagal memuat daftar pengguna', 'error');
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchUsers();
 }, []);

 const handleOpenLogs = async (u: UserItem) => {
 setSelectedUser(u);
 setShowLogsModal(true);
 setLogsLoading(true);
 setLogsData(null);
 setSelectedMsg(null);
 try {
 const data = await apiGetUserLogs(u.id);
 setLogsData(data);
 } catch (err: any) {
 notify(err.message || 'Gagal mengambil log aktivitas pengguna', 'error');
 } finally {
 setLogsLoading(false);
 }
 };

 const handleCreateSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!createForm.name || !createForm.email || !createForm.password) {
 notify('Semua field wajib diisi', 'error');
 return;
 }
 try {
 await apiCreateUser({
 name: createForm.name,
 email: createForm.email,
 password: createForm.password,
 role: createForm.role,
 quotaPerDay: 100,
 });
 notify('Pengguna baru berhasil ditambahkan', 'success');
 setShowCreateModal(false);
 setCreateForm({
 name: '',
 email: '',
 password: '',
 role: 'user',
 quotaPeriod: 'weekly',
 quotaLimit: 100,
 });
 fetchUsers();
 } catch (err: any) {
 notify(err.message || 'Gagal menambahkan pengguna', 'error');
 }
 };

 const handleEditSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!selectedUser) return;
 try {
 await apiUpdateUser(selectedUser.id, {
 name: editForm.name,
 role: editForm.role,
 status: editForm.status,
 quotaLimit: Number(editForm.quotaLimit),
 quotaPeriod: editForm.quotaPeriod,
 });
 notify('Data pengguna berhasil diperbarui', 'success');
 setShowEditModal(false);
 fetchUsers();
 } catch (err: any) {
 notify(err.message || 'Gagal memperbarui pengguna', 'error');
 }
 };

 const handleResetPasswordSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!selectedUser || !newPassword || newPassword.length < 6) {
 notify('Password minimal 6 karakter', 'error');
 return;
 }
 try {
 await apiResetPassword(selectedUser.id, newPassword);
 notify(`Password untuk ${selectedUser.name} berhasil direset`, 'success');
 setShowResetModal(false);
 setNewPassword('');
 } catch (err: any) {
 notify(err.message || 'Gagal mereset password', 'error');
 }
 };

 const handleRotateKey = (u: UserItem) => {
 setConfirmModal({
 isOpen: true,
 title: `Rotasi API Key — ${u.name}`,
 message: `Kunci API lama untuk ${u.name} (${u.email}) akan langsung tidak berlaku. Semua webhook, bot, atau integrasi yang memakai key ini akan terputus sampai key baru dimasukkan. Yakin ingin melanjutkan?`,
 confirmText: 'Ya, Rotasi Key',
 confirmVariant: 'warning',
 onConfirm: async () => {
 setConfirmModal((prev) => ({ ...prev, isOpen: false }));
 try {
 await apiRotateApiKey(u.id);
 notify(`API Key untuk ${u.name} berhasil dirotasi`, 'success');
 fetchUsers();
 } catch (err: any) {
 notify(err.message || 'Gagal merotasi API Key', 'error');
 }
 },
 });
 };

 const handleDeleteUser = (u: UserItem) => {
 if (u.id === currentUser?.id) {
 notify('Tidak dapat menghapus akun Anda sendiri', 'error');
 return;
 }
 setConfirmModal({
 isOpen: true,
 title: `Hapus Pengguna — ${u.name}`,
 message: `PERINGATAN: Akun"${u.name}" (${u.email}) beserta seluruh data kuota dan hak akses API akan dihapus permanen. Tindakan ini tidak dapat dibatalkan!`,
 confirmText: 'Hapus Permanen',
 confirmVariant: 'danger',
 onConfirm: async () => {
 setConfirmModal((prev) => ({ ...prev, isOpen: false }));
 try {
 await apiDeleteUser(u.id);
 notify(`Pengguna ${u.name} berhasil dihapus`, 'success');
 fetchUsers();
 } catch (err: any) {
 notify(err.message || 'Gagal menghapus pengguna', 'error');
 }
 },
 });
 };

 // Helper Quota Format
 const getPeriodLabel = (p?: string) => {
 if (p === 'daily') return 'Hari';
 if (p === 'monthly') return 'Bulan';
 return 'Minggu';
 };

 // Filter
 const filteredUsers = users.filter((u) => {
 const matchQuery =
 u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
 u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
 u.id.toLowerCase().includes(searchQuery.toLowerCase());
 const matchRole = roleFilter === 'all' || u.role === roleFilter;
 return matchQuery && matchRole;
 });

 // Metrik Ringkas
 const totalUsers = users.length;
 const googleUsers = users.filter((u) => u.authProvider === 'google').length;
 const activeUsers = users.filter((u) => u.status === 'active').length;
 const totalWeeklySent = users.reduce((acc, u) => acc + (u.usedInPeriod ?? u.usedThisWeek ?? 0), 0);

 return (
 <div className="space-y-5 sm:space-y-6">
 {/* Header & Metrics Cards */}
 <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
 <div className="bg-surface/80 border border-line rounded-md p-3.5 sm:p-4 flex items-center justify-between">
 <div>
 <p className="text-[11px] sm:text-xs font-medium text-ink-muted">Total Pengguna</p>
 <p className="text-xl sm:text-2xl font-bold text-ink mt-0.5 sm:mt-1">{totalUsers}</p>
 </div>
 <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-info/10 border border-info/20 flex items-center justify-center text-sea">
 <Users size={18} className="sm:w-5 sm:h-5" />
 </div>
 </div>

 <div className="bg-surface/80 border border-line rounded-md p-3.5 sm:p-4 flex items-center justify-between">
 <div>
 <p className="text-[11px] sm:text-xs font-medium text-ink-muted">Google SSO</p>
 <p className="text-xl sm:text-2xl font-bold text-ink mt-0.5 sm:mt-1">{googleUsers}</p>
 </div>
 <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-sea/10 border border-sea-line/20 flex items-center justify-center text-sea">
 <Globe size={18} className="sm:w-5 sm:h-5" />
 </div>
 </div>

 <div className="bg-surface/80 border border-line rounded-md p-3.5 sm:p-4 flex items-center justify-between">
 <div>
 <p className="text-[11px] sm:text-xs font-medium text-ink-muted">Pengguna Aktif</p>
 <p className="text-xl sm:text-2xl font-bold text-pine mt-0.5 sm:mt-1">
 {activeUsers} <span className="text-xs text-ink-muted font-normal">/ {totalUsers}</span>
 </p>
 </div>
 <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-pine-soft/10 border border-pine/20 flex items-center justify-center text-pine">
 <CheckCircle2 size={18} className="sm:w-5 sm:h-5" />
 </div>
 </div>

 <div className="bg-surface/80 border border-line rounded-md p-3.5 sm:p-4 flex items-center justify-between">
 <div>
 <p className="text-[11px] sm:text-xs font-medium text-ink-muted">Pesan Periode Aktif</p>
 <p className="text-xl sm:text-2xl font-bold text-honey mt-0.5 sm:mt-1">{totalWeeklySent}</p>
 </div>
 <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-honey/10 border border-honey-line/20 flex items-center justify-center text-honey">
 <MessageSquare size={18} className="sm:w-5 sm:h-5" />
 </div>
 </div>
 </div>

 {/* Action Bar & Responsive Search */}
 <div className="bg-surface/80 border border-line rounded-md p-3.5 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-4">
 <div className="flex items-center gap-2.5 flex-1">
 <div className="relative flex-1 sm:max-w-xs">
 <input
 type="text"
 placeholder="Cari nama, email, ID..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 pl-9 text-xs sm:text-sm text-ink placeholder-slate-500 focus:outline-none focus:border-sea-line transition-colors"
 />
 <Search size={14} className="absolute left-3 top-2.5 sm:top-3 text-ink-faint" />
 </div>

 <select
 value={roleFilter}
 onChange={(e: any) => setRoleFilter(e.target.value)}
 className="bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink-soft focus:outline-none focus:border-sea-line"
 >
 <option value="all">Semua Role</option>
 <option value="admin">Super Admin</option>
 <option value="subscription">Subscription</option>
 <option value="user">User Free</option>
 </select>
 </div>

 <div className="flex items-center gap-2 justify-end">
 <button
 onClick={fetchUsers}
 className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-soft hover:text-ink bg-surface-alt/80 hover:bg-surface-alt rounded-lg border border-line-strong/60 transition-colors"
 >
 <RefreshCw size={13} />
 <span>Refresh</span>
 </button>
 <button
 onClick={() => setShowCreateModal(true)}
 className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-surface bg-sea hover:bg-sea rounded-lg transition-colors"
 >
 <UserPlus size={14} />
 <span>Tambah User</span>
 </button>
 </div>
 </div>

 {/* TABEL PENGGUNA (RESPONSIF MOBILE DENGAN HORIZONTAL SCROLL) */}
 <div className="bg-surface/80 border border-line rounded-md overflow-hidden">
 <div className="overflow-x-auto">
 <table className="w-full text-left text-xs text-ink-soft min-w-[760px]">
 <thead className="bg-surface-sunken/60 uppercase tracking-wider text-ink-muted border-b border-line font-semibold text-[11px]">
 <tr>
 <th className="py-3 px-4">Pengguna</th>
 <th className="py-3 px-4">Role</th>
 <th className="py-3 px-4">Limit & Kuota Dinamis</th>
 <th className="py-3 px-4">Status</th>
 <th className="py-3 px-4 text-right">Aksi</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-line/60">
 {loading ? (
 <tr>
 <td colSpan={5} className="py-12 text-center text-ink-faint text-xs">
 Memuat data pengguna...
 </td>
 </tr>
 ) : filteredUsers.length === 0 ? (
 <tr>
 <td colSpan={5} className="py-12 text-center text-ink-faint text-xs">
 Tidak ada pengguna yang sesuai pencarian.
 </td>
 </tr>
 ) : (
 filteredUsers.map((u) => {
 const used = u.usedInPeriod ?? u.usedThisWeek ?? 0;
 const limit = u.quotaLimit ?? u.quotaPerWeek ?? 100;
 const period = u.quotaPeriod || 'weekly';
 const pct = Math.min(100, Math.round((used / limit) * 100));
 const isOverQuota = used >= limit && u.role !== 'admin';
 const resetFormatted = u.quotaResetAt
 ? new Date(u.quotaResetAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
 : '-';

 return (
 <tr key={u.id} className="hover:bg-surface-alt/30 transition-colors">
 {/* Pengguna Info */}
 <td className="py-3.5 px-4">
 <div className="flex items-center gap-3">
 {u.avatarUrl ? (
 <img src={u.avatarUrl} alt={u.name} className="w-8 h-8 rounded-sm border border-line-strong object-cover" />
 ) : (
 <div
 className={`w-8 h-8 rounded-sm flex items-center justify-center font-bold text-xs ${
 u.role === 'admin'
 ? 'bg-sea/30 text-sea-deep border border-info/40'
 : 'bg-surface-alt/50 text-ink-soft border border-line-strong/40'
 }`}
 >
 {u.name ? u.name.charAt(0).toUpperCase() : 'U'}
 </div>
 )}
 <div>
 <div className="flex items-center gap-1.5">
 <span className="font-semibold text-ink">{u.name}</span>
 {u.authProvider === 'google' && (
 <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded bg-sea/10 text-sea border border-sea-line/20 font-medium">
 <Globe size={10} /> Google
 </span>
 )}
 </div>
 <p className="text-[11px] text-ink-muted">{u.email}</p>
 <p className="text-[10px] font-mono text-ink-faint">ID: {u.id}</p>
 </div>
 </div>
 </td>

 {/* Role */}
 <td className="py-3.5 px-4">
 {u.role === 'admin' ? (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-semibold bg-sea/15 text-sea-deep border border-sea-line/30">
 <ShieldCheck size={11} /> Admin
 </span>
 ) : u.role === 'subscription' ? (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-semibold bg-honey/15 text-honey-deep border border-honey-line/30">
 <Sparkles size={11} /> Subscription
 </span>
 ) : (
 <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-medium bg-surface-alt text-ink-soft border border-line-strong">
 <Users size={11} /> User Free
 </span>
 )}
 </td>

 {/* Limit & Kuota Dinamis */}
 <td className="py-3.5 px-4 min-w-[200px]">
 {u.role === 'admin' ? (
 <div className="text-xs text-ink-muted">
 <span className="text-pine font-semibold">Unlimited</span> (Bebas Kuota)
 </div>
 ) : (
 <div className="space-y-1.5">
 <div className="flex items-center justify-between text-xs">
 <span className={`font-semibold ${isOverQuota ? 'text-clay' : 'text-ink-soft'}`}>
 {used} / {limit}{' '}
 <span className="text-[10px] text-ink-muted font-normal">
 pesan/{getPeriodLabel(period).toLowerCase()}
 </span>
 </span>
 <span className="text-[10px] text-ink-muted flex items-center gap-1">
 <Clock size={10} /> Reset: {resetFormatted}
 </span>
 </div>
 <div className="w-full h-1.5 bg-surface-alt rounded-sm overflow-hidden">
 <div
 className={`h-full rounded-sm transition-all ${
 isOverQuota ? 'bg-clay' : pct > 80 ? 'bg-honey' : 'bg-sea'
 }`}
 style={{ width: `${pct}%` }}
 />
 </div>
 </div>
 )}
 </td>

 {/* Status */}
 <td className="py-3.5 px-4">
 <span
 className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[11px] font-medium ${
 u.status === 'active'
 ? 'bg-pine-soft/15 text-pine border border-pine/30'
 : 'bg-clay/15 text-clay border border-clay-line/30'
 }`}
 >
 {u.status === 'active' ? (
 <>
 <CheckCircle2 size={11} /> Aktif
 </>
 ) : (
 <>
 <XCircle size={11} /> Suspended
 </>
 )}
 </span>
 </td>

 {/* Aksi */}
 <td className="py-3.5 px-4 text-right">
 <div className="flex items-center justify-end gap-1">
 <button
 onClick={() => handleOpenLogs(u)}
 title="Lihat Log Aktivitas & Pesan User"
 className="p-1.5 text-xs text-sea hover:text-sea-deep hover:bg-info/10 rounded-md transition-colors flex items-center gap-1"
 >
 <FileText size={13} />
 <span>Log</span>
 </button>

 <button
 onClick={() => {
 setSelectedUser(u);
 setEditForm({
 name: u.name,
 role: u.role,
 status: u.status,
 quotaPeriod: u.quotaPeriod || 'weekly',
 quotaLimit: u.quotaLimit ?? u.quotaPerWeek ?? 100,
 });
 setShowEditModal(true);
 }}
 title="Edit User"
 className="p-1.5 text-xs text-ink-soft hover:text-surface hover:bg-surface-alt rounded-md transition-colors"
 >
 <Edit3 size={13} />
 </button>

 <button
 onClick={() => handleRotateKey(u)}
 title="Rotasi API Key"
 className="p-1.5 text-xs text-honey hover:text-honey-deep hover:bg-honey/10 rounded-md transition-colors"
 >
 <Key size={13} />
 </button>

 {u.authProvider !== 'google' && (
 <button
 onClick={() => {
 setSelectedUser(u);
 setNewPassword('');
 setShowResetModal(true);
 }}
 title="Reset Password"
 className="p-1.5 text-xs text-sea hover:text-sea-deep hover:bg-sea-soft/10 rounded-md transition-colors"
 >
 <Lock size={13} />
 </button>
 )}

 {u.id !== currentUser?.id && (
 <button
 onClick={() => handleDeleteUser(u)}
 title="Hapus User"
 className="p-1.5 text-xs text-clay hover:text-clay-deep hover:bg-clay/10 rounded-md transition-colors"
 >
 <Trash2 size={13} />
 </button>
 )}
 </div>
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 </table>
 </div>
 </div>

 {showEditModal && selectedUser && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink/75 backdrop-blur-xs animate-in fade-in duration-150">
 <div className="bg-surface border border-line rounded-md w-full max-w-md p-5 sm:p-6 space-y-4">
 <div className="flex items-center justify-between border-b border-line pb-3">
 <h3 className="text-base font-bold text-ink flex items-center gap-2">
 <Edit3 size={16} className="text-sea" />
 <span>Edit Pengguna: {selectedUser.name}</span>
 </h3>
 <button onClick={() => setShowEditModal(false)} className="text-ink-muted hover:text-ink-soft">
 <X size={18} />
 </button>
 </div>

 <form onSubmit={handleEditSubmit} className="space-y-3.5">
 <div>
 <label className="block text-xs font-medium text-ink-muted mb-1">Nama</label>
 <input
 type="text"
 required
 value={editForm.name}
 onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
 className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink focus:outline-none focus:border-sea-line"
 />
 </div>

 <div className="grid grid-cols-2 gap-2.5">
 <div>
 <label className="block text-xs font-medium text-ink-muted mb-1">Role</label>
 <select
 value={editForm.role}
 onChange={(e: any) => setEditForm({ ...editForm, role: e.target.value })}
 className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink-soft focus:outline-none focus:border-sea-line"
 >
 <option value="user">User Free</option>
 <option value="subscription">Subscription (Custom Quota)</option>
 <option value="admin">Super Admin</option>
 </select>
 </div>

 <div>
 <label className="block text-xs font-medium text-ink-muted mb-1">Status Akun</label>
 <select
 value={editForm.status}
 onChange={(e: any) => setEditForm({ ...editForm, status: e.target.value })}
 className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink-soft focus:outline-none focus:border-sea-line"
 >
 <option value="active">Aktif</option>
 <option value="suspended">Suspended</option>
 </select>
 </div>
 </div>

 {editForm.role !== 'admin' && (
 <div className="bg-surface-sunken/60 p-3 rounded-md border border-line space-y-2.5">
 <div className="flex items-center gap-1.5 text-xs text-sea font-semibold">
 <Sliders size={13} />
 <span>Pengaturan Batas Kuota Dinamis</span>
 </div>

 <div className="grid grid-cols-2 gap-2.5">
 <div>
 <label className="block text-[11px] font-medium text-ink-muted mb-1">Siklus Periode</label>
 <select
 value={editForm.quotaPeriod}
 onChange={(e: any) => setEditForm({ ...editForm, quotaPeriod: e.target.value })}
 className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-xs text-ink-soft focus:outline-none focus:border-sea-line"
 >
 <option value="daily">Harian (Daily)</option>
 <option value="weekly">Mingguan (Weekly)</option>
 <option value="monthly">Bulanan (Monthly)</option>
 </select>
 </div>

 <div>
 <label className="block text-[11px] font-medium text-ink-muted mb-1">Limit Pesan</label>
 <input
 type="number"
 value={editForm.quotaLimit}
 onChange={(e) => setEditForm({ ...editForm, quotaLimit: Number(e.target.value) })}
 className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-xs text-ink focus:outline-none focus:border-sea-line"
 />
 </div>
 </div>
 <p className="text-[10px] text-ink-faint">Default: 100 pesan/minggu. Mengubah siklus periode akan mereset jadwal hitung.</p>
 </div>
 )}

 <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
 <button
 type="button"
 onClick={() => setShowEditModal(false)}
 className="px-3.5 py-2 text-xs font-semibold text-ink-muted hover:text-ink-soft bg-surface-alt rounded-lg transition-colors"
 >
 Batal
 </button>
 <button
 type="submit"
 className="px-4 py-2 text-xs font-semibold text-surface bg-sea hover:bg-sea rounded-lg transition-colors"
 >
 Simpan Perubahan
 </button>
 </div>
 </form>
 </div>
 </div>
 )}

 {/* MODAL: RESET PASSWORD */}
 {showResetModal && selectedUser && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink/75 backdrop-blur-xs animate-in fade-in duration-150">
 <div className="bg-surface border border-line rounded-md w-full max-w-sm p-5 space-y-4">
 <div className="flex items-center justify-between border-b border-line pb-3">
 <h3 className="text-base font-bold text-ink flex items-center gap-2">
 <Lock size={16} className="text-sea" />
 <span>Reset Password</span>
 </h3>
 <button onClick={() => setShowResetModal(false)} className="text-ink-muted hover:text-ink-soft">
 <X size={18} />
 </button>
 </div>

 <p className="text-xs text-ink-muted">
 Masukkan password baru untuk pengguna <b className="text-ink-soft">{selectedUser.name}</b>.
 </p>

 <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
 <div>
 <input
 type="password"
 required
 minLength={6}
 placeholder="Password baru (min 6 karakter)"
 value={newPassword}
 onChange={(e) => setNewPassword(e.target.value)}
 className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink focus:outline-none focus:border-sea-line"
 />
 </div>

 <div className="flex items-center justify-end gap-2 pt-1 border-t border-line">
 <button
 type="button"
 onClick={() => setShowResetModal(false)}
 className="px-3.5 py-2 text-xs font-semibold text-ink-muted hover:text-ink-soft bg-surface-alt rounded-lg transition-colors"
 >
 Batal
 </button>
 <button
 type="submit"
 className="px-4 py-2 text-xs font-semibold text-surface bg-sea hover:bg-sea rounded-lg transition-colors"
 >
 Ganti Password
 </button>
 </div>
 </form>
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
