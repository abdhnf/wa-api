# Rancangan: Decision Log Anti-Ban

Dokumen ini menjelaskan **mengapa** keputusan guard anti-ban perlu dicatat, apa
yang dicatat, dan bagaimana membuktikan pencatatannya bekerja. Ini Langkah 1
dari tiga langkah yang disepakati; Langkah 2 (MCP read-only) dan Langkah 3
(rekomendasi berbasis bukti) belum dikerjakan dan sengaja tidak disentuh di sini.

---

## 1. Masalah

Sistem anti-ban sudah punya tujuh guard. Semuanya berjalan. Yang tidak ada:
**jejak keputusannya**.

Akibatnya, saat sebuah nomor terblokir, pertanyaan paling penting — "guard mana
yang seharusnya menahan ini, dan kenapa tidak?" — tidak bisa dijawab dari data.
Yang tersedia hanya `messages.status` (berubah status, tanpa alasan), `api_logs`
(HTTP request, bukan keputusan guard), dan `sessions.antiban_state` (kondisi
akhir, bukan riwayat evaluasi).

### Kondisi sekarang, dengan bukti

Tiga temuan dari pemeriksaan langsung pada database produksi:

1. **Tidak ada satu pun penolakan guard tercatat.** Pencarian journal 30 hari
   untuk pola `pesan ditahan|Batas blast|auto-pause|handshake|reply ratio|cooldown`
   menghasilkan **0 baris**. Bukan berarti guard tidak menahan apa pun — guard yang
   *meloloskan* pesan memang tidak menulis apa pun, sehingga tidak ada cara
   membedakan "diperiksa dan lolos" dari "tidak pernah diperiksa".

2. **Ada pesan `failed` tanpa error.** Sembilan pesan berstatus gagal tanpa
   `error` di payload dan tanpa jejak di `api_logs`. Tidak ada bukti apakah
   kegagalan itu berasal dari guard atau dari WhatsApp.

3. **Perilaku blast tidak bisa direkonstruksi.** Sesi `sess-mu2512ti`
   mengirim 50 pesan dengan median jeda 115 detik, 31,8 pesan/jam, 50 penerima
   unik, 0 penerima dikenal — tapi tidak ada catatan guard mana yang dievaluasi
   untuk tiap pesan, dengan ambang berapa, pada preset apa.

Temuan 1 adalah yang paling menentukan: **ketiadaan catatan `allow` membuat
seluruh sistem tidak bisa diaudit**, meski semua guard berfungsi normal.

---

## 2. Temuan yang menentukan bentuk rancangan

### 2.1 Satu pesan dievaluasi berkali-kali

`processQueue()` dijalankan setiap antrean bangun. Satu pesan yang sama bisa
melewati blok guard lebih dari sekali — misalnya tertahan rate limiter, lalu
dijadwalkan ulang dan lolos. Kalau keputusan disimpan sebagai kolom di
`messages`, evaluasi terakhir akan **menimpa** riwayat sebelumnya.

Karena itu keputusan disimpan di **tabel terpisah**, satu baris per evaluasi.

### 2.2 Guard yang menahan sudah bersuara, yang meloloskan tidak

Guard yang memblokir umumnya memanggil `console.warn`. Guard yang meloloskan
tidak. Kalau pencatatan hanya menangkap blokir, kita mengulang masalah yang sama
dengan nama berbeda. Karena itu **`allow` wajib dicatat** — justru itu yang
memungkinkan mengukur seberapa dekat sebuah pengiriman ke ambang batas.

### 2.3 Preset mengubah arti keputusan

`allow` pada preset `strict` dan `allow` pada preset `broadcast` adalah dua hal
berbeda: yang pertama berarti "diperiksa, aman", yang kedua bisa berarti
"guard-nya dimatikan". Tanpa nama preset, kolom `decision` tidak bisa
ditafsirkan. Preset karena itu ikut dicatat per baris.

### 2.4 Audit tidak boleh menggagalkan pengiriman

Kalau pencatatan melempar error, seluruh `processQueue()` bisa berhenti dan
antrean macet — kerusakan yang jauh lebih besar daripada kehilangan satu baris
audit. `recordGuardDecision()` karena itu **tidak pernah melempar**; kegagalan
hanya jadi `console.warn` sekali per kejadian.

### 2.5 Nomor penerima tidak boleh disimpan mentah

Decision log dipakai untuk analisis jangka panjang dan dibaca lewat API. Menyimpan
nomor mentah berarti menambah satu lagi permukaan kebocoran PII. Yang disimpan
hanya **hash** penerima, dengan normalisasi nomor lebih dulu.

Normalisasi wajib: `0812…` dan `62812…` adalah nomor yang sama. Tanpa
penyeragaman, satu penerima menghasilkan dua hash dan analisis "berapa kali
orang ini dikirimi" jadi salah. Aturannya disamakan dengan `validatePhoneFormat()`:
buang `@…` dan `:…`, ambil digit, ubah awalan `0` menjadi `62`.

---

## 3. Rancangan

### 3.1 Keputusan penyimpanan: tabel baru `antiban_decisions`

Alasan tabel terpisah sudah dijelaskan di §2.1. Skema:

| Kolom | Isi |
|---|---|
| `id` | autoincrement |
| `session_id` | sesi yang mengevaluasi |
| `guard` | `recovery` / `replyRatio` / `contactGraph` / `timelock` / `rateLimiter` / `warmup` / `sessionHealth` |
| `decision` | `allow` / `block` / `warn` |
| `reason` | kalimat yang bisa dibaca manusia |
| `message_id` | pesan yang dievaluasi (boleh null untuk guard level sesi) |
| `batch_id` | batch kampanye (boleh null) |
| `recipient_hash` | hash penerima, bukan nomor |
| `metrics` | JSON: angka saat evaluasi |
| `threshold` | JSON: ambang yang berlaku saat itu |
| `preset` | preset anti-ban aktif |
| `created_at` | waktu evaluasi |

Empat index: `(session_id, created_at)`, `(guard, decision, created_at)`,
`(message_id)` parsial, dan `(batch_id)` parsial. Index ketiga dipakai untuk
menjawab "kenapa pesan ini tertahan"; dua index terakhir parsial (`WHERE ... IS
NOT NULL`) karena sebagian besar baris guard level sesi memang tanpa `message_id`
maupun `batch_id`.

`metrics` dan `threshold` disimpan sebagai JSON, bukan kolom terpisah: tiap
guard punya angka yang berbeda (`lastHour`/`maxPerHour` untuk rate limiter,
`knownChats`/`recipientKnown` untuk contact graph), dan menyeragamkannya jadi
kolom akan memaksa kolom null di mana-mana.

### 3.2 Guard yang dicatat

| Guard | Lokasi | Yang dicatat |
|---|---|---|
| `recovery` | `session-manager.ts` blok guard | status ban-recovery |
| `timelock` | sama | cooldown aktif/tidak |
| `replyRatio` | sama | rasio balasan saat itu |
| `contactGraph` | sama | penerima dikenal/tidak, jumlah kontak dikenal |
| `rateLimiter` | setelah `getDelayReason` | jeda + pemakaian kuota jam/hari |
| `warmup` | `resolveSession()` → `catatWarmup()` | fase warm-up, terkirim hari ini vs batas |
| `sessionHealth` | `resolveSession()` saat semua kandidat ditolak | sesi mana ditolak dan alasannya |

Guard `rateLimiter` dicatat dengan format alasan yang memuat **pemakaian kuota**
(`12/300 per jam, 40/1500 per hari`), bukan hanya "lolos". Tanpa angka itu,
tidak mungkin tahu apakah sebuah pengiriman berjalan di 5% atau 95% kapasitas.

### 3.3 Bentuk data: contoh nyata

Baris `allow` pada contact graph di preset `broadcast` — inilah yang menjelaskan
blast kontak dingin:

```json
{
  "guard": "contactGraph",
  "decision": "allow",
  "reason": "Guard contact graph NONAKTIF pada preset ini — kontak dingin lolos tanpa pemeriksaan",
  "preset": "broadcast",
  "metrics": { "knownChats": 0, "recipientKnown": false, "lastDay": 12 },
  "threshold": { "enabled": false, "handshakeMinDelayMs": 300000, "maxStrangerMessagesPerDay": 50 }
}
```

### 3.4 Retensi

`pruneDecisions(keepDays = 30)` dipanggil oportunistik (paling sering sekali per
beberapa jam) dari dalam `recordGuardDecision()`. Tidak ada cron baru: `api_logs`
pun tidak punya prune otomatis, dan menambah penjadwal baru untuk satu tabel
adalah biaya operasional yang tidak sepadan.

### 3.5 Endpoint baca

Dua endpoint, keduanya **read-only**:

- `GET /api/v1/antiban/decisions/summary?sessionId=&sinceHours=`
  → hitungan per guard dan per keputusan.
- `GET /api/v1/antiban/decisions?sessionId=&guard=&decision=&batchId=&sinceHours=&limit=&offset=`
  → daftar baris, dengan `total` untuk paginasi.

Isolasi tenant: pengguna non-admin hanya bisa membaca sesi miliknya. Tanpa
`sessionId`, non-admin mendapat `400` — bukan daftar seluruh sistem.

Tidak ada endpoint tulis. Decision log hanya diisi oleh jalur pengiriman, tidak
oleh API; kalau bisa ditulis lewat API, audit trail kehilangan nilainya.

---

## 4. Perubahan per berkas

| Berkas | Perubahan |
|---|---|
| `backend/src/db/decision-log.ts` | **baru** — modul murni SQL: `recordGuardDecision`, `hashRecipient`, `evaluateGuard`, `summarizeDecisions`, `listDecisions`, `pruneDecisions` |
| `backend/src/antiban-decision-log.ts` | **baru** — jembatan konteks sesi; re-export + `getSessionAntiBanPreset()` |
| `backend/src/db/skema.ts` | tabel `antiban_decisions` + 3 index |
| `backend/src/db.ts` | re-export `decision-log.js` |
| `backend/src/session-manager.ts` | instrumentasi 6 guard + impor |
| `backend/src/routes/operasional.ts` | 2 endpoint baca + isolasi tenant |

Pemisahan `db/decision-log.ts` (murni SQL) dari `antiban-decision-log.ts` (tahu
konteks sesi) disengaja: modul SQL bisa diuji tanpa memuat seluruh
`SessionManager` beserta dependensi WhatsApp-nya.

---

## 5. Kompatibilitas

- **Tanpa migrasi destruktif.** Hanya `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX
  IF NOT EXISTS`. Diuji pada salinan database berisi data nyata: 10 tabel lama
  utuh, jumlah baris tidak berubah, tidak ada kolom hilang.
- **Tanpa perubahan perilaku.** Tidak ada guard yang ditambah, dihapus, atau
  diubah ambangnya. Instrumentasi hanya membaca nilai yang sudah ada.
- **Tanpa dependensi baru.**
- **Gagal mencatat ≠ gagal mengirim.** Kalau tabel belum ada atau insert gagal,
  pengiriman tetap berjalan; hanya muncul `console.warn`.

---

## 6. Cara verifikasi

Sembilan skrip di `backend/scripts/`, semuanya memakai database sementara di
`/tmp` — bukan database produksi:

| Skrip | Membuktikan |
|---|---|
| `uji-decision-log.mjs` | tabel, insert, hash, summary, list, paginasi, retensi |
| `uji-decision-log-integrasi.mjs` | tiap guard di source benar-benar memanggil pencatatan; warm-up dicatat sekali per kirim, bukan per kandidat |
| `uji-rasio-keputusan.mjs` | rasio baris per percobaan kirim pada tiga kondisi (autorotate mati, aktif, berurutan) |
| `uji-session-health-block.mjs` | penolakan seluruh sesi kandidat tetap tercatat, dengan rincian per sesi |
| `uji-normalisasi-nomor.mjs` | normalisasi nomor telepon, termasuk awalan `00` dan format JID |
| `uji-decision-log-boot.sh` | server hidup dengan DB kosong; tabel & index terbentuk; route audit terdaftar |
| `uji-decision-log-e2e.sh` | alur penuh lewat HTTP: auth, tulis, baca, filter, isolasi tenant, read-only |
| `uji-decision-log-migrasi.mjs` | migrasi aman pada **salinan** DB berisi data |
| `seed-decision-log-e2e.mjs` | fixture untuk uji E2E (dijalankan otomatis oleh `uji-decision-log-e2e.sh`) |

Jalankan dari `backend/`:

```bash
node scripts/uji-decision-log.mjs
node scripts/uji-decision-log-integrasi.mjs
node scripts/uji-rasio-keputusan.mjs
node scripts/uji-session-health-block.mjs
node scripts/uji-normalisasi-nomor.mjs
bash scripts/uji-decision-log-boot.sh
bash scripts/uji-decision-log-e2e.sh
node scripts/uji-decision-log-migrasi.mjs /path/ke/salinan.db
```

Hasil yang diharapkan pada versi ini: **39 + 22 + 28 asersi lulus**, rasio
**1,0 baris per panggilan** pada ketiga kondisi, penolakan seluruh sesi tercatat
tepat 1 baris `sessionHealth`, E2E mengembalikan `200/403/400/401` untuk empat
skenario isolasi tenant, dan `404` untuk semua percobaan tulis.

---

## 7. Yang tidak dikerjakan

Sengaja di luar cakupan Langkah 1:

- **MCP server.** Akan dibangun di atas endpoint ini (Langkah 2), bukan
  menggantikannya.
- **Rekomendasi otomatis.** Butuh data historis dari log ini dulu (Langkah 3).
- **Perubahan ambang guard.** Decision log mengukur, tidak mengubah. Menaikkan
  atau menurunkan ambang harus berdasarkan data yang dikumpulkan, bukan
  bersamaan dengan instrumentasinya — kalau dilakukan sekaligus, tidak ada cara
  memisahkan efek keduanya.
- **Notifikasi/alert.** Belum ada data cukup untuk menetapkan ambang alert.
- **Dashboard panel.** Endpoint sudah tersedia; tampilan menyusul setelah ada
  data nyata untuk ditampilkan.

---

## 8. Volume data

Perkiraan dari beban produksi nyata (56 pesan/hari pada sesi tersibuk), bukan
angka karangan:

| Komponen | Baris per percobaan kirim |
|---|---|
| `warmup` (satu kali, di `resolveSession()`) | 1 |
| `recovery` | 1 |
| `timelock` | 1 |
| `replyRatio` | 1 |
| `contactGraph` | 1 |
| `rateLimiter` | 1 |
| **Total** | **6** |

Dengan faktor retry 1,2: sekitar **12.000 baris/bulan**, atau **±4,6 MB/bulan**
(estimasi 400 byte/baris). Retensi default 30 hari (`pruneDecisions`) menjaga
tabel tetap di kisaran itu.

Angka ini yang membuat desain "satu baris per guard per percobaan" layak.
Sebelum perbaikan, guard `warmup` bisa menghasilkan 3 baris per pengiriman saat
autorotate aktif dan **0 baris** saat autorotate mati — jadi biayanya tidak
sebanding dengan manfaatnya.

## 9. Gap yang masih terbuka

Dicatat jujur supaya tidak dikira sudah tertutup:

1. **Keputusan `failed` masih tanpa alasan.** Sembilan pesan gagal tanpa `error`
   di payload. Decision log mencatat evaluasi guard, bukan kegagalan di sisi
   WhatsApp — dua hal berbeda. Kalau kegagalan itu berasal dari guard, sekarang
   akan terlihat; kalau dari WhatsApp, tetap tidak.
2. **Pesan masuk (balasan) belum dicatat.** `knownChats` bertambah saat **kita**
   mengirim, bukan saat mereka membalas. Ini berarti guard contact graph secara
   struktural tidak bisa membedakan "dibalas" dari "tidak dibalas". Decision log
   membuat masalah ini **terlihat** (lewat `recipientKnown: false` yang konsisten),
   tapi tidak memperbaikinya.
3. **Belum ada data historis.** Tabel mulai kosong. Analisis tren butuh waktu
   pengumpulan; keputusan berbasis data tidak bisa diambil dari tabel kosong.
4. **Baris `warmup` tidak terikat `messageId`.** `resolveSession()` dipanggil
   sebelum pesan dibuat (lihat `routes/pesan.ts`), jadi guard warm-up tercatat
   dengan `recipientHash` tetapi tanpa `message_id`. Untuk mengaitkannya ke satu
   pesan perlu meneruskan id pesan ke `resolveSession()` — perubahan urutan alur
   yang tidak dilakukan di Langkah 1. Analisis per penerima tetap bisa dilakukan
   lewat `recipient_hash` + `created_at`.
5. **Penolakan `timelock` di `checkHealth()` tetap tidak tercatat sebagai
   `timelock`.** Saat semua kandidat ditolak, alasannya tercatat — tetapi sebagai
   satu baris `sessionHealth` dengan rincian di `metrics`, bukan satu baris
   `timelock` per sesi. Jadi `GET /decisions?guard=timelock` tidak akan
   menampilkan penolakan pada tahap pemilihan sesi. Ini konsekuensi desain
   "satu baris per pemanggilan" yang mencegah duplikasi; memisahkannya butuh
   desain pencatatan per kandidat tersendiri.
