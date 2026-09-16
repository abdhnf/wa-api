# Changelog

Semua perubahan penting pada `wa-api` didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
[Semantic Versioning](https://semver.org/lang/id/).

---

## [Unreleased] — branch `fix/antiban-guard-resilience-20260916`

**Tema:** resiliensi guard anti-ban + auto-resume antrean.
**Basis:** `570d547` (main). **Belum di-merge ke `main`.**

Ringkasan singkat untuk tim dev: sebelumnya 3 dari 4 guard anti-ban membuang pesan
ke status `failed` permanen saat terpicu, sementara satu-satunya guard yang menahan
pesan justru memacetkan antrean karena `pauseQueue()` tidak punya jalur pemulihan
otomatis. Branch ini menyeragamkan semuanya menjadi "tahan pesan + jeda sementara +
lanjut sendiri", sekaligus menutup bug yang membuat delay pacing terkalikan 10x.

### Fixed

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
  (`Yth.`, `Kepada`, `Dear`, `Halo`, `Hai`, `Hi`) sebelum hashing. Setelah
  perbaikan, 52 pesan identik menghasilkan 1 hash. Pesan tanpa baris sapaan
  tidak terpengaruh.

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

- **`normalizeContentForHash()` diekspor** dari `antiban.ts` agar dapat diuji
  terpisah dan dipakai ulang oleh jalur validasi lain.

### Catatan penting untuk reviewer

- Perubahan ini **belum diuji terhadap nomor WhatsApp produksi**. Verifikasi yang
  dilakukan bersifat unit/integration test lokal (22 skenario, lihat bagian
  Verifikasi) — bukan uji lapangan.
- **Dampak kecepatan:** menghapus `onReconnect()` di jalur sukses membuat
  pengiriman blast menjadi **~10x lebih cepat** dari kondisi saat ini. Ini adalah
  keputusan throughput, **bukan** peningkatan keamanan nomor. Untuk blast bervolume
  besar, pertimbangkan preset `broadcast` dan pantau metrik 463/429.
- `contactGraph` masih berstatus `enabled: false` (default). Jika diaktifkan,
  kontak baru akan diblokir sampai handshake 1 jam — pastikan perilaku ini
  diinginkan sebelum mengaktifkannya di production.

### Verifikasi

22 skenario uji dijalankan terhadap hasil build (`dist/`), bukan terhadap production:

- Normalisasi hash: 52 pesan identik → 1 hash; konten berbeda tetap beda hash;
  pesan tanpa baris sapaan tidak berubah.
- Flag `distraction`: 0 dari 20.000 pesan pada preset `broadcast` terkena jeda;
  preset `balanced` tetap ~5%.
- `remainingMs()`: idle → 0, aktif → positif, guard nonaktif → 0.
- Ambang blokir guard identik tercapai tepat pada pesan ke-10 (preset `broadcast`).
- Penjadwal auto-resume: penjepitan batas bawah/atas, pembersihan saat resume
  manual, dan antrean benar-benar terbuka sendiri setelah masa blokir lewat.

### Diketahui belum diperbaiki (di luar cakupan branch ini)

- **`db.ts` gagal inisialisasi pada database baru.** Index
  `idx_messages_status_prio` dibuat (baris ~105) sebelum `ensureColumn('messages',
  'priority', ...)` (baris ~139), sehingga fresh install selalu error
  `no such column: priority`. Ditemukan saat menyiapkan lingkungan uji; belum
  diperbaiki karena menyentuh skema database produksi.
- **`pausedSessions` / `pausedBatches` masih in-memory.** Restart service
  menghapus seluruh status jeda. Perlu dipersist ke SQLite.
- **Status `pending` masih ambigu** — dipakai untuk "menunggu di dashboard"
  sekaligus "menunggu di gateway".
- **Pembatalan kampanye masih tercatat `failed`,** bukan `cancelled`, sehingga
  ikut menurunkan `delivery_rate` sesi.
- **`date.timezone = PRC` pada `php.ini`** (UTC+8) di server; Laravel sudah aman
  lewat `APP_TIMEZONE`, tetapi kode PHP yang memakai `date()` native masih drift.
- **`onTimelockUpdate()` belum pernah dipanggil**, sehingga `timeEnforcementEnds`
  asli dari WhatsApp tidak pernah dipakai (timelock selalu berasumsi 60 detik).
