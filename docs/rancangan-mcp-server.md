# Rancangan: MCP Server untuk Audit & Setup wa-api

Status: **rancangan, belum diimplementasikan.**
Basis kode: `ebffc45` (sudah ter-deploy di produksi).

Dokumen ini merancang server MCP (Model Context Protocol) yang memberi agen AI
akses langsung ke wa-api untuk **audit** dan **setup terbatas**. Ini Langkah 2
dari tiga langkah; Langkah 1 (decision log anti-ban) sudah selesai dan
ter-deploy, Langkah 3 (rekomendasi berbasis bukti) belum dikerjakan.

---

## 1. Masalah

### 1.1 Audit sekarang dilakukan dengan membaca database langsung

Mendiagnosis kenapa sebuah pesan tertahan atau kenapa sebuah nomor terblokir
saat ini berarti SSH ke VM, membuka `wa.db` dengan `node:sqlite`, lalu menulis
query ad-hoc. Cara ini punya tiga masalah:

- **Tidak bisa diulang.** Query yang dipakai untuk satu investigasi tidak
  tersimpan, sehingga investigasi berikutnya menulis query baru dari nol.
- **Berbahaya.** Database produksi dibuka langsung; satu query yang salah tulis
  bisa mengubah data. Sudah ada preseden: verifikasi decision log sempat
  menggunakan salinan `wa.db` produksi yang membawa kredensial sesi WA hidup.
- **Tidak bisa dipakai agen.** Agen AI tidak punya jalur resmi ke data; yang ada
  hanya shell dan SQL bebas, tanpa batas cakupan.

### 1.2 Setup dilakukan lewat panel, satu klik pada satu waktu

Mengubah preset anti-ban, menjeda antrean, atau menyambung ulang sesi menuntut
seseorang membuka panel dan menekan tombol. Untuk pekerjaan yang berulang
(misalnya "periksa ketiga sesi, jeda yang antreannya menumpuk, laporkan"), tidak
ada cara menyatakannya sekali lalu menjalankannya.

### 1.3 Permintaan user: akses per pengguna, bukan hanya admin

Arah yang diputuskan: **setiap user punya API key, dan user boleh memakai MCP
lewat agennya sendiri untuk mengontrol wa-api — tetapi hanya dalam batas
sesinya sendiri. Admin melihat seluruh audit.**

Konsekuensi: MCP bukan alat admin. Ia **multi-tenant**, dan isolasi tenant
bukan pelengkap melainkan syarat utama. Bagian 2.1 menunjukkan bahwa isolasi itu
sekarang bocor.

---

## 2. Temuan yang menentukan bentuk rancangan

Semua angka di bawah diukur pada produksi (`ebffc45`), bukan diperkirakan.

### 2.1 Isolasi tenant bocor di dua endpoint — PRASYARAT, bukan cacat MCP

Diuji dengan API key user non-admin sungguhan (`Abdullah Hanif`, role `user`)
terhadap sesi milik admin. Hanya `GET`, tidak ada yang diubah:

| Endpoint | Status | Hasil |
|---|---|---|
| `GET /sessions/:id` | `403` | aman |
| `GET /sessions/:id/antiban` | `403` | aman |
| `GET /antiban/decisions/summary` | `403` | aman |
| `GET /sessions/:id/metrics` | **`200`** | **bocor** — metrik sesi orang lain terbaca |
| `GET /sessions/:id/queue/status` | **`200`** | **bocor** — antrean sesi orang lain terbaca |

Penyebabnya, dibaca dari sumber: kedua endpoint tidak memanggil
`manager.getSession()` dan tidak membandingkan `session.userId` dengan
`user.id`. Bandingkan dengan endpoint yang aman (`sessions.ts:23-35`), yang
melakukannya secara eksplisit.

Empat endpoint lain juga tidak memeriksa kepemilikan — `queue/pause`,
`queue/resume`, `queue/clear`, `reconnect` — dan tiga di antaranya **menulis**.
Ini tidak diuji dengan `POST` karena akan mengubah produksi, tetapi terbaca dari
sumber: tidak ada perbandingan `userId` di tubuh fungsinya.

Sebaliknya, endpoint yang dipakai sebagai tool baca MCP **sudah** benar. Diperiksa
satu per satu dari sumber:

| Endpoint | Cara menegakkan isolasi |
|---|---|
| `GET /sessions` | `filterUserId = admin ? undefined : user.id` |
| `GET /messages/:sessionId` | `filterUserId` diteruskan ke `listMessagesPaged` |
| `GET /api-logs` | `filterUserId = admin ? (query.userId ?? undefined) : user.id` |
| `GET /antiban/decisions` | Non-admin wajib `sessionId`; sesi diperiksa kepemilikannya, `403` bila bukan |
| `GET /sessions/:id` | Bandingkan `session.userId` dengan `user.id`, `403` bila beda |
| `GET /sessions/:id/antiban` | Sama |

Jadi masalahnya bukan "seluruh API bocor", melainkan **enam endpoint spesifik**
yang terlewat — dan dua di antaranya justru yang akan dipakai tool audit
(`metrics`, `queue/status`). Itu sebabnya Bagian 7.1 tidak bisa dilewati.

**Kesimpulan:** MCP tidak boleh dibangun di atas endpoint yang belum menegakkan
isolasi tenant. Kalau dibangun, MCP hanya akan mempercepat kebocoran yang sudah
ada — dan memberi agen milik user biasa jalan yang rapi menuju data user lain.
Menutup celah ini adalah **pekerjaan tersendiri (Bagian 7.1)**, bukan bagian
dari MCP, dan harus selesai lebih dulu.

### 2.2 `api_logs` tidak mencatat GET yang berhasil

Hook `onResponse` (`routes/konteks.ts:23-56`) melewati setiap `GET` dengan status
`< 400`:

```ts
if (method === 'GET' && statusCode < 400) return;
```

Artinya **seluruh tool baca MCP tidak akan meninggalkan jejak apa pun** di
`api_logs`. Kalau MCP hanya mengandalkan `api_logs`, pertanyaan "agen siapa
membaca data apa" tidak akan pernah bisa dijawab untuk operasi baca.

### 2.3 `api_logs` mencatat pelaku, tapi tidak bisa membedakan agen dari manusia

Kolom `api_logs`: `id, user_id, method, endpoint, status_code, ip, duration_ms,
error_message, created_at`. `user_id` terisi dari `req.apiKeyUser`, jadi pelaku
tercatat. Tetapi tidak ada penanda bahwa permintaan itu datang dari MCP, bukan
dari panel atau curl manusia. `ip` juga tidak menolong: MCP berjalan di VM yang
sama, jadi `ip`-nya `127.0.0.1` — sama dengan siapa pun yang menjalankan curl di
sana.

### 2.4 Tidak ada konsep scope; API key = seluruh hak pemiliknya

`requireAuth` (`auth.ts:38-52`) hanya memeriksa: kunci ada, user ditemukan,
`status === 'active'`. Tidak ada scope, tidak ada pembatasan endpoint. Jadi API
key milik user biasa memberi akses ke **semua** endpoint yang tidak memeriksa
kepemilikan — termasuk yang menulis.

### 2.5 Rate limit per IP, bukan per user

`rateLimitHook` (`security.ts:115`) memakai `getClientIp(req)` sebagai kunci,
dengan batas `240 req/menit` global dan `30 req/menit` untuk `/auth/*`. Karena
MCP berjalan di `localhost`, seluruh trafik MCP berbagi satu ember rate limit
dengan trafik lokal lain. Satu agen yang berisik bisa menghabiskan kuota untuk
semua.

### 2.6 Data yang dibutuhkan audit sudah tersedia lewat API

Ini yang membuat rancangan layak: hampir semua bahan audit sudah bisa dibaca
lewat HTTP, tanpa SQL langsung.

| Kebutuhan audit | Sumber yang ada |
|---|---|
| Sesi: status, warmup, risk score | `GET /sessions`, `GET /sessions/:id` |
| Guard: warmup, timelock, rate limiter, circadian, recovery | `GET /sessions/:id/antiban` |
| Keputusan guard (allow/block + alasan) | `GET /antiban/decisions`, `/summary` |
| Antrean: tertunda, per status, jeda | `GET /sessions/:id/queue/status` |
| Metrik: err463, err429, blocked | `GET /sessions/:id/metrics` |
| Riwayat pesan + `errorDetail` | `GET /messages/:sessionId` |
| Status satu pesan + `statusTimes` | `GET /messages/status/:id` |
| Log panggilan API | `GET /api-logs` |
| Rotasi sesi | `GET /autorotate/status` |

`errorDetail` **terbukti terisi** di produksi, bukan kolom kosong: 9 pesan
`failed` memuat alasan spesifik (`"Session sess-mu2512ti tidak aktif. Pairing
dulu."`, `"Gagal mengunduh media: HTTP 404"`), dan 65 pesan `cancelled` memuat
`"Kampanye ... dihentikan oleh pengguna"`. Ini penting: audit bisa menjawab
"kenapa" untuk sebagian besar kegagalan tanpa membuka DB.

### 2.7 Preset anti-ban bisa diaudit karena tersimpan di kolom sesi

`getSessionAntiBanSettings()` membaca `sessions.antiban_preset` dan
`sessions.antiban_config`. Jadi perubahan preset meninggalkan jejak yang bisa
dibaca kembali — bukan state yang hanya hidup di memori.

### 2.8 Volume yang akan dihadapi MCP

Dari 30 hari terakhir di produksi: `read` 144, `delivered` 93, `cancelled` 65,
`sent` 12, `failed` 9, `queued` 3, `not_registered` 1. Total ~327 pesan/30 hari
(±11/hari) — jauh lebih kecil dari perkiraan 56/hari yang dipakai merancang
decision log. Artinya MCP yang membaca seluruh riwayat 30 hari pun masih wajar;
tidak perlu paginasi agresif untuk skala sekarang, tetapi tetap wajib ada
karena `listMessagesPaged` sudah mendukungnya.

---

## 3. Rancangan

### 3.1 Bentuk: proses terpisah, bicara lewat HTTP

MCP server adalah **proses Node terpisah** di VM yang sama, memanggil
`http://127.0.0.1:3100` dengan `X-API-Key`. Bukan di dalam proses backend.

Alasan, berurutan menurut bobot:

1. **Kegagalan MCP tidak boleh menjatuhkan pengiriman.** Kalau MCP berjalan
   in-process dan crash (bug di SDK, memori bocor, tool yang menggantung), ia
   menjatuhkan `wa-backend` — dan seluruh antrean pesan berhenti. Sebagai proses
   terpisah, kegagalannya terkurung.
2. **Bisa dimatikan tanpa menyentuh produksi.** `systemctl stop wa-mcp` tidak
   mengubah apa pun pada backend.
3. **Memaksa melewati jalur yang sama dengan manusia.** MCP tidak boleh punya
   jalan pintas ke `SessionManager`. Kalau ia memanggil metode internal
   langsung, ia bisa melakukan hal yang tidak bisa dilakukan lewat API — dan
   perbedaan itu akan menjadi sumber bug yang sulit dilacak.
4. **Tidak menambah dependensi ke proses produksi.** SDK MCP dan zod-nya tidak
   ikut ke dalam backend yang sedang melayani pesan.

Biaya yang diterima: satu lapisan HTTP tambahan (latensi ~1-2 ms di localhost,
tidak berarti dibanding jeda antar pesan yang 2-5 detik).

### 3.2 Transport: stdio, bukan HTTP

MCP server memakai transport **stdio** (JSON-RPC lewat stdin/stdout), dijalankan
oleh klien MCP (Hermes) sebagai subprocess.

Alasan: transport HTTP untuk MCP menuntut membuka port dan mengelola
autentikasi pada lapisan MCP itu sendiri — padahal autentikasi sudah ditangani
wa-api lewat `X-API-Key`. Dengan stdio, tidak ada port baru yang terbuka, tidak
ada permukaan serangan baru, dan tidak ada kredensial yang perlu dikelola dua
kali. Siapa pun yang bisa menjalankan proses itu memang sudah punya akses ke VM.

### 3.3 Identitas: API key per pengguna, diteruskan apa adanya

MCP **tidak menyimpan** kunci milik siapa pun secara terpusat. Kunci datang dari
konfigurasi klien MCP, satu proses per pengguna:

```
WA_API_BASE_URL=http://127.0.0.1:3100
WA_API_KEY=<kunci milik user yang menjalankan agen>
WA_MCP_ACTOR=<label bebas, mis. "hermes-abdhnf">
```

Konsekuensi yang harus disadari dan diterima:

- **Otorisasi sepenuhnya bergantung pada wa-api.** MCP tidak menambah
  pemeriksaan hak sendiri; ia hanya meneruskan kunci. Kalau wa-api bilang `403`,
  MCP melaporkan `403`. Ini disengaja: satu sumber kebenaran otorisasi, bukan
  dua yang bisa berbeda.
- **Karena itu Bagian 2.1 adalah prasyarat mutlak.** MCP tidak bisa menutupi
  endpoint yang bocor; ia hanya akan meneruskan kebocoran itu dengan antarmuka
  yang lebih rapi.
- **`WA_MCP_ACTOR` hanya label, bukan autentikasi.** Ia dipakai untuk mengisi
  kolom audit agar bisa dibedakan dari aksi manusia, bukan untuk memberi hak.

### 3.4 Penanda agen: header `X-MCP-Actor`

Setiap permintaan MCP menyertakan header tambahan:

```
X-MCP-Actor: hermes-abdhnf
X-MCP-Tool: wa_audit_session
```

Backend **tidak** mengubah perilaku berdasarkan header ini — ia hanya diteruskan
ke `api_logs` sebagai bagian dari `endpoint` atau kolom baru. Tujuannya
keterlacakan, bukan otorisasi. Kalau header ini hilang, tidak ada yang rusak;
yang hilang hanya kemampuan membedakan agen dari manusia.

### 3.5 Tabel audit khusus aksi tulis

Karena `api_logs` melewati `GET` yang berhasil (2.2) dan tidak menyimpan
parameter, aksi tulis MCP dicatat ke tabel sendiri:

```sql
CREATE TABLE IF NOT EXISTS mcp_audit (
  id             TEXT PRIMARY KEY,
  actor          TEXT,              -- label dari X-MCP-Actor
  user_id        TEXT NOT NULL,     -- pemilik API key (dari wa-api, bukan dari MCP)
  tool           TEXT NOT NULL,     -- nama tool MCP
  target_type    TEXT,              -- 'session' | 'batch' | 'message'
  target_id      TEXT,
  arguments      TEXT,              -- JSON parameter, sudah disaring
  result_status  TEXT NOT NULL,     -- 'ok' | 'denied' | 'error'
  result_summary TEXT,              -- ringkasan hasil, bukan seluruh respons
  duration_ms    INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_user_time ON mcp_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_tool_time ON mcp_audit (tool, created_at DESC);
```

Dua keputusan penting di sini:

- **`user_id` diambil dari wa-api, bukan dari MCP.** MCP tidak boleh menjadi
  sumber kebenaran tentang siapa pelakunya; kalau ia bisa, ia bisa berbohong.
  Cara mengambilnya: respons `GET /auth/me` dengan kunci yang sama, di-cache
  per proses.
- **`arguments` disaring, bukan disalin mentah.** Nomor telepon tidak pernah
  masuk; yang masuk hanya hash-nya, mengikuti aturan yang sama dengan
  `antiban_decisions`. Ini mencegah tabel audit berubah menjadi salinan data
  pribadi.

**Siapa yang menulis tabel ini?** Dua pilihan, dengan pilihan kedua yang
diambil:

| Pilihan | Masalah |
|---|---|
| MCP menulis langsung ke `wa.db` | MCP butuh akses tulis ke DB produksi — melanggar prinsip "MCP lewat API saja", dan membuka jalur tulis yang tidak melalui validasi wa-api |
| Endpoint baru `POST /api/v1/mcp/audit` di wa-api | Menambah endpoint tulis; tetapi pelakunya tetap `apiKeyUser` yang sudah terautentikasi, dan validasinya di satu tempat |

Dipilih: **endpoint baru**, karena MCP tetap tidak menyentuh DB, dan `user_id`
dijamin benar oleh wa-api sendiri. Endpoint ini hanya menerima `tool`,
`target`, `arguments` yang sudah disaring, dan `result` — tidak bisa dipakai
membaca apa pun.

### 3.6 Daftar tool

Dua belas tool, dipisah tegas antara baca dan tulis. Semua tool baca memakai
endpoint yang **sudah menegakkan isolasi tenant** (setelah Bagian 7.1 selesai).

#### Tool baca (7)

| Tool | Endpoint | Kegunaan |
|---|---|---|
| `wa_list_sessions` | `GET /sessions` | Daftar sesi yang boleh dilihat pemanggil, dengan status & warmup |
| `wa_get_session` | `GET /sessions/:id` | Detail satu sesi |
| `wa_audit_antiban` | `GET /sessions/:id/antiban` | State semua guard: warmup, timelock, rate limiter, circadian, recovery. **Inti audit.** |
| `wa_get_queue` | `GET /sessions/:id/queue/status` | Antrean: tertunda, per status, jeda, auto-resume |
| `wa_get_metrics` | `GET /sessions/:id/metrics` | err463/err429/blocked + rasio per 100 |
| `wa_list_messages` | `GET /messages/:sessionId` | Riwayat pesan, filter status/batch, termasuk `errorDetail` |
| `wa_audit_decisions` | `GET /antiban/decisions` + `/summary` | Keputusan guard: siapa menahan apa, berapa kali, kenapa |

Tool `wa_audit_decisions` menggabungkan dua endpoint menjadi satu karena
pertanyaan yang dijawabnya satu: "guard mana yang menahan, dan berapa sering".
Memisahkannya memaksa pemanggil melakukan dua panggilan untuk satu pertanyaan.

#### Tool tulis (5) — semuanya bisa dibalik

| Tool | Endpoint | Bisa dibalik dengan |
|---|---|---|
| `wa_set_antiban_preset` | `PUT /sessions/:id/antiban` | Set preset kembali ke nilai sebelumnya (dibaca dulu, dicatat di audit) |
| `wa_pause_queue` | `POST /sessions/:id/queue/pause` | `wa_resume_queue` |
| `wa_resume_queue` | `POST /sessions/:id/queue/resume` | `wa_pause_queue` |
| `wa_reconnect_session` | `POST /sessions/:id/reconnect` | Tidak perlu — reconnect bersifat idempoten |
| `wa_reset_cooldown` | `POST /sessions/:id/antiban/reset-cooldown` | Cooldown akan aktif lagi dengan sendirinya |

**Yang sengaja TIDAK dijadikan tool**, beserta alasannya:

- **Kirim pesan / blast.** Tidak bisa dibatalkan setelah terkirim, dan inilah
  tepatnya tindakan yang memicu pemblokiran nomor. Memberi agen kemampuan ini
  berarti memberi agen kemampuan membakar nomor.
- **Hapus sesi, logout, hapus user.** Menghapus kredensial sesi berarti pairing
  ulang; tidak bisa dibatalkan oleh agen.
- **Kelola user, reset PIN/password, rotate key.** Di luar cakupan audit, dan
  satu kesalahan berarti mengunci seseorang dari akunnya.
- **`queue/clear`.** Menghapus antrean membatalkan pesan yang mungkin sudah
  dijadwalkan; tidak ada jalan pulang.

Batas ini bukan kehati-hatian berlebihan: `queue/clear` dan blast adalah dua
operasi yang paling mungkin dipanggil agen secara tidak sengaja karena
keduanya terdengar seperti "bersihkan" dan "kirim pengumuman".

### 3.7 Bentuk respons: ringkas dan berorientasi jawaban

MCP mengembalikan teks terstruktur, bukan JSON mentah seluruh respons API.
Contoh untuk `wa_audit_antiban`:

```
Sesi sess-mtvs3tj5 (paketan) — connected
Preset: broadcast · Profil: mature

Guard:
  warmup      graduated, hari 7/7, kuota tanpa batas (0 terkirim hari ini)
  timelock    tidak aktif
  rateLimiter 0/jam, 0/hari
  circadian   multiplier 0.85 (jam 13:xx)
  recovery    fase normal

Catatan: preset broadcast menonaktifkan contactGraph dan replyRatio.
```

Alasan tidak mengembalikan JSON mentah: respons `GET /sessions/:id/antiban`
berukuran besar karena memuat **semua** definisi preset (strict, balanced,
broadcast) di setiap panggilan. Mengirim itu ke konteks agen menghabiskan
token untuk informasi yang tidak ditanyakan. MCP memilih bagian yang relevan.

### 3.8 Penanganan galat: teruskan, jangan tafsirkan

Kalau wa-api mengembalikan `403`, MCP mengembalikan `403` dengan pesan aslinya.
Ia tidak boleh mencoba "menutupi" dengan fallback, dan tidak boleh menafsirkan
`403` sebagai "sesi tidak ada" — dua hal itu berbeda dan pemanggil berhak tahu
bedanya.

Untuk galat jaringan (`ECONNREFUSED`), MCP melaporkan bahwa backend tidak dapat
dihubungi, **tanpa** mencoba ulang secara otomatis untuk tool tulis. Retry
otomatis pada operasi tulis bisa menggandakan efek yang tidak idempoten.

### 3.9 Konfigurasi & operasional

```
systemd: wa-mcp.service   (proses terpisah, Restart=on-failure)
stdio:   dijalankan klien MCP, bukan systemd
```

Karena transportnya stdio, MCP **tidak** dijalankan sebagai service yang
mendengarkan; ia dijalankan sebagai subprocess oleh klien. Yang perlu
`systemd` hanyalah kalau kelak dipakai transport HTTP. Untuk sekarang cukup
didaftarkan di konfigurasi klien MCP dengan perintah `node /path/ke/wa-mcp/dist/index.js`
dan variabel lingkungan di atas.

---

## 4. Perubahan per berkas

| Berkas | Perubahan |
|---|---|
| `backend/src/routes/sessions.ts` | **Prasyarat:** tambah pemeriksaan kepemilikan di `queue/pause`, `queue/resume`, `queue/clear`, `reconnect`, `metrics`, `queue/status` |
| `backend/src/db/skema.ts` | Tabel `mcp_audit` + 2 index |
| `backend/src/db/mcp-audit.ts` | **Baru** — `recordMcpAction`, `listMcpAudit`. Murni SQL. |
| `backend/src/routes/operasional.ts` | `POST /api/v1/mcp/audit` (tulis, terbatas), `GET /api/v1/mcp/audit` (baca, admin lihat semua) |
| `backend/src/routes/konteks.ts` | Teruskan `X-MCP-Actor`/`X-MCP-Tool` ke `api_logs` |
| `mcp/` (direktori baru) | **Baru** — server MCP: `package.json`, `src/index.ts`, `src/client.ts`, `src/tools/*.ts` |
| `docs/rancangan-mcp-server.md` | Dokumen ini |

`mcp/` sengaja di luar `backend/` supaya dependensinya (SDK MCP) tidak masuk ke
`package.json` backend, dan `npm install` di backend tetap tidak berubah.

---

## 5. Kompatibilitas

- **Tidak ada perubahan perilaku pengiriman.** MCP hanya membaca dan memanggil
  endpoint yang sudah ada.
- **Tidak ada endpoint baru yang bisa mengirim pesan.** Batas di Bagian 3.6
  ditegakkan dengan tidak adanya tool, bukan dengan pemeriksaan runtime.
- **`api_logs` bertambah kolom** (kalau `X-MCP-Actor` disimpan terpisah).
  Penambahan kolom memakai pola `ensureColumn` yang sudah dipakai repo, jadi
  baris lama tidak terganggu.
- **Tabel `mcp_audit` baru**, tidak menyentuh tabel lama.
- **Rate limit tidak berubah.** Konsekuensinya: trafik MCP ikut memakai ember
  per-IP `127.0.0.1` (2.5). Untuk skala sekarang (11 pesan/hari) ini tidak
  menjadi masalah; dicatat sebagai batas yang diketahui.

---

## 6. Cara verifikasi

Semua uji memakai database sementara di `/tmp` dan port cadangan, **bukan**
database produksi — mengikuti aturan yang sama dengan decision log.

| Uji | Membuktikan |
|---|---|
| `uji-mcp-tenant.mjs` | User non-admin **tidak** bisa membaca/menulis sesi user lain, untuk **semua** endpoint yang dipakai MCP. Inilah uji prasyarat. |
| `uji-mcp-audit-tulis.mjs` | Setiap tool tulis menghasilkan tepat satu baris `mcp_audit`, dengan `user_id` benar dan parameter tersaring |
| `uji-mcp-audit-baca.mjs` | Admin melihat audit semua user; user biasa hanya melihat miliknya |
| `uji-mcp-tool-baca.mjs` | Ketujuh tool baca mengembalikan data yang sama dengan endpoint aslinya |
| `uji-mcp-tool-tulis.mjs` | Kelima tool tulis benar-benar mengubah state, dan bisa dibalik |
| `uji-mcp-tolak-tulis.mjs` | Tidak ada tool yang bisa mengirim pesan, menghapus sesi, atau mengelola user — diperiksa dari daftar tool yang teregistrasi |
| `uji-mcp-backend-mati.sh` | Saat backend dimatikan, MCP melaporkan galat dengan jelas dan **tidak** retry otomatis pada tool tulis |

Uji pertama adalah gerbang: kalau `uji-mcp-tenant.mjs` gagal, MCP tidak boleh
dipasang sama sekali.

---

## 7. Yang tidak dikerjakan

### 7.1 Menutup kebocoran isolasi tenant (pekerjaan tersendiri, PRASYARAT)

Enam endpoint tidak memeriksa kepemilikan; dua terbukti bocor, empat terbaca
dari sumber. Ini **bukan** bagian dari MCP dan tidak boleh dicampur ke dalam
commit MCP, karena:

- Ia mengubah perilaku endpoint yang sudah dipakai panel — perlu diuji terhadap
  panel, bukan hanya terhadap MCP.
- Ia bisa mematahkan alur yang sekarang bekerja. Contohnya: panel admin mungkin
  memang memanggil `queue/status` untuk sesi mana pun; menambahkan pemeriksaan
  kepemilikan tanpa memahami pemanggilnya akan memunculkan `403` di tempat yang
  sebelumnya `200`.

Urutan yang benar: **tutup celah → uji panel → baru bangun MCP.**

### 7.2 Sisanya

- **Rekomendasi otomatis.** Itu Langkah 3, dan butuh data dari decision log yang
  sekarang masih kosong di produksi.
- **Transport HTTP untuk MCP.** Tidak perlu selama klien berjalan di mesin yang
  sama.
- **Tool untuk blast.** Sengaja ditolak (3.6).
- **Rate limit per user.** Perubahan pada `security.ts` menyentuh seluruh API,
  bukan hanya MCP; pekerjaan tersendiri.
- **UI panel untuk audit MCP.** Endpoint `GET /mcp/audit` tersedia; tampilan
  menyusul setelah ada data.

---

## 8. Gap yang masih terbuka

1. **Decision log di produksi masih kosong (0 baris).** Tabel dan endpoint sudah
   ter-deploy, tetapi belum ada pengiriman sejak deploy, jadi belum ada data.
   Tool `wa_audit_decisions` akan mengembalikan hasil kosong sampai ada
   pengiriman. Ini bukan cacat, tetapi perlu diketahui agar tidak disalahartikan
   sebagai "tidak ada penolakan".
2. **`X-MCP-Actor` bisa dipalsukan.** Siapa pun yang punya API key bisa mengirim
   header itu. Karena itu ia **bukan** autentikasi, dan `user_id` di `mcp_audit`
   diambil dari wa-api. Tetap dicatat sebagai batas: label agen tidak dapat
   dipercaya sepenuhnya.
3. **Tool baca tidak berjejak di `api_logs`.** Sesuai 2.2, `GET` sukses dilewati.
   Jejak baca hanya ada kalau MCP memanggil `POST /mcp/audit` untuk operasi baca
   juga — yang menambah satu tulis per baca. Keputusan yang diambil: **tidak**
   mencatat baca, karena biayanya (satu tulis per baca) lebih besar dari
   manfaatnya pada volume sekarang. Kalau kelak perlu jejak penuh, ini titik
   yang harus diubah.
4. **Belum ada pembatasan jumlah panggilan per agen.** MCP bisa memanggil
   endpoint berulang kali sampai kena rate limit per-IP (240/menit), yang
   kuotanya dibagi dengan trafik lokal lain. Untuk skala sekarang wajar; untuk
   agen yang berisik, perlu pembatas sendiri.
5. **Preset `broadcast` mematikan sebagian guard.** Ini bukan cacat MCP, tetapi
   konsekuensi yang harus dipahami saat membaca audit: pada preset ini,
   `contactGraph` dan `replyRatio` tidak berjalan, sehingga `allow` pada kedua
   guard itu berarti "dimatikan", bukan "diperiksa dan aman". Tool
   `wa_audit_antiban` menampilkan catatan ini secara eksplisit supaya tidak
   salah tafsir.

---

## 9. Hal yang perlu diputuskan sebelum implementasi

1. **Apakah `X-MCP-Actor` disimpan sebagai kolom baru di `api_logs`, atau
   ditempel ke `endpoint`?** Kolom baru lebih bersih tetapi menambah migrasi;
   menempel ke `endpoint` merusak pengelompokan endpoint yang sekarang dipakai
   untuk statistik.
2. **Apakah `mcp_audit` perlu retensi?** `antiban_decisions` memakai 30 hari.
   Audit aksi tulis jauh lebih sedikit jumlahnya, jadi mungkin tidak perlu — tapi
   keputusan itu sebaiknya diambil sadar, bukan karena lupa.
3. **Siapa yang boleh memanggil `POST /mcp/audit`?** Kalau semua user boleh,
   user bisa menulis baris audit palsu. Kalau hanya MCP yang boleh, perlu cara
   membedakan MCP dari manusia — padahal itulah yang sedang dibangun. Usulan:
   endpoint menerima `tool` hanya dari daftar putih nama tool yang dikenal, dan
   `user_id` selalu diambil dari kunci, sehingga kebohongan yang mungkin hanya
   pada `arguments` dan `result_summary`.
