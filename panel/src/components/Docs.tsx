import React, { useState } from 'react';
import {
 Sliders, BookOpen, Terminal, Copy, Check, Smartphone, MessageSquare,
 Users as UsersIcon, Webhook, Activity, ShieldCheck, Plus, FileText, Send, Eye, ScrollText,
 Cpu, HardDrive, Download, Settings, Layers, Sparkles, CheckCircle2, AlertTriangle, ExternalLink,
 Shield, Server, Network, ShieldAlert, KeyRound, Zap, RefreshCw, Lock as LockIcon
} from 'lucide-react';

function getUserApiKey(): string {
 if (typeof window !== 'undefined') {
 return localStorage.getItem('wa_api_key') || 'wa_live_YOUR_API_KEY';
 }
 return 'wa_live_YOUR_API_KEY';
}

const API_BASE = (import.meta as any).env?.VITE_API_BASE || (
 typeof window !== 'undefined'
 ? `${window.location.protocol}//${window.location.hostname}:3100/api/v1`
 : 'http://172.30.30.229:3100/api/v1'
);

interface EndpointDoc {
 method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
 path: string;
 desc: string;
 auth: string;
 curl: string;
 body?: string;
 response?: string;
}

interface GuideBlock {
 title: string;
 desc?: string;
 code?: string;
 lang?: string;
 items?: { label: string; value: string; desc?: string }[];
 callout?: { type: 'tip' | 'warning' | 'info'; text: string };
 notes?: string[];
}

interface Section {
 id: string;
 label: string;
 category: 'system' | 'api';
 icon: React.ReactNode;
 intro: string;
 endpoints?: EndpointDoc[];
 guideBlocks?: GuideBlock[];
}

const sections: Section[] = [
 // ==========================================
 // PANDUAN SISTEM (SYSTEM GUIDES)
 // ==========================================
 {
 id: 'requirements',
 label: '00. Requirements',
 category: 'system',
 icon: <Cpu size={15} />,
 intro: 'Spesifikasi prasyarat minimum dan rekomendasi arsitektur server untuk menjalankan WhatsApp API Gateway Baileys v7 secara optimal di lingkungan production.',
 guideBlocks: [
 {
 title: 'Sistem Operasi & Arsitektur CPU',
 desc: 'Gateway didesain untuk berjalan di berbagai platform Linux modern dengan kernel 5.15+ (x86_64 / amd64 maupun aarch64 / ARM64):',
 items: [
 { label: 'OS Direkomendasikan', value: 'Ubuntu 22.04 / 24.04 LTS, Debian 12 (Bookworm), Proxmox VE (LXC / QEMU VM)' },
 { label: 'OS Alternatif', value: 'CentOS Stream 9, Rocky Linux 9, AlmaLinux 9' },
 { label: 'CPU Arsitektur', value: 'x86_64 (Intel/AMD) atau ARM64 (Apple Silicon, Raspberry Pi 4/5)' },
 ]
 },
 {
 title: 'Alokasi Hardware (Resource Sizing)',
 desc: 'Kebutuhan resource berbanding lurus dengan jumlah nomor WhatsApp aktif dan volume antrean pesan harian:',
 items: [
 { label: 'Spesifikasi Minimum (1–5 Nomor)', value: '1 vCPU, 1 GB RAM, 10 GB NVMe Storage (Kapasitas hingga 5.000 pesan/hari)' },
 { label: 'Rekomendasi Skala Menengah (10–50 Nomor)', value: '2–4 vCPU, 2–4 GB RAM, 40 GB NVMe Storage (Kapasitas hingga 100.000 pesan/hari)' },
 { label: 'Skala Enterprise (50+ Nomor)', value: '4–8 vCPU, 8 GB RAM, 100 GB NVMe Storage (Dedicated VM dengan SSD high-IOPS)' },
 ],
 callout: {
 type: 'tip',
 text: 'Arsitektur Baileys Socket berjalan langsung di atas protokol WebSocket TCP tanpa browser headless (Chromium/Puppeteer), sehingga konsumsi memori per sesi sangat hemat (hanya ~30MB hingga ~50MB per nomor aktif).'
 }
 },
 {
 title: 'Runtime & Tools Prerequisite',
 desc: 'Pastikan software berikut sudah terinstal di server host sebelum menjalankan tahapan instalasi:',
 items: [
 { label: 'Node.js Runtime', value: 'v20.10.0+ LTS atau v22.x LTS (Mendukung native node:sqlite dan modern ESM)' },
 { label: 'Package Manager', value: 'pnpm (v9.0+) direkomendasikan untuk kecepatan & efisiensi ruang disk (atau npm v10+)' },
 { label: 'Database Engine', value: 'SQLite 3.40+ (Tersedia native/embedded, zero configuration, zero memory overhead)' },
 { label: 'Tools Pendukung', value: 'Git, curl, jq (opsional untuk testing JSON terminal)' },
 ],
 code: `# Verifikasi versi runtime di server Linux
node -v # Pastikan output >= v20.10.0
pnpm -v # Pastikan output >= v9.0.0
sqlite3 --version`,
 lang: 'bash'
 },
 {
 title: 'Firewall & Jaringan Port',
 desc: 'Gateway membutuhkan port listening internal dan koneksi outbound ke server WhatsApp Meta:',
 items: [
 { label: 'Port 3100 (Inbound)', value: 'Backend REST API Fastify Gateway (Dapat dibatasi localhost jika memakai Nginx)' },
 { label: 'Port 5174 (Inbound)', value: 'Frontend Web Admin Panel (Vite Preview / Production Build)' },
 { label: 'Port 443 (Outbound TCP)', value: 'Akses HTTPS ke server media, CDN, dan push notification WhatsApp' },
 { label: 'Port 5222 (Outbound TCP)', value: 'Noise Handshake Socket Baileys ke server WhatsApp (*.whatsapp.net / *.whatsapp.com)' },
 ],
 callout: {
 type: 'warning',
 text: 'Pastikan firewall VPS / Security Group tidak memblokir koneksi outbound ke port 5222 TCP, karena protokol komunikasi Baileys menggunakan port ini untuk sinkronisasi sesi.'
 }
 }
 ]
 },
 {
 id: 'installation',
 label: '01. Installation',
 category: 'system',
 icon: <Download size={15} />,
 intro: 'Pilih metode instalasi yang paling sesuai dengan lingkungan server Anda: Docker Compose (paling mudah & terisolasi), aaPanel Web GUI (tanpa banyak sentuh terminal), atau Standalone Linux VPS (PM2 / Systemd).',
 guideBlocks: [
 {
 title: 'Metode A: Docker Compose (Rekomendasi untuk Pemula / 1-Klik)',
 desc: 'Solusi paling praktis tanpa perlu menginstal Node.js, pnpm, atau compiler di host OS. Container backend Fastify dan Nginx frontend panel otomatis terhubung.',
 code: `# 1. Clone repository
git clone https://github.com/abdhnf/wa-api.git
cd wa-api

# 2. Siapkan file environment backend
cp backend/.env.example backend/.env

# 3. Jalankan seluruh container di background
docker compose up -d --build

# 4. Periksa log dan status container
docker compose ps
docker compose logs -f`,
 lang: 'bash',
 notes: [
 'Panel admin langsung dapat diakses di: http://SERVER_IP:5174',
 'Database SQLite dan token sesi Baileys otomatis tersimpan aman di folder ./data lokal.',
 'Container panel sudah memiliki reverse proxy Nginx internal yang otomatis meneruskan request /api/ ke container backend.'
 ]
 },
 {
 title: 'Metode B: aaPanel Web Manager (GUI Control Panel)',
 desc: 'Panduan deployment untuk pengguna aaPanel tanpa perlu konfigurasi systemd manual lewat terminal:',
 code: `# 1. Install Node.js Runtime di aaPanel
Buka menu App Store -> Cari"Node.js Version Manager" -> Install Node.js v20.x atau v22.x LTS.

# 2. Upload / Clone Source Code
Buka menu Files -> Masuk ke /www/wwwroot/ -> Buka Terminal di aaPanel:
git clone https://github.com/abdhnf/wa-api.git
cd wa-api

# 3. Setup Backend di aaPanel Node Project
- Buka menu Website -> Tab"Node project" -> Klik"Add Node project"
- Project directory: /www/wwwroot/wa-api/backend
- Project name: wa-backend
- Run opt: Node (pilih Node v20/v22 yang sudah diinstall)
- Run file: dist/server.js
- Port: 3100
- Catatan: Jalankan 'pnpm install && pnpm build' di folder backend terlebih dahulu sebelum submit.

# 4. Build Frontend Panel
Buka terminal aaPanel di folder /www/wwwroot/wa-api/panel:
pnpm install && pnpm build

# 5. Pasang Domain & Reverse Proxy di aaPanel
- Menu Website -> Add Website (misal: wa-api.domain.com)
- Buka tab SSL -> Pilih Let's Encrypt -> Klik Apply.
- Buka tab Config (Nginx configuration) -> Masukkan blok proxy:
 location /api/ { proxy_pass http://127.0.0.1:3100; }
 location / { root /www/wwwroot/wa-api/panel/dist; try_files $uri $uri/ /index.html; }`,
 lang: 'bash',
 notes: [
 'Dengan cara ini, frontend disajikan langsung oleh Nginx statis kecepatan tinggi, sedangkan API ditangani oleh Node.js background worker.',
 'Satu domain wa-api.domain.com langsung menangani panel web dan API tanpa bentrok port.'
 ]
 },
 {
 title: 'Metode C: Standalone Linux VPS (PM2 / Systemd)',
 desc: 'Untuk instalasi langsung di server Linux polosan (Ubuntu 22/24 LTS, Debian 12) menggunakan process manager PM2 atau daemon Systemd:',
 code: `# 1. Clone & Install Dependensi Monorepo
git clone https://github.com/abdhnf/wa-api.git
cd wa-api

# Backend setup
cd backend && cp .env.example .env
pnpm install && pnpm build

# Frontend setup
cd ../panel && cp .env.example .env
pnpm install && pnpm build

# 2. Pilihan Daemon A: Jalankan dengan PM2 (Paling Mudah)
npm install -g pm2
cd ../backend
pm2 start dist/server.js --name"wa-backend"
pm2 save && pm2 startup

# 3. Pilihan Daemon B: Jalankan dengan Systemd
sudo tee /etc/systemd/system/wa-backend.service << 'EOF'
[Unit]
Description=WhatsApp Gateway Backend
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
sudo systemctl enable --now wa-backend`,
 lang: 'bash',
 notes: [
 'Frontend panel dist/ dapat disajikan menggunakan Nginx biasa atau Caddy server.',
 'Gunakan perintah pm2 logs wa-backend atau journalctl -u wa-backend -f untuk memantau aktivitas server.'
 ]
 }
 ]
 },
 {
 id: 'configuration',
 label: '02. Configuration',
 category: 'system',
 icon: <Settings size={15} />,
 intro: 'Panduan konfigurasi environment variable (.env), tuning database SQLite WAL, parameter Anti-Ban Engine, serta reverse proxy HTTPS Nginx.',
 guideBlocks: [
 {
 title: '1. Daftar Environment Variables Backend (.env)',
 desc: 'File konfigurasi terletak di direktori root backend. Berikut daftar variabel lengkap:',
 items: [
 { label: 'PORT', value: '3100', desc: 'Port listening Fastify HTTP API' },
 { label: 'HOST', value: '0.0.0.0', desc: 'Network interface binding (0.0.0.0 untuk semua IP LAN/Publik)' },
 { label: 'JWT_SECRET', value: 'string_random_panjang_32_char', desc: 'Kunci rahasia hashing token JWT autentikasi panel' },
 { label: 'DB_PATH', value: './data/wa.db', desc: 'Path lokasi file database SQLite' },
 { label: 'SESSIONS_DIR', value: './sessions_auth', desc: 'Folder penyimpanan kredensial multi-device Baileys' },
 { label: 'CLOUDFLARE_TURNSTILE_SECRET', value: '0x4AAAAAA...', desc: 'Opsional: Secret key Cloudflare Turnstile proteksi bot' },
 { label: 'GOOGLE_CLIENT_ID', value: 'xxx.apps.googleusercontent.com', desc: 'Opsional: OAuth 2.0 Client ID untuk SSO Google' },
 ],
 code: `# Contoh konfigurasi produksi: ~/dev/wa-server-backend/.env
PORT=3100
HOST=0.0.0.0
JWT_SECRET=wa_gateway_super_secret_jwt_key_2026_prod_secure
DB_PATH=./data/wa.db
SESSIONS_DIR=./sessions_auth
TURNSTILE_SECRET_KEY=0x4AAAAAA...
GOOGLE_CLIENT_ID=...`,
 lang: 'env'
 },
 {
 title: '2. Tuning Performa SQLite Database (WAL Mode)',
 desc: 'Engine database secara otomatis menggunakan WAL mode dan in-memory tuning untuk performa transaksi tinggi:',
 items: [
 { label: 'PRAGMA journal_mode = WAL', value: 'Menghindari write-lock contention sehingga proses read & write berjalan simultan' },
 { label: 'PRAGMA synchronous = NORMAL', value: 'Memaksimalkan write IOPS dengan integritas data ACID terjamin' },
 { label: 'PRAGMA cache_size = -20000', value: 'Alokasi RAM cache database 20 MB untuk query instan' },
 { label: 'PRAGMA mmap_size = 268435456', value: 'Memory-mapped I/O 256 MB untuk kecepatan pembacaan log & antrean' },
 ]
 },
 {
 title: '3. Konfigurasi Nginx Reverse Proxy & SSL (Domain Publik)',
 desc: 'Gunakan Nginx untuk mengekspos panel dan backend ke domain publik dengan enkripsi HTTPS Let’s Encrypt:',
 code: `server {
 listen 80;
 server_name wa.domainanda.com;
 return 301 https://$host$request_uri;
}

server {
 listen 443 ssl http2;
 server_name wa.domainanda.com;

 ssl_certificate /etc/letsencrypt/live/wa.domainanda.com/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/wa.domainanda.com/privkey.pem;

 # Frontend Admin Panel
 location / {
 proxy_pass http://127.0.0.1:5174;
 proxy_set_header Host $host;
 proxy_set_header X-Real-IP $remote_addr;
 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 }

 # Backend API Gateway
 location /api/ {
 proxy_pass http://127.0.0.1:3100/api/;
 proxy_set_header Host $host;
 proxy_set_header X-Real-IP $remote_addr;
 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 proxy_set_header X-Forwarded-Proto $scheme;
 proxy_read_timeout 90s;
 }
}`,
 lang: 'nginx'
 }
 ]
 },
 {
 id: 'overview',
 label: '03. Getting Started / Overview',
 category: 'system',
 icon: <Zap size={15} />,
 intro: 'Arsitektur komponen, siklus hidup sesi WhatsApp (QR vs Pairing Code), hierarki tingkatan akun (Role), dan panduan tes kirim pesan pertama.',
 guideBlocks: [
 {
 title: 'Kredensial Default Login Awal (Fresh Install)',
 desc: 'Saat backend pertama kali dijalankan pada database yang masih baru/kosong, sistem otomatis membuatkan akun Super Admin perdana:',
 items: [
 { label: 'Default Email', value: 'admin@example.com', desc: 'Dapat disesuaikan lewat ENV: ADMIN_EMAIL' },
 { label: 'Default Password', value: 'admin123', desc: 'Dapat disesuaikan lewat ENV: ADMIN_PASSWORD' },
 { label: 'Role & Kuota', value: 'Super Admin (Unlimited ∞)', desc: 'Hak akses penuh ke seluruh pengaturan sistem dan API key' }
 ],
 callout: {
 type: 'warning',
 text: 'PENTING: Segera login ke panel dan perbarui password akun Admin Anda melalui menu Users & API Keys!'
 }
 },
 {
 title: 'Arsitektur Sistem & Alur Komunikasi',
 desc: 'WhatsApp Gateway Baileys v7 dirancang dengan pemisahan tanggung jawab yang jelas:',
 items: [
 { label: '1. Fastify REST API (:3100)', value: 'Pintu gerbang HTTP request, otentikasi JWT / API Key, validasi skema pesan, dan pencatatan selektif log.' },
 { label: '2. Multi-Tenant Session Resolver', value: 'Memetakan request pengiriman ke nomor WhatsApp yang tepat atau memilih sesi terbaik dari pool auto-rotate.' },
 { label: '3. 8-Layer Anti-Ban Engine', value: 'Melakukan throttling jitter delay dinamis, proteksi jam tidur (circadian), warmup limit, dan reply ratio.' },
 { label: '4. Baileys Noise Socket Engine', value: 'Mengirimkan paket pesan terenkripsi end-to-end langsung ke server WhatsApp Meta.' },
 { label: '5. SQLite WAL Engine', value: 'Penyimpanan persisten lokal untuk sesi, antrean pesan, receipt delivery status, dan audit logs.' },
 ]
 },
 {
 title: 'Hierarki Akun & Hak Akses (Role)',
 desc: 'Sistem mendukung 3 tingkat pengguna dengan fungsionalitas yang terisolasi:',
 items: [
 { label: 'Super Admin (admin)', value: 'Hak akses total: pengaturan sistem, audit API log lintas akun, rotasi API key siapa saja, dan bebas batas kuota (Unlimited).' },
 { label: 'Subscription Tier (subscription)', value: 'Ditandai dengan badge khusus: akun langganan dengan alokasi custom kuota pesan harian & mingguan fleksibel.' },
 { label: 'User Free (user)', value: 'Tier dasar gratis: dibatasi kuota standar (default 100 pesan/hari, reset setiap jam 00:00 WIB).' },
 ]
 },
 {
 title: 'Siklus Hidup Sesi (Session Lifecycle)',
 desc: 'Dua cara mudah menghubungkan nomor WhatsApp ke gateway:',
 items: [
 { label: 'Metode A: Scan QR Code', value: 'Buka menu Sessions ➔ Buat Sesi ➔ Buka WhatsApp di HP ➔ Perangkat Tertaut ➔ Scan QR yang muncul di layar.' },
 { label: 'Metode B: 8-Digit Pairing Code', value: 'Masukkan nomor HP berawalan 628xxx ➔ Masukkan kode 8 digit yang muncul di panel ke notifikasi WhatsApp HP Anda.' },
 { label: 'Auto-Restore Saat Restart', value: 'Sesi yang sudah terhubung akan otomatis direkoneksi kembali saat server reboot tanpa perlu scan ulang.' },
 ]
 },
 {
 title: 'Pengujian Kirim Pesan Pertama (Quick Test)',
 desc: 'Gunakan perintah cURL berikut dari terminal Anda (X-API-Key personal Anda sudah otomatis terisi di bawah):',
 code: `curl -s -X POST ${API_BASE}/messages/send \\
 -H"X-API-Key: ${getUserApiKey()}" \\
 -H"Content-Type: application/json" \\
 -d '{
"sessionId":"auto",
"to":"6281234567890",
"text":"Halo! Pesan pertama berhasil dikirim melalui WhatsApp API Gateway Baileys v7 🚀"
 }' | jq .`,
 lang: 'bash',
 callout: {
 type: 'tip',
 text: 'Parameter sessionId dapat diisi dengan ID sesi spesifik (misal: sess-mttrskn5) atau gunakan nilai"auto" agar sistem secara otomatis merotasi nomor yang tersedia di akun Anda.'
 }
 }
 ]
 },

 // ==========================================
 // REFERENSI ENDPOINT API (API REFERENCE)
 // ==========================================
 {
 id: 'auth',
 label: 'Authentication',
 category: 'api',
 icon: <ShieldCheck size={15} />,
 intro: 'Semua request API menggunakan header X-API-Key atau token JWT Bearer. X-API-Key digunakan untuk integrasi sistem eksternal, sedangkan JWT untuk panel admin.',
 endpoints: [
 {
 method: 'POST',
 path: '/auth/login',
 desc: 'Login user dengan email & password. Mengembalikan token JWT dan data user.',
 auth: 'Publik',
 curl: `curl -s -X POST ${API_BASE}/auth/login \\\n -H"Content-Type: application/json" \\\n -d '{"email":"admin@abdhnf.com","password":"yourpassword"}' | jq .`,
 body: '{\n"email":"admin@abdhnf.com",\n"password":"yourpassword"\n}',
 response: '{"token":"eyJhbGciOi...","user": {"id":"usr_c26f74d6","name":"Admin","email":"admin@abdhnf.com","role":"admin","apiKey":"wa_live_..."}}',
 },
 {
 method: 'GET',
 path: '/auth/me',
 desc: 'Ambil data profil pengguna yang sedang aktif, termasuk API key dan statistik kuota.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s ${API_BASE}/auth/me \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"id":"usr_c26f74d6","name":"Admin","email":"admin@abdhnf.com","role":"admin","apiKey":"wa_live_...","quotaPerDay": 100000,"usedToday": 10,"quotaPerWeek": 700000}',
 },
 {
 method: 'POST',
 path: '/auth/rotate-key',
 desc: 'Rotasi mandiri API key oleh user yang sedang login. Kunci lama akan langsung hangus.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X POST ${API_BASE}/auth/rotate-key \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"success": true,"apiKey":"wa_live_new_secret_..."}',
 },

 {
  method: 'POST',
  path: '/auth/blast-launch/regenerate',
  desc: 'Regenerate atau revoke Blast Access Token. Token lama langsung tidak berlaku.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/auth/blast-launch/regenerate \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"success": true,"token":"blst_new_...","launchUrl":"http://172.30.30.229:8085/auth/launch?token=blst_new_..."}',
 },
 {
  method: 'POST',
  path: '/auth/register',
  desc: 'Registrasi akun baru secara mandiri. Bisa dinonaktifkan Administrator lewat /settings.',
  auth: 'Publik',
  curl: `curl -s -X POST ${API_BASE}/auth/register \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"name":"Budi","email":"budi@example.com","password":"password123"}' \\\n
 | jq .`,
  body: '{\n"name":"Budi",\n"email":"budi@example.com",\n"password":"password123"\n}',
  response: '{"success": true,"user": {"id":"usr_abc123","name":"Budi","apiKey":"wa_live_..."}}',
 },
 {
  method: 'POST',
  path: '/auth/google',
  desc: 'Login atau registrasi otomatis memakai Google OAuth. Domain email dapat dibatasi oleh Administrator.',
  auth: 'Publik',
  curl: `curl -s -X POST ${API_BASE}/auth/google \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"credential":"<google-id-token>"}' \\\n
 | jq .`,
  body: '{\n"credential":"<google-id-token>"\n}',
  response: '{"token":"eyJhbGciOi...","user": {"id":"usr_abc123","email":"budi@example.com","role":"user"}}',
 },
 {
  method: 'GET',
  path: '/auth/config',
  desc: 'Konfigurasi autentikasi publik: apakah Google OAuth dan pendaftaran mandiri aktif, plus client ID untuk tombol login Google.',
  auth: 'Publik',
  curl: `curl -s -X GET ${API_BASE}/auth/config \\\n
 | jq .`,
  response: '{"googleAuthEnabled": false,"googleClientId":"","registrationEnabled": true}',
 }, ],
 },
 {
 id: 'sessions',
 label: 'Sessions',
 category: 'api',
 icon: <Smartphone size={15} />,
 intro: 'Manajemen sesi WhatsApp (multi-device). Setiap sesi merepresentasikan satu akun WhatsApp yang terhubung.',
 endpoints: [
 {
 method: 'GET',
 path: '/sessions',
 desc: 'Daftar semua sesi WhatsApp beserta status koneksi, risk score, dan metrik.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s ${API_BASE}/sessions \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"sessions": [{"id":"sess-mttrskn5","name":"Akun Utama","phone":"628xxx","status":"connected","riskScore": 12,"warmupDay": 3,"messagesSentToday": 15}]}',
 },
 {
 method: 'POST',
 path: '/sessions',
 desc: 'Buat sesi baru. Mengembalikan QR code untuk di-scan.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X POST ${API_BASE}/sessions \\\n -H"X-API-Key: ${getUserApiKey()}" \\\n -H"Content-Type: application/json" \\\n -d '{"name":"Nomor CS"}' | jq .`,
 body: '{\n"name":"Nomor CS",\n"phone":"6281234567890"\n}',
 response: '{"success": true,"session": {"id":"sess-xxx","status":"connecting","qr":"data:image/png;base64,..."}}',
 },
 {
 method: 'GET',
 path: '/sessions/:id/qr',
 desc: 'Ambil QR code terbaru untuk sesi yang sedang proses pairing.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s ${API_BASE}/sessions/sess-mttrskn5/qr \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"qr":"data:image/png;base64,...","status":"connecting"}',
 },
 {
 method: 'POST',
 path: '/sessions/:id/logout',
 desc: 'Logout sesi dari WhatsApp (putuskan koneksi, kredensial pairing tetap tersimpan).',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X POST ${API_BASE}/sessions/sess-mttrskn5/logout \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"success": true,"status":"disconnected"}',
 },
 {
 method: 'DELETE',
 path: '/sessions/:id',
 desc: 'Hapus sesi dan semua kredensial autentikasinya.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X DELETE ${API_BASE}/sessions/sess-mttrskn5 \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"success": true,"message":"Sesi berhasil dihapus"}',
 },

 {
  method: 'GET',
  path: '/sessions/:id',
  desc: 'Detail satu sesi: status koneksi, pemilik, risk score, dan metrik engine.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/sessions/sess-mttrskn5 \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"session": {"id":"sess-mttrskn5","name":"Akun Utama","phone":"628xxx","status":"connected","riskScore": 12}}',
 },
 {
  method: 'PATCH',
  path: '/sessions/:id',
  desc: 'Rename atau ganti profil sesi tanpa memutus koneksi WhatsApp.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X PATCH ${API_BASE}/sessions/sess-mttrskn5 \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"name":"Nomor CS Baru"}' \\\n
 | jq .`,
  body: '{\n"name":"Nomor CS Baru"\n}',
  response: '{"success": true,"session": {"id":"sess-mttrskn5","name":"Nomor CS Baru"}}',
 },
 {
  method: 'POST',
  path: '/sessions/:id/reconnect',
  desc: 'Sambungkan kembali sesi yang logout tanpa perlu scan QR ulang.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/sessions/sess-mttrskn5/reconnect \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"success": true,"status":"connecting"}',
 },
 {
  method: 'POST',
  path: '/sessions/:id/pair',
  desc: 'Re-pair sesi: hapus auth lama dan minta QR code baru untuk dipindai.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/sessions/sess-mttrskn5/pair \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"name":"Akun Utama","phone":"6281234567890"}' \\\n
 | jq .`,
  body: '{\n"name":"Akun Utama",\n"phone":"6281234567890"\n}',
  response: '{"success": true,"sessionId":"sess-mttrskn5","qr":"data:image/png;base64,...","session": {"status":"connecting"}}',
 },
 {
  method: 'GET',
  path: '/sessions/:id/queue/status',
  desc: 'Status antrean pengiriman sesi: jumlah pesan menunggu, sedang diproses, dan status jeda.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/sessions/sess-mttrskn5/queue/status \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"sessionId":"sess-mttrskn5","pending": 4,"sending": 1,"paused": false}',
 },
 {
  method: 'POST',
  path: '/sessions/:id/queue/pause',
  desc: 'Jeda antrean pengiriman sesi. Parameter reason bersifat opsional.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/sessions/sess-mttrskn5/queue/pause \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"reason":"Menunggu konfirmasi klien"}' \\\n
 | jq .`,
  body: '{\n"reason":"Menunggu konfirmasi klien"\n}',
  response: '{"success": true,"paused": true,"reason":"Menunggu konfirmasi klien"}',
 },
 {
  method: 'POST',
  path: '/sessions/:id/queue/resume',
  desc: 'Lanjutkan kembali antrean pengiriman yang dijeda.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/sessions/sess-mttrskn5/queue/resume \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"success": true,"paused": false}',
 },
 {
  method: 'POST',
  path: '/sessions/:id/queue/clear',
  desc: 'Kosongkan antrean pesan yang belum terkirim pada sesi ini.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/sessions/sess-mttrskn5/queue/clear \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"success": true,"cleared": 4}',
 }, ],
 },
 {
 id: 'antiban',
 label: 'Anti-Ban Engine',
 category: 'api',
 icon: <Sliders size={15} />,
 intro: 'WhatsApp Gateway dilengkapi anti-ban engine 8 layer terintegrasi: WarmUp, Rate Limiter, Timelock 463, Circadian Rhythm, Reconnect Throttle, Recovery Phase, Reply Ratio, dan Contact Graph.',
 endpoints: [
 {
 method: 'GET',
 path: '/sessions/:id/antiban',
 desc: 'Ambil status detail dan telemetri 8 layer anti-ban untuk sesi tertentu.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s ${API_BASE}/sessions/sess-mttrskn5/antiban \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"sessionId":"sess-mttrskn5","antiBan": {"warmup": {"day": 1,"todayLimit": 20,"todaySent": 3},"rateLimiter": {"lastMinute": 0,"lastHour": 3},"timelock": {"isActive": false},"circadianMultiplier": 1.02,"reconnectMultiplier": 1.0,"recovery": {"currentPhase":"normal"}}}',
 },

 {
  method: 'PUT',
  path: '/sessions/:id/antiban',
  desc: 'Update konfigurasi anti-ban per sesi: pilih preset (strict, balanced, broadcast) atau tuning manual per layer.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X PUT ${API_BASE}/sessions/sess-mttrskn5/antiban \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"preset":"balanced"}' \\\n
 | jq .`,
  body: '{\n"preset":"balanced"\n}',
  response: '{"success": true,"sessionId":"sess-mttrskn5","antiBan": {"preset":"balanced"}}',
 },
 {
  method: 'POST',
  path: '/sessions/:id/antiban/reset-cooldown',
  desc: 'Reset cooldown Reply Ratio, opsional untuk satu JID tertentu saja.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/sessions/sess-mttrskn5/antiban/reset-cooldown \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"jid":"6281234567890@s.whatsapp.net"}' \\\n
 | jq .`,
  body: '{\n"jid":"6281234567890@s.whatsapp.net"\n}',
  response: '{"success": true,"sessionId":"sess-mttrskn5","replyRatio": {"cooldownActive": false}}',
 },
 {
  method: 'GET',
  path: '/sessions/:id/contact-graph/batch/:batchId',
  desc: 'Status approval Contact Graph Layer 8 untuk satu batch kampanye: jumlah nomor terdaftar dan yang sudah lolos handshake.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/sessions/sess-mttrskn5/contact-graph/batch/batch_promo_ramadhan_2026 \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"sessionId":"sess-mttrskn5","batchId":"batch_promo_ramadhan_2026","approved": ["6281234567890@s.whatsapp.net"],"count": 1}',
 },
 {
  method: 'POST',
  path: '/sessions/:id/contact-graph/batch',
  desc: 'Daftarkan nomor penerima ke whitelist Contact Graph untuk satu batch kampanye. Nomor otomatis dinormalisasi ke format JID.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/sessions/sess-mttrskn5/contact-graph/batch \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"batchId":"batch_promo_ramadhan_2026","recipients": ["6281234567890","6289876543210"]}' \\\n
 | jq .`,
  body: '{\n"batchId":"batch_promo_ramadhan_2026",\n"recipients": ["6281234567890","6289876543210"]\n}',
  response: '{"success": true,"batchId":"batch_promo_ramadhan_2026","registered": 2}',
 },
 {
  method: 'DELETE',
  path: '/sessions/:id/contact-graph/batch/:batchId',
  desc: 'Cabut seluruh whitelist Contact Graph untuk satu batch kampanye.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X DELETE ${API_BASE}/sessions/sess-mttrskn5/contact-graph/batch/batch_promo_ramadhan_2026 \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"success": true,"batchId":"batch_promo_ramadhan_2026","revoked": 2}',
 }, ],
 },
 {
 id: 'messages',
 label: 'Messages',
 category: 'api',
 icon: <MessageSquare size={15} />,
 intro: 'Kirim pesan teks, gambar, dokumen, audio, video, dan lokasi. Dilengkapi validasi format nomor otomatis (auto-convert 08xx -> 628xx).',
 endpoints: [
 {
 method: 'POST',
 path: '/messages/send',
 desc: 'Kirim pesan teks. Mendukung parameter priority ("high" atau"normal"). Nilai"auto" pada sessionId akan memilih sesi dari pool yang tersedia.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X POST ${API_BASE}/messages/send \\\n -H"X-API-Key: ${getUserApiKey()}" \\\n -H"Content-Type: application/json" \\\n -d '{"sessionId":"auto","to":"6281234567890","text":"Halo dari API Gateway!"}' | jq .`,
 body: '{\n"sessionId":"auto",\n"to":"6281234567890",\n"text":"Halo dari WhatsApp Gateway Baileys v7!",\n"priority":"normal"\n}',
 response: '{"success": true,"messageId":"msg_abc123","status":"pending","sessionId":"sess-mttrskn5"}',
 },
 {
 method: 'POST',
 path: '/messages/send-media',
 desc: 'Kirim media (gambar, dokumen, audio, video). Mendukung mediaUrl atau mediaBase64.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X POST ${API_BASE}/messages/send-media \\\n -H"X-API-Key: ${getUserApiKey()}" \\\n -H"Content-Type: application/json" \\\n -d '{"sessionId":"auto","to":"6281234567890","mediaType":"image","mediaUrl":"https://example.com/foto.jpg","caption":"Lihat foto ini"}' | jq .`,
 body: '{\n"sessionId":"auto",\n"to":"6281234567890",\n"mediaType":"image",\n"mediaUrl":"https://example.com/foto.jpg",\n"caption":"Bukti Pengiriman",\n"priority":"normal"\n}',
 response: '{"success": true,"messageId":"msg_def456","status":"pending"}',
 },
 {
 method: 'POST',
 path: '/messages/send-bulk',
 desc: 'Kirim pesan ke banyak penerima sekaligus (maks 500 nomor per batch). Otomatis diproses antrean.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X POST ${API_BASE}/messages/send-bulk \\\n -H"X-API-Key: ${getUserApiKey()}" \\\n -H"Content-Type: application/json" \\\n -d '{"sessionId":"auto","recipients": ["6281234567890","6289876543210"],"text":"Broadcast promo"}' | jq .`,
 body: '{\n"sessionId":"auto",\n"recipients": ["6281234567890","6289876543210"],\n"text":"Pengumuman sistem terjadwal",\n"priority":"normal"\n}',
 response: '{"success": true,"batchId":"batch_789","queuedCount": 2}',
 },

 {
  method: 'POST',
  path: '/messages/send-location',
  desc: 'Kirim pesan lokasi (latitude & longitude). Nama dan alamat lokasi bersifat opsional.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/messages/send-location \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"sessionId":"auto","to":"6281234567890","latitude":-6.2088,"longitude":106.8456,"name":"Kantor Pusat"}' \\\n
 | jq .`,
  body: '{\n"sessionId":"auto",\n"to":"6281234567890",\n"latitude":-6.2088,\n"longitude":106.8456,\n"name":"Kantor Pusat"\n}',
  response: '{"success": true,"messageId":"msg_loc789","status":"pending"}',
 }, ],
 },
 {
 id: 'status',
 label: 'Message Status',
 category: 'api',
 icon: <FileText size={15} />,
 intro: 'Lacak status pengiriman pesan secara real-time: pending, pacing, sending, sent, delivered, read, atau failed.',
 endpoints: [
 {
 method: 'GET',
 path: '/messages/status/:id',
 desc: 'Ambil status pengiriman pesan berdasarkan messageId.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s ${API_BASE}/messages/status/msg_abc123 \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"messageId":"msg_abc123","status":"read","recipient":"6281234567890","sentAt":"2026-09-10T10:00:00.000Z"}',
 },

 {
  method: 'POST',
  path: '/messages/:id/retry',
  desc: 'Kirim ulang pesan yang gagal berdasarkan messageId.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/messages/msg_abc123/retry \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"success": true,"message": {"id":"msg_abc123","status":"pending"}}',
 },
 {
  method: 'GET',
  path: '/messages/status/bulk/:batchId',
  desc: 'Status seluruh pesan dalam satu batch kampanye sekaligus.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/messages/status/bulk/batch_789 \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"batchId":"batch_789","total": 2,"messages": [{"id":"msg_abc123","status":"delivered"}]}',
 }, ],
 },
 {
 id: 'users',
 label: 'Users & Quota',
 category: 'api',
 icon: <UsersIcon size={15} />,
 intro: 'Kelola akun pengguna, hak akses peran (admin, subscription, user), kuota pesan harian & mingguan, serta rotasi API key.',
 endpoints: [
 {
 method: 'GET',
 path: '/users',
 desc: 'Daftar semua pengguna gateway (khusus role Admin).',
 auth: 'JWT (Admin)',
 curl: `curl -s ${API_BASE}/users \\\n -H"Authorization: Bearer <TOKEN_ADMIN>" | jq .`,
 response: '{"users": [{"id":"usr_c26f74d6","name":"Admin","email":"admin@abdhnf.com","role":"admin","quotaPerDay": 100000,"usedToday": 35}]}',
 },
 {
 method: 'POST',
 path: '/users',
 desc: 'Buat pengguna baru. Role:"admin","subscription", atau"user".',
 auth: 'JWT (Admin)',
 curl: `curl -s -X POST ${API_BASE}/users \\\n -H"Authorization: Bearer <TOKEN_ADMIN>" \\\n -H"Content-Type: application/json" \\\n -d '{"name":"Client Pro","email":"pro@domain.com","password":"password123","role":"subscription","quotaPerDay": 2000}' | jq .`,
 body: '{\n"name":"Client Pro",\n"email":"pro@domain.com",\n"password":"password123",\n"role":"subscription",\n"quotaPerDay": 2000\n}',
 response: '{"success": true,"user": {"id":"usr_xxx","name":"Client Pro","apiKey":"wa_live_..."}}',
 },

 {
  method: 'POST',
  path: '/users/:id/rotate-key',
  desc: 'Rotasi API key milik pengguna lain (khusus Admin). Kunci lama langsung hangus.',
  auth: 'JWT (Admin)',
  curl: `curl -s -X POST ${API_BASE}/users/usr_abc123/rotate-key \\\n
 -H"Authorization: Bearer ***" \\\n
 | jq .`,
  response: '{"success": true,"apiKey":"wa_live_new_secret_..."}',
 },
 {
  method: 'PATCH',
  path: '/users/:id',
  desc: 'Update data pengguna: nama, role, kuota harian, atau sesi yang ditugaskan.',
  auth: 'JWT (Admin)',
  curl: `curl -s -X PATCH ${API_BASE}/users/usr_abc123 \\\n
 -H"Authorization: Bearer ***" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"quotaPerDay":5000,"role":"subscription"}' \\\n
 | jq .`,
  body: '{\n"quotaPerDay":5000,\n"role":"subscription"\n}',
  response: '{"success": true,"user": {"id":"usr_abc123","quotaPerDay":5000}}',
 },
 {
  method: 'DELETE',
  path: '/users/:id',
  desc: 'Hapus akun pengguna. Akun dengan sesi aktif akan ditolak.',
  auth: 'JWT (Admin)',
  curl: `curl -s -X DELETE ${API_BASE}/users/usr_abc123 \\\n
 -H"Authorization: Bearer ***" \\\n
 | jq .`,
  response: '{"success": true,"message":"User berhasil dihapus"}',
 },
 {
  method: 'POST',
  path: '/users/:id/reset-password',
  desc: 'Reset password pengguna tanpa perlu password lama. Minimal 6 karakter.',
  auth: 'JWT (Admin)',
  curl: `curl -s -X POST ${API_BASE}/users/usr_abc123/reset-password \\\n
 -H"Authorization: Bearer ***" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"password":"newpassword123"}' \\\n
 | jq .`,
  body: '{\n"password":"newpassword123"\n}',
  response: '{"success": true,"message":"Password berhasil direset"}',
 }, ],
 },
 {
 id: 'webhooks',
 label: 'Webhooks',
 category: 'api',
 icon: <Webhook size={15} />,
 intro: 'Konfigurasi webhook untuk menerima notifikasi real-time saat pesan masuk atau receipt status diperbarui.',
 endpoints: [
 {
 method: 'GET',
 path: '/webhooks',
 desc: 'Daftar webhook yang terdaftar untuk akun Anda.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s ${API_BASE}/webhooks \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"webhooks": [{"id":"wh_1","url":"https://my-app.com/wa-webhook","events": ["message.received","message.status"],"status":"active"}]}',
 },

 {
  method: 'POST',
  path: '/webhooks',
  desc: 'Daftarkan webhook baru untuk menerima notifikasi event. Secret dibuat otomatis bila tidak dikirim.',
  auth: 'X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/webhooks \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"url":"https://my-app.com/wa-webhook","events": ["message.received","message.status"]}' \\\n
 | jq .`,
  body: '{\n"url":"https://my-app.com/wa-webhook",\n"events": ["message.received","message.status"]\n}',
  response: '{"success": true,"webhookId":"whk_ab12cd34","status":"active"}',
 }, ],
 },
 {
 id: 'logs',
 label: 'API Logs & Maintenance',
 category: 'api',
 icon: <ScrollText size={15} />,
 intro: 'Audit riwayat mutasi API, pelacakan error, dan panduan otomasi retensi log database via Linux Crontab.',
 endpoints: [
 {
 method: 'GET',
 path: '/api-logs',
 desc: 'Ambil daftar riwayat log request API dengan pagination dan filter status.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s"${API_BASE}/api-logs?page=1&limit=25&status=error" \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"logs": [{"id":"log_123","method":"POST","endpoint":"/messages/send","statusCode": 400,"durationMs": 4,"errorMessage":"Nomor tidak valid"}],"total": 1,"totalPages": 1}',
 },
 {
 method: 'DELETE',
 path: '/api-logs',
 desc: 'Hapus satu atau beberapa baris log API berdasarkan array ID.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X DELETE ${API_BASE}/api-logs \\\n -H"X-API-Key: ${getUserApiKey()}" \\\n -H"Content-Type: application/json" \\\n -d '{"ids": ["log_123","log_456"]}' | jq .`,
 body: '{\n"ids": ["log_123","log_456"]\n}',
 response: '{"success": true,"message":"2 log berhasil dihapus"}',
 },
 {
 method: 'POST',
 path: '/api-logs/clear',
 desc: 'Pembersihan log lama (retensi). Parameter olderThanDays menentukan usia log yang dihapus.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X POST ${API_BASE}/api-logs/clear \\\n -H"X-API-Key: ${getUserApiKey()}" \\\n -H"Content-Type: application/json" \\\n -d '{"olderThanDays": 7}' | jq .`,
 body: '{\n"olderThanDays": 7\n}',
 response: '{"success": true,"deleted": 142,"message":"142 log lebih lama dari 7 hari berhasil dibersihkan"}',
 },
 ],
 },
 {
 id: 'usage',
 label: 'Usage & Health',
 category: 'api',
 icon: <Activity size={15} />,
 intro: 'Cek kesehatan gateway dan status penggunaan kuota pengiriman pesan akun.',
 endpoints: [
 {
 method: 'GET',
 path: '/usage',
 desc: 'Cek sisa kuota pengiriman pesan hari ini untuk akun Anda.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s ${API_BASE}/usage \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"quotaPerDay": 1000,"usedToday": 15,"remaining": 985}',
 },
 {
 method: 'GET',
 path: '/health',
 desc: 'Cek kesehatan server gateway tanpa autentikasi.',
 auth: 'Publik',
 curl: `curl -s ${API_BASE}/health | jq .`,
 response: '{"status":"ok","uptime": 1234.5,"sessions": 1}',
 },

 {
  method: 'GET',
  path: '/metrics',
  desc: 'Laporan metrik agregat seluruh sesi: throughput, latensi, dan distribusi status pengiriman.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/metrics \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"metrics": [{"sessionId":"sess-mttrskn5","sentToday": 15,"failedToday": 0}]}',
 },
 {
  method: 'GET',
  path: '/sessions/:id/metrics',
  desc: 'Laporan metrik satu sesi, termasuk status engine anti-ban (warmup, rate limiter, recovery phase).',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/sessions/sess-mttrskn5/metrics \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"metrics": {"sessionId":"sess-mttrskn5","sentToday": 15,"warmupDay": 3}}',
 }, ],
 },
 {
 id: 'blast-auth',
 label: 'Blast Dashboard SSO & PIN',
 category: 'api',
 icon: <LockIcon size={15} />,
 intro: 'Mekanisme One-Time Magic Launch Token dan verifikasi handshake 6-digit PIN untuk login WhatsApp Blast Dashboard tanpa password konvensional.',
 endpoints: [
 {
 method: 'POST',
 path: '/auth/blast-pin',
 desc: 'Atur atau ubah 6-digit PIN keamanan numerik akun untuk otorisasi WhatsApp Blast Dashboard.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X POST ${API_BASE}/auth/blast-pin \\\n -H"X-API-Key: ${getUserApiKey()}" \\\n -H"Content-Type: application/json" \\\n -d '{"pin":"123456"}' | jq .`,
 body: '{\n"pin":"123456"\n}',
 response: '{"success": true,"message":"PIN keamanan Blast Dashboard berhasil disimpan!"}',
 },
 {
 method: 'POST',
 path: '/auth/blast-launch',
 desc: 'Generate link peluncuran sekali pakai (One-Time Launch Token, TTL 10 menit). Membutuhkan PIN akun sudah tersetting.',
 auth: 'JWT atau X-API-Key',
 curl: `curl -s -X POST ${API_BASE}/auth/blast-launch \\\n -H"X-API-Key: ${getUserApiKey()}" | jq .`,
 response: '{"success": true,"token":"blst_7fa8b9c...","launchUrl":"http://172.30.30.229:8085/auth/launch?token=blst_7fa8b9c...","expiresInSeconds": 600,"hasBlastPin": true}',
 },
 {
 method: 'POST',
 path: '/auth/verify-blast-launch',
 desc: 'Verifikasi handshake dari backend Blast Dashboard. Token langsung dibakar (single-use burned) dan mengembalikan kredensial API key jika PIN benar.',
 auth: 'Publik (Server-to-Server Handshake)',
 curl: `curl -s -X POST ${API_BASE}/auth/verify-blast-launch \\\n -H"Content-Type: application/json" \\\n -d '{"token":"blst_7fa8b9c...","pin":"123456"}' | jq .`,
 body: '{\n"token":"blst_7fa8b9c...",\n"pin":"123456"\n}',
 response: '{"success": true,"user": {"id":"usr_abc","name":"Budi","email":"budi@example.com","role":"user","apiKey":"wa_live_sec_...","quotaPerWeek": 700,"usedInPeriod": 12}}',
 },
 ],
 },
 {
 id: 'media',
 label: 'Media & Files',
 category: 'api',
 icon: <HardDrive size={15} />,
 intro: 'Unggah dan kelola berkas media yang dipakai saat mengirim pesan. Berkas yang diunggah menghasilkan ID yang bisa langsung dipakai sebagai mediaUrl pada endpoint kirim pesan.',
 endpoints: [
 {
  method: 'POST',
  path: '/media/upload',
  desc: 'Unggah berkas media. Menerima JSON base64 (field data atau base64) maupun binary body dengan header X-File-Name.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/media/upload \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"data":"<base64>","mimeType":"image/jpeg","fileName":"foto.jpg"}' \\\n
 | jq .`,
  body: '{\n"data":"<base64>",\n"mimeType":"image/jpeg",\n"fileName":"foto.jpg"\n}',
  response: '{"success": true,"id":"a1b2c3d4e5f6a7b8c9d0e1f2.jpg","url":"/api/v1/media/a1b2c3d4e5f6a7b8c9d0e1f2.jpg"}',
 },
 {
  method: 'GET',
  path: '/media/:id',
  desc: 'Ambil berkas media berdasarkan ID. Endpoint ini publik tanpa autentikasi agar bisa dibaca WhatsApp saat mengunduh media.',
  auth: 'Publik',
  curl: `curl -s -X GET ${API_BASE}/media/a1b2c3d4e5f6a7b8c9d0e1f2.jpg \\\n
 | jq .`,
  response: '<binary image/jpeg>',
 },
 {
  method: 'DELETE',
  path: '/media/:id',
  desc: 'Hapus berkas media dari penyimpanan server.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X DELETE ${API_BASE}/media/a1b2c3d4e5f6a7b8c9d0e1f2.jpg \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"success": true,"message":"Media berhasil dihapus"}',
 },
 ],
},
 {
 id: 'queue-batches',
 label: 'Queue & Batches',
 category: 'api',
 icon: <Layers size={15} />,
 intro: 'Kontrol kampanye massal dan antrean pengiriman. Setiap batch memiliki ID yang dikembalikan oleh endpoint send-bulk dan dapat dijeda, dilanjutkan, atau dibersihkan secara terpisah.',
 endpoints: [
 {
  method: 'GET',
  path: '/batches/:batchId/status',
  desc: 'Status satu batch kampanye: apakah sedang dijeda dan berapa pesan yang tersisa.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/batches/batch_789/status \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"batchId":"batch_789","paused": false,"pending": 0}',
 },
 {
  method: 'POST',
  path: '/batches/:batchId/pause',
  desc: 'Jeda seluruh pengiriman dalam satu batch kampanye. Parameter reason bersifat opsional.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/batches/batch_789/pause \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"reason":"Menunggu approval klien"}' \\\n
 | jq .`,
  body: '{\n"reason":"Menunggu approval klien"\n}',
  response: '{"success": true,"paused": true}',
 },
 {
  method: 'POST',
  path: '/batches/:batchId/resume',
  desc: 'Lanjutkan kembali batch kampanye yang dijeda.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/batches/batch_789/resume \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"success": true,"paused": false}',
 },
 {
  method: 'POST',
  path: '/batches/:batchId/clear',
  desc: 'Batalkan dan kosongkan sisa antrean dalam satu batch kampanye.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X POST ${API_BASE}/batches/batch_789/clear \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"success": true,"cleared": 12}',
 },
 {
  method: 'GET',
  path: '/messages/:sessionId',
  desc: 'Riwayat pesan dengan paginasi dan filter. Gunakan nilai all atau auto pada sessionId untuk menggabungkan seluruh sesi.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/messages/all?limit=50&status=delivered&batchId=batch_789 \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"messages": [{"id":"msg_abc123","to":"6281234567890","status":"delivered"}],"total": 1}',
 },
 ],
},
 {
 id: 'settings',
 label: 'Settings & Auto-Rotate',
 category: 'api',
 icon: <Settings size={15} />,
 intro: 'Konfigurasi tingkat sistem (khusus Admin) dan strategi Auto-Rotate sesi untuk pemerataan beban pengiriman antar nomor.',
 endpoints: [
 {
  method: 'GET',
  path: '/settings',
  desc: 'Ambil konfigurasi sistem: status Google OAuth, pendaftaran publik, Turnstile, dan integrasi eksternal. Khusus Admin.',
  auth: 'JWT (Admin)',
  curl: `curl -s -X GET ${API_BASE}/settings \\\n
 -H"Authorization: Bearer ***" \\\n
 | jq .`,
  response: '{"settings": {"googleAuthEnabled": false,"registrationEnabled": true,"hasClientSecret": true}}',
 },
 {
  method: 'PATCH',
  path: '/settings',
  desc: 'Update konfigurasi sistem. Client secret yang dikirim akan disimpan, nilai kosong diabaikan. Khusus Admin.',
  auth: 'JWT (Admin)',
  curl: `curl -s -X PATCH ${API_BASE}/settings \\\n
 -H"Authorization: Bearer ***" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"registrationEnabled":false}' \\\n
 | jq .`,
  body: '{\n"registrationEnabled":false\n}',
  response: '{"success": true,"message":"Pengaturan berhasil disimpan"}',
 },
 {
  method: 'GET',
  path: '/autorotate/settings',
  desc: 'Ambil konfigurasi Auto-Rotate milik akun: status aktif, strategi, dan interval rotasi.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/autorotate/settings \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"settings": {"enabled": true,"strategy":"least_loaded"}}',
 },
 {
  method: 'PATCH',
  path: '/autorotate/settings',
  desc: 'Update konfigurasi Auto-Rotate akun: aktifkan/nonaktifkan, pilih strategi, dan atur daftar sesi dalam pool.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X PATCH ${API_BASE}/autorotate/settings \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 -H"Content-Type: application/json" \\\n
 -d '{"enabled":true,"strategy":"least_loaded"}' \\\n
 | jq .`,
  body: '{\n"enabled":true,\n"strategy":"least_loaded"\n}',
  response: '{"success": true,"message":"Pengaturan Auto-Rotate akun Anda berhasil diperbarui."}',
 },
 {
  method: 'GET',
  path: '/autorotate/status',
  desc: 'Status Auto-Rotate per sesi: mana yang masuk pool, beban terakhir, dan kapan terakhir dipakai.',
  auth: 'JWT atau X-API-Key',
  curl: `curl -s -X GET ${API_BASE}/autorotate/status \\\n
 -H"X-API-Key: ${getUserApiKey()}" \\\n
 | jq .`,
  response: '{"sessions": [{"id":"sess-mttrskn5","name":"Akun Utama","status":"connected","inPool": true}]}',
 },
 ],
},
 {
 id: 'admin',
 label: 'Admin & Audit',
 category: 'api',
 icon: <ShieldAlert size={15} />,
 intro: 'Endpoint khusus Administrator untuk audit aktivitas pengguna. Membutuhkan role admin pada token yang dipakai.',
 endpoints: [
 {
  method: 'GET',
  path: '/admin/users/:id/logs',
  desc: 'Audit log dan aktivitas satu pengguna: riwayat request, error, dan perubahan data. Khusus Super Admin / Admin.',
  auth: 'JWT (Admin)',
  curl: `curl -s -X GET ${API_BASE}/admin/users/usr_abc123/logs \\\n
 -H"Authorization: Bearer ***" \\\n
 | jq .`,
  response: '{"logs": [{"id":"log_123","method":"POST","endpoint":"/messages/send","statusCode": 202}]}',
 },
 ],
},
];

const methodColor: Record<string, string> = {
 GET: 'bg-pine-soft/10 text-pine border-pine/30',
 POST: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
 PUT: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
 PATCH: 'bg-honey/10 text-honey border-honey-line/30',
 DELETE: 'bg-clay/10 text-clay border-clay-line/30',
};

export const Docs: React.FC = () => {
 const [activeSection, setActiveSection] = useState('requirements');
 const [copied, setCopied] = useState<string | null>(null);

 const copyCode = (code: string, key: string) => {
 navigator.clipboard.writeText(code);
 setCopied(key);
 setTimeout(() => setCopied(null), 2000);
 };

 const active = sections.find(s => s.id === activeSection) || sections[0];

 const systemSections = sections.filter(s => s.category === 'system');
 const apiSections = sections.filter(s => s.category === 'api');

 return (
 <div className="flex flex-col lg:flex-row gap-6">
 {/* Sidebar Navigation */}
 <aside className="w-full lg:w-64 shrink-0">
 <div className="sticky top-20 space-y-4">
 
 {/* Header Reference */}
 <div className="bg-surface border border-line rounded-md p-3.5 space-y-1">
 <div className="flex items-center gap-2 text-pine font-bold text-xs">
 <BookOpen size={16} />
 <span>Dokumentasi Gateway</span>
 </div>
 <p className="text-[11px] text-ink-muted leading-tight">
 Panduan produksi & referensi REST API Baileys v7
 </p>
 </div>

 {/* Group 1: Panduan Sistem */}
 <div className="space-y-1">
 <div className="px-3 py-1 text-[10px] font-bold text-ink-faint uppercase tracking-wider flex items-center gap-1.5">
 <Server size={11} className="text-pine" />
 <span>Panduan Sistem & Setup</span>
 </div>
 {systemSections.map(section => (
 <button
 key={section.id}
 onClick={() => setActiveSection(section.id)}
 className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-xs font-medium transition cursor-pointer ${
 activeSection === section.id
 ? 'bg-pine-wash/70 text-pine-deep border border-pine-line/60 '
 : 'text-ink-muted hover:bg-surface hover:text-ink border border-transparent'
 }`}
 >
 <span className={activeSection === section.id ? 'text-pine' : 'text-ink-faint'}>
 {section.icon}
 </span>
 <span className="truncate">{section.label}</span>
 </button>
 ))}
 </div>

 {/* Group 2: Referensi API */}
 <div className="space-y-1 pt-2 border-t border-line/80">
 <div className="px-3 py-1 text-[10px] font-bold text-ink-faint uppercase tracking-wider flex items-center gap-1.5">
 <Terminal size={11} className="text-sky-400" />
 <span>Referensi Endpoint API</span>
 </div>
 {apiSections.map(section => (
 <button
 key={section.id}
 onClick={() => setActiveSection(section.id)}
 className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left text-xs font-medium transition cursor-pointer ${
 activeSection === section.id
 ? 'bg-sky-950/70 text-sky-300 border border-sky-800/60 '
 : 'text-ink-muted hover:bg-surface hover:text-ink border border-transparent'
 }`}
 >
 <span className={activeSection === section.id ? 'text-sky-400' : 'text-ink-faint'}>
 {section.icon}
 </span>
 <span className="truncate">{section.label}</span>
 {section.endpoints && (
 <span className="ml-auto text-[10px] px-1.5 py-0.2 rounded-md bg-surface-sunken text-ink-muted font-mono border border-line">
 {section.endpoints.length}
 </span>
 )}
 </button>
 ))}
 </div>

 </div>
 </aside>

 {/* Main Content Area */}
 <main className="flex-1 min-w-0 space-y-4">
 
 {/* Header Section Banner */}
 <div className="bg-surface border border-line rounded-md p-5 sm:p-6 space-y-2">
 <div className="flex items-center gap-2.5">
 <div className={`p-2 rounded-md border ${
 active.category === 'system'
 ? 'bg-pine-wash/80 text-pine border-pine-line/60'
 : 'bg-sky-950/80 text-sky-400 border-sky-800/60'
 }`}>
 {active.icon}
 </div>
 <div>
 <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border ${
 active.category === 'system'
 ? 'bg-pine-wash text-pine border-pine-line/50'
 : 'bg-sky-950 text-sky-400 border-sky-800/50'
 }`}>
 {active.category === 'system' ? 'Panduan Sistem' : 'API Endpoint Reference'}
 </span>
 <h2 className="text-lg sm:text-xl font-bold text-ink mt-1">{active.label}</h2>
 </div>
 </div>
 <p className="text-xs sm:text-sm text-ink-soft leading-relaxed pt-1">
 {active.intro}
 </p>
 </div>

 {/* Render Mode 1: SYSTEM GUIDE BLOCKS */}
 {active.category === 'system' && active.guideBlocks && (
 <div className="space-y-4">
 {active.guideBlocks.map((block, idx) => (
 <div key={idx} className="bg-surface border border-line rounded-md p-5 sm:p-6 space-y-3.5">
 <h3 className="text-sm sm:text-base font-bold text-ink flex items-center gap-2">
 <span className="w-1.5 h-4 bg-pine-soft rounded-sm" />
 {block.title}
 </h3>

 {block.desc && (
 <p className="text-xs sm:text-sm text-ink-soft leading-relaxed">
 {block.desc}
 </p>
 )}

 {/* Structured Key-Value List */}
 {block.items && (
 <div className="grid grid-cols-1 gap-2 pt-1">
 {block.items.map((it, i) => (
 <div key={i} className="p-3 bg-surface-sunken border border-line rounded-md space-y-1">
 <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
 <span className="text-xs font-semibold text-pine">{it.label}</span>
 <span className="text-xs font-mono text-ink">{it.value}</span>
 </div>
 {it.desc && (
 <p className="text-[11px] text-ink-muted pt-0.5">{it.desc}</p>
 )}
 </div>
 ))}
 </div>
 )}

 {/* Code Block Snippet */}
 {block.code && (
 <div className="space-y-1 pt-1">
 <div className="flex items-center justify-between text-[11px] text-ink-muted font-mono px-1">
 <span className="flex items-center gap-1">
 <Terminal size={12} className="text-pine" />
 <span>{block.lang || 'bash'}</span>
 </span>
 <button
 onClick={() => copyCode(block.code!, `block-${idx}`)}
 className="flex items-center gap-1 text-pine hover:text-pine-deep transition cursor-pointer font-sans"
 >
 {copied === `block-${idx}` ? <Check size={12} /> : <Copy size={12} />}
 <span>{copied === `block-${idx}` ? 'Tersalin!' : 'Salin Kode'}</span>
 </button>
 </div>
 <pre className="wa-codeblock text-xs font-mono">
 {block.code}
 </pre>
 </div>
 )}

 {/* Bullet Notes / Tips */}
 {block.notes && block.notes.length > 0 && (
 <div className="p-3 bg-pine-wash/20 border border-pine-line/40 rounded-md space-y-1.5 mt-2">
 <div className="text-[11px] font-semibold text-pine flex items-center gap-1.5">
 <Sparkles size={13} />
 <span>Catatan & Tips:</span>
 </div>
 <ul className="space-y-1 pl-4 list-disc text-xs text-ink-soft">
 {block.notes.map((note, nIdx) => (
 <li key={nIdx} className="leading-relaxed">{note}</li>
 ))}
 </ul>
 </div>
 )}

 {/* Callout Box */}
 {block.callout && (
 <div className={`p-3.5 rounded-md border flex items-start gap-2.5 text-xs ${
 block.callout.type === 'warning'
 ? 'bg-honey-wash/40 border-honey-line/50 text-honey-deep'
 : block.callout.type === 'tip'
 ? 'bg-pine-wash/40 border-pine-line/50 text-pine-deep'
 : 'bg-sea-wash/40 border-sea-line/50 text-sea-deep'
 }`}>
 {block.callout.type === 'warning' ? (
 <AlertTriangle size={16} className="text-honey shrink-0 mt-0.5" />
 ) : (
 <CheckCircle2 size={16} className="text-pine shrink-0 mt-0.5" />
 )}
 <span className="leading-relaxed">{block.callout.text}</span>
 </div>
 )}
 </div>
 ))}
 </div>
 )}

 {/* Render Mode 2: API ENDPOINT REFERENCE */}
 {active.category === 'api' && active.endpoints && (
 <div className="space-y-4">
 {active.endpoints.map((ep, idx) => (
 <div key={ep.path + idx} className="bg-surface border border-line rounded-md overflow-hidden">
 {/* Endpoint Header */}
 <div className="px-5 py-3.5 border-b border-line bg-surface-sunken/60 flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-2.5 flex-wrap">
 <span className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono font-bold ${methodColor[ep.method]}`}>
 {ep.method}
 </span>
 <code className="text-xs sm:text-sm text-ink font-mono font-semibold">{ep.path}</code>
 </div>
 <span className="text-[10px] px-2.5 py-0.5 rounded-sm bg-surface-sunken border border-line text-ink-muted font-mono">
 {ep.auth}
 </span>
 </div>

 {/* Endpoint Details */}
 <div className="px-5 py-4 space-y-3.5">
 <p className="text-xs sm:text-sm text-ink-soft leading-relaxed">{ep.desc}</p>

 {ep.body && (
 <div className="space-y-1">
 <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">
 Request Body (JSON)
 </span>
 <pre className="bg-surface-sunken border border-line rounded-md p-3 text-xs text-sky-300 font-mono overflow-x-auto">
 {ep.body}
 </pre>
 </div>
 )}

 <div className="space-y-1">
 <div className="flex items-center justify-between text-[10px] font-bold text-ink-faint uppercase tracking-wider">
 <span className="flex items-center gap-1">
 <Terminal size={12} className="text-pine" />
 <span>Contoh Perintah cURL (Live Key)</span>
 </span>
 <button
 onClick={() => copyCode(ep.curl, ep.path + idx)}
 className="flex items-center gap-1 text-pine hover:text-pine-deep transition cursor-pointer font-sans"
 >
 {copied === (ep.path + idx) ? <Check size={12} /> : <Copy size={12} />}
 <span>{copied === (ep.path + idx) ? 'Tersalin!' : 'Salin cURL'}</span>
 </button>
 </div>
 <pre className="wa-codeblock text-xs font-mono">
 {ep.curl}
 </pre>
 </div>

 {ep.response && (
 <div className="space-y-1">
 <span className="text-[10px] font-bold text-ink-faint uppercase tracking-wider">
 Contoh Response (HTTP 200)
 </span>
 <pre className="bg-surface-sunken border border-line rounded-md p-3 text-xs text-pine-deep font-mono overflow-x-auto">
 {ep.response}
 </pre>
 </div>
 )}
 </div>
 </div>
 ))}
 </div>
 )}

 </main>
 </div>
 );
};

export default Docs;
