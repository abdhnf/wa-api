# Changelog

Semua perubahan penting pada `wa-api` didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
[Semantic Versioning](https://semver.org/lang/id/).

---

## [Unreleased] — contactGraph config plumbing

**Tema:** menyambungkan konfigurasi ContactGraphWarmer yang selama ini terputus.
**Status:** sudah di-merge ke `main` (`4c1ef2e`) dan ter-deploy ke produksi.

### Latar belakang

`ContactGraphWarmer` dibangun dengan `cfg` (yaitu `AntiBanConfig`) yang **tidak
memiliki satu pun field milik contactGraph**. Constructor-nya menjalankan:

```ts
this.config = { ...DEFAULT_CONTACT_GRAPH_CONFIG, ...config };
```

Karena `config` tidak memuat field apa pun yang dikenali, spread-nya tidak
mengisi apa-apa dan guard **selalu** berjalan dengan `DEFAULT_CONTACT_GRAPH_CONFIG`
(`enabled: false`). Setiap perubahan konfigurasi contactGraph dari preset maupun
panel dibuang diam-diam.

Akibatnya guard ini tidak pernah berfungsi sejak awal, dan preset `strict` /
`balanced` / `broadcast` menghasilkan contactGraph yang identik.

### Fixed

- **Konfigurasi contactGraph tidak pernah sampai ke guard** (`session-manager.ts`).
  Guard kini dibangun dengan `contactGraphConfig` yang disusun dari preset +
  override custom, bukan `cfg` utuh.

- **Preset tidak mendeklarasikan contactGraph sama sekali** (`antiban.ts`).
  Ketiga preset kini mendeklarasikan konfigurasinya secara eksplisit.

### Added

- **`ContactGraphConfig` sebagai bagian `AntiBanConfig`** (`antiban.ts`).
  Ditambah `DEFAULT_CONTACT_GRAPH_CONFIG` dan `ContactGraphConfig` yang diekspor
  agar bisa dipakai lintas modul.

- **`ContactGraphWarmer.updateConfig()` dan `getConfig()`** (`antiban.ts`).
  `updateConfig()` hanya mengganti konfigurasi tanpa membuang state kontak yang
  sudah terkumpul — penting agar kontak yang sudah `known` tidak kembali menjadi
  `stranger` saat operator berganti preset.

- **`updateAntiBanSettings()` ikut menerapkan contactGraph** (`session-manager.ts`).
  Tanpa ini, memilih preset `broadcast` tidak akan mematikan handshake dan
  memilih `strict` tidak akan menyalakannya.

- **`getAntiBanStatus()` menyertakan `currentConfig.contactGraph`**
  (`session-manager.ts`) agar panel dapat menampilkan konfigurasi yang
  benar-benar aktif, bukan nilai default.

### Changed

Deklarasi contactGraph per preset:

| Preset | `enabled` | `handshakeMinDelayMs` | `maxStrangerMessagesPerDay` |
|---|---|---|---|
| `strict` | **true** | 1 jam (3.600.000) | 5 |
| `balanced` | **false** | 5 menit (300.000) | 50 |
| `broadcast` | **false** | — | — |

### Catatan penting untuk reviewer

- **Hanya preset `strict` yang mengaktifkan contactGraph.** Ini disengaja.
- **`balanced` sengaja dibiarkan nonaktif.** Ketiga sesi produksi pernah berjalan
  pada preset ini; menyalakannya akan langsung memblokir blast ke kontak baru
  begitu di-deploy. Nilai tuning 5 menit sudah disiapkan agar tinggal diaktifkan
  setelah ada keputusan eksplisit + uji blast kecil.
- **Dampak ke produksi saat deploy: NOL.** Ketiga sesi produksi memakai preset
  `broadcast` → `enabled: false` → perilaku identik dengan sebelumnya.

### Mengapa contactGraph berbahaya untuk blast

Saat aktif, pesan pertama ke kontak baru diblokir selama `handshakeMinDelayMs`.
Blast pada dasarnya mengirim ke kontak baru, sehingga:

| Skenario | Hasil |
|---|---|
| Blast 52 kontak, preset `broadcast` | **0 diblokir** |
| Blast 52 kontak, contactGraph aktif | **52 diblokir** — antrean macet total |

Karena itu contactGraph **tidak boleh** diaktifkan pada sesi blast tanpa
mekanisme pengecualian (whitelist penerima kampanye). Ini masih menjadi
pekerjaan terbuka.

### Verifikasi

17 skenario baru, semuanya PASS:

- Konfigurasi contactGraph benar-benar diterima guard (bug utama)
- Config kosong → fallback default (`enabled: false`)
- `DEFAULT_ANTIBAN_CONFIG.contactGraph` ada dan nonaktif
- Ketiga preset mendeklarasikan contactGraph eksplisit
- `broadcast` OFF; `strict` ON dengan handshake 1 jam; `balanced` OFF
- Preset yang aktif hanya `strict` — tidak ada kejutan di produksi
- `updateConfig()` mengubah perilaku guard
- `updateConfig()` tidak membuang state kontak yang sudah terkumpul
- `updateConfig()` partial tidak mereset field lain
- Saat OFF: `canMessage()` selalu lolos tanpa mencatat apa pun
- Saat ON: kontak baru diblokir dan dijadwalkan handshake (bukan 5 detik)
- Saat ON: yang chat duluan langsung boleh dibalas
- Saat ON: grup tanpa lurk period diblokir
- Simulasi blast 52 kontak: `broadcast` → 0 diblokir; contactGraph ON → 52 diblokir

Regresi: 22 (guard/auto-resume) + 16 (db/persistensi) + 13 (timelock) + 15 (metrik)
— semuanya tetap PASS. Total **83 skenario PASS, 0 FAIL**.

Diverifikasi di produksi setelah deploy:

```
strict     contactGraph.enabled = true
balanced   contactGraph.enabled = false
broadcast  contactGraph.enabled = false
```

---

## [Unreleased] — resiliensi guard anti-ban

**Tema:** resiliensi guard anti-ban, auto-resume antrean, persistensi status jeda.
**Basis:** `570d547`. **Sudah di-merge ke `main` dan ter-deploy.**

Ringkasan singkat untuk tim dev: sebelumnya 3 dari 4 guard anti-ban membuang pesan
ke status `failed` permanen saat terpicu, sementara satu-satunya guard yang menahan
pesan justru memacetkan antrean karena `pauseQueue()` tidak punya jalur pemulihan
otomatis. Perubahan ini menyeragamkan semuanya menjadi "tahan pesan + jeda sementara +
lanjut sendiri", mempersist status jeda agar bertahan melewati restart, memperbaiki
bug yang membuat delay pacing terkalikan 10x, dan memperbaiki `db.ts` yang selalu
gagal pada instalasi database baru.

### Fixed

- **`db.ts` selalu gagal pada database baru** (`db.ts`).
  Blok `CREATE INDEX` dijalankan **sebelum** `ensureColumn()`, padahal 5 dari 8 index
  menyentuh kolom yang baru ditambahkan lewat migrasi ringan (`priority`, `batch_id`,
  `user_id`, `wa_message_id`). Fresh install selalu berhenti dengan
  `no such column: priority`. Blok index dipindah ke setelah seluruh `ensureColumn`.

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
  (`Yth.`, `Kepada`, `Dear`, `Halo`, `Hai`, `Hi`) sebelum hashing.

- **Pesan hilang dari antrean saat guard memblokir** (`session-manager.ts`).
  Guard `timelock`, `replyRatio`, dan `contactGraph` menandai pesan `failed`
  lalu `continue` — pesan permanen keluar dari antrean tanpa retry. Kini
  keempat guard memakai pola yang sama dengan rate limiter: pesan dikembalikan
  ke depan antrean (`holdMessageAtFront`) lalu antrean dijeda sementara.

- **`enforcementType` timelock hilang setelah restart** (`antiban.ts`).
  `getState()` menyimpan `enforcementType` tetapi constructor tidak
  memulihkannya. Kini dipulihkan (`state.enforcementType ?? null`), dengan
  state versi lama tetap kompatibel.

### Added

- **Penjadwal auto-resume antrean** (`scheduleAutoResume()`).
  Sebelumnya satu-satunya pemanggil `resumeQueue()` adalah endpoint manual, jadi
  setiap `pauseQueue()` otomatis berarti antrean berhenti sampai ada manusia yang
  klik Resume. Sekarang setiap jeda otomatis menjadwalkan pembukaan kembali:
  sisa waktu blokir dijepit ke rentang **5 detik – 1 jam** dengan margin 5%,
  timer `unref()`, dan jadwal yang lebih cepat tidak ditimpa jadwal yang lebih lambat.

- **Persistensi status jeda antrean** (`db.ts`, `session-manager.ts`).
  `pausedSessions` dan `pausedBatches` sebelumnya in-memory, sehingga restart
  service menghapus seluruh jeda dan antrean langsung berjalan kembali tanpa
  sepengetahuan operator. Kini disimpan ke tabel `settings`
  (`queue_paused_sessions`, `queue_paused_batches`) dan dipulihkan saat startup
  lewat `restoreQueuePauseState()`.

- **`remainingMs()` pada setiap guard** (`antiban.ts`) sebagai sumber waktu tunggu
  bagi penjadwal auto-resume.

- **Flag `distraction` per-preset** (`antiban.ts`). Jeda "distraksi manusiawi"
  5–20 menit dimatikan pada preset `broadcast` dan `strict`; tetap aktif pada
  `balanced`.

- **`onTimelockUpdate()` ter-wire dengan data resmi WhatsApp** (`antiban.ts`,
  `BaileysEngine.ts`, `session-manager.ts`).
  `fetchAccountReachoutTimelock()` adalah API nyata Baileys 7.0.0-rc14
  (`Socket/chats.d.ts:122`), dan `reachoutTimeLock` di-emit ke
  `connection.update` (`socket.js:915`, `messages-recv.js:160`). Durasi sanksi
  asli dari WhatsApp kini dipakai untuk menjadwalkan auto-resume, bukan asumsi
  60 detik.

### Changed

- **Guard pesan identik dihitung per penerima** (`antiban.ts`).
  Setelah normalisasi hash aktif, hitungan global akan memblokir pengumuman yang
  sama ke 52 orang — padahal itu broadcast yang sah. Kunci pelacak kini gabungan
  **penerima + hash konten**.

### Catatan penting untuk reviewer

- Perubahan ini **belum diuji terhadap nomor WhatsApp produksi**. Verifikasi
  bersifat unit/integration test lokal + smoke test server.
- **Dampak kecepatan:** menghapus `onReconnect()` di jalur sukses membuat
  pengiriman blast menjadi **~10x lebih cepat**. Ini keputusan throughput,
  **bukan** peningkatan keamanan nomor.

---

## [Unreleased] — metrik pengiriman & pemisahan status antrean

**Tema:** monitoring report-rate, dasar baseline, dan pemisahan status `pending`.
**Sudah di-merge ke `main` dan ter-deploy.**

### Added

- **`metrics.ts` — `DeliveryMetrics` per sesi** (`metrics.ts`).
  Menghitung `sent`, `err463`, `err429`, `errNotRegistered`, `errOther`, dan
  `blockedContacts`, disajikan sebagai **laju per 100 pesan terkirim** dengan
  indikator kesehatan: `sehat` (<2%), `perhatian` (≥2%), `berisiko` (≥5%).
  Tanpa pesan terkirim, laju bernilai `null` — bukan `Infinity`/`NaN`.

- **Endpoint metrik** (`server.ts`):
  `GET /api/v1/metrics` dan `GET /api/v1/sessions/:id/metrics`.

- **`BaileysEngine.fetchBlocklist()`** (`BaileysEngine.ts`).
  Mengambil daftar kontak yang mem-block nomor — sinyal reputasi paling langsung
  yang tersedia — dipanggil saat connected via `onBlocklistCallback`.

### Changed

- **Status antrean gateway dipisahkan dari draft dashboard** (`types.ts`, `db.ts`,
  `session-manager.ts`).
  `pending` sebelumnya dipakai untuk dua hal berbeda. Kini:
  - `queued` = menunggu di **gateway**
  - `pending` = draft lokal di **dashboard**

  Baris data lama tetap dibaca (`status IN ('queued', 'pending')`) agar tidak ada
  pesan existing yang hilang.

- **`clearBatch` menandai `cancelled`, bukan `failed`** (`session-manager.ts`).
  Pembatalan kampanye oleh operator sebelumnya tercatat sebagai kegagalan dan ikut
  menurunkan `delivery_rate`. Bukti: sesi FMIPA INFO tercatat `delivery_rate` 16%
  dari 81 `failed`, padahal mayoritas berasal dari kampanye yang dibatalkan.

### Catatan penting untuk reviewer

- **"Report-rate" literal tidak tersedia di Baileys.** Tidak ada API yang memberi
  tahu berapa penerima me-report nomor. Yang tersedia dan dipakai adalah
  **block-rate** (`fetchBlocklist`) + error-rate resmi (463/429).

---

## Pekerjaan terbuka

- **Whitelist penerima kampanye** agar contactGraph dapat diaktifkan pada sesi
  blast tanpa memacetkan antrean.
- **Pengukuran baseline anti-ban** — nomor sacrificial, ukur 463/429/blocked per
  100 pesan selama 3 hari, ubah satu variabel per siklus. Pondasi metrik sudah siap.
- **Koreksi 81 pesan `failed` lama** di produksi (mayoritas dari kampanye yang
  dibatalkan) menjadi `cancelled`, agar `delivery_rate` sesi FMIPA INFO akurat.
