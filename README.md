# WhatsApp API Gateway & Admin Panel (Monorepo)

Production-ready, multi-tenant WhatsApp API Gateway built with **Fastify v5**, **Baileys Socket Engine (v7)**, **SQLite (WAL mode)**, and a modern **React 19 + Vite + Tailwind CSS** admin dashboard.

---

## 📑 Daftar Isi

- [0. Requirements](#0-requirements)
- [1. Pilihan Metode Instalasi](#1-pilihan-metode-instalasi)
  - [Metode A: Docker Compose (Rekomendasi 1-Klik)](#metode-a-docker-compose-rekomendasi-1-klik)
  - [Metode B: aaPanel Web Manager (GUI Control Panel)](#metode-b-aapanel-web-manager-gui-control-panel)
  - [Metode C: Standalone Linux VPS (PM2 / Systemd)](#metode-c-standalone-linux-vps-pm2--systemd)
- [2. Configuration & Single Domain Routing](#2-configuration--single-domain-routing)
- [3. Getting Started / Overview](#3-getting-started--overview)
- [4. Monorepo Structure](#4-monorepo-structure)
- [5. API Reference Summary](#5-api-reference-summary)
- [6. Anti-Ban Engine & Telemetry](#6-anti-ban-engine--telemetry)
- [7. License](#7-license)

---

## 0. Requirements

Sebelum menjalankan gateway ini, pastikan infrastruktur server Anda memenuhi spesifikasi berikut:

### 1. Sistem Operasi & Hardware
- **OS:** Linux x86_64 atau ARM64 (Ubuntu 22.04/24.04 LTS, Debian 12, Rocky Linux 9, atau Proxmox VE VM).
- **CPU & RAM:**
  - *Minimum:* 1 vCPU, 1 GB RAM (hingga 5 sesi aktif simultan).
  - *Rekomendasi Production:* 2–4 vCPU, 2–4 GB RAM (skala 10–50 sesi aktif dengan antrean ribuan pesan).
- **Storage:** Minimal 10 GB NVMe / SSD (untuk data sesi Baileys dan log database SQLite).

### 2. Runtime & Tools (Untuk Non-Docker)
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

## 1. Pilihan Metode Instalasi

Pilih salah satu metode instalasi yang paling sesuai dengan kebutuhan server Anda:

---

### Metode A: Docker Compose (Rekomendasi 1-Klik) 🐳
> **Paling cocok untuk pemula** yang tidak ingin repot menginstal Node.js, pnpm, atau compiler native di OS host.

#### 1. Clone Repository
```bash
git clone https://github.com/abdhnf/wa-api.git
cd wa-api
```

#### 2. Jalankan Container
```bash
# Jalankan seluruh service (Backend + Panel) di background
docker compose up -d --build
```

#### 3. Cek Status & Akses
- Periksa container: `docker compose ps`
- Pantau logs: `docker compose logs -f`
- Buka di browser: **`http://SERVER_IP:5174`**
- *Catatan:* Container panel sudah menyertakan Nginx reverse proxy internal yang otomatis meneruskan request `/api/` ke backend. Database SQLite dan sesi WhatsApp tersimpan aman di direktori `./data` lokal.

---

### Metode B: aaPanel Web Manager (GUI Control Panel) 🌐
> **Paling cocok untuk pengguna VPS yang memakai aaPanel** agar tidak perlu mengetik konfigurasi systemd manual di terminal.

#### 1. Install Node.js di aaPanel
- Buka aaPanel ➔ Menu **App Store** ➔ Cari **Node.js Version Manager**.
- Install **Node.js v20.x atau v22.x LTS**.

#### 2. Clone Project ke Direktori Web
- Buka menu **Files** ➔ Masuk ke folder `/www/wwwroot/`.
- Klik tombol **Terminal** di aaPanel dan jalankan:
  ```bash
  git clone https://github.com/abdhnf/wa-api.git
  cd wa-api/backend
  cp .env.example .env
  pnpm install && pnpm build
  
  cd ../panel
  cp .env.example .env
  pnpm install && pnpm build
  ```

#### 3. Daftarkan Backend di Node Project
- Buka menu **Website** ➔ Tab **Node project** ➔ Klik **Add Node project**:
  - **Path:** `/www/wwwroot/wa-api/backend`
  - **Name:** `wa-backend`
  - **Run Opt:** Node (pilih v20 atau v22)
  - **Run file:** `dist/server.js`
  - **Port:** `3100`
  - Klik **Submit**. Backend langsung berjalan otomatis di background dengan auto-restart bawaan PM2.

#### 4. Buat Website & Pasang Nginx Reverse Proxy
- Buka menu **Website** ➔ **Add site** (misal: `wa-api.domain.com`).
- Klik nama site ➔ Tab **SSL** ➔ Pilih **Let's Encrypt** ➔ Klik **Apply**.
- Buka tab **Config** pada popup site tersebut, tambahkan aturan proxy:
  ```nginx
  # 1. API Gateway Backend
  location /api/ {
      proxy_pass http://127.0.0.1:3100;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
  }

  # 2. Frontend Panel (Sajikan hasil build static langsung)
  location / {
      root /www/wwwroot/wa-api/panel/dist;
      index index.html;
      try_files $uri $uri/ /index.html;
  }
  ```
- Klik **Save**. Sekarang `https://wa-api.domain.com` siap digunakan tanpa port!

---

### Metode C: Standalone Linux VPS (PM2 / Systemd) 🐧
> Untuk sysadmin atau developer yang ingin menjalankan aplikasi langsung di server Linux (Ubuntu/Debian) tanpa panel GUI.

#### 1. Setup Dependencies & Build
```bash
git clone https://github.com/abdhnf/wa-api.git
cd wa-api

# Backend
cd backend && cp .env.example .env
pnpm install && pnpm build

# Panel
cd ../panel && cp .env.example .env
pnpm install && pnpm build
```

#### 2. Jalankan Backend dengan PM2
```bash
npm install -g pm2
cd ../backend
pm2 start dist/server.js --name "wa-backend"
pm2 save && pm2 startup
```

#### 3. Atau Jalankan dengan Systemd Daemon
```bash
sudo tee /etc/systemd/system/wa-backend.service << 'EOF'
[Unit]
Description=WhatsApp API Gateway Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/wa-api/backend
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now wa-backend
```

---

## 2. Configuration & Single Domain Routing

### 1. Backend Environment (`backend/.env`)
```env
# Server Network Binding
PORT=3100
HOST=0.0.0.0
NODE_ENV=production

# JWT Security Secret (Gunakan openssl rand -hex 32)
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

### 2. Penyatuan Domain Tunggal (`wa-api.domain.com`)
Frontend panel otomatis mendeteksi apakah diakses melalui port pengembangan (`:5174`) atau melalui domain produksi. Saat diakses melalui domain, seluruh request API otomatis diarahkan ke `https://wa-api.domain.com/api/v1` tanpa perlu konfigurasi tambahan di frontend!

---

## 3. Getting Started / Overview

### Kredensial Default Login Pertama (Fresh Install) 🔑
Ketika backend dijalankan untuk pertama kali pada database yang baru/kosong, sistem otomatis membuatkan akun **Super Admin** default:

| Field | Default Value | Catatan / Override ENV |
| :--- | :--- | :--- |
| **Email** | `admin@example.com` | Variabel ENV: `ADMIN_EMAIL` |
| **Password** | `admin123` | Variabel ENV: `ADMIN_PASSWORD` |
| **Role** | `admin` | Akses penuh & Kuota Bebas (`Unlimited ∞`) |

> ⚠️ **PENTING:** Demi keamanan, segera login ke panel dan ganti password default ini di menu **Users & API Keys**!

### Arsitektur Inti Gateway
- **Baileys v7 Socket Engine:** Terhubung langsung ke protokol WhatsApp Multi-Device menggunakan enkripsi Noise Handshake (ringan tanpa konsumsi RAM headless Chromium/Puppeteer).
- **Fastify v5 REST Framework:** Latensi endpoint sub-10ms, validasi schema runtime Zod, dan asynchronous processing non-blocking.
- **SQLite Single-File Engine:** Mode WAL (Write-Ahead Logging), multi-threaded readers, dan asynchronous write non-blocking (`setImmediate`) untuk logging API.
- **Role Tiering:**
  - 👑 **Super Admin (`admin`):** Akses konfigurasi global, manajemen pengguna, audit log, dan bebas kuota (`Unlimited ∞`).
  - ⭐ **Subscription Plan (`subscription`):** Akun langganan dengan alokasi kuota pesan kustom harian dan mingguan.
  - 👤 **Free Tier (`user`):** Akun dasar dengan kuota 100 pesan/hari (700 pesan/minggu).

### Siklus Hidup Sesi (Session Lifecycle)
1. Buka dashboard panel di browser (`https://wa-api.domain.com` atau `http://SERVER_IP:5174`).
2. Masuk ke tab **Sessions** ➔ Klik **Tambah Sesi**.
3. Pilih metode pairing:
   - **QR Code Pairing:** Scan via aplikasi WhatsApp di menu *Perangkat Tertaut (Linked Devices)*.
   - **Pairing Code 8-Digit:** Masukkan nomor telepon aktif untuk menerima kode pairing teks 8 digit.
4. Setelah terhubung (`connected`), sesi otomatis tersimpan dan akan dipulihkan secara otomatis (*auto-restore*) jika server direstart.

### Quick Dispatch Test via cURL
```bash
curl -X POST https://wa-api.domain.com/api/v1/messages/send \
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
├── docker-compose.yml        # 1-Click Multi-Container Deployment
├── backend/                  # Fastify v5 + Baileys v7 Server
│   ├── Dockerfile            # Container build for backend
│   ├── src/
│   │   ├── server.ts         # Fastify App, Routes, Zod Schemas & Error Handlers
│   │   ├── db.ts             # SQLite DDL, WAL initialization, User & Logs helpers
│   │   ├── types.ts          # TypeScript interfaces & Role tiering definitions
│   │   ├── auth.ts           # JWT Auth, Google OAuth & API Key validation
│   │   └── antiban.ts        # 8-Layer Anti-Ban & Telemetry engine
│   ├── package.json
│   └── .env.example
│
├── panel/                    # React 19 + Vite + Tailwind CSS Dashboard
│   ├── Dockerfile            # Multi-stage build + Nginx Alpine runner
│   ├── nginx.conf            # SPA static routing + internal API reverse proxy
│   ├── src/
│   │   ├── App.tsx           # Responsive navigation (Desktop tabs + Mobile drawer)
│   │   ├── api.ts            # Client fetch wrappers & single-domain auto-detect
│   │   └── components/
│   │       ├── Docs.tsx          # Interactive API & System Guide Docs (3 install modes)
│   │       ├── ApiKeyModal.tsx   # Self-service API Key & Quota Modal
│   │       ├── UsersPage.tsx     # User & Quota Management (Dark modal dialogs)
│   │       ├── ApiLogsPage.tsx   # Request Logs & Maintenance Table
│   │       └── SessionsPage.tsx  # WhatsApp Multi-Session Manager
│   ├── package.json
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
| `GET` | `/api/v1/messages/status/:id` | Cek status receipt (sent, delivered, read) | API Key / JWT |
| `GET` | `/api/v1/api-logs` | Lihat histori API logs dengan paginasi & filter | Bearer (Admin) |
| `DELETE` | `/api/v1/api-logs` | Hapus log terpilih atau bersihkan seluruh histori | Bearer (Admin) |

---

## 6. Anti-Ban Engine & Telemetry

Gateway ini dilengkapi modul mitigasi pemblokiran 8 layer:
1. **Adaptive Jitter Delay:** Delay pengiriman acak antar pesan (3.000ms – 12.000ms).
2. **Timelock Protection (463):** Pacing throttling jika rasio pesan keluar melonjak tajam.
3. **Sirkadian Rhythm Delay:** Penyesuaian kecepatan pengiriman di jam istirahat malam.
4. **Number Warmup Mode:** Pembatasan volume otomatis untuk nomor WhatsApp yang baru terdaftar.
5. **Session Health Telemetry:** Monitoring status socket, auto-reconnect, dan graceful backoff.

---

## 7. License

Distributed under the MIT License. See `LICENSE` for more information.
