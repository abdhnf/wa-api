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
 KeyRound,
 Link2,
 Copy,
 Check,
 ExternalLink,
 X,
 ChevronRight,
 Send,
 Sliders,
 Phone
 } from 'lucide-react';
import {
 apiGetUsers,
 apiCreateUser,
 apiUpdateUser,
 apiDeleteUser,
 apiRotateApiKey,
 apiResetPassword,
 apiResetPin,
 apiGetUserBlastLink,
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
 hasBlastPin?: boolean;
 hasBlastToken?: boolean;
 /** Nomor telepon kanonik (628xxx). Opsional — user lama belum punya. */
 phone?: string;
 }

interface UserLogsData {
  user: UserItem;
  sessions: any[];
  messages: any[];
}

// Format waktu ringkas untuk log (tanggal + jam, zona waktu pengguna).
const fmtWaktu = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const LABEL_STATUS_PESAN: Record<string, string> = {
  queued: 'Menunggu',
  sending: 'Dikirim',
  sent: 'Terkirim',
  delivered: 'Diterima',
  read: 'Dibaca',
  failed: 'Gagal',
};

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
 const [showResetPinModal, setShowResetPinModal] = useState(false);
 const [showBlastLinkModal, setShowBlastLinkModal] = useState(false);
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
   phone: '',
   role: 'user' as 'admin' | 'subscription' | 'user',
   quotaPeriod: 'weekly' as 'daily' | 'weekly' | 'monthly',
   quotaLimit: 100,
 });

 const [editForm, setEditForm] = useState({
   name: '',
   phone: '',
   role: 'user' as 'admin' | 'subscription' | 'user',
   status: 'active' as 'active' | 'suspended',
   quotaPeriod: 'weekly' as 'daily' | 'weekly' | 'monthly',
   quotaLimit: 100,
 });

 const [newPassword, setNewPassword] = useState('');
 const [newPin, setNewPin] = useState('');
 const [blastLink, setBlastLink] = useState<{ loading: boolean; url: string | null; hasToken: boolean; message?: string; error?: string }>({ loading: false, url: null, hasToken: false });
 const [blastLinkCopied, setBlastLinkCopied] = useState(false);
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
     phone: createForm.phone || undefined,
     role: createForm.role,
     quotaPerDay: 100,
     quotaPeriod: createForm.quotaPeriod,
     quotaLimit: Number(createForm.quotaLimit),
   });
   notify('Pengguna baru berhasil ditambahkan', 'success');
   setShowCreateModal(false);
   setCreateForm({
     name: '',
     email: '',
     password: '',
     phone: '',
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
   phone: editForm.phone,
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

 const handleResetPinSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 if (!selectedUser) return;
 const pin = newPin.trim();
 if (pin && !/^\d{6}$/.test(pin)) {
 notify('PIN wajib 6 digit angka', 'error');
 return;
 }
 try {
 await apiResetPin(selectedUser.id, pin);
 notify(
 pin
 ? `PIN Blast untuk ${selectedUser.name} berhasil dipasang`
 : `PIN Blast ${selectedUser.name} dihapus — user wajib memasang PIN baru saat membuka Blast`,
 'success'
 );
 setShowResetPinModal(false);
 setNewPin('');
 fetchUsers();
 } catch (err: any) {
 notify(err.message || 'Gagal mereset PIN', 'error');
 }
 };

 const handleViewBlastLink = async (u: UserItem) => {
 setSelectedUser(u);
 setBlastLink({ loading: true, url: null, hasToken: false });
 setBlastLinkCopied(false);
 setShowBlastLinkModal(true);
 try {
 const res = await apiGetUserBlastLink(u.id);
 setBlastLink({
 loading: false,
 url: res?.launchUrl ?? null,
 hasToken: !!res?.hasToken,
 message: res?.message,
 });
 } catch (err: any) {
 setBlastLink({ loading: false, url: null, hasToken: false, error: err.message || 'Gagal mengambil link akses' });
 }
 };

 const handleCopyBlastLink = () => {
 if (!blastLink.url) return;
 navigator.clipboard.writeText(blastLink.url);
 setBlastLinkCopied(true);
 setTimeout(() => setBlastLinkCopied(false), 2000);
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
 {u.phone && (
   <p className="text-[10px] text-ink-faint font-mono flex items-center gap-1">
     <Phone size={9} />
     {u.phone}
   </p>
 )}
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
   phone: u.phone || '',
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

 {u.role !== 'admin' && (
 <button
 onClick={() => {
 setSelectedUser(u);
 setNewPin('');
 setShowResetPinModal(true);
 }}
 title={u.hasBlastPin ? 'Reset PIN Blast Dashboard' : 'Pasang PIN Blast Dashboard'}
 className={`p-1.5 text-xs rounded-md transition-colors ${
 u.hasBlastPin
 ? 'text-honey hover:text-honey-deep hover:bg-honey/10'
 : 'text-ink-soft hover:text-ink hover:bg-surface-alt'
 }`}
 >
 <KeyRound size={13} />
 </button>
 )}

 <button
 onClick={() => handleViewBlastLink(u)}
 title={u.hasBlastToken ? 'Lihat link akses Blast Dashboard' : 'Link Blast belum dibuat'}
 className={`p-1.5 text-xs rounded-md transition-colors ${
 u.hasBlastToken
 ? 'text-sea hover:text-sea-deep hover:bg-sea-soft/10'
 : 'text-ink-muted hover:text-ink-soft hover:bg-surface-alt'
 }`}
 >
 <Link2 size={13} />
 </button>

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

 <div>
 <label className="block text-xs font-medium text-ink-muted mb-1">
 Nomor Telepon <span className="text-ink-faint font-normal">(opsional)</span>
 </label>
 <input
 type="tel"
 value={editForm.phone}
 onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
 placeholder="08123456789"
 className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink focus:outline-none focus:border-sea-line font-mono"
 />
 <p className="text-[10px] text-ink-faint mt-1">
 Kosongkan untuk menghapus nomor.
 </p>
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

 {/* MODAL: TAMBAH USER */}
 {showCreateModal && (
   <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink/75 backdrop-blur-xs animate-in fade-in duration-150">
     <div className="bg-surface border border-line rounded-md w-full max-w-md p-5 sm:p-6 space-y-4">
       <div className="flex items-center justify-between border-b border-line pb-3">
         <h3 className="text-base font-bold text-ink flex items-center gap-2">
           <UserPlus size={16} className="text-sea" />
           <span>Tambah Pengguna</span>
         </h3>
         <button onClick={() => setShowCreateModal(false)} className="text-ink-muted hover:text-ink-soft">
           <X size={18} />
         </button>
       </div>

       <form onSubmit={handleCreateSubmit} className="space-y-3.5">
         <div>
           <label className="block text-xs font-medium text-ink-muted mb-1">Nama</label>
           <input
             type="text"
             required
             value={createForm.name}
             onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
             className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink focus:outline-none focus:border-sea-line"
           />
         </div>

         <div>
           <label className="block text-xs font-medium text-ink-muted mb-1">Email</label>
           <input
             type="email"
             required
             value={createForm.email}
             onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
             className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink focus:outline-none focus:border-sea-line"
           />
         </div>

         <div>
           <label className="block text-xs font-medium text-ink-muted mb-1">Password</label>
           <input
             type="password"
             required
             minLength={6}
             placeholder="Minimal 6 karakter"
             value={createForm.password}
             onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
             className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink focus:outline-none focus:border-sea-line"
           />
         </div>

         <div>
           <label className="block text-xs font-medium text-ink-muted mb-1">
             Nomor Telepon <span className="text-ink-faint font-normal">(opsional)</span>
           </label>
           <input
             type="tel"
             value={createForm.phone}
             onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
             placeholder="08123456789"
             className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink focus:outline-none focus:border-sea-line font-mono"
           />
           <p className="text-[10px] text-ink-faint mt-1">
             Format 08xx, +62xxx, atau 62xxx. Disimpan seragam sebagai 628xxx.
           </p>
         </div>

         <div>
           <label className="block text-xs font-medium text-ink-muted mb-1">Role</label>
           <select
             value={createForm.role}
             onChange={(e: any) => setCreateForm({ ...createForm, role: e.target.value })}
             className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink-soft focus:outline-none focus:border-sea-line"
           >
             <option value="user">User Free</option>
             <option value="subscription">Subscription (Custom Quota)</option>
             <option value="admin">Super Admin</option>
           </select>
         </div>

         {createForm.role !== 'admin' && (
           <div className="bg-surface-sunken/60 p-3 rounded-md border border-line space-y-2.5">
             <div className="flex items-center gap-1.5 text-xs text-sea font-semibold">
               <Sliders size={13} />
               <span>Pengaturan Batas Kuota Dinamis</span>
             </div>

             <div className="grid grid-cols-2 gap-2.5">
               <div>
                 <label className="block text-[11px] font-medium text-ink-muted mb-1">Siklus Periode</label>
                 <select
                   value={createForm.quotaPeriod}
                   onChange={(e: any) => setCreateForm({ ...createForm, quotaPeriod: e.target.value })}
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
                   min={1}
                   value={createForm.quotaLimit}
                   onChange={(e) => setCreateForm({ ...createForm, quotaLimit: Number(e.target.value) })}
                   className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-xs text-ink focus:outline-none focus:border-sea-line"
                 />
               </div>
             </div>

             <p className="text-[11px] text-ink-muted">
               Limit dihitung per siklus yang dipilih dan otomatis direset saat siklus berakhir.
             </p>
           </div>
         )}

         <div className="flex items-center justify-end gap-2 pt-1 border-t border-line">
           <button
             type="button"
             onClick={() => setShowCreateModal(false)}
             className="px-3.5 py-2 text-xs font-semibold text-ink-muted hover:text-ink-soft bg-surface-alt rounded-lg transition-colors"
           >
             Batal
           </button>
           <button
             type="submit"
             className="px-4 py-2 text-xs font-semibold text-surface bg-sea hover:bg-sea rounded-lg transition-colors"
           >
             Simpan
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

 {/* MODAL: RESET / PASANG PIN BLAST DASHBOARD */}
 {showResetPinModal && selectedUser && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink/75 backdrop-blur-xs animate-in fade-in duration-150">
 <div className="bg-surface border border-line rounded-md w-full max-w-sm p-5 space-y-4">
 <div className="flex items-center justify-between border-b border-line pb-3">
 <h3 className="text-base font-bold text-ink flex items-center gap-2">
 <KeyRound size={16} className="text-honey" />
 <span>PIN Blast Dashboard</span>
 </h3>
 <button onClick={() => setShowResetPinModal(false)} className="text-ink-muted hover:text-ink-soft">
 <X size={18} />
 </button>
 </div>

 <p className="text-xs text-ink-muted">
 PIN ini dipakai pengguna <b className="text-ink-soft">{selectedUser.name}</b> untuk membuka
 WhatsApp Blast Dashboard. Status saat ini:{' '}
 {selectedUser.hasBlastPin ? (
 <b className="text-honey">sudah terpasang</b>
 ) : (
 <b className="text-ink-soft">belum ada</b>
 )}
 </p>

 <form onSubmit={handleResetPinSubmit} className="space-y-4">
 <div>
 <input
 type="text"
 inputMode="numeric"
 autoComplete="off"
 maxLength={6}
 placeholder="PIN baru — 6 digit angka"
 value={newPin}
 onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
 className="w-full bg-surface-sunken border border-line rounded-lg px-3 py-2 text-xs sm:text-sm text-ink tracking-[0.4em] text-center font-mono focus:outline-none focus:border-sea-line"
 />
 <p className="text-[11px] text-ink-muted mt-1.5">
 Kosongkan lalu simpan untuk <b className="text-ink-soft">menghapus PIN</b> — pengguna akan
 diminta memasang PIN baru sendiri saat membuka Blast Dashboard.
 </p>
 </div>

 <div className="flex items-center justify-end gap-2 pt-1 border-t border-line">
 <button
 type="button"
 onClick={() => setShowResetPinModal(false)}
 className="px-3.5 py-2 text-xs font-semibold text-ink-muted hover:text-ink-soft bg-surface-alt rounded-lg transition-colors"
 >
 Batal
 </button>
 <button
 type="submit"
 className="px-4 py-2 text-xs font-semibold text-surface bg-honey hover:bg-honey-deep rounded-lg transition-colors"
 >
 {newPin.trim() ? 'Pasang PIN' : 'Hapus PIN'}
 </button>
 </div>
 </form>
 </div>
 </div>
 )}

 {/* MODAL: LIHAT LINK AKSES BLAST DASHBOARD (read-only) */}
 {showBlastLinkModal && selectedUser && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink/75 backdrop-blur-xs animate-in fade-in duration-150">
 <div className="bg-surface border border-line rounded-md w-full max-w-lg p-5 space-y-4">
 <div className="flex items-center justify-between border-b border-line pb-3">
 <h3 className="text-base font-bold text-ink flex items-center gap-2">
 <Link2 size={16} className="text-sea" />
 <span>Link Akses Blast Dashboard</span>
 </h3>
 <button onClick={() => setShowBlastLinkModal(false)} className="text-ink-muted hover:text-ink-soft">
 <X size={18} />
 </button>
 </div>

 <p className="text-xs text-ink-muted">
 Link akses milik <b className="text-ink-soft">{selectedUser.name}</b> ({selectedUser.email}).
 Tampilan ini hanya untuk membaca — link tidak dibuat ulang di sini.
 </p>

 {blastLink.loading ? (
 <div className="p-4 bg-surface-sunken border border-line rounded-md flex items-center justify-center gap-2 text-xs text-ink-muted">
 <RefreshCw size={16} className="animate-spin text-sea" />
 <span>Memuat link akses...</span>
 </div>
 ) : blastLink.error ? (
 <div className="p-3 bg-clay-wash/40 border border-clay-line/50 rounded-md text-xs text-clay-deep flex items-center gap-2">
 <AlertCircle size={14} className="shrink-0" />
 <span>{blastLink.error}</span>
 </div>
 ) : blastLink.hasToken && blastLink.url ? (
 <div className="space-y-3">
 <div className="flex items-center gap-2 p-2 bg-surface-sunken border border-line rounded-md">
 <div className="flex-1 px-2.5 font-mono text-xs text-ink truncate select-all">
 {blastLink.url}
 </div>
 <button
 onClick={handleCopyBlastLink}
 className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition shrink-0 ${
 blastLinkCopied ? 'bg-pine text-surface' : 'bg-surface-alt hover:bg-surface-alt text-ink'
 }`}
 >
 {blastLinkCopied ? <Check size={13} /> : <Copy size={13} />}
 <span>{blastLinkCopied ? 'Tersalin' : 'Salin'}</span>
 </button>
 </div>

 <a
 href={blastLink.url}
 target="_blank"
 rel="noopener noreferrer"
 className="w-full py-2.5 bg-sea hover:bg-sea-soft text-surface font-bold rounded-md text-xs transition flex items-center justify-center gap-2"
 >
 <span>Buka Blast Dashboard</span>
 <ExternalLink size={14} />
 </a>

 <p className="text-[11px] text-ink-muted leading-relaxed">
 Membuka link ini tetap meminta <b className="text-ink-soft">PIN 6 digit</b> milik pengguna.
 Kalau PIN-nya lupa, reset lewat tombol PIN di baris pengguna.
 </p>
 </div>
 ) : (
 <div className="p-4 bg-honey-wash/30 border border-honey-line/40 rounded-md space-y-2">
 <div className="flex items-start gap-2.5">
 <AlertCircle size={16} className="text-honey shrink-0 mt-0.5" />
 <div>
 <h4 className="text-xs font-bold text-honey-deep">Link belum pernah dibuat</h4>
 <p className="text-[11px] text-honey-deep/80 mt-0.5">
 {blastLink.message || 'Pengguna ini belum membuka menu Blast App, jadi token aksesnya belum terbit.'}
 </p>
 </div>
 </div>
 <p className="text-[11px] text-ink-muted pt-1">
 Token <b>tidak dibuat otomatis</b> dari halaman ini. Minta pengguna membuka panel, klik
 <b className="text-ink-soft"> Blast App</b> di kanan atas, lalu salin link dari sana.
 {!selectedUser.hasBlastPin && ' PIN-nya juga belum dipasang.'}
 </p>
 </div>
 )}

 <div className="flex items-center justify-end pt-2 border-t border-line">
 <button
 onClick={() => setShowBlastLinkModal(false)}
 className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink-soft bg-surface-alt rounded-lg transition-colors"
 >
 Tutup
 </button>
 </div>
 </div>
 </div>
 )}
 {/* MODAL: LOG AKTIVITAS PENGGUNA */}
{showLogsModal && selectedUser && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink/75 backdrop-blur-xs animate-in fade-in duration-150">
    <div className="bg-surface border border-line rounded-md w-full max-w-3xl max-h-[88vh] flex flex-col">
      <div className="flex items-center justify-between border-b border-line p-5 pb-3">
        <h3 className="text-base font-bold text-ink flex items-center gap-2">
          <FileText size={16} className="text-sea" />
          <span>Log Aktivitas: {selectedUser.name}</span>
        </h3>
        <button onClick={() => setShowLogsModal(false)} className="text-ink-muted hover:text-ink-soft">
          <X size={18} />
        </button>
      </div>

      {/* Tab */}
      <div className="flex items-center gap-1 px-5 pt-3 border-b border-line">
        {([
          ['messages', 'Pesan', MessageSquare],
          ['sessions', 'Sesi', Smartphone],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setLogsTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
              logsTab === key
                ? 'border-sea text-sea'
                : 'border-transparent text-ink-muted hover:text-ink-soft'
            }`}
          >
            <Icon size={13} />
            <span>{label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt text-ink-muted">
              {key === 'messages' ? logsData?.messages?.length ?? 0 : logsData?.sessions?.length ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {logsLoading ? (
          <p className="py-10 text-center text-xs text-ink-faint">Memuat log aktivitas...</p>
        ) : !logsData ? (
          <p className="py-10 text-center text-xs text-ink-faint">Tidak ada data.</p>
        ) : logsTab === 'messages' ? (
          logsData.messages.length === 0 ? (
            <p className="py-10 text-center text-xs text-ink-faint">Belum ada pesan untuk pengguna ini.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-ink-soft min-w-[640px]">
                <thead className="bg-surface-sunken/60 uppercase tracking-wider text-ink-muted border-b border-line font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Tujuan</th>
                    <th className="py-2.5 px-3">Isi</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Waktu</th>
                    <th className="py-2.5 px-3 text-right">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {logsData.messages.map((m: any) => (
                    <tr key={m.id} className="hover:bg-surface-sunken/40">
                      <td className="py-2.5 px-3 font-mono text-[11px]">{m.to}</td>
                      <td className="py-2.5 px-3 max-w-[240px] truncate">
                        {m.text || m.caption || (m.mediaType ? `[${m.mediaType}]` : '—')}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1">
                          {m.status === 'failed' ? (
                            <XCircle size={12} className="text-clay" />
                          ) : m.status === 'queued' ? (
                            <Clock size={12} className="text-honey" />
                          ) : (
                            <CheckCircle2 size={12} className="text-sea" />
                          )}
                          {LABEL_STATUS_PESAN[m.status] || m.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-ink-muted whitespace-nowrap">{fmtWaktu(m.timestamp)}</td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => setSelectedMsg(m)}
                          className="inline-flex items-center gap-1 text-sea hover:text-sea-deep"
                        >
                          <Eye size={12} />
                          <span>Lihat</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : logsData.sessions.length === 0 ? (
          <p className="py-10 text-center text-xs text-ink-faint">Belum ada sesi untuk pengguna ini.</p>
        ) : (
          <div className="space-y-2.5">
            {logsData.sessions.map((s: any) => (
              <div key={s.id} className="bg-surface-sunken/50 border border-line rounded-md p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{s.name}</p>
                    <p className="text-[11px] text-ink-muted font-mono">{s.phone || '—'}</p>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded border ${
                    s.status === 'connected'
                      ? 'bg-sea-wash/60 text-sea border-sea-line'
                      : 'bg-surface-alt text-ink-muted border-line'
                  }`}>
                    {s.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-[11px]">
                  <div>
                    <p className="text-ink-muted">Terkirim hari ini</p>
                    <p className="text-ink font-semibold">{s.messagesSentToday ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-ink-muted">Delivery rate</p>
                    <p className="text-ink font-semibold">{s.deliveryRate ?? 0}%</p>
                  </div>
                  <div>
                    <p className="text-ink-muted">Risk score</p>
                    <p className="text-ink font-semibold">{s.riskScore ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-ink-muted">Warmup hari</p>
                    <p className="text-ink font-semibold">{s.warmupDay ?? 0}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end p-5 pt-3 border-t border-line">
        <button
          onClick={() => setShowLogsModal(false)}
          className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink-soft bg-surface-alt rounded-lg transition-colors"
        >
          Tutup
        </button>
      </div>
    </div>
  </div>
)}

{/* MODAL: DETAIL PESAN */}
{selectedMsg && (
  <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-ink/80 backdrop-blur-sm animate-in fade-in duration-150">
    <div className="bg-surface border border-line rounded-md w-full max-w-lg max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between border-b border-line p-5 pb-3">
        <h3 className="text-base font-bold text-ink flex items-center gap-2">
          <MessageSquare size={16} className="text-sea" />
          <span>Detail Pesan</span>
        </h3>
        <button onClick={() => setSelectedMsg(null)} className="text-ink-muted hover:text-ink-soft">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {([
          ['ID', selectedMsg.id],
          ['Sesi', selectedMsg.sessionId],
          ['Tujuan', selectedMsg.to],
          ['Status', LABEL_STATUS_PESAN[selectedMsg.status] || selectedMsg.status],
          ['Waktu', fmtWaktu(selectedMsg.timestamp)],
          ['Prioritas', selectedMsg.priority || 'normal'],
          ['ID pesan WhatsApp', selectedMsg.waMessageId],
          ['Media', selectedMsg.mediaType ? `${selectedMsg.mediaType}${selectedMsg.mediaMimeType ? ` (${selectedMsg.mediaMimeType})` : ''}` : null],
          ['Berkas', selectedMsg.fileName],
          ['Detail error', selectedMsg.errorDetail],
        ] as const).map(([label, value]) =>
          value ? (
            <div key={label} className="grid grid-cols-[130px_1fr] gap-3 text-xs">
              <span className="text-ink-muted">{label}</span>
              <span className="text-ink-soft break-all">{String(value)}</span>
            </div>
          ) : null
        )}

        {(selectedMsg.text || selectedMsg.caption) && (
          <div className="pt-2 border-t border-line">
            <p className="text-xs text-ink-muted mb-1.5">Isi pesan</p>
            <p className="text-xs text-ink-soft whitespace-pre-wrap bg-surface-sunken border border-line rounded-md p-3">
              {selectedMsg.text || selectedMsg.caption}
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end p-5 pt-3 border-t border-line">
        <button
          onClick={() => setSelectedMsg(null)}
          className="px-4 py-2 text-xs font-semibold text-ink-muted hover:text-ink-soft bg-surface-alt rounded-lg transition-colors"
        >
          Tutup
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
