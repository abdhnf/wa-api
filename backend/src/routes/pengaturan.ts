/**
 * Pengaturan sistem: profil pemakaian, konfigurasi umum, konfigurasi email,
 * dan auto-rotate sesi.
 *
 * Berkas ini tidak dijalankan sendiri: server.ts memanggil
 * daftarkanRutePengaturan() saat menyusun aplikasi.
 */
import { requireApiKey, requireAuth } from '../auth.js';
import { listMessagesPaged, getAllSettings, setSettings, getAllUserSettings, setUserSettings } from '../db.js';
import { simpanKonfigurasiMail, ujiKoneksiMail, kirimEmail, konfigurasiUntukKlien, PRESET_PROVIDER } from '../mailer.js';
import { templateEmailUji, templateEmailUjiTeks, BRAND } from '../mail-templates.js';
import { manager } from './konteks.js';
import type { FastifyInstance } from 'fastify';

export function daftarkanRutePengaturan(app: FastifyInstance): void {
  // ============ Usage & Health ============
  // Catatan: quotaPerDay/usedToday dipertahankan untuk kompatibilitas panel lama.
  // Kuota otoritatif sekarang berbasis periode (quotaLimit/usedInPeriod/quotaPeriod),
  // dipakai konsumen seperti WhatsApp Blast Dashboard.
  app.get('/api/v1/usage', { preHandler: requireApiKey }, async (req) => {
    const u = req.apiKeyUser!;
    const quotaLimit = u.quotaLimit ?? u.quotaPerWeek ?? 0;
    const usedInPeriod = u.usedInPeriod ?? 0;
    return {
      quotaPerDay: u.quotaPerDay,
      usedToday: u.usedToday,
      remaining: Math.max(0, u.quotaPerDay - u.usedToday),
      quotaLimit,
      usedInPeriod,
      quotaPeriod: u.quotaPeriod ?? 'weekly',
      quotaResetAt: u.quotaResetAt,
      remainingInPeriod: u.role === 'admin' ? null : Math.max(0, quotaLimit - usedInPeriod),
    };
  });

  app.get('/api/v1/messages/:sessionId', { preHandler: requireAuth }, async (req) => {
    const { sessionId } = req.params as { sessionId: string };
    const query = (req.query || {}) as {
      batchId?: string;
      limit?: string;
      offset?: string;
      status?: string;
      phones?: string;
    };
    const user = req.apiKeyUser!;
    const filterUserId = user.role === 'admin' ? undefined : user.id;
    const targetSession = (sessionId === 'auto' || sessionId === 'all') ? undefined : sessionId;

    const statuses = typeof query.status === 'string' && query.status.length > 0
      ? query.status.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
    const phones = typeof query.phones === 'string' && query.phones.length > 0
      ? query.phones.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200)
      : undefined;

    const result = listMessagesPaged({
      sessionId: targetSession,
      filterUserId,
      batchId: query.batchId || undefined,
      statuses,
      phones,
      limit: query.limit ? Number(query.limit) : 50,
      offset: query.offset ? Number(query.offset) : 0,
    });

    return { messages: result.messages, total: result.total };
  });

  // ============ Settings (Admin Only) ============
  app.get('/api/v1/settings', { preHandler: requireAuth }, async (req, reply) => {
    const user = (req as any).user || (req as any).apiKeyUser;
    if (!user || user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak. Khusus Administrator.' });
    }
    const all = getAllSettings();
    return {
      settings: {
        googleAuthEnabled: all['google_auth_enabled'] === 'true',
        googleClientId: all['google_client_id'] || '',
        googleAllowedDomains: all['google_allowed_domains'] || '',
        googleClientSecret: all['google_client_secret'] ? '••••••••' : '',
        hasClientSecret: Boolean(all['google_client_secret']),
        registrationEnabled: all['registration_enabled'] !== 'false',
        turnstileEnabled: all['turnstile_enabled'] === 'true',
        turnstileSiteKey: all['turnstile_site_key'] || '',
        turnstileSecretKey: all['turnstile_secret_key'] ? '••••••••' : '',
        hasTurnstileSecret: Boolean(all['turnstile_secret_key']),
        blastDashboardUrl: all['blast_dashboard_url'] || 'http://172.30.30.229:8085',
        // Basis URL panel ini sendiri. Dipakai menyusun tautan di email (reset
        // password, buka dashboard). Kosong berarti belum pernah diatur dan
        // kode akan jatuh ke env, lalu ke alamat pengembangan — lihat panel-url.ts.
        panelBaseUrl: all['panel_base_url'] || '',
        // Konfigurasi email. Password TIDAK pernah dikirim utuh ke klien — hanya
        // penanda bahwa password sudah tersimpan.
        mail: konfigurasiUntukKlien(),
      },
      mailPresets: PRESET_PROVIDER,
    };
  });

  app.patch('/api/v1/settings', { preHandler: requireAuth }, async (req, reply) => {
    const user = (req as any).user || (req as any).apiKeyUser;
    if (!user || user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak. Khusus Administrator.' });
    }
    const body = (req.body || {}) as {
      googleAuthEnabled?: boolean;
      googleClientId?: string;
      googleClientSecret?: string;
      googleAllowedDomains?: string;
      registrationEnabled?: boolean;
      turnstileEnabled?: boolean;
      turnstileSiteKey?: string;
      turnstileSecretKey?: string;
      blastDashboardUrl?: string;
      panelBaseUrl?: string;
    };
    const updates: Record<string, string> = {};
    if (body.googleAuthEnabled !== undefined) {
      updates['google_auth_enabled'] = body.googleAuthEnabled ? 'true' : 'false';
    }
    if (body.googleClientId !== undefined) {
      updates['google_client_id'] = body.googleClientId.trim();
    }
    if (body.googleAllowedDomains !== undefined) {
      updates['google_allowed_domains'] = body.googleAllowedDomains.trim();
    }
    if (body.googleClientSecret !== undefined && body.googleClientSecret !== '••••••••' && body.googleClientSecret.trim() !== '') {
      updates['google_client_secret'] = body.googleClientSecret.trim();
    }
    if (body.registrationEnabled !== undefined) {
      updates['registration_enabled'] = body.registrationEnabled ? 'true' : 'false';
    }
    if (body.turnstileEnabled !== undefined) {
      updates['turnstile_enabled'] = body.turnstileEnabled ? 'true' : 'false';
    }
    if (body.turnstileSiteKey !== undefined) {
      updates['turnstile_site_key'] = body.turnstileSiteKey.trim();
    }
    if (body.turnstileSecretKey !== undefined && body.turnstileSecretKey !== '••••••••' && body.turnstileSecretKey.trim() !== '') {
      updates['turnstile_secret_key'] = body.turnstileSecretKey.trim();
    }
    if (body.blastDashboardUrl !== undefined) {
      updates['blast_dashboard_url'] = body.blastDashboardUrl.trim();
    }
    if (body.panelBaseUrl !== undefined) {
      const nilai = body.panelBaseUrl.trim().replace(/\/+$/, '');
      // Nilai kosong sah: artinya "jangan pakai nilai dari tabel", dan kode akan
      // jatuh ke env. Selain itu wajib http/https — alamat tanpa skema akan
      // menghasilkan tautan relatif di email dan tidak bisa diklik.
      if (nilai !== '' && !/^https?:\/\/[^\s]+$/i.test(nilai)) {
        return reply.code(400).send({
          error: 'Basis URL panel harus diawali http:// atau https:// dan tidak boleh mengandung spasi.',
        });
      }
      updates['panel_base_url'] = nilai;
    }
    setSettings(updates);
    return { success: true, message: 'Pengaturan berhasil diperbarui.' };
  });

  // Simpan konfigurasi email. Dipisah dari PATCH /settings di atas karena
  // password perlu diperlakukan berbeda: nilai '••••••••' berarti "jangan ubah",
  // bukan "simpan string titik-titik ini".
  app.put('/api/v1/settings/mail', { preHandler: requireAuth }, async (req, reply) => {
    const user = (req as any).user || (req as any).apiKeyUser;
    if (!user || user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak. Khusus Administrator.' });
    }
    const body = (req.body || {}) as Record<string, unknown>;
    const hasil = simpanKonfigurasiMail(body);
    if (!hasil.ok) return reply.code(400).send({ error: hasil.pesan });
    return { success: true, message: hasil.pesan };
  });

  // Uji koneksi ke server SMTP tanpa mengirim apa pun.
  app.post('/api/v1/settings/mail/test', { preHandler: requireAuth }, async (req, reply) => {
    const user = (req as any).user || (req as any).apiKeyUser;
    if (!user || user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak. Khusus Administrator.' });
    }
    const hasil = await ujiKoneksiMail();
    if (!hasil.ok) return reply.code(400).send({ success: false, error: hasil.pesan });
    return { success: true, message: hasil.pesan };
  });

  // Kirim email uji sungguhan ke alamat tujuan.
  app.post('/api/v1/settings/mail/send-test', { preHandler: requireAuth }, async (req, reply) => {
    const user = (req as any).user || (req as any).apiKeyUser;
    if (!user || user.role !== 'admin') {
      return reply.code(403).send({ error: 'Akses ditolak. Khusus Administrator.' });
    }
    const tujuan = String((req.body as any)?.to || user.email || '').trim();
    if (!tujuan || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tujuan)) {
      return reply.code(400).send({ error: 'Alamat tujuan tidak valid.' });
    }

    const hasil = await kirimEmail({
      tujuan,
      subjek: `${BRAND.nama} — Uji Konfigurasi Email`,
      html: templateEmailUji({ tujuan }),
      teks: templateEmailUjiTeks({ tujuan }),
    });

    if (!hasil.ok) return reply.code(400).send({ success: false, error: hasil.pesan });
    return { success: true, message: `Email uji terkirim ke ${tujuan}.` };
  });


  // ============ Auto-Rotate & Session Pooling ============
  app.get('/api/v1/autorotate/settings', { preHandler: requireAuth }, async (req) => {
    const user = (req as any).apiKeyUser;
    const all = user ? getAllUserSettings(user.id) : getAllSettings();
    let poolSessions: string[] = [];
    try {
      if (all['autorotate_pool_sessions']) poolSessions = JSON.parse(all['autorotate_pool_sessions']);
    } catch {}

    return {
      settings: {
        enabled: all['autorotate_enabled'] === 'true',
        strategy: all['autorotate_strategy'] || 'least_loaded',
        rotateOnLimit: all['autorotate_rotate_on_limit'] !== 'false',
        rotateOnDisconnect: all['autorotate_rotate_on_disconnect'] !== 'false',
        rotateOn463: all['autorotate_rotate_on_463'] !== 'false',
        stickySession: all['autorotate_sticky_session'] !== 'false',
        poolSessions,
      },
    };
  });

  app.patch('/api/v1/autorotate/settings', { preHandler: requireAuth }, async (req, reply) => {
    const user = (req as any).apiKeyUser;
    const body = (req.body || {}) as {
      enabled?: boolean;
      strategy?: 'least_loaded' | 'round_robin' | 'warmup_priority';
      rotateOnLimit?: boolean;
      rotateOnDisconnect?: boolean;
      rotateOn463?: boolean;
      stickySession?: boolean;
      poolSessions?: string[];
    };

    const updates: Record<string, string> = {};
    if (body.enabled !== undefined) updates['autorotate_enabled'] = body.enabled ? 'true' : 'false';
    if (body.strategy !== undefined) updates['autorotate_strategy'] = body.strategy;
    if (body.rotateOnLimit !== undefined) updates['autorotate_rotate_on_limit'] = body.rotateOnLimit ? 'true' : 'false';
    if (body.rotateOnDisconnect !== undefined) updates['autorotate_rotate_on_disconnect'] = body.rotateOnDisconnect ? 'true' : 'false';
    if (body.rotateOn463 !== undefined) updates['autorotate_rotate_on_463'] = body.rotateOn463 ? 'true' : 'false';
    if (body.stickySession !== undefined) updates['autorotate_sticky_session'] = body.stickySession ? 'true' : 'false';
    if (body.poolSessions !== undefined) updates['autorotate_pool_sessions'] = JSON.stringify(body.poolSessions);

    if (user) {
      setUserSettings(user.id, updates);
    } else {
      setSettings(updates);
    }
    return { success: true, message: 'Pengaturan Auto-Rotate akun Anda berhasil diperbarui.' };
  });

  app.get('/api/v1/autorotate/status', { preHandler: requireAuth }, async (req) => {
    const user = (req as any).apiKeyUser;
    const isAdmin = user && user.role === 'admin';
    const filterUserId = isAdmin ? undefined : user?.id;

    const sessions = await manager.listSessions(filterUserId);
    const all = user ? getAllUserSettings(user.id) : getAllSettings();
    let poolSessions: string[] = [];
    try {
      if (all['autorotate_pool_sessions']) poolSessions = JSON.parse(all['autorotate_pool_sessions']);
    } catch {}

    const roster = sessions.map((s) => {
      const ab = manager.getAntiBanStatus(s.id);
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        status: s.status,
        inPool: poolSessions.length === 0 || poolSessions.includes(s.id),
        warmupDay: s.warmupDay,
        messagesSentToday: s.messagesSentToday,
        deliveryRate: s.deliveryRate,
        riskScore: s.riskScore,
        warmupStatus: ab?.warmup || null,
        timelockActive: ab?.timelock?.isActive || false,
      };
    });

    const userPrefEnabled = all['autorotate_enabled'] === 'true';
    const userEligible = sessions.length >= 2;

    return {
      enabled: userPrefEnabled && userEligible,
      userPrefEnabled,
      userEligible,
      strategy: all['autorotate_strategy'] || 'least_loaded',
      totalSessions: sessions.length,
      poolCount: roster.filter((r) => r.inPool).length,
      activePoolCount: roster.filter((r) => r.inPool && r.status === 'connected').length,
      roster,
    };
  });
}
