/**
 * Autentikasi: login, profil sendiri, pendaftaran, Google OAuth,
 * PIN & tautan Blast Dashboard, serta pemulihan password mandiri.
 *
 * Berkas ini tidak dijalankan sendiri: server.ts memanggil
 * daftarkanRuteAuth() saat menyusun aplikasi.
 */

import { requireAuth } from '../auth.js';
import { hashPassword, verifyPassword, generateApiKey, checkLoginBruteForce, recordLoginFailure, recordLoginSuccess, verifyTurnstileToken, getClientIp } from '../security.js';
import { getUserByEmail, getUserByPhone, getUserById, createUser, updateUser, setUserApiKey, setUserBlastPin, verifyAndBurnBlastLaunchToken, getOrCreateUserBlastAccessToken, rotateUserBlastAccessToken, getUserByBlastAccessToken, getSetting, upsertGoogleUser } from '../db.js';
import { normalisasiNomor } from '../phone.js';
import { ajukanResetPassword, verifikasiTokenReset, pakaiTokenReset } from '../password-reset.js';
import { kirimEmailRegistrasi } from '../notifikasi-email.js';
import { loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, parseBody } from './schemas.js';
import type { FastifyInstance } from 'fastify';

export function daftarkanRuteAuth(app: FastifyInstance): void {
  // ============ Auth ============
  app.post('/api/v1/auth/login', async (req, reply) => {
    const clientIp = getClientIp(req);

    // 1. Cek Proteksi Brute Force per IP
    const bruteCheck = checkLoginBruteForce(clientIp);
    if (!bruteCheck.allowed) {
      return reply.code(429).send({
        error: `IP Anda diblokir sementara karena terlalu banyak percobaan login gagal. Coba lagi dalam ${bruteCheck.waitSeconds} detik.`,
        statusCode: 429
      });
    }

    const parsed = parseBody(loginSchema, req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { data } = parsed;

    // 2. Cek Cloudflare Turnstile (jika diaktifkan di pengaturan sistem)
    const turnstileEnabled = getSetting('turnstile_enabled') === 'true';
    const turnstileSecret = getSetting('turnstile_secret_key') || '';
    if (turnstileEnabled && turnstileSecret) {
      if (!data.turnstileToken) {
        return reply.code(403).send({ error: 'Verifikasi CAPTCHA Cloudflare wajib diselesaikan.' });
      }
      const verifyResult = await verifyTurnstileToken(data.turnstileToken, turnstileSecret, clientIp);
      if (!verifyResult.success) {
        return reply.code(403).send({ error: `Verifikasi CAPTCHA gagal: ${verifyResult.error || 'Token tidak valid'}` });
      }
    }

    // 3. Autentikasi Pengguna
    const cleanEmail = (data.email || '').trim().toLowerCase();
    const cleanPassword = data.password || '';
    const user = getUserByEmail(cleanEmail);
    if (!user || !verifyPassword(cleanPassword, user.passwordHash)) {
      const failStatus = recordLoginFailure(clientIp);
      if (failStatus.locked) {
        return reply.code(429).send({
          error: 'Terlalu banyak percobaan login gagal. IP Anda diblokir selama 15 menit untuk alasan keamanan.',
          statusCode: 429
        });
      }
      return reply.code(401).send({
        error: 'Email atau password salah',
        remainingAttempts: failStatus.remainingAttempts
      });
    }

    // Reset catatan brute force saat berhasil login
    recordLoginSuccess(clientIp);

    const token = app.jwt.sign({ id: user.id, role: user.role, email: user.email });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role, apiKey: user.apiKey, quotaPerDay: user.quotaPerDay, usedToday: user.usedToday, hasBlastPin: !!user.blastPinHash } };
  });

  // Ambil profil user saat ini (termasuk API key & quota)
  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.apiKeyUser || getUserById((req.user as any)?.id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      apiKey: user.apiKey,
      quotaPerDay: user.quotaPerDay,
      usedToday: user.usedToday,
      quotaPerWeek: user.quotaPerWeek,
      usedThisWeek: user.usedThisWeek,
      status: user.status,
      hasBlastPin: !!user.blastPinHash,
      phone: user.phone || '',
      // Panel memakai ini untuk memutuskan perlu menampilkan onboarding.
      perluOnboarding: !user.phone,
    };
  });

  // Lengkapi profil sendiri (dipakai halaman onboarding setelah daftar via Google)
  app.patch('/api/v1/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.apiKeyUser || getUserById((req.user as any)?.id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

    const body = (req.body || {}) as { phone?: unknown; name?: unknown };

    const patch: { phone?: string | null; name?: string } = {};

    if (body.name !== undefined) {
      const nama = String(body.name).trim();
      if (!nama) return reply.code(400).send({ error: 'Nama tidak boleh kosong' });
      patch.name = nama;
    }

    if (body.phone !== undefined) {
      const mentah = String(body.phone).trim();
      if (mentah === '') {
        // Kosong berarti menghapus nomor — berguna kalau salah isi.
        patch.phone = null;
      } else {
        const kanonik = normalisasiNomor(mentah);
        if (!kanonik) {
          return reply.code(400).send({
            error: 'Nomor WhatsApp tidak valid. Contoh format yang diterima: 08123456789 atau +628123456789.',
          });
        }
        const pemilik = getUserByPhone(kanonik);
        if (pemilik && pemilik.id !== user.id) {
          return reply.code(409).send({ error: 'Nomor WhatsApp sudah dipakai akun lain' });
        }
        patch.phone = kanonik;
      }
    }

    updateUser(user.id, patch);
    const segar = getUserById(user.id)!;

    return {
      success: true,
      user: {
        id: segar.id,
        name: segar.name,
        email: segar.email,
        phone: segar.phone || '',
        perluOnboarding: !segar.phone,
      },
    };
  });

  // Rotasi API key oleh user itu sendiri
  app.post('/api/v1/auth/rotate-key', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.apiKeyUser || getUserById((req.user as any)?.id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });
    const newKey = generateApiKey('wa');
    setUserApiKey(user.id, newKey);
    return { success: true, apiKey: newKey };
  });

  // ============ Blast Dashboard Launch & PIN Handshake ============

  // Set / Ubah 6-digit PIN Keamanan Blast Dashboard
  app.post('/api/v1/auth/blast-pin', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.apiKeyUser || getUserById((req.user as any)?.id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

    const body = req.body as any;
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';
    if (!/^\d{6}$/.test(pin)) {
      return reply.code(400).send({ error: 'PIN wajib berupa 6 digit angka numerik.' });
    }

    const pinHash = hashPassword(pin);
    setUserBlastPin(user.id, pinHash);
    return { success: true, message: 'PIN keamanan Blast Dashboard berhasil disimpan!' };
  });

  // Persistent Launch URL / Token untuk membuka WhatsApp Blast Dashboard (berlaku permanen)
  app.post('/api/v1/auth/blast-launch', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.apiKeyUser || getUserById((req.user as any)?.id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

    // Cek apakah user sudah memasang PIN
    const hasPin = !!user.blastPinHash;
    if (!hasPin) {
      return reply.code(400).send({
        error: 'Anda belum mengatur PIN keamanan Blast Dashboard. Silakan atur PIN terlebih dahulu.',
        requirePinSetup: true,
      });
    }

    const token = getOrCreateUserBlastAccessToken(user.id);
    const blastDashboardBaseUrl = (getSetting('blast_dashboard_url') || 'http://172.30.30.229:8085').replace(/\/$/, '');
    const launchUrl = `${blastDashboardBaseUrl}/auth/launch?token=${token}`;

    return {
      success: true,
      token,
      launchUrl,
      persistent: true,
      hasBlastPin: true,
    };
  });

  // Regenerate / Revoke Blast Access Token
  app.post('/api/v1/auth/blast-launch/regenerate', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.apiKeyUser || getUserById((req.user as any)?.id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });

    const token = rotateUserBlastAccessToken(user.id);
    const blastDashboardBaseUrl = (getSetting('blast_dashboard_url') || 'http://172.30.30.229:8085').replace(/\/$/, '');
    const launchUrl = `${blastDashboardBaseUrl}/auth/launch?token=${token}`;

    return {
      success: true,
      token,
      launchUrl,
      persistent: true,
      message: 'Link akses WhatsApp Blast berhasil diperbarui. Link sebelumnya sudah tidak berlaku.',
    };
  });

  // Verifikasi Handshake dari Blast Dashboard (Menerima Token Persistent/Temporary + PIN, dan Mengembalikan API Key & Profil)
  app.post('/api/v1/auth/verify-blast-launch', async (req, reply) => {
    const body = req.body as any;
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';

    if (!token) {
      return reply.code(400).send({ error: 'Token peluncuran blast wajib disertakan.' });
    }

    // 1. Cek apakah ini token persistent user (blast_access_token)
    let user = getUserByBlastAccessToken(token);

    // Jika bukan persistent token, fallback cek single-use token lama (backward compatibility)
    if (!user) {
      const tokenCheck = verifyAndBurnBlastLaunchToken(token);
      if (tokenCheck.valid && tokenCheck.userId) {
        user = getUserById(tokenCheck.userId);
      }
    }

    if (!user) {
      return reply.code(401).send({ error: 'Token akses blast tidak valid atau telah digenerate ulang.' });
    }

    // 2. Verifikasi PIN numerik 6 digit
    if (!user.blastPinHash) {
      return reply.code(400).send({ error: 'User ini belum memiliki PIN keamanan blast yang terdaftar.' });
    }

    if (!verifyPassword(pin, user.blastPinHash)) {
      return reply.code(401).send({ error: 'PIN keamanan yang Anda masukkan salah.' });
    }

    // 3. Return kredensial & profil lengkap untuk dikonsumsi Blast Dashboard
    return {
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        apiKey: user.apiKey,
        quotaPerWeek: user.quotaPerWeek,
        quotaLimit: user.quotaLimit,
        usedInPeriod: user.usedInPeriod,
      }
    };
  });

  // Konfigurasi Auth Publik (apakah Google / Register aktif)
  app.get('/api/v1/auth/config', async () => {
    return {
      googleAuthEnabled: getSetting('google_auth_enabled') === 'true',
      googleClientId: getSetting('google_client_id') || '',
      registrationEnabled: getSetting('registration_enabled') !== 'false',
      turnstileEnabled: getSetting('turnstile_enabled') === 'true',
      turnstileSiteKey: getSetting('turnstile_site_key') || '',
    };
  });

  // Login / Register dengan Google OAuth
  app.post('/api/v1/auth/google', async (req, reply) => {
    if (getSetting('google_auth_enabled') !== 'true') {
      return reply.code(403).send({ error: 'Login Google saat ini dinonaktifkan oleh Administrator.' });
    }

    const body = (req.body || {}) as { credential?: string; email?: string; name?: string; googleId?: string; avatarUrl?: string };
    let googleEmail = body.email;
    let googleName = body.name;
    let googleId = body.googleId;
    let googleAvatar = body.avatarUrl;

    // Jika dikirim JWT Credential dari Google GSI (Google Identity Services)
    if (body.credential) {
      try {
        // Decode JWT payload (base64)
        const parts = body.credential.split('.');
        if (parts.length >= 2) {
          const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          googleEmail = payload.email;
          googleName = payload.name || payload.given_name || 'Google User';
          googleId = payload.sub;
          googleAvatar = payload.picture;
        }
      } catch (err) {
        return reply.code(400).send({ error: 'Token kredensial Google tidak valid' });
      }
    }

    if (!googleEmail || !googleId) {
      return reply.code(400).send({ error: 'Data profil Google tidak lengkap (butuh email dan googleId)' });
    }

    // Validasi Email / Domain Whitelist Google Auth
    const allowedDomainsSetting = (getSetting('google_allowed_domains') || '').trim();
    if (allowedDomainsSetting) {
      const allowedList = allowedDomainsSetting
        .split(/[\n,; ]+/)
        .map((d: string) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);

      const emailLower = googleEmail.toLowerCase();
      const emailDomain = emailLower.split('@')[1] || '';

      const isAllowed = allowedList.some((item: string) => {
        return item === emailDomain || item === emailLower;
      });

      if (!isAllowed) {
        console.warn(`[auth:google] Login ditolak untuk ${googleEmail} (domain @${emailDomain} tidak ada di whitelist)`);
        return reply.code(403).send({
          error: `Akses ditolak: Domain email (@${emailDomain}) tidak diizinkan masuk ke gateway.`
        });
      }
    }

    // Catatan: Google Auth selalu mengizinkan user baru terlepas dari toggle form registrasi publik manual

    const { user, baru } = upsertGoogleUser({
      googleId,
      email: googleEmail,
      name: googleName || 'Google User',
      avatarUrl: googleAvatar,
    });

    // Email selamat datang hanya untuk akun yang BARU dibuat. Pengguna lama yang
    // sekadar login ulang tidak perlu dikirimi lagi.
    //
    // Ditunggu (await) supaya tidak ada email yang menggantung saat proses mati,
    // tapi kegagalannya tidak mempengaruhi hasil login — lihat notifikasi-email.ts.
    if (baru) {
      await kirimEmailRegistrasi({
        email: user.email,
        nama: user.name,
        metode: 'google',
        kuotaPerHari: user.quotaPerDay ?? 100,
        kuotaPerMinggu: user.quotaPerWeek ?? 700,
        butuhNomorWa: !user.phone,
      });
    }

    const token = app.jwt.sign({ id: user.id, role: user.role, email: user.email });
    // `perluOnboarding` dipakai panel untuk memutuskan menampilkan halaman
    // pelengkapan profil. Hanya true untuk akun Google baru yang belum punya
    // nomor WhatsApp — pendaftar manual sudah mengisi nomornya di formulir.
    //
    // Field dikirim satu per satu, sama seperti /auth/login. Sebelumnya objek user
    // dikirim utuh dan itu ikut membawa `passwordHash` ke browser.
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        apiKey: user.apiKey,
        quotaPerDay: user.quotaPerDay,
        usedToday: user.usedToday,
        quotaPerWeek: user.quotaPerWeek,
        usedThisWeek: user.usedThisWeek,
        status: user.status,
        hasBlastPin: !!user.blastPinHash,
        phone: user.phone || '',
      },
      perluOnboarding: baru && !user.phone,
    };
  });

  app.post('/api/v1/auth/register', async (req, reply) => {
    // Hormati toggle pendaftaran publik. Tanpa ini, toggle di panel hanya
    // menyembunyikan formulir di UI — endpoint-nya masih terbuka bagi siapa pun
    // yang tahu alamatnya.
    if (getSetting('registration_enabled') === 'false') {
      return reply.code(403).send({ error: 'Pendaftaran akun baru ditutup oleh Administrator.' });
    }

    const parsed = parseBody(registerSchema, req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { data } = parsed;

    if (getUserByEmail(data.email)) return reply.code(409).send({ error: 'Email sudah terdaftar' });

    // Normalisasi nomor WhatsApp. Sama seperti di endpoint admin: format yang
    // tidak masuk akal ditolak di sini, bukan disimpan diam-diam.
    let phone: string | undefined;
    if (data.phone && data.phone.trim() !== '') {
      const kanonik = normalisasiNomor(data.phone);
      if (!kanonik) {
        return reply.code(400).send({
          error: 'Nomor WhatsApp tidak valid. Contoh format yang diterima: 08123456789 atau +628123456789.',
        });
      }
      if (getUserByPhone(kanonik)) {
        return reply.code(409).send({ error: 'Nomor WhatsApp sudah dipakai akun lain' });
      }
      phone = kanonik;
    }

    const user = createUser({
      name: data.name,
      email: data.email,
      passwordHash: hashPassword(data.password),
      role: 'user',
      apiKey: generateApiKey('wa'),
      quotaPerDay: 100,
      phone,
      status: 'active',
    });

    // Email selamat datang. Kegagalannya tidak membatalkan pendaftaran — akun
    // sudah terbentuk di atas dan pengguna tetap bisa masuk.
    await kirimEmailRegistrasi({
      email: user.email,
      nama: user.name,
      metode: 'manual',
      kuotaPerHari: user.quotaPerDay ?? 100,
      kuotaPerMinggu: user.quotaPerWeek ?? 700,
      butuhNomorWa: !user.phone,
    });

    return reply.code(201).send({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, apiKey: user.apiKey },
    });
  });

  // ============ Reset Password Mandiri ============
  //
  // Tiga endpoint publik di bawah ini adalah jalur pemulihan akun. Aturan
  // keamanannya ada di password-reset.ts; yang perlu diperhatikan di sini adalah
  // endpoint `forgot-password` SELALU membalas pesan yang sama, apa pun hasilnya,
  // supaya tidak bisa dipakai memetakan email mana yang terdaftar.

  app.post('/api/v1/auth/forgot-password', async (req, reply) => {
    const parsed = parseBody(forgotPasswordSchema, req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const clientIp = getClientIp(req);
    const hasil = await ajukanResetPassword(parsed.data.email, clientIp);

    // Saat dibatasi (rate limit), kode 429 dikembalikan — ini satu-satunya
    // pengecualian, dan memang disengaja: pengguna yang sah perlu tahu bahwa dia
    // harus menunggu, sementara penyerang sudah jelas tahu dia sedang dibatasi.
    if (!hasil.ok) {
      return reply.code(429).send({ error: hasil.pesan });
    }
    return { success: true, message: hasil.pesan };
  });

  // Periksa token sebelum menampilkan form password baru. Tanpa ini, pengguna
  // mengisi password baru dulu, baru diberi tahu tautannya kedaluwarsa.
  app.get('/api/v1/auth/reset-password/verify', async (req) => {
    const token = String((req.query as any)?.token || '');
    const hasil = verifikasiTokenReset(token);
    // Token tidak valid bukan error server — ini jawaban sah, jadi 200.
    return { valid: hasil.valid, name: hasil.nama, message: hasil.pesan };
  });

  app.post('/api/v1/auth/reset-password', async (req, reply) => {
    const parsed = parseBody(resetPasswordSchema, req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const hasil = pakaiTokenReset(parsed.data.token, parsed.data.password);
    if (!hasil.ok) return reply.code(400).send({ error: hasil.pesan });
    return { success: true, message: hasil.pesan };
  });
}
