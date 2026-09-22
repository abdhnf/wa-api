import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Smartphone, Users, MessageSquare, BookOpen,
  Activity, LogOut, Menu, X, ShieldAlert, KeyRound,
  Settings, ScrollText, ChevronDown, Shield, Send,
  PanelLeftClose, PanelLeft
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
import { ThemeToggle } from './components/ThemeToggle';
import { getStoredAuth, clearAuth, apiGetMyProfile, apiGetUsers, apiRotateApiKey } from './api';
import { type User, EMPTY_USERS } from './dummyData';

const emptyForm = { name: '', email: '', password: '', role: 'user', quotaPerDay: 100, status: 'active', assignedSessionId: '' };

type TabId = 'monitor' | 'playground' | 'sessions' | 'logs' | 'users' | 'docs' | 'settings';

// Sidebar needs no separate short labels: every label fits the 224px rail.
const coreNavItems: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'playground', label: 'Playground', icon: MessageSquare },
  { id: 'monitor', label: 'Monitor & Queue', icon: Activity },
  { id: 'sessions', label: 'Sessions', icon: Smartphone },
  { id: 'logs', label: 'API Logs', icon: ScrollText },
  { id: 'docs', label: 'Docs', icon: BookOpen },
];

const adminNavItems: { id: TabId; label: string; desc: string; icon: React.ElementType }[] = [
  { id: 'users', label: 'Users & API Keys', desc: 'Akun, hak akses, limit kuota', icon: Users },
  { id: 'settings', label: 'System Settings', desc: 'Turnstile, Google OAuth, security', icon: Settings },
];

export const App: React.FC = () => {
  const [auth, setAuth] = useState(getStoredAuth());
  const [activeTab, setActiveTab] = useState<TabId>('playground');
  const [users, setUsers] = useState<User[]>(EMPTY_USERS);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('wa_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('wa_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [blastModalOpen, setBlastModalOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const adminMenuRef = useRef<HTMLDivElement>(null);

  const isAdmin = auth.user?.role === 'admin';
  const currentUser = auth.user;

  useEffect(() => {
    apiGetMyProfile().then(p => {
      if (p) setAuth(getStoredAuth());
    }).catch(() => {});
  }, []);

  // Menutup menu admin saat klik di luar area menu.
  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (adminMenuRef.current && !adminMenuRef.current.contains(event.target as Node)) {
        setAdminMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Drawer ditutup setiap kali berpindah tab, dan bisa ditutup dengan Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

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

  useEffect(() => {
    fetchUsers();
    const iv = setInterval(fetchUsers, 10000);
    return () => clearInterval(iv);
  }, [fetchUsers]);

  // User non-admin tidak boleh berada di tab Users atau Settings.
  useEffect(() => {
    if (!isAdmin && (activeTab === 'users' || activeTab === 'settings')) {
      setActiveTab('playground');
    }
  }, [isAdmin, activeTab]);

  const handleSwitchTab = (tab: TabId) => {
    setAdminMenuOpen(false);
    setDrawerOpen(false);
    setActiveTab(tab);
  };

  const handleLogout = () => {
    clearAuth();
    setAuth({ token: null, user: null });
  };

  if (!auth.token || !auth.user) {
    return (
      <AuthPage
        onLoginSuccess={() => {
          setAuth(getStoredAuth());
          // Segarkan profil dari server setelah login. Response login tidak
          // memuat seluruh field akun, dan `apiGetMyProfile()` juga menulis
          // ulang `wa_user` di localStorage — tanpa ini modal Blast membaca
          // status PIN yang basi dan menampilkan form "Belum Mengatur PIN"
          // padahal PIN-nya sudah ada (berujung menimpa PIN lama).
          apiGetMyProfile()
            .then((p) => {
              if (p && !p.error) setAuth(getStoredAuth());
            })
            .catch(() => {});
        }}
      />
    );
  }

  const navButton = (
    item: { id: TabId; label: string; icon: React.ElementType },
    onPick: (t: TabId) => void,
    isCollapsed = false
  ) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onPick(item.id)}
        aria-current={isActive ? 'page' : undefined}
        title={isCollapsed ? item.label : undefined}
        className={`wa-nav-item wa-tap ${isCollapsed ? 'justify-center px-0 w-10 h-10 mx-auto' : ''} ${
          isActive ? 'wa-nav-item-active' : ''
        }`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {!isCollapsed && <span className="truncate">{item.label}</span>}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-shell text-ink">
      {toast && (
        <div
          role="status"
          className={`fixed bottom-20 lg:bottom-6 right-4 z-50 px-3.5 py-2.5 text-xs wa-alert ${
            toast.type === 'success' ? 'wa-alert-success' : 'wa-alert-danger'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Sticky top header: identity, account, and every cross-page action */}
      <header className="wa-header sticky top-0 z-40">
        <div className="h-14 px-3 lg:px-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Desktop only toggle sidebar: memperluas/menyembunyikan sidebar menjadi icon saja */}
            <button
              type="button"
              onClick={toggleSidebar}
              className="wa-control wa-control-secondary wa-tap w-9 h-9 px-0 items-center justify-center !hidden lg:!inline-flex"
              aria-label={sidebarCollapsed ? "Perluas sidebar" : "Ciutkan sidebar jadi ikon"}
              title={sidebarCollapsed ? "Perluas sidebar" : "Ciutkan sidebar jadi ikon"}
            >
              {sidebarCollapsed ? <PanelLeft className="w-4 h-4 text-ink-muted" /> : <PanelLeftClose className="w-4 h-4 text-ink-muted" />}
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <span className="grid place-items-center w-8 h-8 rounded-md bg-pine text-surface font-bold text-xs shrink-0">
                WA
              </span>
              <span className="font-bold text-sm text-ink truncate">WA Gateway</span>
              <span className="wa-badge wa-badge-brand font-mono">v7</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setApiKeyModalOpen(true)}
              className="wa-control wa-control-secondary wa-tap h-9 px-2.5 text-xs"
              title="Lihat API key dan kuota akun"
            >
              <KeyRound className="w-4 h-4 text-pine" />
              <span className="hidden sm:inline">API Key</span>
            </button>

            <button
              type="button"
              onClick={() => setBlastModalOpen(true)}
              className="wa-control wa-control-secondary wa-tap h-9 px-2.5 text-xs"
              title="Akses WhatsApp Blast Dashboard"
            >
              <Send className="w-4 h-4 text-sea" />
              <span className="hidden sm:inline">Blast App</span>
            </button>

            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-3.5rem)]">
        {/* Fixed sidebar (lg and up): dapat diringkas menjadi icon saja */}
        <aside
          className={`wa-sidebar hidden lg:flex lg:flex-col shrink-0 sticky top-14 self-start h-[calc(100vh-3.5rem)] py-3 transition-all duration-200 ${
            sidebarCollapsed ? 'w-14 px-1' : 'w-56 px-2'
          }`}
        >
          <nav className="flex flex-col gap-0.5 w-full" aria-label="Navigasi utama">
            {!sidebarCollapsed && <div className="wa-nav-group-label pb-1 px-1">Gateway</div>}
            {coreNavItems.map(item => navButton(item, handleSwitchTab, sidebarCollapsed))}
          </nav>

          {isAdmin && (
            <div className={`mt-4 w-full relative ${sidebarCollapsed ? 'px-0' : 'px-1'}`} ref={adminMenuRef}>
              {!sidebarCollapsed && <div className="wa-nav-group-label pb-1 px-1">Administrasi</div>}
              {sidebarCollapsed ? (
                <div className="flex flex-col gap-1 w-full items-center">
                  {adminNavItems.map(aItem => {
                    const AIcon = aItem.icon;
                    const isActive = activeTab === aItem.id;
                    return (
                      <button
                        key={aItem.id}
                        type="button"
                        onClick={() => handleSwitchTab(aItem.id)}
                        aria-current={isActive ? 'page' : undefined}
                        title={aItem.label}
                        className={`wa-nav-item wa-tap justify-center px-0 w-10 h-10 ${
                          isActive ? 'wa-nav-item-active' : ''
                        }`}
                      >
                        <AIcon className="w-4 h-4 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setAdminMenuOpen(!adminMenuOpen)}
                    aria-expanded={adminMenuOpen}
                    className="wa-nav-item wa-tap"
                  >
                    <Shield className="w-4 h-4 shrink-0" />
                    <span className="truncate">Admin</span>
                    <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform ${adminMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {adminMenuOpen && (
                    <div className="mt-1 space-y-1 pl-3 border-l border-line">
                      {adminNavItems.map(aItem => {
                        const AIcon = aItem.icon;
                        const isActive = activeTab === aItem.id;
                        return (
                          <button
                            key={aItem.id}
                            type="button"
                            onClick={() => handleSwitchTab(aItem.id)}
                            aria-current={isActive ? 'page' : undefined}
                            className={`wa-nav-item wa-tap ${isActive ? 'wa-nav-item-active' : ''}`}
                          >
                            <AIcon className="w-4 h-4 shrink-0" />
                            <span className="min-w-0">
                              <span className="block truncate">{aItem.label}</span>
                              <span className="block text-[11px] font-normal text-ink-faint truncate">{aItem.desc}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* User info + Logout action di sidebar paling bawah (selaras dengan wa-blast-dashboard) */}
          <div className="mt-auto w-full pt-3 border-t border-line">
            {sidebarCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <div
                  className="w-10 h-10 rounded-md bg-pine-wash text-pine-deep font-bold text-xs flex items-center justify-center border border-pine-line cursor-default"
                  title={`Akun: ${currentUser.name} (${currentUser.role}) - ${currentUser.email}`}
                >
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-10 h-10 rounded-md flex items-center justify-center text-clay hover:bg-clay-wash hover:text-clay-deep border border-transparent hover:border-clay-line transition-colors cursor-pointer"
                  title="Keluar dari akun"
                  aria-label="Keluar dari akun"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-surface-sunken border border-line flex items-center gap-2">
                <div className="grid place-items-center w-8 h-8 rounded-md bg-pine-wash text-pine-deep font-bold text-xs shrink-0 border border-pine-line">
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-ink truncate leading-tight">
                    {currentUser.name}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <span className={`wa-badge capitalize text-[10px] !py-0 !px-1.5 ${
                      isAdmin
                        ? 'wa-badge-admin'
                        : currentUser.role === 'subscription'
                          ? 'wa-badge-warning'
                          : 'wa-badge-neutral'
                    }`}>
                      {currentUser.role}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="p-1.5 rounded-md text-clay hover:bg-clay-wash hover:text-clay-deep transition-colors shrink-0 cursor-pointer"
                  title="Keluar dari akun"
                  aria-label="Keluar dari akun"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </aside>

        <main key={activeTab} className="flex-1 min-w-0 px-3 sm:px-5 lg:px-6 py-4 lg:py-6 pb-24 lg:pb-6 wa-page-transition">
          {activeTab === 'playground' && <Playground />}
          {activeTab === 'monitor' && <RealtimeMonitor isAdmin={isAdmin} />}
          {activeTab === 'sessions' && <SessionsPage />}
          {activeTab === 'logs' && <ApiLogsPage isAdmin={isAdmin} showToast={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')} />}
          {activeTab === 'docs' && <Docs />}
          {activeTab === 'settings' && isAdmin && <SettingsPage />}
          {activeTab === 'users' && isAdmin && <UsersPage onNotify={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')} />}

          {(activeTab === 'users' || activeTab === 'settings') && !isAdmin && (
            <div className="wa-alert wa-alert-danger flex-col items-start gap-1.5">
              <ShieldAlert className="w-5 h-5" />
              <span className="font-semibold">Akses terbatas</span>
              <span>Halaman ini hanya untuk administrator gateway.</span>
            </div>
          )}
        </main>
      </div>

      <ApiKeyModal
        isOpen={apiKeyModalOpen}
        onClose={() => setApiKeyModalOpen(false)}
        user={auth.user}
        onKeyRotated={() => {
          setAuth(getStoredAuth());
          showToast('API key akun diperbarui', 'success');
        }}
        onOpenDocs={() => setActiveTab('docs')}
      />

      <BlastAccessModal
        isOpen={blastModalOpen}
        onClose={() => setBlastModalOpen(false)}
        user={auth.user}
        onUserUpdated={() => {
          apiGetMyProfile().then(p => {
            if (p && !p.error) setAuth(getStoredAuth());
          });
        }}
      />

      {/* Mobile bottom navigation: primary destinations plus the full drawer */}
      <nav className="wa-bottomnav lg:hidden fixed bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom)]" aria-label="Navigasi mobile">
        <div className="flex items-stretch justify-around max-w-lg mx-auto px-1">
          {coreNavItems.slice(0, 4).map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSwitchTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="w-5 h-5" />
                <span className="truncate max-w-[64px]">{item.label.split(' ')[0]}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls="wa-mobile-drawer"
            className={activeTab === 'docs' || activeTab === 'settings' || activeTab === 'users' ? 'text-pine-deep' : undefined}
          >
            <Menu className="w-5 h-5" />
            <span>Menu</span>
          </button>
        </div>
      </nav>

      {/* Mobile bottom sheet drawer: slide up dari bawah untuk kontrol penuh navigasi & akun */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-ink/60 backdrop-blur-xs wa-backdrop-fade"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div
            id="wa-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Menu navigasi mobile"
            className="relative z-10 w-full max-h-[85vh] bg-surface rounded-t-2xl border-t border-line shadow-2xl flex flex-col wa-scroll-y wa-drawer-bottom"
          >
            {/* Grab handle indicator */}
            <div className="pt-2.5 pb-1 flex justify-center">
              <div className="w-10 h-1.5 rounded-full bg-line-strong/60" />
            </div>

            <div className="flex items-center justify-between px-4 py-2 border-b border-line">
              <span className="font-bold text-sm text-ink">Menu Navigasi</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="wa-control wa-control-secondary w-8 h-8 px-0"
                aria-label="Tutup menu navigasi"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 border-b border-line bg-surface-sunken/60">
              <div className="flex items-center gap-3">
                <span className="grid place-items-center w-10 h-10 rounded-lg bg-pine-wash text-pine-deep font-bold text-sm shrink-0">
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-ink truncate">{currentUser.name}</span>
                    <span className={`wa-badge ${
                      isAdmin
                        ? 'wa-badge-admin'
                        : currentUser.role === 'subscription'
                          ? 'wa-badge-warning'
                          : 'wa-badge-neutral'
                    }`}>
                      {currentUser.role}
                    </span>
                  </div>
                  <span className="block text-[11px] text-ink-muted truncate">{currentUser.email}</span>
                </div>
              </div>
            </div>

            <nav className="p-3 flex flex-col gap-1" aria-label="Navigasi utama mobile">
              <div className="wa-nav-group-label pb-1 px-1">Aksi Cepat</div>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  setApiKeyModalOpen(true);
                }}
                className="wa-nav-item wa-tap !justify-start w-full"
              >
                <KeyRound className="w-4 h-4 shrink-0 text-pine" />
                <span className="truncate">API Key & Kuota Akun</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  setBlastModalOpen(true);
                }}
                className="wa-nav-item wa-tap !justify-start w-full"
              >
                <Send className="w-4 h-4 shrink-0 text-sea" />
                <span className="truncate">Akses WhatsApp Blast</span>
              </button>

              <div className="wa-nav-group-label pb-1 px-1 pt-2">Menu Utama</div>
              {coreNavItems.map(item => navButton(item, handleSwitchTab))}
            </nav>

            {isAdmin && (
              <div className="px-3 pb-3 flex flex-col gap-1 border-t border-line pt-2">
                <div className="wa-nav-group-label pb-1 px-1">Administrasi</div>
                {adminNavItems.map(aItem => {
                  const AIcon = aItem.icon;
                  const isActive = activeTab === aItem.id;
                  return (
                    <button
                      key={aItem.id}
                      type="button"
                      onClick={() => handleSwitchTab(aItem.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`wa-nav-item wa-tap ${isActive ? 'wa-nav-item-active' : ''}`}
                    >
                      <AIcon className="w-4 h-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate">{aItem.label}</span>
                        <span className="block text-[11px] font-normal text-ink-faint truncate">{aItem.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="p-3 border-t border-line">
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  handleLogout();
                }}
                className="wa-control wa-control-secondary w-full justify-center text-clay gap-2 h-10 text-xs font-medium"
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
