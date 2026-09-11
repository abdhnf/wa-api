import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Smartphone, Users, MessageSquare, BookOpen, 
  Activity, LogOut, Menu, X, ShieldAlert, Plus, Pencil, Trash2, KeyRound, Loader2, ShieldCheck, Settings, ScrollText,
  ChevronDown, MoreHorizontal, Shield, Sparkles, ExternalLink, Send
} from 'lucide-react';
import { Playground } from './components/Playground';
import { Docs } from './components/Docs';
import { ApiLogsPage } from './components/ApiLogsPage';
import { RealtimeMonitor } from './components/RealtimeMonitor';
import { AuthPage } from './components/AuthPage';
import { SessionsPage } from './components/SessionsPage';
import { SettingsPage } from './components/SettingsPage';
import { UsersPage } from './components/UsersPage';
import { ApiKeyModal } from './components/ApiKeyModal';
import { BlastAccessModal } from './components/BlastAccessModal';
import { getStoredAuth, clearAuth, apiGetMyProfile, apiGetUsers, apiRotateApiKey, apiCreateUser, apiUpdateUser, apiDeleteUser, apiResetPassword } from './api';
import { type User, EMPTY_USERS } from './dummyData';

const emptyForm = { name: '', email: '', password: '', role: 'user', quotaPerDay: 100, status: 'active', assignedSessionId: '' };

export const App: React.FC = () => {
  const [auth, setAuth] = useState(getStoredAuth());
  const [activeTab, setActiveTab] = useState<'monitor' | 'playground' | 'sessions' | 'logs' | 'users' | 'docs' | 'settings'>('playground');
  const [isNavigating, setIsNavigating] = useState(false);
  const [navProgress, setNavProgress] = useState(0);
  const [users, setUsers] = useState<User[]>(EMPTY_USERS);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [blastModalOpen, setBlastModalOpen] = useState(false);

  useEffect(() => {
    apiGetMyProfile().then(p => {
      if (p) {
        setAuth(getStoredAuth());
      }
    }).catch(() => {});
  }, []);
  const [adminDropdownOpen, setAdminDropdownOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [userModal, setUserModal] = useState<{ open: boolean; mode: 'create' | 'edit' | 'reset'; target?: User; form: typeof emptyForm }>({
    open: false,
    mode: 'create',
    form: emptyForm,
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);

  const adminDropdownRef = useRef<HTMLDivElement>(null);

  const isAdmin = auth.user?.role === 'admin';
  const isAdminTabActive = activeTab === 'users' || activeTab === 'settings';

  // Tutup dropdown saat klik di luar
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (adminDropdownRef.current && !adminDropdownRef.current.contains(event.target as Node)) {
        setAdminDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSwitchTab = (tab: 'monitor' | 'playground' | 'sessions' | 'logs' | 'users' | 'docs' | 'settings') => {
    if (tab === activeTab) {
      setAdminDropdownOpen(false);
      setMobileMenuOpen(false);
      return;
    }
    setIsNavigating(true);
    setNavProgress(25);
    setAdminDropdownOpen(false);
    setMobileMenuOpen(false);
    setTimeout(() => setNavProgress(70), 80);
    setTimeout(() => {
      setActiveTab(tab);
      setNavProgress(100);
      setTimeout(() => {
        setIsNavigating(false);
        setNavProgress(0);
      }, 200);
    }, 150);
  };

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const realUsers: any[] = await apiGetUsers();
      if (Array.isArray(realUsers)) {
        setUsers(realUsers.map((u: any) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          apiKey: u.apiKey || 'wa_key_hidden',
          quotaPerDay: u.quotaPerDay || 100,
          usedToday: u.usedToday || 0,
          status: u.status || 'active',
          role: u.role || 'user',
          assignedSessionId: u.assignedSessionId || null,
        })));
      }
    } catch { /* backend offline */ }
  }, [isAdmin]);

  // Fetch users saat mount + auto-refresh 10s (admin only)
  useEffect(() => {
    fetchUsers();
    const iv = setInterval(fetchUsers, 10000);
    return () => clearInterval(iv);
  }, [fetchUsers]);

  // User non-admin tidak bisa buka tab Users atau Settings (role permission)
  useEffect(() => {
    if (!isAdmin && (activeTab === 'users' || activeTab === 'settings')) {
      setActiveTab('playground');
    }
  }, [isAdmin, activeTab]);

  // Jika belum login, tampilkan AuthPage
  if (!auth.token || !auth.user) {
    return (
      <AuthPage
        onLoginSuccess={() => {
          setAuth(getStoredAuth());
        }}
      />
    );
  }

  const currentUser = auth.user;

  const handleLogout = () => {
    clearAuth();
    setAuth({ token: null, user: null });
  };

  const handleRotateKey = async (userId: string) => {
    setRotatingId(userId);
    try {
      const res = await apiRotateApiKey(userId);
      if (res?.apiKey) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, apiKey: res.apiKey } : u));
        showToast('API key berhasil dirotasi!', 'success');
      } else {
        showToast(res?.error || 'Gagal rotasi API key', 'error');
      }
    } catch (e: any) {
      showToast(`Gagal: ${e.message}`, 'error');
    } finally {
      setRotatingId(null);
    }
  };

  const handleToggleStatus = async (u: User) => {
    const next = u.status === 'active' ? 'suspended' : 'active';
    try {
      await apiUpdateUser(u.id, { status: next });
      showToast(`User ${next === 'active' ? 'diaktifkan' : 'di-suspend'}`, 'success');
      fetchUsers();
    } catch (e: any) {
      showToast(`Gagal: ${e.message}`, 'error');
    }
  };

  // Navigasi Inti (Semua User)
  const coreNavItems = [
    { id: 'playground' as const, label: 'Playground', shortLabel: 'Play', icon: MessageSquare },
    { id: 'monitor' as const, label: 'Monitor & Queue', shortLabel: 'Monitor', icon: Activity },
    { id: 'sessions' as const, label: 'Sessions', shortLabel: 'Sessions', icon: Smartphone },
    { id: 'logs' as const, label: 'API Logs', shortLabel: 'Logs', icon: ScrollText },
    { id: 'docs' as const, label: 'Docs', shortLabel: 'Docs', icon: BookOpen },
  ];

  // Navigasi Admin
  const adminNavItems = [
    { id: 'users' as const, label: 'Users & API Keys', desc: 'Kelola akun, hak akses & limit kuota', icon: Users },
    { id: 'settings' as const, label: 'System Settings', desc: 'Turnstile, Google OAuth & Security', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans selection:bg-emerald-500/30">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-20 sm:bottom-5 right-5 z-[100] px-4 py-3 rounded-2xl shadow-2xl text-sm font-semibold animate-in slide-in-from-bottom-4 fade-in duration-200 ${
          toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Top Navbar Header */}
      <header className="border-b border-gray-800/80 bg-gray-900/90 backdrop-blur-md sticky top-0 z-40 transition-all">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
          
          {/* Sisi Kiri: Brand & Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-lg shadow-emerald-950 font-bold text-sm text-white">
              WA
            </div>
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="font-bold text-xs sm:text-sm tracking-tight text-gray-100">
                WA Gateway
              </span>
              <span className="text-[9px] bg-emerald-950 text-emerald-400 border border-emerald-800/60 px-1.5 py-0.2 rounded-full font-mono font-medium">
                v7
              </span>
            </div>
          </div>

          {/* Sisi Tengah: Desktop Navigation Bar (Padding Compact & Responsive Label) */}
          <nav className="hidden lg:flex items-center gap-0.5 bg-gray-950/80 p-1 rounded-2xl border border-gray-800/80 shadow-xs shrink-0">
            {coreNavItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSwitchTab(item.id)}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900/90'
                  }`}
                  title={item.label}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="hidden xl:inline">{item.label}</span>
                  <span className="xl:hidden">{item.shortLabel}</span>
                </button>
              );
            })}

            {/* Admin Dropdown Pill (Khusus Admin, Menyatukan Users & Settings) */}
            {isAdmin && (
              <div className="relative ml-0.5" ref={adminDropdownRef}>
                <button
                  onClick={() => setAdminDropdownOpen(!adminDropdownOpen)}
                  className={`flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    isAdminTabActive
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900/90'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5 text-purple-300 shrink-0" />
                  <span>Admin</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${adminDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Popover Menu Dropdown */}
                {adminDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-3 py-1.5 border-b border-gray-800/80 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                      Manajemen Sistem
                    </div>
                    {adminNavItems.map(aItem => {
                      const AIcon = aItem.icon;
                      const isSubActive = activeTab === aItem.id;
                      return (
                        <button
                          key={aItem.id}
                          onClick={() => handleSwitchTab(aItem.id)}
                          className={`w-full flex items-start gap-2.5 p-2.5 rounded-xl text-left transition cursor-pointer ${
                            isSubActive
                              ? 'bg-purple-950/50 text-purple-200 border border-purple-800/50'
                              : 'text-gray-300 hover:bg-gray-800/70 hover:text-white'
                          }`}
                        >
                          <AIcon className={`w-4 h-4 mt-0.5 shrink-0 ${isSubActive ? 'text-purple-400' : 'text-gray-400'}`} />
                          <div>
                            <div className="text-xs font-semibold">{aItem.label}</div>
                            <div className="text-[10px] text-gray-400 leading-tight mt-0.5">{aItem.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </nav>

          {/* Sisi Kanan: User Info & Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Tombol API Key Navbar */}
            <button
              onClick={() => setApiKeyModalOpen(true)}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/80 border border-emerald-800/60 text-emerald-300 text-xs font-semibold transition cursor-pointer shadow-xs"
              title="Lihat API Key & Kuota Akun"
            >
              <KeyRound className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden xl:inline">API Key</span>
            </button>

            {/* Tombol Blast Dashboard Akses */}
            <button
              onClick={() => setBlastModalOpen(true)}
              className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-blue-950/60 hover:bg-blue-900/80 border border-blue-800/60 text-blue-300 text-xs font-semibold transition cursor-pointer shadow-xs"
              title="Akses WhatsApp Blast Dashboard"
            >
              <Send className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden xl:inline">Blast App</span>
            </button>

            {/* User Profile Capsule */}
            <div 
              onClick={() => setApiKeyModalOpen(true)}
              className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-gray-950/70 border border-gray-800/70 hover:border-gray-700 cursor-pointer transition"
              title="Klik untuk melihat detail profil & API key"
            >
              <div className="w-6 h-6 rounded-lg bg-emerald-950 border border-emerald-800/60 text-emerald-400 flex items-center justify-center font-bold text-xs shrink-0">
                {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="hidden xl:flex flex-col text-left max-w-[100px] truncate">
                <span className="text-xs font-semibold text-gray-200 truncate">{currentUser.name}</span>
              </div>
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-md ${
                isAdmin 
                  ? 'bg-purple-950/80 text-purple-400 border border-purple-800/60' 
                  : currentUser.role === 'subscription'
                    ? 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                    : 'bg-blue-950/80 text-blue-400 border border-blue-800/60'
              }`}>
                {currentUser.role}
              </span>
            </div>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="p-1.5 sm:p-2 text-gray-400 hover:text-rose-400 hover:bg-gray-800/80 rounded-xl transition-colors border border-gray-800 cursor-pointer shadow-xs"
              title="Keluar / Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>

            {/* Hamburger Button (Mobile & Tablet) */}
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 sm:p-2 text-gray-300 hover:text-white hover:bg-gray-800 rounded-xl border border-gray-800 transition cursor-pointer shadow-xs"
              title="Buka Menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area: Kembalikan max-w-7xl proporsional */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3.5 sm:p-6 lg:p-8 pb-24 lg:pb-12">
        {activeTab === 'playground' && <Playground />}
        {activeTab === 'monitor' && <RealtimeMonitor isAdmin={isAdmin} />}
        {activeTab === 'sessions' && <SessionsPage />}
        {activeTab === 'logs' && <ApiLogsPage isAdmin={isAdmin} showToast={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')} />}
        {activeTab === 'docs' && <Docs />}
        {activeTab === 'settings' && isAdmin && <SettingsPage />}
        {activeTab === 'users' && isAdmin && <UsersPage onNotify={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')} />}

        {/* Non-admin notice */}
        {(activeTab === 'users' || activeTab === 'settings') && !isAdmin && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-2xl p-8 text-center animate-in fade-in">
            <ShieldAlert className="mx-auto text-red-400 mb-2" size={28} />
            <p className="text-sm text-red-300 font-semibold">Akses Terbatas</p>
            <p className="text-xs text-red-400/70 mt-1">Halaman ini khusus untuk Administrator gateway.</p>
          </div>
        )}
      </main>

      {/* Modal API Key & Kuota Pengguna */}
      <ApiKeyModal
        isOpen={apiKeyModalOpen}
        onClose={() => setApiKeyModalOpen(false)}
        user={auth.user}
        onKeyRotated={(newKey) => {
          setAuth(getStoredAuth());
          showToast('API Key Anda berhasil diperbarui!', 'success');
        }}
        onOpenDocs={() => {
          setActiveTab('docs');
        }}
      />

      {/* Modal Akses WhatsApp Blast Dashboard */}
      <BlastAccessModal
        isOpen={blastModalOpen}
        onClose={() => setBlastModalOpen(false)}
        user={auth.user}
        onUserUpdated={() => {
          apiGetMyProfile().then(p => {
            if (p && !p.error) {
              setAuth(getStoredAuth());
            }
          });
        }}
      />


      {/* Mobile Sticky Bottom Navigation Bar (Thumb-Friendly) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-gray-900/95 backdrop-blur-lg border-t border-gray-800/90 px-2 py-1.5 shadow-2xl">
        <div className="flex items-center justify-around max-w-md mx-auto">
          {coreNavItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSwitchTab(item.id)}
                className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition cursor-pointer ${
                  isActive
                    ? 'text-emerald-400 font-bold'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <div className={`p-1 rounded-lg transition ${isActive ? 'bg-emerald-950/60' : ''}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-[10px] mt-0.5 tracking-tight">{item.shortLabel}</span>
              </button>
            );
          })}

          {/* Tombol Menu Tambahan di Mobile */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className={`flex flex-col items-center justify-center py-1 px-2 rounded-xl transition cursor-pointer ${
              isAdminTabActive ? 'text-purple-400 font-bold' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <div className={`p-1 rounded-lg transition ${isAdminTabActive ? 'bg-purple-950/60' : ''}`}>
              <MoreHorizontal className="w-4 h-4" />
            </div>
            <span className="text-[10px] mt-0.5 tracking-tight">Menu</span>
          </button>
        </div>
      </div>

      {/* Mobile Slide-over Drawer / Bottom Sheet */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-in fade-in duration-150">
          {/* Backdrop */}
          <div 
            className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer Box */}
          <div className="relative w-full max-w-lg bg-gray-900 border-t sm:border border-gray-800 rounded-t-3xl sm:rounded-3xl p-5 space-y-4 shadow-2xl max-h-[85vh] overflow-y-auto z-10 animate-in slide-in-from-bottom duration-200">
            {/* Header Drawer */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-xs">
                  WA
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-100">Navigasi Panel</h3>
                  <p className="text-[10px] text-gray-400">Pilih menu fitur WhatsApp Gateway</p>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Profile Card di Drawer */}
            <div className="bg-gray-950 border border-gray-800/80 rounded-2xl p-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-800/60 text-emerald-400 flex items-center justify-center font-bold text-sm">
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <div>
                  <div className="text-xs font-bold text-gray-200">{currentUser.name}</div>
                  <div className="text-[10px] text-gray-400 font-mono">{currentUser.email}</div>
                </div>
              </div>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-lg ${
                isAdmin 
                  ? 'bg-purple-950 text-purple-400 border border-purple-800/50' 
                  : currentUser.role === 'subscription'
                    ? 'bg-amber-950 text-amber-400 border border-amber-800/50'
                    : 'bg-blue-950 text-blue-400 border border-blue-800/50'
              }`}>
                {currentUser.role}
              </span>
            </div>

            {/* Quick API Key Button di Drawer */}
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                setApiKeyModalOpen(true);
              }}
              className="w-full flex items-center justify-between p-3 bg-emerald-950/50 hover:bg-emerald-950/80 border border-emerald-800/60 rounded-2xl text-emerald-300 text-xs font-bold transition cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-4 h-4 text-emerald-400" />
                <span>API Key & Kuota Akun Saya</span>
              </div>
              <span className="text-[10px] bg-emerald-900/80 text-emerald-300 px-2 py-0.5 rounded-md font-mono border border-emerald-700/60">
                Buka
              </span>
            </button>

            {/* Grup Navigasi Utama */}
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 px-2 py-1">
                Fitur Utama Gateway
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {coreNavItems.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSwitchTab(item.id)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer text-left ${
                        isActive
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-gray-950/60 hover:bg-gray-800 text-gray-300 border border-gray-800/60'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Grup Navigasi Admin (Jika Admin) */}
            {isAdmin && (
              <div className="space-y-1 pt-2 border-t border-gray-800/80">
                <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 px-2 py-1 flex items-center gap-1.5">
                  <Shield className="w-3 h-3" />
                  <span>Administrasi Sistem (Admin)</span>
                </div>
                <div className="space-y-1.5">
                  {adminNavItems.map(item => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSwitchTab(item.id)}
                        className={`w-full flex items-start gap-3 p-2.5 rounded-xl text-xs transition cursor-pointer text-left ${
                          isActive
                            ? 'bg-purple-600 text-white shadow-sm'
                            : 'bg-gray-950/60 hover:bg-gray-800 text-gray-300 border border-gray-800/60'
                        }`}
                      >
                        <Icon className="w-4 h-4 mt-0.5 shrink-0 text-purple-400" />
                        <div>
                          <div className="font-semibold">{item.label}</div>
                          <div className="text-[10px] opacity-80 mt-0.5">{item.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tombol Logout Drawer */}
            <div className="pt-2 border-t border-gray-800">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 p-2.5 rounded-xl text-xs font-bold text-rose-400 bg-rose-950/20 hover:bg-rose-950/50 border border-rose-800/40 transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Keluar dari Akun</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
