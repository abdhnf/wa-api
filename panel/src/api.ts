// Client API terpusat untuk panel frontend

const API_BASE = (import.meta as any).env?.VITE_API_BASE || (
  typeof window !== 'undefined'
    ? (window.location.port === '5174'
        ? `${window.location.protocol}//${window.location.hostname}:3100/api/v1`
        : `${window.location.origin}/api/v1`)
    : 'http://127.0.0.1:3100/api/v1'
);

export function getStoredToken(): string | null {
  return localStorage.getItem('wa_token');
}

export function getStoredUser(): any | null {
  const u = localStorage.getItem('wa_user');
  try {
    return u ? JSON.parse(u) : null;
  } catch {
    return null;
  }
}

export function getStoredAuth(): { token: string | null; user: any | null } {
  return {
    token: getStoredToken(),
    user: getStoredUser(),
  };
}

export function saveAuth(token: string, user: any): void {
  localStorage.setItem('wa_token', token);
  localStorage.setItem('wa_user', JSON.stringify(user));
  if (user?.apiKey) {
    localStorage.setItem('wa_api_key', user.apiKey);
  }
}

export function clearAuth(): void {
  localStorage.removeItem('wa_token');
  localStorage.removeItem('wa_user');
  localStorage.removeItem('wa_api_key');
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const token = getStoredToken();
  const apiKey = localStorage.getItem('wa_api_key');

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (apiKey && !headers['X-API-Key']) {
    headers['X-API-Key'] = apiKey;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const errMsg = body.error || `Request failed: ${res.status}`;
    // Jika 401 token expired dan ini bukan request login, auto-clean auth
    if (res.status === 401 && !path.startsWith('/auth/')) {
      clearAuth();
      // Dispatch custom event agar app redirect ke login tanpa reload paksa
      window.dispatchEvent(new CustomEvent('wa_unauthorized', { detail: errMsg }));
    }
    throw new Error(errMsg);
  }

  return res.json();
}

// ---------- Auth ----------
export async function apiLogin(email: string, password: string, turnstileToken?: string) {
  const res = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, turnstileToken }),
  });
  if (res?.token) saveAuth(res.token, res.user);
  return res;
}

export async function apiRegister(name: string, email: string, password: string) {
  const res = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
  if (res?.token) saveAuth(res.token, res.user);
  return res;
}

// ---------- Sessions ----------
export async function apiGetSessions(): Promise<any[]> {
  const res = await request('/sessions');
  if (Array.isArray(res)) return res;
  if (Array.isArray((res as any)?.sessions)) return (res as any).sessions;
  return [];
}

export async function apiGetSession(id: string) {
  const res: any = await request(`/sessions/${id}`);
  return res?.session ?? res;
}

export async function apiCreateSession(name: string, phone?: string) {
  return request('/sessions', {
    method: 'POST',
    body: JSON.stringify({ name, phone }),
  });
}

export async function apiStartPairing(sessionId: string, name?: string) {
  return request(`/sessions/${sessionId}/pair`, {
    method: 'POST',
    body: JSON.stringify({ name: name || sessionId }),
  });
}

export async function apiRenameSession(id: string, name: string) {
  return request(`/sessions/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export async function apiLogoutSession(id: string) {
  return request(`/sessions/${id}/logout`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function apiReconnectSession(id: string) {
  return request(`/sessions/${id}/reconnect`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function apiRepairSession(id: string, name?: string, phone?: string) {
  return request(`/sessions/${id}/pair`, {
    method: 'POST',
    body: JSON.stringify({ name, phone }),
  });
}

export async function apiDeleteSession(id: string) {
  return request(`/sessions/${id}`, {
    method: 'DELETE',
  });
}

export async function apiGetQr(id: string) {
  return request(`/sessions/${id}/qr`);
}

export const apiGetSessionQr = apiGetQr;

// ---------- Users ----------
export async function apiGetUsers(): Promise<any[]> {
  const res = await request('/users');
  if (Array.isArray(res)) return res;
  if (Array.isArray((res as any)?.users)) return (res as any).users;
  return [];
}

export async function apiCreateUser(payload: { name: string; email: string; password: string; role: string; quotaPerDay: number; assignedSessionId?: string }) {
  return request('/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiUpdateUser(id: string, patch: any) {
  return request(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function apiDeleteUser(id: string) {
  return request(`/users/${id}`, {
    method: 'DELETE',
  });
}

export async function apiResetPassword(id: string, password: string) {
  return request(`/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function apiRotateApiKey(userId?: string) {
  const id = userId || getStoredUser()?.id;
  return request(`/users/${id}/rotate-key`, {
    method: 'POST',
  });
}


export async function apiGetUserLogs(userId: string): Promise<{ user: any; sessions: any[]; messages: any[] }> {
  return request(`/admin/users/${userId}/logs`);
}

// ---------- Messages ----------
export async function apiSendMessage(payload: { sessionId: string; to: string; text: string; priority?: 'high' | 'normal' }) {
  return request('/messages/send', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiSendMedia(payload: {
  sessionId: string;
  to: string;
  mediaType: 'image' | 'document' | 'audio' | 'video';
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimeType?: string;
  fileName?: string;
  caption?: string;
  priority?: 'high' | 'normal';
}) {
  return request('/messages/send-media', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiSendLocation(payload: {
  sessionId: string;
  to: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}) {
  return request('/messages/send-location', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiSendBulk(payload: { sessionId: string; recipients: string[]; text: string; priority?: 'high' | 'normal' }) {
  return request('/messages/send-bulk', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function apiGetQueueStatus(sessionId: string) {
  return request('/sessions/' + sessionId + '/queue/status');
}

export async function apiPauseQueue(sessionId: string, reason?: string) {
  return request('/sessions/' + sessionId + '/queue/pause', {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function apiResumeQueue(sessionId: string) {
  return request('/sessions/' + sessionId + '/queue/resume', {
    method: 'POST',
  });
}

export async function apiGetSessionMessages(sessionId: string) {
  return request(`/messages/${sessionId}`);
}

export async function apiGetMessageStatus(messageId: string) {
  return request(`/messages/status/${messageId}`);
}

export async function apiGetBulkStatus(batchId: string) {
  return request(`/messages/status/bulk/${batchId}`);
}

export async function apiGetAntiBan(sessionId: string) {
  return request(`/sessions/${sessionId}/antiban`);
}

export async function apiGetAuthConfig() {
  return request('/auth/config');
}

export async function apiLoginGoogle(data: { credential?: string; email?: string; name?: string; googleId?: string; avatarUrl?: string }) {
  const res = await request('/auth/google', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (res?.token) saveAuth(res.token, res.user);
  return res;
}

export async function apiGetSettings() {
  return request('/settings');
}

export async function apiUpdateSettings(settings: {
  googleAuthEnabled?: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  registrationEnabled?: boolean;
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  googleAllowedDomains?: string;
}) {
  return request('/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

export async function apiGetAutoRotateSettings() {
  return request('/autorotate/settings');
}

export async function apiUpdateAutoRotateSettings(payload: {
  enabled?: boolean;
  strategy?: 'least_loaded' | 'round_robin' | 'warmup_priority';
  rotateOnLimit?: boolean;
  rotateOnDisconnect?: boolean;
  rotateOn463?: boolean;
  stickySession?: boolean;
  poolSessions?: string[];
}) {
  return request('/autorotate/settings', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function apiGetAutoRotateStatus() {
  return request('/autorotate/status');
}

export async function apiGetApiLogs(params?: { page?: number; limit?: number; status?: string; userId?: string }) {
  const q = new URLSearchParams();
  if (params?.page) q.append('page', String(params.page));
  if (params?.limit) q.append('limit', String(params.limit));
  if (params?.status && params.status !== 'all') q.append('status', params.status);
  if (params?.userId) q.append('userId', params.userId);
  const qs = q.toString();
  return request('/api-logs' + (qs ? '?' + qs : ''));
}

export async function apiDeleteApiLogs(ids: string[]) {
  return request('/api-logs', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
}

export async function apiClearApiLogs(olderThanDays?: number, all?: boolean) {
  return request('/api-logs/clear', {
    method: 'POST',
    body: JSON.stringify({ olderThanDays, all }),
  });
}

export async function apiGetMyProfile() {
  const data = await request('/auth/me');
  if (data && data.apiKey) {
    localStorage.setItem('wa_api_key', data.apiKey);
    const existing = getStoredUser() || {};
    localStorage.setItem('wa_user', JSON.stringify({ ...existing, ...data }));
  }
  return data;
}

export async function apiRotateMyKey() {
  const data = await request('/auth/rotate-key', { method: 'POST' });
  if (data && data.apiKey) {
    localStorage.setItem('wa_api_key', data.apiKey);
    const existing = getStoredUser() || {};
    localStorage.setItem('wa_user', JSON.stringify({ ...existing, apiKey: data.apiKey }));
  }
  return data;
}
