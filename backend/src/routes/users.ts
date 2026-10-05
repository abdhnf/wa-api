/**
 * Manajemen pengguna (khusus admin): daftar, buat, ubah, hapus,
 * reset password, reset PIN, dan tautan Blast milik user lain.
 *
 * Berkas ini tidak dijalankan sendiri: server.ts memanggil
 * daftarkanRuteUsers() saat menyusun aplikasi.
 */
import { requireAdmin } from '../auth.js';
import { hashPassword, generateApiKey } from '../security.js';
import { getUserByEmail, getUserByPhone, getUserById, listUsers, createUser, updateUser, deleteUser, setUserPassword, setUserApiKey, setUserBlastPin, clearUserBlastPin, getUserBlastAccessToken, getSetting } from '../db.js';
import { normalisasiNomor } from '../phone.js';
import { createUserSchema, parseBody } from './schemas.js';
import type { FastifyInstance } from 'fastify';

export function daftarkanRuteUsers(app: FastifyInstance): void {
  // ============ Users ============
  app.get('/api/v1/users', { preHandler: requireAdmin }, async () => {
    // Jangan kirim hash/token ke klien. blastPinHash & blastAccessToken cukup
    // diwakili boolean hasBlastPin / hasBlastToken supaya panel bisa menampilkan status.
    return {
      users: listUsers().map((u) => {
        const { passwordHash, blastPinHash, blastAccessToken, ...rest } = u as any;
        return { ...rest, hasBlastPin: !!blastPinHash, hasBlastToken: !!blastAccessToken };
      }),
    };
  });

  app.post('/api/v1/users', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = parseBody(createUserSchema, req.body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const { data } = parsed;

    if (getUserByEmail(data.email)) return reply.code(409).send({ error: 'Email sudah terdaftar' });

    // Normalisasi nomor telepon ke bentuk kanonik. Kalau formatnya tidak masuk
    // akal, tolak di sini — jangan simpan nomor yang salah diam-diam.
    let phone: string | undefined;
    if (data.phone && data.phone.trim() !== '') {
      const kanonik = normalisasiNomor(data.phone);
      if (!kanonik) {
        return reply.code(400).send({
          error: 'Nomor telepon tidak valid. Contoh format yang diterima: 08123456789 atau +628123456789.',
        });
      }
      // Diperiksa lebih dulu supaya balasannya 409 dengan pesan yang jelas.
      // Tanpa ini, UNIQUE INDEX di database melempar error SQLite mentah dan
      // pengguna hanya melihat "Internal Server Error".
      if (getUserByPhone(kanonik)) {
        return reply.code(409).send({ error: 'Nomor telepon sudah dipakai akun lain' });
      }
      phone = kanonik;
    }

    const user = createUser({
      name: data.name,
      email: data.email,
      passwordHash: hashPassword(data.password),
      role: data.role || 'user',
      apiKey: generateApiKey('wa'),
      quotaPerDay: data.quotaPerDay ?? 100,
      quotaPeriod: data.quotaPeriod,
      quotaLimit: data.quotaLimit,
      assignedSessionId: data.assignedSessionId,
      status: 'active',
      phone,
    });
    return reply.code(201).send({ success: true, user: { ...user, passwordHash: undefined } });
  });

  app.post('/api/v1/users/:id/rotate-key', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = getUserById(id);
    if (!user) return reply.code(404).send({ error: 'User tidak ditemukan' });
    const newKey = generateApiKey('wa');
      setUserApiKey(id, newKey);
      return { success: true, apiKey: newKey };
  });

  // ============ Users CRUD (admin only) ============
  app.patch('/api/v1/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as any;
    const cur = getUserById(id);
    if (!cur) return reply.code(404).send({ error: 'User tidak ditemukan' });
    if (cur.role === 'admin' && body.role && body.role !== 'admin') {
      return reply.code(400).send({ error: 'Tidak bisa menurunkan role admin' });
    }

    // Nomor telepon: undefined = jangan sentuh, kosong = hapus, ada isi = normalisasi.
    // Dibedakan begini supaya mengosongkan kolom di panel benar-benar menghapus
    // nomor, bukan malah mempertahankan nilai lama.
    let phonePatch: string | null | undefined = undefined;
    if (body.phone !== undefined) {
      if (body.phone === null || String(body.phone).trim() === '') {
        phonePatch = null;
      } else {
        const kanonik = normalisasiNomor(String(body.phone));
        if (!kanonik) {
          return reply.code(400).send({
            error: 'Nomor telepon tidak valid. Contoh format yang diterima: 08123456789 atau +628123456789.',
          });
        }
        // Cek duplikat sebelum menyentuh database — lihat catatan di POST /users.
        const pemilik = getUserByPhone(kanonik);
        if (pemilik && pemilik.id !== id) {
          return reply.code(409).send({ error: 'Nomor telepon sudah dipakai akun lain' });
        }
        phonePatch = kanonik;
      }
    }

    const user = updateUser(id, {
      name: body.name,
      role: body.role,
      quotaPerDay: body.quotaPerDay,
      quotaPerWeek: body.quotaLimit !== undefined ? Number(body.quotaLimit) : (body.quotaPerWeek !== undefined ? Number(body.quotaPerWeek) : undefined),
      quotaLimit: body.quotaLimit !== undefined ? Number(body.quotaLimit) : (body.quotaPerWeek !== undefined ? Number(body.quotaPerWeek) : undefined),
      quotaPeriod: body.quotaPeriod,
      status: body.status,
      assignedSessionId: body.assignedSessionId === undefined ? undefined : (body.assignedSessionId || null),
      phone: phonePatch,
    });
    return { success: true, user: { ...user, passwordHash: undefined } };
  });

  app.delete('/api/v1/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const cur = getUserById(id);
    if (!cur) return reply.code(404).send({ error: 'User tidak ditemukan' });
    if (cur.role === 'admin') return reply.code(400).send({ error: 'Tidak bisa menghapus admin' });
    deleteUser(id);
    return { success: true };
  });

  app.post('/api/v1/users/:id/reset-password', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { password?: string };
    if (!body.password || body.password.length < 6) {
      return reply.code(400).send({ error: 'Password minimal 6 karakter' });
    }
    if (!getUserById(id)) return reply.code(404).send({ error: 'User tidak ditemukan' });
    setUserPassword(id, hashPassword(body.password));
    return { success: true };
  });

  // Reset PIN Blast Dashboard milik user. Dua mode:
  //  - body.pin berisi 6 digit  -> pasang PIN baru langsung (user tidak perlu setup ulang)
  //  - body.pin kosong/absen    -> hapus PIN, user wajib memasang sendiri saat membuka Blast
  app.post('/api/v1/users/:id/reset-pin', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body || {}) as { pin?: string };
    const target = getUserById(id);
    if (!target) return reply.code(404).send({ error: 'User tidak ditemukan' });

    const raw = typeof body.pin === 'string' ? body.pin.trim() : '';

    if (!raw) {
      clearUserBlastPin(id);
      return { success: true, mode: 'cleared', hasBlastPin: false };
    }

    // Samakan aturan dengan endpoint /auth/blast-pin agar tidak ada jalur yang lebih longgar.
    if (!/^\d{6}$/.test(raw)) {
      return reply.code(400).send({ error: 'PIN wajib berupa 6 digit angka numerik.' });
    }

    setUserBlastPin(id, hashPassword(raw));
    return { success: true, mode: 'set', hasBlastPin: true };
  });

  // Lihat link akses Blast Dashboard milik user lain (READ-ONLY, khusus admin).
  //
  // Sengaja hanya GET dan sengaja memakai getUserBlastAccessToken() — bukan
  // getOrCreateUserBlastAccessToken(). Endpoint ini untuk MELIHAT, bukan menerbitkan:
  // kalau user belum punya token, balasannya hasToken:false, bukan token baru.
  // Menerbitkan token untuk akun orang lain lewat jalur "lihat" akan memperluas
  // akses tanpa persetujuan pemilik akun.
  app.get('/api/v1/users/:id/blast-link', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const target = getUserById(id);
    if (!target) return reply.code(404).send({ error: 'User tidak ditemukan' });

    const token = getUserBlastAccessToken(id);
    if (!token) {
      return {
        success: true,
        hasToken: false,
        hasBlastPin: !!target.blastPinHash,
        launchUrl: null,
        message: 'User ini belum pernah membuat link akses. Link akan dibuat saat pemiliknya membuka menu Blast App di panel.',
      };
    }

    const base = (getSetting('blast_dashboard_url') || 'http://172.30.30.229:8085').replace(/\/$/, '');
    return {
      success: true,
      hasToken: true,
      hasBlastPin: !!target.blastPinHash,
      launchUrl: `${base}/auth/launch?token=${token}`,
    };
  });
}
