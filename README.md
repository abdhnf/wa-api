# WhatsApp API Gateway & Admin Panel (Monorepo)

Production-ready, multi-tenant WhatsApp API Gateway built with **Fastify v5**, **Baileys Socket Engine**, **SQLite (WAL mode)**, and a modern **React 19 + Vite + Tailwind CSS** admin dashboard.

---

## 📑 Daftar Isi

- [0. Requirements](#0-requirements)
- [1. Installation](#1-installation)
- [2. Configuration](#2-configuration)
- [3. Getting Started / Overview](#3-getting-started--overview)
- [4. Monorepo Structure](#4-monorepo-structure)
- [5. API Reference Summary](#5-api-reference-summary)
- [6. Production Deployment (Systemd & Reverse Proxy)](#6-production-deployment-systemd--reverse-proxy)
- [7. Anti-Ban Engine & Telemetry](#7-anti-ban-engine--telemetry)
- [8. License](#8-license)

---

## 0. Requirements

Sebelum menjalankan gateway ini, pastikan infrastruktur dan server Anda memenuhi spesifikasi berikut:

### 1. Sistem Operasi & Hardware
- **OS:** Linux x86_64 atau ARM64 (Ubuntu 22.04/24.04 LTS, Debian 12, Rocky Linux 9, atau Proxmox VE VM).
- **CPU & RAM:**
  - *Minimum:* 1 vCPU, 1 GB RAM (hingga 5 sesi aktif simultan).
  - *Rekomendasi Production:* 2–4 vCPU, 2–4 GB RAM (skala 10–50 sesi aktif dengan antrean ribuan pesan).
- **Storage:** Minimal 10 GB NVMe / SSD (untuk data sesi Baileys dan log database SQLite).

### 2. Runtime & Tools
- **Node.js:** Versi `>= 20.10.0 LTS` atau `v22.x LTS` (membutuhkan modul native `node:sqlite` dan `node:crypto`).
- **Package Manager:** `pnpm` (disarankan `>= 9.0`) atau `npm` (`>= 10.0`).
- **Database:** SQLite 3.40+ (menggunakan engine native WAL mode, zero external DB setup).

### 3. Port & Jaringan
- **Port 3100:** Fastify Backend REST API & WebSocket server.
- **Port 5174:** Vite Production Web Panel (atau port 80/443 via reverse proxy).
- **Outbound Network:**
  - Port `443` (TCP HTTPS) untuk media upload/download WhatsApp CDN.
  - Port `5222` (TCP XMPP/Noise) untuk koneksi handshake Baileys ke WhatsApp server (`*.whatsapp.net`).

---

## 1. Installation

Monorepo ini memuat dua package utama: `backend` (Fastify API Gateway) dan `panel` (Admin Dashboard SPA).

### Step 1: Clone Repository
```bash
git clone https://github.com/abdhnf/wa-api.git
cd wa-api
```

### Step 2: Setup Backend
```bash
cd backend
cp .env.example .env

# Install dependencies & build TypeScript
pnpm install
pnpm build
```

### Step 3: Setup Frontend Panel
```bash
cd ../panel
cp .env.example .env

# Install dependencies & build frontend bundle
pnpm install
pnpm build
```

---

## 2. Configuration

### 1. Backend Environment (`backend/.env`)
Salin dari `.env.example` lalu sesuaikan nilainya:

```env
# Server Network Binding
PORT=3100
HOST=0.0.0.0
NODE_ENV=production

# JWT Security Secret (Gunakan string acak aman: openssl rand -hex 32)
JWT_SECRET=your_jwt_secret_hex_key_here

# Storage Paths
DB_PATH=./data/wa.db
SESSIONS_DIR=./data/auth

# Cloudflare Turnstile CAPTCHA (Opsional untuk login bot-protection)
TURNSTILE_SECRET_KEY=
TURNSTILE_SITE_KEY=

# Google OAuth 2.0 (Opsional untuk Login SSO)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Anti-Ban Engine Parameters
ANTIBAN_WARMUP_DAYS=7
ANTIBAN_MIN_DELAY_MS=3000
ANTIBAN_MAX_DELAY_MS=12000
ANTIBAN_TIMELOCK_MINUTES=463
```

### 2. Frontend Panel Environment (`panel/.env`)
```env
# Alamat Backend API Gateway
VITE_API_BASE=http://localhost:3100/api/v1
```

---

## 3. Getting Started / Overview

### Arsitektur Inti Gateway
- **Baileys v7 Socket Engine:** Terhubung langsung ke WhatsApp Multi-Device Protocol menggunakan enkripsi Noise Handshake (ringan tanpa konsumsi RAM headless Chromium/Puppeteer).
- **Fastify v5 REST Framework:** Latensi endpoint sub-10ms, validasi schema runtime Zod, dan zero-overhead async processing.
- **SQLite Single-File Engine:** Mode WAL (Write-Ahead Logging), multi-threaded readers, dan asynchronous write non-blocking (`setImmediate`) untuk pencatatan log API.
- **Role Tiering & Multi-Tenant:**
  - 👑 **Super Admin (`admin`):** Akses penuh ke konfigurasi global, manajemen pengguna, audit log, dan bebas kuota (`Unlimited ∞`).
  - ⭐ **Subscription Plan (`subscription`):** Akun langganan dengan alokasi kuota pesan kustom harian dan mingguan.
  - 👤 **Free Tier (`user`):** Akun dasar dengan kuota 100 pesan/hari (700 pesan/minggu).

### Siklus Hidup Sesi (Session Lifecycle)
1. Buka dashboard panel di browser (`http://localhost:5174`).
2. Masuk ke tab **Sessions** ➔ Klik **Tambah Sesi**.
3. Pilih metode pairing:
   - **QR Code Pairing:** Scan via WhatsApp mobile di menu *Perangkat Tertaut (Linked Devices)*.
   - **Pairing Code 8-Digit:** Masukkan nomor telepon aktif untuk menerima kode pairing teks 8 digit.
4. Setelah terhubung (`connected`), sesi otomatis tersimpan dan akan dipulihkan secara otomatis (*auto-restore*) jika server direstart.

### Quick Dispatch Test via cURL
Kirim pesan pertama Anda dengan menyertakan `X-API-Key` akun Anda:

```bash
curl -X POST http://localhost:3100/api/v1/messages/send \
  -H "X-API-Key: wa_live_your_api_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "auto",
    "to": "6281234567890",
    "text": "Halo, pesan berhasil dikirim via WhatsApp Gateway API!"
  }'
```

---

## 4. Monorepo Structure

```text
wa-api/
├── backend/                  # Fastify v5 + Baileys v7 Server
│   ├── src/
│   │   ├── server.ts         # Fastify App, Routes, Zod Schemas & Error Handlers
│   │   ├── db.ts             # SQLite DDL, WAL initialization, User & Logs helpers
│   │   ├── types.ts          # TypeScript interfaces & Role tiering definitions
│   │   ├── auth.ts           # JWT Auth, Google OAuth & API Key validation
│   │   └── antiban/          # 8-Layer Anti-Ban & Telemetry engine
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
│
├── panel/                    # React 19 + Vite + Tailwind CSS Dashboard
│   ├── src/
│   │   ├── App.tsx           # Responsive navigation (Desktop tabs + Mobile drawer)
│   │   ├── api.ts            # Client fetch wrappers & token sync
│   │   ├── components/
│   │   │   ├── Docs.tsx          # Interactive API & System Guide Docs
│   │   │   ├── ApiKeyModal.tsx   # Self-service API Key & Quota Modal
│   │   │   ├── UsersPage.tsx     # User & Quota Management (Dark modal dialogs)
│   │   │   ├── ApiLogsPage.tsx   # Request Logs & Maintenance Table
│   │   │   ├── SessionsPage.tsx  # WhatsApp Multi-Session Manager
│   │   │   └── Playground.tsx    # Live Interactive Dispatch Tester
│   │   └── dummyData.ts
│   ├── package.json
│   ├── vite.config.ts
│   └── .env.example
│
├── .gitignore                # Production ignore rules (No secrets, no db leaks)
└── README.md                 # Complete System & Deployment Documentation
```

---

## 5. API Reference Summary

| Method | Endpoint | Deskripsi | Auth |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Login user & return JWT token + API Key | Public |
| `GET` | `/api/v1/auth/me` | Ambil profil akun & status kuota pesan aktif | Bearer JWT |
| `POST` | `/api/v1/auth/rotate-key`| Rotasi mandiri API Key milik akun aktif | Bearer JWT |
| `GET` | `/api/v1/sessions` | List status seluruh sesi WhatsApp yang terdaftar | API Key / JWT |
| `POST` | `/api/v1/sessions` | Buat sesi baru (QR scan atau Pairing Code) | API Key / JWT |
| `POST` | `/api/v1/messages/send` | Kirim pesan teks (auto-route atau sesi spesifik) | API Key / JWT |
| `POST` | `/api/v1/messages/media` | Kirim media file (gambar, video, audio, PDF) | API Key / JWT |
| `GET` | `/api/v1/messages/status/:id` | Cek tanda centang receipt (sent, delivered, read) | API Key / JWT |
| `GET` | `/api/v1/api-logs` | Lihat histori API logs dengan paginasi & filter | Bearer (Admin) |
| `DELETE` | `/api/v1/api-logs` | Hapus log terpilih atau bersihkan seluruh histori | Bearer (Admin) |

---

## 6. Production Deployment (Systemd & Reverse Proxy)

### 1. Systemd Service (Daemon Otomatis)

Buat file unit backend `/etc/systemd/system/wa-backend.service`:
```ini
[Unit]
Description=WhatsApp Gateway Backend
After=network.target

[Service]
Type=simple
User=abdhnf
WorkingDirectory=/home/abdhnf/projects/wa-api/backend
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Buat file unit frontend `/etc/systemd/system/wa-panel.service`:
```ini
[Unit]
Description=WhatsApp Gateway Panel
After=network.target

[Service]
Type=simple
User=abdhnf
WorkingDirectory=/home/abdhnf/projects/wa-api/panel
ExecStart=/usr/bin/pnpm preview --host 0.0.0.0 --port 5174
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Aktifkan service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wa-backend wa-panel
```

### 2. Nginx Reverse Proxy & SSL Let's Encrypt

```nginx
server {
    listen 80;
    server_name wa.example.com;

    # Frontend Panel
    location / {
        proxy_pass http://127.0.0.1:5174;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API Gateway
    location /api/ {
        proxy_pass http://127.0.0.1:3100/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Pasang SSL otomatis:
```bash
sudo certbot --nginx -d wa.example.com
```

---

## 7. Anti-Ban Engine & Telemetry

Gateway ini dilengkapi modul mitigasi pemblokiran 8 layer:
1. **Adaptive Jitter Delay:** Delay pengiriman acak antar pesan (3.000ms – 12.000ms).
2. **Timelock Protection (463):** Pacing throttling jika rasio pesan keluar melonjak tajam.
3. **Sirkadian Rhythm Delay:** Penyesuaian kecepatan pengiriman di jam istirahat malam.
4. **Number Warmup Mode:** Pembatasan volume otomatis untuk nomor WhatsApp yang baru terdaftar.
5. **Session Health Telemetry:** Monitoring status socket, auto-reconnect, dan graceful backoff.

---

## 8. License

Distributed under the MIT License. See `LICENSE` for more information.
