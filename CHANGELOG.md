# Changelog

Semua perubahan penting pada `wa-api` didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
[Semantic Versioning](https://semver.org/lang/id/).

---

## [Unreleased] — tiga celah bukti audit

`api_logs` sudah menyimpan siapa, menyentuh apa, dan dengan nilai apa. Tiga hal
membuatnya belum bisa dipakai sebagai bukti; ketiganya ditutup di sini.

### Added

- **`params_before`** — kolom untuk nilai *sebelum* aksi. Sebelumnya audit bisa
  menjawab "preset diubah menjadi broadcast", tidak "dari apa" — dan untuk aksi
  yang bisa dibalik, pertanyaan kedua itulah yang menentukan. Sengaja **tidak**
  diisi otomatis oleh hook `onResponse`: server hanya melihat permintaan yang
  sedang berjalan, bukan keadaan sebelumnya, jadi mengisinya di sana berarti
  mencatat sesuatu yang belum terjadi. Yang mengisi adalah handler yang memang
  sudah membaca nilai lama, lewat `catatNilaiSebelum(req, …)`. Dipasang di
  `PUT /sessions/:id/antiban`.
- **Retensi otomatis** (`backend/src/retensi.ts`) — dijalankan server sekali
  sehari; baris audit disimpan 90 hari, catatan galat 30 hari (sama seperti
  `antiban_decisions`). Dua ambang, bukan satu: pertanyaan "siapa melakukan apa
  bulan lalu" biasanya baru muncul setelah beberapa minggu, sedangkan galat biasa
  tidak perlu selama itu.
- **`audit`** — penanda baris bukti. Baris bertanda ini tidak bisa dihapus
  non-admin, sedangkan catatan galat biasa tetap bisa dibersihkan pemiliknya.

### Kenapa retensi harus di server

`POST /api-logs/clear` sengaja tidak bisa menghapus baris audit — kalau bisa,
pihak yang diaudit dapat menghapus jejaknya sendiri. Konsekuensinya endpoint itu
tidak akan pernah menyusutkan tabel, sementara volume naik karena GET dari agen
kini ikut tercatat. Pembersihannya karena itu dipindah ke sisi server, dan
jumlah yang dihapus dicatat ke log agar bukan penghapusan senyap.

### Fixed

- **Penyaring `params` menyensor `typingWPM`.** Pola rahasia menangkap `pin` di
  dalam "ty**pin**g", sehingga angka kecepatan mengetik — bagian konfigurasi
  anti-ban yang justru ingin diaudit — tersimpan sebagai `[REDACTED]`. Diperbaiki
  dengan daftar pengecualian eksplisit, **bukan** dengan melonggarkan pola:
  mengubahnya menjadi `(^|[_-])pin$` akan meloloskan `pinCode`, jauh lebih
  berbahaya daripada satu angka yang tersensor.

### Catatan pengujian

`backend/scripts/uji-celah-audit.sh` — 11 asersi lewat HTTP sungguhan pada DB
kosong di `/tmp` dan port cadangan. Yang dibuktikan, bukan diasumsikan:

- `params_before.preset = "strict"` sementara `params.preset = "broadcast"`
  sesudah dua kali perubahan berturut-turut — jadi nilai lama benar-benar dibaca
  dari keadaan yang berlaku, bukan dari nilai bawaan.
- Non-admin menghapus baris audit → `deletedCount: 0`, `dilewati: 1`, barisnya
  masih ada; admin menghapus baris yang sama → benar-benar hilang. Tanpa asersi
  kedua, "tidak bisa dihapus" bisa berarti "tidak bisa dihapus siapa pun".
- Baris galat biasa tetap bisa dihapus pemiliknya — ini yang menjaga tombol di
  panel tidak berubah menjadi 403.
- Retensi: baris 100 hari hilang (audit & galat), baris hari ini tidak ikut.

Regresi: `uji-audit-params` 64/64, `uji-api-logs-audit` 11/11, tenant 32/32,
qr-jwt 4/4, decision-log 39/39, integrasi 22/22, normalisasi 28/28,
`uji-mcp` 37/37.

---

## [Unreleased] — server MCP untuk audit & setup terbatas

`mcp/` — proses terpisah, transport stdio, 12 tool (7 baca + 5 tulis yang bisa
dibalik). Rancangan & alasannya di `docs/rancangan-mcp-server.md`, cara pakai di
`mcp/README.md`.

Dua keputusan yang menentukan bentuknya:

- **Proses terpisah, bukan in-process.** Kalau MCP berjalan di dalam backend dan
  crash, seluruh antrean pesan berhenti. Sebagai proses terpisah, kegagalannya
  terkurung, dan SDK MCP tidak masuk ke proses produksi.
- **Otorisasi sepenuhnya di wa-api.** MCP hanya meneruskan API key pemiliknya;
  ia tidak punya pemeriksaan hak sendiri. `403` diteruskan sebagai `403`, tidak
  ditafsirkan sebagai "tidak ada".

### Added

- `mcp/src/client.ts` — satu jalur untuk semua permintaan, supaya `X-MCP-Actor`
  tidak mungkin terlupa di satu tool dan bukan di tool lain (tanpa header itu,
  GET yang berhasil tidak tercatat sebagai bukti audit).
- `mcp/src/format.ts` — pemformat yang menjawab pertanyaan, bukan membuang JSON
  mentah. Diukur: `antiban` 3.466 byte, 67%-nya definisi seluruh preset yang
  tidak ditanyakan; sesudah diformat menjadi ~530 karakter.
- `mcp/src/tools/baca.ts`, `mcp/src/tools/tulis.ts` — 12 tool.
- `backend/scripts/uji-mcp.mjs` (37 asersi) — uji lewat JSON-RPC sungguhan.
- `backend/scripts/ukur-respons-mcp.sh`, `bentuk-respons.sh` — pengukur ukuran
  respons dan pencetak bentuk JSON, dipakai agar formatter ditulis dari data
  nyata.

### Catatan pengujian

Uji ini menemukan tiga hal yang tidak terlihat dari membaca kode:

1. **Pemeriksaan kata kunci tidak cukup.** Tool bernama `wa_bersihkan_antrean`
   yang memanggil `queue/clear` lolos dari filter kata terlarang. Yang
   menangkapnya adalah perbandingan dengan daftar putih nama tool.
2. **Asersi "nilai lama dilaporkan" semula terlalu lemah** — ia lulus walau
   handler tidak membaca nilai lama sama sekali. Diperbaiki agar memeriksa
   nilainya, bukan hanya ada/tidaknya panah pada pesan.
3. **Peringatan preset `broadcast` tidak teruji.** Tanpa peringatan itu, angka
   `replyRatio 0` terbaca sebagai masalah padahal guard-nya memang dimatikan.

Ketiganya ditemukan dengan merusak kode dengan sengaja lalu memastikan uji
gagal — bukan dengan membaca ulang uji yang hijau.

### Belum dikerjakan

- Retensi `api_logs` otomatis, `params_before`, dan pembatasan `DELETE
  /api-logs` untuk non-admin (lihat bagian sebelumnya).
- Pembatasan jumlah panggilan per agen; sekarang masih bergantung pada rate limit
  per-IP wa-api.
- `WA_MCP_ACTOR` bisa dipalsukan — diterima, karena ia label dan bukan
  autentikasi; pelaku tetap diambil dari kunci yang diverifikasi.

---

## [Unreleased] — isolasi tenant pada rute sesi

Prasyarat untuk server MCP multi-tenant. Selama satu API key bisa menyentuh sesi
milik user lain, MCP hanya akan membungkus kebocoran itu dengan antarmuka yang
lebih rapi — dan memberi agen AI kemampuan menghentikan antrean atau memutus
sesi tenant lain.

Sebelum perubahan ini, enam endpoint pada `routes/sessions.ts` hanya memakai
`requireAuth` tanpa pemeriksaan kepemilikan sama sekali, dan satu endpoint
(`GET /metrics`) mengembalikan laporan seluruh tenant dalam satu respons. Satu
pola pemeriksaan yang benar sudah ada, tetapi disalin ke sebagian handler saja —
justru handler yang tidak menyalinnya yang bocor.

### Added

- **`backend/src/kepemilikan.ts`** — `periksaKepemilikanSesi()`, `tolakSesi()`,
  dan `idSesiMilik()`. Membaca `sessions.user_id` dari database, bukan dari
  `manager.getSession()`, karena pemeriksaan otorisasi tidak boleh bergantung
  pada koneksi WhatsApp yang mungkin sedang putus.
- **Uji:** `scripts/uji-tenant-isolasi.sh` (32 asersi) menjalankan server pada DB
  kosong di `/tmp` dan port cadangan, lalu memanggil setiap endpoint dengan dua
  kunci berbeda: kunci pemilik harus 2xx, kunci penyusup harus 403/404. Uji yang
  sama dijalankan terhadap kode **sebelum** perbaikan dan gagal 10 kali — tanpa
  pembanding itu, uji hijau tidak membuktikan apa pun.
- **Uji:** `scripts/uji-qr-jwt.sh` (4 asersi) untuk alur pairing panel yang
  memakai `requireJwt`, karena rute itu tidak mengisi `req.apiKeyUser` dan
  identitasnya harus diambil dari `req.user.id`.

### Fixed

- `GET /sessions/:id/metrics`, `GET /sessions/:id/queue/status`,
  `POST /sessions/:id/queue/pause|resume|clear`, `PATCH /sessions/:id`,
  `POST /sessions/:id/logout|reconnect|pair`, `DELETE /sessions/:id`, dan
  `GET /sessions/:id/qr` kini memeriksa kepemilikan.
- `GET /metrics` disaring: non-admin hanya menerima laporan sesi miliknya.
- Enam salinan blok pemeriksaan yang sudah ada (`antiban`, `contact-graph`)
  diganti ke helper yang sama, supaya tidak ada dua cara berbeda menjawab
  pertanyaan yang sama.

### Catatan

- Sesi tanpa `user_id` tetap boleh diakses. Kolom itu punya `DEFAULT
  'usr_c26f74d6'`, jadi baris lama tidak `NULL`; aturan ini hanya jaring pengaman
  agar sesi yang belum terklasifikasi tidak mengunci admin dari sesinya sendiri.
- Sesi yang tidak ada dijawab **404**, bukan 403, supaya tidak membocorkan bahwa
  id tersebut ada.

---

## [Unreleased] — `api_logs` sebagai bukti audit, bukan hanya catatan galat

Persiapan untuk server MCP yang akan dipakai agen AI melakukan audit dan setup
terbatas. Rancangan lengkapnya ada di `docs/rancangan-mcp-server.md`.

Arah yang diambil: **audit adalah permintaan itu sendiri**, bukan catatan
terpisah yang dilaporkan pemanggil. Server sudah melihat setiap request lewat
hook `onResponse`; menyuruh agen menulis baris audit sendiri akan membuat satu
aksi menghasilkan dua catatan yang bisa berbeda, menjadikan agen saksi atas
perbuatannya sendiri, dan menambah endpoint tulis yang justru bisa dipakai
menulis baris audit palsu.

### Added

- **Empat kolom audit pada `api_logs`** (`backend/src/db/skema.ts`): `actor`,
  `target_type`, `target_id`, `params`. Ditambahkan lewat `ensureColumn`, jadi
  baris lama tetap terbaca dengan nilai `NULL`. Dua index parsial menyertainya,
  diletakkan **setelah** `ensureColumn` karena index pada kolom yang belum ada
  membuat instalasi DB baru gagal.
- **`backend/src/audit-params.ts`** — penyaring `req.body` sebelum disimpan.
  Nomor telepon diganti hash lewat `hashRecipient()` (fungsi yang sama dengan
  `antiban_decisions`, sehingga hash-nya bisa dikorelasikan), field yang
  namanya mengandung kredensial diganti `[REDACTED]`, ukuran dibatasi 2 KB,
  kedalaman 4 tingkat, array 20 elemen. Tanpa ini `api_logs` berubah menjadi
  salinan data pribadi dan kredensial — log audit yang menyimpan rahasia bukan
  audit, melainkan kebocoran kedua.
- **Uji:** `scripts/uji-audit-params.mjs` (59 asersi) dan
  `scripts/uji-api-logs-audit.sh` (11 asersi, lewat HTTP sungguhan pada DB
  kosong di `/tmp`).

### Changed

- **GET yang berhasil kini dicatat bila membawa `X-MCP-Actor`**
  (`backend/src/routes/konteks.ts`). Sebelumnya seluruh GET sukses dibuang
  tanpa syarat, sehingga operasi baca agen tidak akan berjejak sama sekali.
  Filter tidak dihapus — panel melakukan polling GET terus-menerus — melainkan
  dibuat selektif.
- **`insertApiLog()` dan `listApiLogs()`** menerima dan mengembalikan empat
  kolom baru (`backend/src/db/api-logs.ts`).

### Catatan

- **Cacat yang ditemukan tetapi belum diperbaiki:** `DELETE /api-logs` dan
  `POST /api-logs/clear` hanya memakai `requireAuth`, sehingga non-admin bisa
  menghapus log miliknya sendiri. Sebagai catatan galat itu wajar; sebagai bukti
  audit itu cacat, karena pihak yang diaudit bisa menghapus jejaknya. Perbaikan
  belum dilakukan karena panel menampilkan tombol hapus untuk semua peran —
  mengubahnya menjadi admin-only akan memunculkan 403 di UI yang sekarang
  dipakai. Perlu keputusan tersendiri.
- **`params` hanya menyimpan nilai baru**, bukan nilai sebelumnya. Untuk
  menjawab "preset diubah dari apa ke apa", `params` saja tidak cukup.
- **Retensi `api_logs` belum otomatis.** Volume naik karena GET agen ikut
  tercatat; batas retensi perlu ditetapkan sebelum MCP dipakai rutin.

---

## [Unreleased] — Pencatatan guard warm-up & penolakan seluruh sesi

Dua cacat pada instrumentasi decision log yang **tidak memunculkan error** dan
tidak tertangkap uji regex mana pun — keduanya ditemukan lewat probe yang
menghitung baris pada database sungguhan.

### Fixed

- **Guard warm-up tercatat di tempat yang salah** (`backend/src/session-manager.ts`).
  Pencatatan berada di dalam `checkHealth()`, yang sebenarnya fungsi **seleksi
  sesi**, bukan jalur kirim. Akibatnya salah pada dua kondisi sekaligus: dengan
  autorotate aktif dan tiga sesi kandidat, satu pengiriman menghasilkan **3 baris**
  `warmup` tanpa `message_id` (satu per kandidat); dengan autorotate mati —
  instalasi satu sesi, setup paling umum — guard ini **tidak pernah tercatat sama
  sekali**, padahal justru di sesi baru warm-up paling mungkin menahan. Kini
  dicatat lewat `catatWarmup()` di `resolveSession()`, dipanggil dari tiga jalur
  yang memilih sesi (satu-sesi, sticky session, rotasi). Hasil probe: **1 baris
  per pengiriman** pada kedua kondisi.
- **Penolakan seluruh sesi tidak tercatat sama sekali.** Ketika semua kandidat
  ditolak `checkHealth()`, `resolveSession()` mengembalikan sesi dengan alasan
  "semua sesi sedang limit" tanpa satu baris pun di decision log — padahal inilah
  kasus yang paling perlu ditelusuri, karena pesan benar-benar tertahan. Kini
  dicatat **satu baris** `sessionHealth` berisi rincian penolakan tiap sesi di
  `metrics`, sehingga tidak mengulang masalah duplikasi seperti pada warm-up.

### Added

- **`scripts/uji-rasio-keputusan.mjs`** — mengukur jumlah baris per percobaan
  kirim pada tiga kondisi (autorotate mati, aktif dengan tiga kandidat, dan tiga
  panggilan berurutan). Inilah yang membuktikan cacat di atas dengan angka.
- **`scripts/uji-session-health-block.mjs`** — memaksa kuota warm-up kedua sesi
  habis, lalu memastikan penolakan seluruh sesi tercatat tepat satu baris
  `sessionHealth` beserta rinciannya.
- **4 asersi regresi** di `uji-decision-log-integrasi.mjs` (total 22) yang
  memastikan pencatatan tidak kembali ke dalam `checkHealth()` dan
  `catatWarmup()` tetap dipanggil di ketiga jalur pemilihan sesi.

### Notes

- **Baris `warmup` tetap tanpa `message_id`.** `resolveSession()` dipanggil
  sebelum pesan dibuat, jadi pengaitan ke satu pesan belum mungkin tanpa
  mengubah urutan alur. Analisis per penerima tetap bisa dilakukan lewat
  `recipient_hash` + `created_at`.
- **Volume terukur:** 6 baris per percobaan kirim, sekitar **12.000 baris/bulan**
  (±4,6 MB) pada beban 56 pesan/hari, dengan retensi 30 hari.

---

## [Unreleased] — Perbaikan normalisasi nomor & IP privat di nilai bawaan

Dua bug yang ditemukan saat menulis uji untuk decision log. Keduanya berjenis
sama: **tidak memunculkan error**, hanya menghasilkan nilai yang "kelihatan
benar" padahal salah.

### Fixed

- **Awalan internasional `00` pada nomor telepon** (`backend/src/phone.ts`).
  `006281234567890` dinormalisasi menjadi `62006281234567890` — nomor yang tidak
  pernah ada. Penyebabnya, awalan `00` masuk ke cabang `startsWith('0')` sehingga
  nol pertama dibuang lalu `62` ditambahkan di depannya. `normalisasiNomor()`
  dipakai pendaftaran user, penambahan user oleh admin, dan onboarding — jadi
  nomor yang ditulis dengan cara internasional ditolak sebagai tidak valid.
- **`hashRecipient()` punya aturan normalisasi sendiri** (`backend/src/db/decision-log.ts`).
  Sebelumnya hanya mengubah awalan `0` menjadi `62`, sehingga menyimpang dari
  jalur kirim untuk nomor berawalan `00` dan nomor tanpa awalan. Akibatnya satu
  penerima bisa menghasilkan dua hash berbeda, dan pengelompokan "berapa pesan
  ke satu penerima" pecah tanpa terlihat. Kini memakai `normalisasiNomor()`
  sebagai satu-satunya sumber bentuk kanonik.
- **IP privat VM di 17 lokasi.** Alamat IP privat VM pengembangan tertanam di
  nilai bawaan kode produksi (`panel-url.ts`, `blast_dashboard_url` di tiga
  berkas route), contoh konfigurasi, skrip verifikasi, dan contoh di panel. Di
  produksi alamat itu menghasilkan tautan yang tidak bisa dibuka pengguna tanpa
  error apa pun. Nilai bawaan kini `localhost`; setting di produksi sudah terisi
  domain publik sehingga tidak terpengaruh.

### Changed

- **Alamat bawaan Blast Dashboard disatukan.** Sebelumnya ditulis ulang di empat
  tempat (`auth.ts` dua kali, `pengaturan.ts`, `users.ts`). Kini satu konstanta
  `BLAST_DASHBOARD_URL_BAWAAN`, sejajar dengan `PANEL_BASE_URL_BAWAAN`.
- **`db/keputusan.ts` → `db/decision-log.ts`.** Satu fitur sebelumnya memakai dua
  bahasa nama berkas (Indonesia di `db/`, Inggris di `antiban-decision-log.ts`).
  Identifier yang diekspor tetap Inggris seperti seluruh kode lain.

### Added

- **`scripts/uji-normalisasi-nomor.mjs`** — 28 asersi: 11 varian penulisan nomor,
  9 masukan tidak valid, konsistensi `nomorValid()`. Sebelumnya `normalisasiNomor()`
  tidak punya uji sama sekali.
- **Uji regresi normalisasi di `uji-decision-log.mjs`** — 7 varian penulisan nomor
  harus bertemu di satu hash. Uji inilah yang menemukan bug `00` di atas.

---

## [Unreleased] — Decision log anti-ban

Sistem anti-ban punya tujuh guard yang berjalan, tapi **tidak meninggalkan jejak
keputusan**. Saat sebuah nomor terblokir, pertanyaan "guard mana yang seharusnya
menahan ini, dan kenapa tidak?" tidak bisa dijawab dari data: `messages.status`
berubah tanpa alasan, `api_logs` mencatat HTTP bukan keputusan guard, dan
`antiban_state` hanya menyimpan kondisi akhir.

Bagian ini menambahkan tabel `antiban_decisions` dan instrumentasi enam guard.
**Tidak ada perilaku pengiriman yang berubah** — hanya pembacaan nilai yang sudah
ada, dicatat per evaluasi.

### Added

- **Tabel `antiban_decisions`** (`backend/src/db/skema.ts`) — satu baris per
  evaluasi guard, bukan per pesan. Satu pesan bisa dievaluasi berkali-kali
  (setiap antrean bangun); menyimpannya sebagai kolom di `messages` akan
  menimpa riwayat percobaan sebelumnya. Empat index: per sesi+waktu, per
  guard+keputusan+waktu, per `message_id` (parsial), dan per `batch_id`
  (parsial) — dua terakhir parsial karena guard level sesi memang tanpa
  `message_id`.
- **Modul `backend/src/db/decision-log.ts`** — `recordGuardDecision`,
  `hashRecipient`, `evaluateGuard`, `summarizeDecisions`, `listDecisions`,
  `pruneDecisions`. Murni SQL, tanpa impor domain, supaya bisa diuji tanpa
  memuat `SessionManager` beserta dependensi WhatsApp-nya.
- **Jembatan `backend/src/antiban-decision-log.ts`** — tahu konteks sesi
  (`getSessionAntiBanPreset`). Preset ikut dicatat karena `allow` pada
  `broadcast` berarti hal yang berbeda dari `allow` pada `strict`: yang kedua
  "diperiksa dan aman", yang pertama bisa berarti "guard-nya dimatikan".
- **Instrumentasi tujuh guard** (`backend/src/session-manager.ts`): `recovery`,
  `timelock`, `replyRatio`, `contactGraph`, `rateLimiter`, `warmup`, dan
  `sessionHealth`. Keputusan `allow` **dan** `block` sama-sama dicatat — guard
  yang menahan sudah memanggil `console.warn`, yang meloloskan tidak, sehingga
  tanpa mencatat `allow` tidak ada cara mengukur seberapa dekat pengiriman ke
  ambang batas.
- **Dua endpoint baca** (`backend/src/routes/operasional.ts`):
  `GET /api/v1/antiban/decisions/summary` dan `GET /api/v1/antiban/decisions`
  (paginasi + filter guard/decision/batch/sesi/waktu). Non-admin hanya bisa
  membaca sesi miliknya; tanpa `sessionId` mendapat `400`. Tidak ada endpoint
  tulis — decision log hanya diisi jalur pengiriman.
- **Tujuh skrip verifikasi** di `backend/scripts/`, semuanya memakai database
  sementara di `/tmp`: unit (39 asersi), integrasi (22 asersi), rasio keputusan,
  penolakan seluruh sesi, boot, E2E HTTP (63 asersi), migrasi pada salinan DB,
  plus fixture seed.

### Notes

- **Tanpa PII.** Yang disimpan hanya `recipient_hash` (SHA-256, 16 hex), metrik,
  dan ambang — tidak pernah isi pesan atau nomor mentah.
- **`hashRecipient` menormalkan awalan nomor** (`0812…` → `62812…`), disamakan
  dengan `validatePhoneFormat()`. Tanpa itu satu penerima menghasilkan dua hash
  dan analisis "berapa kali orang ini dikirimi" jadi salah.
- **Pencatatan tidak pernah menggagalkan pengiriman.** `recordGuardDecision()`
  menelan semua error menjadi `console.warn` sekali per kejadian; antrean tidak
  boleh macet gara-gara audit.
- **Migrasi non-destruktif**, diuji pada salinan database berisi data nyata:
  10 tabel lama utuh, jumlah baris tidak berubah, tidak ada kolom hilang.
- **Retensi 30 hari** lewat `pruneDecisions()` oportunistik; tanpa cron baru.
- Rancangan lengkap beserta gap yang masih terbuka: `docs/rancangan-decision-log-antiban.md`.

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
  Baris ini membaca `process.env.PANEL_BASE_URL` sendiri, sementara `notifikasi-email.ts` membaca tabel `settings` lebih dulu. Nilai cadangannya alamat pengembangan (`http://localhost:5174`), jadi di produksi tautan yang sampai ke pengguna tidak bisa dibuka — tanpa satu pun error.

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