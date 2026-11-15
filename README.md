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
- [6. Inbox, Webhook & Chatbot](#6-inbox-webhook--chatbot)
- [7. Anti-Ban Engine & Telemetry](#7-anti-ban-engine--telemetry)
- [8. License](#8-license)

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
| `POST` | `/api/v1/messages/send-media` | Kirim media file (gambar, video, audio, PDF) | API Key / JWT |
| `GET` | `/api/v1/messages/status/:id` | Cek status receipt (sent, delivered, read) | API Key / JWT |
| `GET` | `/api/v1/inbound` | Daftar pesan masuk dengan filter & paginasi | API Key / JWT |
| `GET` | `/api/v1/inbound/conversations` | Ringkasan percakapan (satu baris per nomor) | API Key / JWT |
| `GET` | `/api/v1/inbound/conversation` | Riwayat satu percakapan | API Key / JWT |
| `POST` | `/api/v1/webhooks` | Daftarkan webhook (secret ditampilkan sekali) | API Key / JWT |
| `GET` | `/api/v1/webhooks` | Daftar webhook (secret disamarkan) | API Key / JWT |
| `PATCH` | `/api/v1/webhooks/:id` | Ubah URL, event, status, cakupan, atau filter isi pesan | API Key / JWT |
| `DELETE` | `/api/v1/webhooks/:id` | Hapus webhook beserta riwayatnya | API Key / JWT |
| `POST` | `/api/v1/webhooks/:id/rotate-secret` | Terbitkan secret baru (ditampilkan sekali) | API Key / JWT |
| `POST` | `/api/v1/webhooks/:id/test` | Kirim payload uji, kembalikan status code | API Key / JWT |
| `GET` | `/api/v1/webhooks/:id/deliveries` | Riwayat pengiriman + status tiap percobaan | API Key / JWT |
| `POST` | `/api/v1/webhooks/deliveries/:id/retry` | Masukkan kembali pengiriman gagal ke antrean | API Key / JWT |
| `GET` | `/api/v1/chatbot/flows` | Daftar aturan chatbot | API Key / JWT |
| `POST` | `/api/v1/chatbot/flows` | Tambah aturan chatbot | API Key / JWT |
| `PATCH` | `/api/v1/chatbot/flows/:id` | Ubah aturan chatbot | API Key / JWT |
| `DELETE` | `/api/v1/chatbot/flows/:id` | Hapus aturan chatbot | API Key / JWT |
| `POST` | `/api/v1/chatbot/test` | Uji aturan tanpa mengirim WhatsApp | API Key / JWT |
| `GET` | `/api/v1/chatbot/sessions` | Percakapan yang sedang berjalan | API Key / JWT |
| `GET` | `/api/v1/chatbot/optouts` | Kontak yang meminta berhenti | API Key / JWT |
| `GET` | `/api/v1/api-logs` | Lihat histori API logs dengan paginasi & filter | Bearer (Admin) |
| `DELETE` | `/api/v1/api-logs` | Hapus log terpilih atau bersihkan seluruh histori | Bearer (Admin) |

---

## 6. Inbox, Webhook & Chatbot

### Inbox
Pesan masuk disimpan ke tabel `inbound_messages` dan bisa dibaca lewat
`GET /api/v1/inbound`. Yang disaring: pesan dari diri sendiri, riwayat hasil
sinkronisasi (`append`), dan status story. Grup tetap disimpan dengan
`chat_type = 'group'`, tetapi chatbot tidak membalasnya.

**Pengirim berbentuk LID.** Sejak WhatsApp memperkenalkan Linked Identity, satu
kontak punya dua alamat: `628xxx@s.whatsapp.net` dan `14396814266545@lid`. Angka
pada bentuk `@lid` adalah id internal, **bukan nomor telepon** — mengirim pesan
ke sana berakhir `not_registered`. Nomor ditentukan berurutan:

1. JID pengirim sendiri, bila sudah berbentuk nomor.
2. `remoteJidAlt`, yang sering disertakan Baileys.
3. Pemetaan tersimpan di `lid_mappings` (diisi otomatis dari setiap pesan masuk
   dan dari metadata grup).
4. Tidak ada -> `fromPhone = null`, dan chatbot tidak membalas.

`from_jid` tetap menyimpan bentuk aslinya untuk penelusuran.

### Webhook
Webhook dikirim dari antrean (`webhook_deliveries`), bukan dari jalur permintaan
— penerima yang lambat tidak menahan pemrosesan pesan WhatsApp.

Event yang tersedia: `message.received`, `message.status`, `session.status`.

**Cakupan.** Satu webhook tidak harus menerima semua pesan akun. Saat
mendaftar (`POST /api/v1/webhooks`) atau mengubahnya (`PATCH`):

| Field | Arti |
| :--- | :--- |
| `sessionId` | Batasi ke satu sesi. `null`/kosong = semua sesi. Harus sesi yang ada dan milik Anda. |
| `chatTypes` | `private` / `group` / `broadcast`. Default `["private"]`. `null` = semua jenis. |
| `matchType` | `exact` / `contains` / `keyword` / `regex`. `null` = semua pesan diteruskan. |
| `matchValue` | Nilai yang dicocokkan. Wajib diisi bersama `matchType`. |

Penyaringan dilakukan saat event dipancarkan, bukan oleh penerima. Penerima yang
hanya menangani chat pribadi tidak akan pernah menerima pesan grup.

**Filter isi pesan.** `sessionId` dan `chatTypes` menjawab "dari nomor mana",
bukan "pesan apa". Tanpa `matchType`, webhook ke dashboard tiket tetap menerima
setiap sapaan dan setiap balasan "terima kasih" — penerima harus menyaring
sendiri, setelah kuota jaringannya terpakai. Istilah dan artinya sengaja sama
dengan aturan chatbot, sehingga aturan yang sudah terbukti di sana bisa
dipindahkan apa adanya:

| `matchType` | Cocok bila |
| :--- | :--- |
| `exact` | Seluruh teks sama (tanpa beda huruf besar/kecil). |
| `contains` | Teks memuat rangkaian tersebut. |
| `keyword` | Salah satu kata pada daftar dipisah koma muncul sebagai kata utuh. `harga` tidak cocok pada `hargai`. |
| `regex` | Pola cocok. Divalidasi saat disimpan; regex rusak ditolak, bukan dibiarkan diam. |

Filter hanya dinilai untuk event yang **membawa pesan** (`message.received`).
`message.status` dan `session.status` tetap terkirim: keduanya tidak punya teks
untuk dicocokkan, dan menilainya akan membuat webhook berfilter diam-diam
berhenti menerima perubahan status. Pesan bergambar dinilai dari caption-nya;
pesan tanpa teks sama sekali tidak lolos filter.

Melepas filter: kirim `matchType: null` pada `PATCH` — `matchValue` ikut
dihapus, supaya tidak tersisa nilai yatim yang menyala lagi saat tipe dipasang.

`session.status` hanya dipancarkan untuk **perubahan yang bertahan**: status
terakhir per sesi disimpan dan jeda minimum 30 detik diberlakukan. Koneksi
WhatsApp bisa naik-turun beberapa detik sekali saat jaringan buruk; tanpa
penjagaan itu setiap kedipan menjadi satu kiriman dan penerima dibanjiri event
`connected`/`disconnected` yang tidak informatif.

Setiap kiriman membawa header:

| Header | Isi |
| :--- | :--- |
| `X-WA-Webhook-Id` | ID webhook pengirim (`whk_…`), untuk memilih secret yang tepat |
| `X-WA-Event` | Nama event |
| `X-WA-Delivery` | ID unik satu pemancaran, sama dengan `deliveryId` di payload |
| `X-WA-Idempotency-Key` | Kunci stabil untuk kejadian ini — sama pada dua pemancaran kejadian yang sama |
| `X-WA-Retry-Count` | Percobaan ke berapa (`0` = pertama) |
| `X-WA-Timestamp` | Epoch detik saat kirim |
| `X-WA-Signature` | `sha256=<hmac>` atas `${timestamp}.${body}` |

**`X-WA-Delivery` vs `X-WA-Idempotency-Key`.** Keduanya menjawab pertanyaan
berbeda. `X-WA-Delivery` unik per pemancaran, jadi ia hanya menyatukan percobaan
ulang dari satu baris antrean. `X-WA-Idempotency-Key` diturunkan dari isi
kejadian (`msg_<sesi>_<waMessageId>`, `ack_<sesi>_<waMessageId>_<status>`,
`sess_<sesi>_<status>_<waktu>`), sehingga pesan yang dikirim ulang Baileys
setelah reconnect menghasilkan kunci yang sama. **Dedupe di penerima sebaiknya
memakai `X-WA-Idempotency-Key`**, bukan `X-WA-Delivery`.

Secret bersifat **per webhook**, jadi penerima yang menerima kiriman dari lebih
dari satu webhook perlu tahu kunci mana yang dipakai. `X-WA-Webhook-Id` mengisi
kebutuhan itu; nilainya bukan rahasia (hanya penunjuk baris konfigurasi), dan
pemalsuan tetap butuh secret.

Verifikasi di sisi penerima:

```js
// Petakan id → secret yang diberikan saat webhook didaftarkan.
const secrets = {
  whk_a018444f: process.env.WA_SECRET_INBOX,
  whk_4008f9d9: process.env.WA_SECRET_STATUS,
};

const secret = secrets[req.headers['x-wa-webhook-id']];
if (!secret) return res.status(401).end();

const expected = 'sha256=' + createHmac('sha256', secret)
  .update(`${timestamp}.${body}`)
  .digest('hex');
if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
  return res.status(401).end();
}
```

Bila aplikasi penerima hanya punya satu webhook, secret itu cukup disimpan di
satu variabel lingkungan dan header `X-WA-Webhook-Id` boleh diabaikan.

> **Dedupe pakai `X-WA-Idempotency-Key`, bukan `deliveryId`.** Satu event yang
> cocok dengan beberapa webhook diantrekan sekali per webhook dengan `deliveryId`
> yang sama, tetapi tanda tangannya berbeda. Untuk mengenali kiriman ganda dari
> kejadian yang sama, pakai `X-WA-Idempotency-Key`; bila perlu memisahkan per
> endpoint, gabungkan dengan `X-WA-Webhook-Id`.

Percobaan ulang: 1m → 5m → 30m → 2h → 6h, maksimal 5 kali. HTTP 4xx (selain 408
dan 429) dianggap permanen dan tidak diulang.

**Masa simpan body.** Body pengiriman berisi isi pesan pelanggan, jadi setelah
pengiriman selesai (sukses maupun gagal permanen) isinya dikosongkan setelah
`WEBHOOK_PAYLOAD_RETENTION_HOURS` jam (default 24). Barisnya tetap ada sebagai
jejak audit — yang hilang hanya body-nya. Baris `pending` tidak pernah
dikosongkan karena body-nya masih dibutuhkan worker.

Konsekuensinya: pengiriman yang gagal lebih lama dari jendela itu **tidak bisa
diulang** lewat `POST /webhooks/deliveries/:id/retry` — endpoint membalas `409`,
bukan `404`, karena barisnya ada tetapi body-nya sudah tidak disimpan. Perpanjang
nilainya bila riwayat perlu bisa diulang lebih lama; `0` mematikan pembersihan
sehingga body bertahan sampai barisnya dipangkas (30 hari).

**Secret.** Nilainya hanya dikembalikan sekali, saat webhook dibuat. Pembacaan
berikutnya menampilkan bentuk tersamarkan (`whse••••ef53`). Bila salinan itu
hilang, jangan hapus lalu daftar ulang — riwayat pengiriman ikut terhapus.
Pakai `POST /api/v1/webhooks/:id/rotate-secret`, yang menerbitkan secret baru
dan mengembalikannya sekali. Setelah rotasi, penerima akan menolak kiriman
sampai nilai barunya dipasang di sana.

### Chatbot
Aturan disimpan di `chatbot_flows`, posisi percakapan di `chatbot_sessions`.
Tipe pencocokan: `exact`, `contains`, `keyword` (kata utuh, dipisah koma), dan
`regex`. Aturan dengan `steps` menjalankan alur bertingkat.

Perilaku yang perlu diketahui:

- **Hanya chat pribadi.** Grup dilewati.
- **Opt-out dihormati lebih dulu.** `STOP`, `BERHENTI`, `UNSUB` mencatat kontak
  ke `chatbot_optouts`; bot diam dan nomornya sebaiknya dikeluarkan dari blast.
- **Human takeover.** Begitu operator membalas manual (tanpa `batchId`), bot
  berhenti untuk kontak itu selama 24 jam.
- **Balasan lewat antrean prioritas**, sehingga tetap tercatat di `messages` dan
  tetap kena pacing anti-ban.
- **Sinyal "sedang mengetik" dikirim sebelum balasan.** Durasinya mengikuti
  panjang balasan dan dibatasi 8 detik — cukup untuk terasa manusiawi, tidak
  sampai membuat penerima mengira bot macet. Jalur blast juga sudah memakai
  mekanisme yang sama, jadi tidak ada dua perilaku berbeda.
- **Pengirim berbentuk `@lid`** diselesaikan ke nomor aslinya lewat
  `lid_mappings`. Bila pemetaannya belum diketahui, bot diam.

Uji aturan tanpa mengirim apa pun:

```bash
curl -s -X POST https://wa-api.domain.com/api/v1/chatbot/test \
  -H "X-API-Key: wa_live_xxx" -H "Content-Type: application/json" \
  -d '{"sessionId":"sess-abc","text":"halo"}'
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
