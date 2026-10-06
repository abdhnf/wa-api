# Changelog

Semua perubahan penting pada `wa-api` didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
[Semantic Versioning](https://semver.org/lang/id/).

---

## [Unreleased] — Waktu per transisi status pesan

Fitur ini menjawab satu pertanyaan yang sebelumnya tidak bisa dijawab panel:
**kapan** sebuah pesan berpindah status, dan **berapa lama** jedanya. Sebelumnya
kolom waktu di semua tabel hanya memuat `created_at` — waktu pesan masuk antrean.
Di bawah badge "Terkirim", angka itu menyesatkan, karena jeda anti-ban bisa
membuat selisihnya bermenit-menit.

Backend menyimpan waktu tiap transisi di `payload.statusTimes` (tanpa migrasi
skema) memakai timestamp asli WhatsApp. Panel dan dashboard membacanya.

### Added

- **`statusTimes` di payload pesan** (`backend/src/db/pesan.ts`). Diisi di
  `insertMessage` (waktu antrean) dan `updateMessageStatus` (tiap transisi).
  Timestamp yang tidak masuk akal jatuh ke jam server.
- **Kolom jam status terkini di sel Status, empat tabel panel:**
  Playground, Monitor & Queue, Admin Command Center, dan modal Log pengguna.
  Jam ditulis langsung di bawah badge supaya bisa dibandingkan antar baris tanpa
  membuka tooltip — tooltip tidak tersedia di layar sentuh.
- **Util bersama `panel/src/lib/messageStatus.tsx`:** `susunBarisWaktu`,
  `ringkasWaktu`, `jamStatusTerakhir`, komponen `JamStatus`. Satu sumber
  kebenaran; sebelumnya `getStatusBadge` diduplikasi dengan isi berbeda.

### Fixed

- **Status terminal selain `failed` tidak pernah tampil.** Panel hanya
  menangani `failed`, sehingga pesan `not_registered` / `invalid_number` /
  `cancelled` — yang waktunya sudah dicatat backend — tampil seolah masih di
  antrean. Daftar kini sejalan dengan `FORCED_STATUSES` di backend.
- **Pesan gagal tampil dengan centang hijau di modal Log pengguna.** Ikon hanya
  memeriksa `failed`, jadi `not_registered` dan `invalid_number` terlihat
  berhasil saat operator memindai daftar.
- **Label status mentah di modal Log pengguna.** `LABEL_STATUS_PESAN` hanya
  memuat enam status; sisanya tampil apa adanya (`not_registered`). Kini lengkap.
- **`typeof NaN === 'number'`** membuat `NaN`/`Infinity` lolos dan tampil
  sebagai baris berjam `-`. Diganti `Number.isFinite` di semua jalur.

### Changed

- **Header kolom "Waktu" menjadi "Masuk Antrean"** di keempat tabel. Kolom itu
  memang berisi `created_at`; tanpa penamaan ulang, ia mudah tertukar dengan jam
  status yang kini ada di sel Status.

### Catatan

- **Pesan lama tidak bisa direkonstruksi.** Pesan yang dibuat sebelum fitur ini
  tidak punya `statusTimes`; panel menampilkan "Tidak ada catatan waktu per
  tahap" apa adanya, bukan mengarang waktu dari `created_at`.
- **Uji:** suite `wa-api` **8/8 lulus** (termasuk `uji-util-waktu-panel.mjs`
  **34/34**).

---

## [Unreleased] — Pemecahan berkas besar backend

**Tema:** memecah empat berkas backend yang sudah terlalu besar menjadi modul per domain, tanpa mengubah perilaku.
**Basis:** `8129a33` (main).

Ringkasan: empat berkas backend menumpuk 5.430 baris — `server.ts` 2.094, `db.ts` 1.444, `antiban.ts` 1.282, `mail-templates.ts` 610. Menelusuri satu handler berarti menggulir ribuan baris, dan menyentuh satu bagian berisiko menyenggol bagian lain di berkas yang sama. Keempatnya dipecah menjadi 36 berkas di empat direktori, dengan berkas aslinya kini berupa fasad re-export. Yang dijaga ketat bukan sekadar "build hijau", tetapi **perilaku yang tidak berubah**: untuk `db.ts` itu urutan efek samping saat impor (skema, migrasi kolom, index, seed), untuk `antiban.ts` itu 135 pengamatan perilaku delapan guard dengan jam dan RNG dibekukan, untuk `mail-templates.ts` itu keluaran HTML karakter per karakter.

### Changed

- **`server.ts` 2.094 → 35 baris** (`backend/src/server.ts`, 9 berkas di `backend/src/routes/`).
  Bootstrap tipis: plugin, hook, dan `listen`. Handler dipisah per domain — `auth` 14 route, `pesan` 12, `sessions` 25, `pengaturan` 10, `users` 8, `operasional` 5, sisanya `schemas`/`media`/`konteks`. Daftar route **dibangkitkan dari sumber**, bukan ditulis manual: percobaan pertama dengan daftar manual menghasilkan 72 dari 74 route karangan.

- **`mail-templates.ts` 610 → 35 baris** (`backend/src/mail-templates.ts`, 4 berkas di `backend/src/email/`).
  Dipisah menurut jenis email: `dasar` (warna, font, escaping), `reset-password`, `registrasi`, `uji`.

- **`db.ts` 1.444 → 44 baris** (`backend/src/db.ts`, 12 berkas di `backend/src/db/`).
  Dipisah per domain data: `client` (satu-satunya pemilik koneksi), `skema`, `users`, `pesan`, `api-logs`, `jeda`, `reset-password`, `sessions`, `kuota`, `lid`, `kesehatan`, `admin`. Berkas aslinya menyisipkan seksi antar domain (users → reset-password → users lagi → kuota), sehingga satu berkas hasil boleh terdiri dari beberapa rentang baris.

- **`antiban.ts` 1.282 → 42 baris** (`backend/src/antiban.ts`, 11 berkas di `backend/src/antiban/`).
  Dipisah per guard: `tipe`, `preset`, `util`, `rate-limiter`, `warmup`, `timelock`, `presence`, `reconnect`, `ban-recovery`, `reply-ratio`, `contact-graph`.

- **Fasad memakai daftar nama eksplisit, bukan `export *`** (`backend/src/antiban.ts`).
  Empat simbol (`MS`, `hashContent`, `identicalKey`, `ReplyRatioConfig`) dulu privat di `antiban.ts` tetapi harus dipakai lintas modul hasil. Simbol itu diekspor **hanya di modulnya**, dan fasad dibangkitkan dari daftar `export` berkas asli sehingga permukaan API tidak bertambah satu nama pun. `export *` akan ikut membocorkannya.

- **Perkakas pemecahan disimpan di repo** (`backend/scripts-pecah/`).
  Generator per berkas (`pecah-*.py`), verifier isi + permukaan API (`verifikasi-*.py`), banding perilaku (`banding-http.mjs`, `banding-email.mjs`, `banding-antiban.mjs`), pre-flight deploy (`pra-deploy.py`), dan jaring uji (`jalankan-uji.sh`). Tujuannya agar pemecahan berkas berikutnya tidak dikerjakan dengan cara yang berbeda-beda.

### Notes for reviewer

- **Verifikasi yang dijalankan, per tahap:** baris kode hasil dibandingkan sebagai multiset dengan berkas asli (tidak ada hilang, tidak ada baru); permukaan API dibandingkan nama per nama; `npx tsc` exit 0; 5 skrip uji backend lulus 0 gagal; 74/74 route identik status dan bentuk respons terhadap build pra-refactor; dan untuk `antiban.ts` 135 pengamatan perilaku identik.
- **`db.ts` diverifikasi lebih jauh** karena isinya bukan sekadar kumpulan fungsi: begitu diimpor ia menjalankan PRAGMA, CREATE TABLE, migrasi kolom, index, dan seed. Diuji dengan database kosong **dan** database lama yang dibuka versi baru (migrasi idempoten), lalu dibandingkan: 10 tabel, 12 index, 11 `settings`, 22 kolom `users` — sama persis.
- **`antiban.ts` diuji perilakunya, bukan hanya isinya.** `banding-antiban.mjs` membekukan `Date` dan `Math.random` dengan benih tetap (wajib: ada 37 pemakaian `Date.now()` dan 7 `Math.random()`), menjalankan skenario yang sama pada build lama dan build pecahan, lalu membandingkan hasilnya. Skrip yang sama dijalankan di VM dengan Node 22 terhadap `dist` yang benar-benar dideploy — 135 pengamatan identik, sama seperti Node 26 lokal.
- **Sudah dideploy ke VM dev 207 dan diverifikasi:** 57 berkas `js` identik dengan build lokal (md5 agregat), `NRestarts=0`, tanpa error di journal, DB produksi utuh, 3 sesi WhatsApp tetap `connected`, dan 9router `Up 9 days (healthy)`.
- **`antiban.ts` terbukti benar-benar berjalan di produksi**, bukan sekadar dimuat: journal VM mencatat `[AntiBan] Timelock 463 untuk sesi ... telah dicabut oleh WhatsApp` dari `TimelockGuard` di modul hasil pemecahan.
- **`session-manager.ts` (1.344 baris) sengaja TIDAK dipecah.** Isinya satu fungsi dan satu class dengan 46 method yang semuanya memakai `this` (167 pemakaian `this.`), dengan state yang saling terkait (engine, queues, pausedSessions, antiban, health, lidResolver, metrics). Memecahnya berarti memisahkan state bersama — itu menulis ulang, bukan memotong per rentang, dan berkas itu ada di jalur kirim pesan. Ambang yang dipakai: bila jumlah pemakaian `this.` pada satu class mendekati jumlah method-nya, berkas itu bukan kandidat potong-per-rentang.
- **Batas cakupan:** yang tidak diuji tetap pesan yang benar-benar terkirim dan pairing WhatsApp, karena keduanya butuh nomor asli.
- **Rollback per tahap tersedia** sebagai direktori `dist.bak-*` di VM (`-pecah`, `-email`, `-db`, `-antiban`), masing-masing cukup di-`mv` kembali lalu restart `wa-backend.service`.

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

## [Unreleased] — Basis URL panel konsisten & bisa diatur dari panel

**Tema:** satu sumber kebenaran untuk alamat panel yang dipakai menyusun tautan di email.
**Basis:** `f3b6de9` (main).

Ringkasan: tautan reset password dan tautan pada email selamat datang membaca sumber yang berbeda, sehingga nilai dari tabel `settings` hanya berpengaruh pada salah satunya. Akibatnya admin yang mengubah alamat panel dari UI akan mendapati email selamat datang benar sementara tautan reset password tetap menunjuk alamat pengembangan — kegagalan senyap, karena tidak ada error yang muncul dan email tetap terkirim. Selain itu tidak ada jalan sama sekali untuk mengisi alamat itu dari panel: endpoint `PATCH /settings` tidak menerimanya dan UI tidak menyediakannya.

### Fixed

- **Tautan reset password mengabaikan tabel `settings`** (`backend/src/password-reset.ts`).
  Baris ini membaca `process.env.PANEL_BASE_URL` sendiri, sementara `notifikasi-email.ts` membaca tabel `settings` lebih dulu. Nilai cadangannya alamat pengembangan (`http://172.30.30.229:5174`), jadi di produksi tautan yang sampai ke pengguna tidak bisa dibuka — tanpa satu pun error.

### Added

- **Modul `backend/src/panel-url.ts`** sebagai satu sumber kebenaran basis URL panel.
  Urutan prioritas: tabel `settings` → env `PANEL_BASE_URL` → alamat pengembangan. Nilai dari tabel dibaca **setiap pemanggilan**, bukan di-cache saat modul dimuat, supaya perubahan dari panel langsung berlaku pada email berikutnya tanpa restart — restart memutus sesi WhatsApp, jadi itu bukan langkah yang boleh diwajibkan hanya untuk memperbaiki alamat.
- **`panelBaseUrl` pada `GET`/`PATCH /api/v1/settings`** (`backend/src/server.ts`).
  Nilai kosong sah dan berarti "jangan pakai nilai dari tabel". Nilai selain itu wajib diawali `http://` atau `https://` tanpa spasi — alamat tanpa skema akan menghasilkan tautan relatif di email dan tidak bisa diklik. Nilai tidak sah ditolak `400` dan **tidak** tersimpan.
- **Kolom "Alamat Panel untuk Tautan Email"** di Settings (`panel/src/components/SettingsPage.tsx`, `panel/src/api.ts`).
  Ditaruh terpisah dari integrasi Blast Dashboard karena keduanya alamat yang berbeda dan mudah tertukar.

### Notes for reviewer

- Uji baru `backend/scripts/uji-base-url-panel.mjs` — **15 LULUS / 0 GAGAL**, dijalankan di atas DB `/tmp` terpisah dengan SMTP sink lokal, jadi email yang diperiksa adalah email yang benar-benar dikirim backend.
- **Uji merah dijalankan:** `password-reset.ts` dikembalikan sementara ke perilaku lama, dan uji itu gagal tepat pada dua assertion yang menggambarkan bug-nya (tautan tidak memakai nilai tabel, dan masih memakai nilai env) sementara 13 assertion lain tetap lulus. Ini membuktikan ujinya menangkap regresi, bukan sekadar selalu hijau.
- Regresi tanpa kegagalan: `uji-e2e-reset` 32/0, `uji-e2e-daftar` 40/0, `uji-reset-password` 27/0, `uji-telepon` 18/0.
- **Batas cakupan:** belum diuji terhadap SMTP sungguhan (Brevo) — hanya sink lokal. Tampilan kolom baru sudah dikompilasi tetapi belum diperiksa di browser.

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
