# Changelog

Semua perubahan penting pada `wa-api` didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
[Semantic Versioning](https://semver.org/lang/id/).

---

## [Unreleased] — Registrasi akun & email selamat datang

**Tema:** notifikasi email saat pendaftaran, kolom nomor WhatsApp di form registrasi, dan halaman pengenalan setelah daftar lewat Google.
**Basis:** `c896df3` (main).

Ringkasan: pendaftaran sebelumnya tidak memberi umpan balik apa pun — akun terbentuk, tetapi pengguna tidak menerima email dan tidak tahu batas pemakaiannya. Pendaftar lewat Google lebih parah lagi: mereka tidak melewati formulir, sehingga akun terbentuk tanpa nomor WhatsApp dan tanpa penjelasan kuota. Tiga hal itu ditutup di sini.

### Added

- **Email selamat datang untuk dua jalur pendaftaran** (`backend/src/notifikasi-email.ts`, `backend/src/mail-templates.ts`).
  Dikirim setelah akun benar-benar terbentuk, dengan isi yang dibedakan menurut jalurnya:
  - Pendaftaran form manual: tombol mengarah ke dashboard.
  - Pendaftaran lewat Google: tombol "Lengkapi Nomor WhatsApp" mengarah ke `/onboarding`.
  Email hanya dikirim untuk akun yang **baru dibuat**. Pengguna lama yang login ulang tidak dikirimi lagi — dibedakan lewat `upsertGoogleUser()` yang kini mengembalikan `{ user, baru }`.
  Kegagalan kirim email sengaja tidak melempar galat: akun sudah ada di database, dan SMTP yang mati tidak boleh membatalkan pendaftaran.

- **Kolom nomor WhatsApp di form registrasi** (`panel/src/components/AuthPage.tsx`, `backend/src/server.ts`).
  Opsional, bertipe `tel`. Nomor dinormalkan ke bentuk kanonik `628...` lewat `normalisasiNomor()` yang sudah dipakai endpoint admin, sehingga `0812-3456-789` dan `+62 812 3456 789` tersimpan identik. Nomor tidak valid ditolak `400` dengan pesan yang menyebut format yang diterima; nomor yang sudah dipakai akun lain ditolak `409`.

- **Halaman pengenalan setelah daftar lewat Google** (`panel/src/components/OnboardingPage.tsx`, rute `/onboarding`).
  Menampilkan sisa kuota harian dan mingguan, lalu meminta nomor WhatsApp. Nomor boleh dikosongkan dan masih dapat dilengkapi kapan saja. Halaman ini hanya muncul untuk akun Google yang baru dibuat, ditandai lewat `perluOnboarding` pada respons `/auth/google`.

- **`PATCH /api/v1/auth/me`** (`backend/src/server.ts`).
  Melengkapi profil sendiri. Dipakai halaman pengenalan untuk menyimpan nomor tanpa akses admin. Menolak nomor tidak valid (`400`) dan nomor milik akun lain (`409`); kirim `phone: ""` untuk menghapus nomor.

- **Uji end-to-end pendaftaran** (`backend/scripts/uji-e2e-daftar.mjs`, 40 pemeriksaan).
  Mendaftar lewat HTTP sungguhan, menangkap email di SMTP sink lokal, lalu membaca kembali isinya — jadi yang diperiksa adalah email yang benar-benar diterima pengguna, bukan template yang dipanggil langsung. Mencakup pula penolakan nomor, tabrakan nomor antar akun, dan toggle pendaftaran publik.

- **Pratinjau email pendaftaran** (`backend/scripts/generate-preview-email.mjs`).
  Dua varian (manual dan Google) disajikan berdampingan supaya perbedaan isinya terlihat langsung.

### Fixed

- **Toggle pendaftaran publik tidak dihormati endpoint** (`backend/src/server.ts`).
  `registration_enabled = false` hanya menyembunyikan formulir di UI; `POST /auth/register` tetap terbuka bagi siapa pun yang tahu alamatnya. Endpoint kini menolak `403` saat toggle mati. Pendaftaran lewat Google sengaja tetap diizinkan — perilaku lama yang dipertahankan dan kini tertulis eksplisit di kode.

- **Nomor WhatsApp basi di panel setelah onboarding** (`panel/src/App.tsx`).
  `onSelesai` menghapus penanda onboarding dari objek state `auth.user` yang diambil saat halaman dibuka, lalu menulisnya kembali ke `localStorage` — menimpa nomor yang baru saja disimpan. Akibatnya panel menampilkan nomor kosong meski server sudah menyimpannya. Kini penanda dihapus dari data yang sudah tersimpan.

### Security

- **`passwordHash` ikut terkirim ke browser lewat `POST /auth/google`** (`backend/src/server.ts`).
  Handler mengembalikan objek user utuh, sehingga hash password ikut dalam respons dan tersimpan di `localStorage` panel. Sudah disamakan dengan `/auth/login` yang memakai daftar field eksplisit. Terverifikasi: respons kini memuat 0 kemunculan `passwordHash`.

### Notes for reviewer

- 40/40 uji baru lulus; tiga uji lama (`uji-reset-password`, `uji-telepon`, `uji-e2e-reset`) dijalankan ulang tanpa regresi.
- Terverifikasi di browser: pendaftaran manual lewat UI menyimpan `6281277776666`; klik Google mengarahkan ke `/onboarding`; menyimpan nomor dari onboarding mengisi `6281922221111` dan menghapus penanda. Responsif pada 375/768/1440 px tanpa overflow horizontal.
- Sudah dideploy ke VM dev 207 dan diverifikasi: `dist` backend identik dengan build lokal (md5 empat berkas), bundel panel identik (md5 JS dan CSS), 3 sesi WhatsApp tetap `connected` setelah restart, dan satu email pendaftaran sungguhan terkirim lewat Brevo.
- **Batas cakupan:** jalur Google **belum diuji di produksi**. Google OAuth di VM dev belum aktif dan mengaktifkannya butuh Client ID sungguhan. Alur tersebut baru terbukti di lingkungan uji dengan GSI disimulasikan.
- Dependensi `nodemailer@10.0.14` disalin manual ke `node_modules` VM. `package.json` VM **tidak boleh diubah** — auto-install pnpm gagal karena `pnpm` tidak ada di PATH systemd, dan `wa-backend.service` akan mati.

---

## [Unreleased]

### Docs
- **API Reference lengkap**: `panel/src/components/Docs.tsx` kini mendokumentasikan **65/65 endpoint** (sebelumnya 24 entri, 22 cocok). Ditambahkan 43 endpoint yang belum terdokumentasi, termasuk Contact Graph whitelist (Layer 8), Queue & Batches, Media & Files, Auto-Rotate, dan Admin audit.
- **Perbaikan path salah** (terverifikasi terhadap `server.ts`):
  - `POST /sessions/:id/disconnect` -> `POST /sessions/:id/logout` (route `disconnect` tidak pernah ada).
  - `GET /messages/:id/status` -> `GET /messages/status/:id` (urutan segmen terbalik).
  - `README.md`: `/api/v1/messages/media` -> `/api/v1/messages/send-media`.
- **4 section baru** di UI Docs: Media & Files, Queue & Batches, Settings & Auto-Rotate, Admin & Audit.
- Tipe `method` dan peta warna diperluas agar `PUT` terdukung (dipakai `/sessions/:id/antiban`).

 — branch `main`

**Tema:** refactor UI/UX Contact Graph Whitelist ke Dedicated Modal & responsif Delivery Queue mobile.

### Added

- **Dedicated Modal Manajemen Whitelist Contact Graph** (`panel/src/components/RealtimeMonitor.tsx`).
  Mengisolasi pengelolaan batch whitelist penerima ke dalam modal dialog terpisah (`showContactGraphModal`), memisahkan antara pemantauan metrik dan manajemen data:
  - **Grid Anti-Ban Simetris**: Kartu Layer 8 (Contact Graph) tetap kompak dengan tinggi seragam (222px) sejajar Layer 5–7, menampilkan ringkasan status batch dan 1 tombol aksi bersih `Kelola Whitelist Penerima...`.
  - **Quick Batch Selector**: Tombol pill interaktif untuk memilih dan beralih cepat antar kampanye yang telah memiliki whitelist.
  - **Live Phone Detection Counter**: Textarea pendaftaran otomatis menghitung jumlah nomor valid secara real-time sebelum didaftarkan.
  - **Search & Filter Penerima**: Menyediakan kolom pencarian nomor telepon instan saat batch memiliki puluhan hingga ratusan nomor.
  - **Aksi Cabut Granular & Massal**: Mendukung pencabutan per nomor (`handleRevokeBatchRecipient`) maupun seluruh nomor per batch (`handleRevokeBatchAll`).

### Fixed

- **Overflow horizontal header Delivery Queue pada viewport mobile** (`panel/src/components/RealtimeMonitor.tsx`).
  Sebelumnya kontainer header tabel dipaksa dalam satu baris horizontal (`flex items-center justify-between`) tanpa pembungkus (`wrap`). Setelah penambahan selector page size (`10, 25, 50, 100`), lebar konten melebar hingga 540px pada viewport 375px (`scrollWidth: 540` vs `clientWidth: 349`), mengakibatkan judul terhimpit 87px dan tombol kontrol antrean meluap keluar batas kartu.
  Diperbaiki dengan reflow responsif:
  - Header utama berubah menjadi susunan bertingkat (`flex-col lg:flex-row lg:items-center justify-between gap-3`).
  - Toolbar kontrol antrean (tombol Jeda/Lanjut, selector baris per halaman, dan counter badge) dibungkus rapi dengan `flex-wrap gap-2`.
  - Paginasi footer disesuaikan dengan touch target ergonomis (`h-8 w-8`) dan teks status halaman yang ringkas (`Hal X/Y`) agar muat rapi di satu baris tanpa scroll horizontal.

### Notes for reviewer

- Terverifikasi via Browser CDP live pada viewport 375x812: `header.clientWidth: 349, header.scrollWidth: 349`, zero horizontal overflow. Tampilan desktop (1280px) tetap sejajar horizontal tanpa regresi.

---

## [Merged] — branch `fix/antiban-guard-resilience-20260916`

**Tema:** resiliensi guard anti-ban, auto-resume antrean, persistensi status jeda.
**Basis:** `570d547` (main). **Sudah di-merge ke `main` dan berjalan di produksi.**

Ringkasan singkat untuk tim dev: sebelumnya 3 dari 4 guard anti-ban membuang pesan
ke status `failed` permanen saat terpicu, sementara satu-satunya guard yang menahan
pesan justru memacetkan antrean karena `pauseQueue()` tidak punya jalur pemulihan
otomatis. Branch ini menyeragamkan semuanya menjadi "tahan pesan + jeda sementara +
lanjut sendiri", mempersist status jeda agar bertahan melewati restart, memperbaiki
bug yang membuat delay pacing terkalikan 10x, dan memperbaiki `db.ts` yang selalu
gagal pada instalasi database baru.

### Fixed

- **`db.ts` selalu gagal pada database baru** (`db.ts`).
  Blok `CREATE INDEX` dijalankan **sebelum** `ensureColumn()`, padahal 5 dari 8 index
  menyentuh kolom yang baru ditambahkan lewat migrasi ringan (`priority`, `batch_id`,
  `user_id`, `wa_message_id`). Fresh install selalu berhenti dengan
  `no such column: priority`. Blok index dipindah ke setelah seluruh `ensureColumn`.
  Ditemukan saat menyiapkan lingkungan uji — sebelumnya tidak terlihat karena
  database produksi sudah punya semua kolom.

- **`record()` dan `getDelay()` memakai hash yang berbeda** (`antiban.ts`).
  `record()` meng-hash konten mentah sementara `getDelay()`/`getDelayReason()`
  meng-hash konten ternormalisasi, sehingga kunci pelacak tidak pernah cocok dan
  guard anti-spam tidak menyala. Keduanya kini memakai hash yang sama.

- **Delay pacing terkalikan 10x pada setiap pengiriman** (`session-manager.ts`).
  `ab.reconnect.onReconnect()` dipanggil di jalur sukses kirim pesan, sehingga
  `ReconnectThrottle.multiplier` selalu bernilai ~0.1 dan setiap `totalDelay`
  terbagi 0.1 (efektif dikali 10). Bukti dari data produksi: dari 97 pesan,
  14 pesan mencatat `jitter_delay_ms` 25–60 detik padahal batas desain preset
  `balanced` hanya ~11 detik. Pemanggilan dihapus; throttle kini hanya dipicu
  oleh reconnect socket sungguhan lewat `engine.onReconnectCallback`.

- **Guard anti-spam konten identik tidak pernah aktif** (`antiban.ts`).
  Hash konten dihitung dari pesan hasil render, sementara dashboard menyisipkan
  nama penerima per kontak. Akibatnya 52 pesan blast dengan isi identik
  menghasilkan 52 hash berbeda dan `maxIdenticalMessages` tidak pernah tercapai.
  Ditambahkan `normalizeContentForHash()` yang menyamarkan baris personalisasi
  (`Yth.`, `Kepada`, `Dear`, `Halo`, `Hai`, `Hi`) sebelum hashing. Pesan tanpa
  baris sapaan tidak terpengaruh.

- **Pesan hilang dari antrean saat guard memblokir** (`session-manager.ts`).
  Guard `timelock`, `replyRatio`, dan `contactGraph` menandai pesan `failed`
  lalu `continue` — pesan permanen keluar dari antrean tanpa retry. Kini
  keempat guard memakai pola yang sama dengan rate limiter: pesan dikembalikan
  ke depan antrean (`holdMessageAtFront`) lalu antrean dijeda sementara.

### Added

- **Penjadwal auto-resume antrean** (`session-manager.ts` → `scheduleAutoResume()`).
  Sebelumnya satu-satunya pemanggil `resumeQueue()` adalah endpoint manual, jadi
  setiap `pauseQueue()` otomatis berarti antrean berhenti sampai ada manusia yang
  klik Resume. Sekarang setiap jeda otomatis menjadwalkan pembukaan kembali:
  sisa waktu blokir dijepit ke rentang **5 detik – 1 jam** dengan margin 5%,
  timer bersifat `unref()` agar tidak menahan proses Node, dan jadwal yang lebih
  cepat tidak ditimpa oleh jadwal yang lebih lambat.

- **Persistensi status jeda antrean** (`db.ts`, `session-manager.ts`).
  `pausedSessions` dan `pausedBatches` sebelumnya hanya in-memory, sehingga
  restart service menghapus seluruh jeda dan antrean langsung berjalan kembali
  tanpa sepengetahuan operator. Kini disimpan ke tabel `settings`
  (`queue_paused_sessions`, `queue_paused_batches`) dan dipulihkan saat startup
  lewat `restoreQueuePauseState()`, dipanggil dari `recoverPendingMessages()`.
  Entri non-jeda dibuang saat disimpan agar tabel tidak menumpuk data basi.

- **`remainingMs()` pada setiap guard** (`antiban.ts`) sebagai sumber waktu tunggu
  bagi penjadwal auto-resume: `TimelockGuard`, `ReplyRatioGuard`,
  `BanRecoveryOrchestrator`, dan `ContactGraphWarmer`.

- **Flag `distraction` per-preset anti-ban** (`antiban.ts`). `PresenceChoreographer`
  punya jeda "distraksi manusiawi" 5–20 menit dengan peluang 5%. Untuk blast 52
  pesan itu berarti 2–3 pesan terkena jeda panjang tanpa alasan. Flag ini
  `false` pada preset `broadcast` dan `strict`, tetap `true` pada `balanced`
  (chat interaktif).

- **`autoResumeInMs` pada `QueueSessionStatus`** (`types.ts`) supaya UI dapat
  menampilkan sisa waktu sampai antrean terbuka kembali.

### Changed

- **Guard pesan identik kini dihitung per penerima** (`antiban.ts`).
  Sebelumnya `maxIdenticalMessages` dihitung global per konten, sehingga setelah
  normalisasi hash aktif, pengumuman yang sama ke 52 orang akan diblokir — padahal
  itu broadcast yang sah. Kunci pelacak kini gabungan **penerima + hash konten**:
  - Pengumuman sama ke 52 penerima berbeda → lolos (broadcast normal)
  - Pesan sama 12x ke satu orang → diblokir di ambang preset
  - 12 pesan berbeda ke satu orang → lolos

- **`normalizeContentForHash()` diekspor** dari `antiban.ts` agar dapat diuji
  terpisah dan dipakai ulang oleh jalur validasi lain.

### Catatan penting untuk reviewer

- Perubahan ini **belum diuji terhadap nomor WhatsApp produksi**. Verifikasi yang
  dilakukan bersifat unit/integration test lokal + smoke test server (lihat bagian
  Verifikasi) — bukan uji lapangan.
- **Dampak kecepatan:** menghapus `onReconnect()` di jalur sukses membuat
  pengiriman blast menjadi **~10x lebih cepat** dari kondisi saat ini. Ini adalah
  keputusan throughput, **bukan** peningkatan keamanan nomor. Untuk blast bervolume
  besar, pertimbangkan preset `broadcast` dan pantau metrik 463/429.
- `contactGraph` masih berstatus `enabled: false` (default). Jika diaktifkan,
  kontak baru akan diblokir sampai handshake 1 jam — pastikan perilaku ini
  diinginkan sebelum mengaktifkannya di production.

### Verifikasi

**38 skenario uji** dijalankan terhadap hasil build (`dist/`) dan server nyata di
port terpisah (bukan production):

*Round 1 — guard & auto-resume (22 skenario):*
- Normalisasi hash: 52 pesan identik → 1 hash; konten berbeda tetap beda hash;
  pesan tanpa baris sapaan tidak berubah.
- Flag `distraction`: 0 dari 20.000 pesan pada preset `broadcast` terkena jeda;
  preset `balanced` tetap ~5%.
- `remainingMs()`: idle → 0, aktif → positif, guard nonaktif → 0.
- Penjadwal auto-resume: penjepitan batas bawah/atas, pembersihan saat resume
  manual, dan antrean benar-benar terbuka sendiri setelah masa blokir lewat.

*Round 2 — db fresh install, persistensi, guard identik (16 skenario):*
- `db.ts` berhasil inisialisasi pada database kosong dan membentuk 8 index.
- Status jeda tersimpan, entri non-jeda dibuang, dan instance `SessionManager`
  baru memulihkan jeda dari database (simulasi restart).
- Guard identik: broadcast 52 orang berbeda → 0 diblokir; spam 12x ke satu orang
  → diblokir; 12 pesan berbeda ke satu orang → 0 diblokir.

*Smoke test server (`dist/server.js`, database bersih, port 3199):*
- `GET /api/v1/health` → `{"status":"ok"}`.
- `GET /sessions/:id/queue/status` mengembalikan field baru `autoResumeInMs`.
- `POST /batches/:id/pause` menulis ke tabel `settings`.
- **Setelah proses benar-benar dimatikan dan dijalankan ulang**, batch masih
  berstatus `isPaused: true` dengan alasan aslinya — membuktikan persistensi
  bekerja lintas restart.

### Diketahui belum diperbaiki (di luar cakupan branch ini)

- **Dua sumber kebenaran untuk status pause.** Dashboard *set* jeda per-batch
  (`pauseBatch`) tetapi *membaca* per-sesi (`fetchQueueStatus`). UI bisa
  menampilkan status yang keliru.
- **Status `pending` masih ambigu** — dipakai untuk "menunggu di dashboard"
  sekaligus "menunggu di gateway".
- **Pembatalan kampanye masih tercatat `failed`,** bukan `cancelled`, sehingga
  ikut menurunkan `delivery_rate` sesi.
- **Dashboard belum punya selector preset antiban.** Endpoint backend
  (`getAntiBanStatus` / `updateAntiBanSettings`) sudah tersedia.
- **Monitoring report-rate belum ada.** Tidak ada pengukuran berapa penerima yang
  mem-block/report nomor — padahal ini faktor paling menentukan reputasi nomor.
- **`date.timezone = PRC` pada `php.ini`** (UTC+8) di server; Laravel sudah aman
  lewat `APP_TIMEZONE`, tetapi kode PHP yang memakai `date()` native masih drift.
- **`onTimelockUpdate()` belum pernah dipanggil**, sehingga `timeEnforcementEnds`
  asli dari WhatsApp tidak pernah dipakai (timelock selalu berasumsi 60 detik).
