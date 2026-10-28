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

> **Status: sudah ditutup.** Bagian 7.1 dikerjakan lebih dulu dan masuk ke
> `main` sebelum server MCP dimulai. Saat membaca `routes/sessions.ts` ternyata
> jumlah endpoint tanpa pemeriksaan **lebih banyak** dari enam: `PATCH
> /sessions/:id` (rename & ganti profil), `POST /sessions/:id/logout`,
> `POST /sessions/:id/pair`, `DELETE /sessions/:id`, dan `GET /sessions/:id/qr`
> juga tidak memeriksa kepemilikan — `DELETE` menghapus sesi orang lain, `pair`
> memutus autentikasi lama lalu menggantinya dengan QR baru. Daftar enam di atas
> adalah yang **terbukti** lewat HTTP, bukan yang lengkap. Pemeriksaan sekarang
> dipusatkan di `backend/src/kepemilikan.ts`; lihat `CHANGELOG.md` untuk rincian
> dan bukti ujinya.

### 2.2 Audit **adalah** hasil permintaan — bukan catatan terpisah

Koreksi terhadap rancangan awal dokumen ini. Rancangan pertama mengusulkan tabel
`mcp_audit` yang **ditulis oleh MCP** setiap kali sebuah tool tulis dipanggil.
Itu keliru, dan alasannya bukan soal selera:

- **Server sudah melihat setiap permintaan.** Hook `onResponse`
  (`routes/konteks.ts:23-56`) berjalan untuk seluruh request. Menyuruh MCP
  menulis baris audit berarti satu aksi menghasilkan **dua** catatan yang bisa
  berbeda isinya.
- **MCP menjadi saksi atas perbuatannya sendiri.** Kalau MCP yang menulis
  "saya mengubah preset sesi X", server tidak punya cara memverifikasinya. Bukti
  yang dilaporkan pihak yang diawasi bukan bukti.
- **Menambah satu endpoint tulis yang justru bisa disalahgunakan.** `POST
  /mcp/audit` harus menerima `tool`, `arguments`, dan `result` dari pemanggil —
  artinya user bisa menulis baris audit palsu, dan rancangan harus menambal itu
  dengan daftar putih nama tool. Tambalan yang tidak perlu kalau audit diambil
  dari request itu sendiri.

Jadi arah yang benar: **`api_logs` dinaikkan menjadi audit, bukan dibuat tabel
kedua.** Satu permintaan, satu baris. Yang perlu dibereskan tinggal dua hal, dan
keduanya cacat pada `api_logs` yang sudah ada — bukan cacat MCP.

### 2.3 Cacat pertama: `api_logs` membuang GET yang berhasil

```ts
if (method === 'GET' && statusCode < 400) return;
```

Filter ini masuk akal untuk panel, yang melakukan polling GET terus-menerus
sehingga log akan penuh sampah. Tetapi untuk MCP, **operasi baca justru
pekerjaan utamanya** — tujuh dari dua belas tool adalah baca. Dengan filter ini,
seluruh aktivitas audit MCP tidak meninggalkan jejak sama sekali, sehingga
pertanyaan "agen siapa membaca data sesi siapa" tidak bisa dijawab.

Perbaikannya bukan menghapus filter (panel akan membanjiri log), melainkan
membuatnya **selektif**: permintaan yang membawa penanda agen tetap dicatat
walaupun `GET` dan berhasil.

### 2.4 Cacat kedua: `api_logs` tidak punya kolom untuk pelaku dan sasaran

Kolom sekarang: `id, user_id, method, endpoint, status_code, ip, duration_ms,
error_message, created_at`.

Yang sudah benar: `user_id` terisi dari `req.apiKeyUser`, jadi **pelaku tercatat
dan tidak bisa dipalsukan** — nilainya berasal dari kunci API yang diverifikasi
server, bukan dari klaim pemanggil.

Yang belum ada:

- **Penanda agen.** Tidak ada cara membedakan permintaan dari MCP dan dari panel.
  `ip` tidak menolong: MCP berjalan di VM yang sama, jadi `ip`-nya `127.0.0.1` —
  sama dengan siapa pun yang menjalankan curl di sana.
- **Sasaran.** `endpoint` memuat `/api/v1/sessions/sess-mtvs3tj5/queue/pause`,
  jadi id sesi sebenarnya ada di dalam string — tetapi mengekstraknya dengan
  pencocokan teks rapuh. Lebih baik disimpan sebagai kolom.
- **Parameter aksi tulis.** Tanpa ini, audit hanya bisa bilang "seseorang
  memanggil `PUT /antiban`", bukan "preset diubah **menjadi** `broadcast`" —
  padahal nilai barunya justru yang ingin diketahui.

Ketiganya bisa diisi server sendiri dari permintaan yang sedang ia tangani:
`actor` dari header, `target_id` dari `req.params`, `params` dari `req.body`.
Tidak ada yang perlu dilaporkan MCP.

### 2.5 Tidak ada konsep scope; API key = seluruh hak pemiliknya

`requireAuth` (`auth.ts:38-52`) hanya memeriksa: kunci ada, user ditemukan,
`status === 'active'`. Tidak ada scope, tidak ada pembatasan endpoint. Jadi API
key milik user biasa memberi akses ke **semua** endpoint yang tidak memeriksa
kepemilikan — termasuk yang menulis.

### 2.6 Rate limit per IP, bukan per user

`rateLimitHook` (`security.ts:115`) memakai `getClientIp(req)` sebagai kunci,
dengan batas `240 req/menit` global dan `30 req/menit` untuk `/auth/*`. Karena
MCP berjalan di `localhost`, seluruh trafik MCP berbagi satu ember rate limit
dengan trafik lokal lain. Satu agen yang berisik bisa menghabiskan kuota untuk
semua.

### 2.7 Data yang dibutuhkan audit sudah tersedia lewat API

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

### 2.8 Preset anti-ban bisa diaudit karena tersimpan di kolom sesi

`getSessionAntiBanSettings()` membaca `sessions.antiban_preset` dan
`sessions.antiban_config`. Jadi perubahan preset meninggalkan jejak yang bisa
dibaca kembali — bukan state yang hanya hidup di memori.

### 2.9 Volume yang akan dihadapi MCP

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

Setiap permintaan MCP menyertakan satu header tambahan:

```
X-MCP-Actor: hermes-abdhnf
```

Backend **tidak** mengubah perilaku berdasarkan header ini selain satu hal:
memakainya untuk memutuskan apakah GET yang berhasil tetap dicatat (3.6). Ia
tidak memberi hak apa pun. Tujuannya keterlacakan, bukan otorisasi. Kalau header
ini hilang, tidak ada yang rusak; yang hilang hanya kemampuan membedakan agen
dari manusia.

Header `X-MCP-Tool` dari rancangan awal **dihapus**. Alasannya: nama tool MCP
tidak menambah informasi dibanding `method` + `endpoint` yang sudah dicatat
server, dan header tambahan yang tidak dipakai hanya menambah permukaan yang
harus dijaga. Satu header, satu kegunaan.

### 3.5 Audit: perluas `api_logs`, jangan buat tabel kedua

Karena audit adalah hasil permintaan itu sendiri (2.2), tidak ada tabel baru dan
tidak ada endpoint tulis baru. Yang dilakukan: menambah empat kolom pada
`api_logs` yang sudah ada, memakai pola `ensureColumn` yang sudah dipakai repo
(`db/skema.ts:102-107`) sehingga baris lama tidak terganggu.

```ts
// db/skema.ts — di samping ensureColumn lain yang sudah ada
ensureColumn('api_logs', 'actor', 'TEXT');       // label agen dari X-MCP-Actor
ensureColumn('api_logs', 'target_type', 'TEXT'); // 'session' | 'batch' | 'message' | 'user'
ensureColumn('api_logs', 'target_id', 'TEXT');   // id sasaran
ensureColumn('api_logs', 'params', 'TEXT');      // JSON body, sudah disaring
// Kedua index di bawah ada di blok db.exec() SETELAH ensureColumn, karena
// index pada kolom yang belum ada membuat instalasi DB baru gagal.
CREATE INDEX IF NOT EXISTS idx_api_logs_actor_time ON api_logs (actor, created_at DESC) WHERE actor IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_logs_target ON api_logs (target_id) WHERE target_id IS NOT NULL;
```

**Status: sudah diimplementasikan** pada commit tersendiri, terpisah dari MCP.
Empat berkas berubah: `db/skema.ts` (kolom + index), `db/api-logs.ts` (insert &
select), `routes/konteks.ts` (pengisian dari `req` + filter GET selektif), dan
`audit-params.ts` (baru — penyaring `params`).

Semua nilai diisi **oleh server**, dari permintaan yang sedang ia tangani:

| Kolom | Sumber di server |
|---|---|
| `user_id` | `req.apiKeyUser.id` — sudah ada, tidak berubah |
| `actor` | header `X-MCP-Actor`, `null` kalau tidak ada |
| `target_type` / `target_id` | `req.params` (`id`, `batchId`, `sessionId`) |
| `params` | `req.body`, disaring sebelum disimpan |

Konsekuensi yang perlu disadari:

- **`params` hanya diisi untuk metode yang menulis** (`POST`/`PUT`/`PATCH`/
  `DELETE`). Menyimpan body `GET` tidak ada gunanya dan hanya menambah ukuran.
- **Penyaringan wajib, bukan opsional.** Nomor telepon diganti hash lewat
  `hashRecipient()` — fungsi yang sama dengan `antiban_decisions`, jadi satu
  nomor menghasilkan hash identik di kedua tabel dan bisa dikorelasikan tanpa
  disimpan. Field yang namanya mengandung kredensial (`password`, `pin`,
  `token`, `apiKey`, `secret`, `otp`, …) diganti `[REDACTED]`, bukan dihapus,
  supaya tetap terlihat bahwa field itu dikirim.
- **Ukuran dibatasi 2 KB per baris**, karena `bodyLimit` server 50 MB untuk
  upload media base64 — tanpa batas, satu permintaan media bisa menulis puluhan
  MB ke tabel log. Kedalaman objek dibatasi 4 tingkat dan array 20 elemen.

Ketiga aturan itu punya uji sendiri (`uji-audit-params.mjs`, 59 asersi), termasuk
yang membuktikan penyaring **tidak** terlalu agresif: `"1500"` (kuota) tetap
angka, `sess-mu2512ti` tetap id, dan `"broadcast"` tetap preset. Penyaring yang
menghapus semua yang mengandung digit akan membuat audit tidak berguna.

### 3.6 Membuat filter GET selektif, bukan dihapus

Filter di `onResponse` diubah supaya hanya melewati GET yang **bukan** dari agen:

```ts
// Sebelum: semua GET sukses dibuang
if (method === 'GET' && statusCode < 400) return;

// Sesudah: GET sukses tetap dibuang KECUALI membawa penanda agen
const actor = (req.headers['x-mcp-actor'] as string | undefined) || null;
if (method === 'GET' && statusCode < 400 && !actor) return;
```

Alasannya: panel melakukan polling GET terus-menerus, jadi menghapus filter akan
membanjiri `api_logs`. Tetapi permintaan agen — yang volumenya kecil dan justru
perlu ditelusuri — tetap tercatat. Dengan begitu tool baca MCP punya jejak tanpa
mengorbankan kegunaan log untuk panel.

Efek samping yang diterima: satu agen yang membaca berulang kali akan menambah
baris log. Ini diinginkan — itulah gunanya audit.

### 3.7 Tidak ada yang perlu dilaporkan MCP

Ini konsekuensi penting dari koreksi di 2.2, dan yang paling menyederhanakan
rancangan: **MCP tidak menulis apa pun ke database, dan tidak memanggil endpoint
audit apa pun.** Ia hanya memanggil endpoint yang sudah ada. Server mencatat
sendiri.

Yang hilang dibanding rancangan awal: kolom `result_summary` (ringkasan hasil
yang dilaporkan MCP). Penggantinya sudah ada di `api_logs`: `status_code` dan
`error_message`. Itu lebih baik, karena berasal dari server — bukan dari klaim
pemanggil.

### 3.8 Daftar tool

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

### 3.9 Bentuk respons: ringkas dan berorientasi jawaban

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
memuat **semua** definisi preset (strict, balanced, broadcast) di setiap
panggilan, padahal pertanyaan yang dijawab hanya "guard mana yang menahan".

Angka ini sudah diukur (`scripts/ukur-respons-mcp.sh`, satu sesi, 30 pesan):

| Endpoint | Byte | Perkiraan token |
|---|---|---|
| `GET /sessions/:id/antiban` | 3.466 | ~866 |
| `GET /sessions/:id/metrics` | 409 | ~102 |
| `GET /sessions/:id/queue/status` | 173 | ~43 |
| `GET /messages/:sessionId` (30 pesan) | 7.485 | ~1.871 |
| `GET /sessions` | 1.413 | ~353 |

Dari 3.434 byte `antiBan`, **2.305 byte (67%) adalah `presets` + `currentConfig`**
— definisi seluruh preset, bukan keadaan sesi. Jadi ukurannya tidak sebesar yang
semula diduga (ratusan token, bukan ribuan), tetapi dua pertiga isinya memang
tidak ditanyakan.

**Koreksi terhadap dugaan awal:** risiko ukuran terbesar bukan `antiban`,
melainkan `wa_list_messages`. Tiga puluh pesan sudah 7.485 byte; endpoint itu
menerima `limit` sampai 200, sehingga satu panggilan tanpa batas bisa mencapai
~50 KB (~12.000 token) dan menghabiskan konteks agen dalam sekali panggil. Tool
riwayat pesan **wajib** memakai `limit` bawaan yang kecil (mis. 20) dan
mengembalikan ringkasan per pesan, bukan `payload` mentah.

### 3.10 Penanganan galat: teruskan, jangan tafsirkan

Kalau wa-api mengembalikan `403`, MCP mengembalikan `403` dengan pesan aslinya.
Ia tidak boleh mencoba "menutupi" dengan fallback, dan tidak boleh menafsirkan
`403` sebagai "sesi tidak ada" — dua hal itu berbeda dan pemanggil berhak tahu
bedanya.

Untuk galat jaringan (`ECONNREFUSED`), MCP melaporkan bahwa backend tidak dapat
dihubungi, **tanpa** mencoba ulang secara otomatis untuk tool tulis. Retry
otomatis pada operasi tulis bisa menggandakan efek yang tidak idempoten.

### 3.11 Konfigurasi & operasional

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

### 3.12 Status implementasi

Sudah dikerjakan dan ter-push. Yang berbeda dari rancangan saat dikerjakan:

| Rancangan | Kenyataan | Sebab |
|---|---|---|
| `src/index.ts`, `src/client.ts`, `src/tools/*.ts` | ditambah `src/format.ts` | Pemformatan dipakai 7 tool baca; menaruhnya di dalam tiap tool berarti 7 salinan aturan yang sama |
| `wa_list_messages` tanpa batas bawaan khusus | bawaan `limit` 20, maksimum 100 | Endpoint menerima 200; 30 pesan = 7.485 byte, satu panggilan tanpa batas bisa ~50 KB |
| Peringatan preset `broadcast` "ditampilkan" | ditambahkan eksplisit di akhir keluaran `wa_audit_antiban` | Tanpa itu, `replyRatio 0` pada preset broadcast terbaca sebagai masalah |
| Batas tool dijaga "secara desain" | dijaga uji daftar putih | Pemeriksaan kata kunci meloloskan tool bernama netral yang memanggil `queue/clear` — terbukti saat diuji |

Uji: `backend/scripts/uji-mcp.mjs`, 37 asersi, lewat JSON-RPC sungguhan. Tiga
mutasi sengaja ditanamkan untuk memastikan uji benar-benar menangkap cacat
(header actor dihapus, nilai lama tidak dibaca, peringatan broadcast dihapus) —
ketiganya tertangkap.

---

## 4. Perubahan per berkas

| Berkas | Perubahan |
|---|---|
| `backend/src/routes/sessions.ts` | **Prasyarat:** tambah pemeriksaan kepemilikan di `queue/pause`, `queue/resume`, `queue/clear`, `reconnect`, `metrics`, `queue/status` |
| `backend/src/db/skema.ts` | Empat kolom baru di `api_logs` (`actor`, `target_type`, `target_id`, `params`) + 2 index, lewat `ensureColumn` |
| `backend/src/db/api-logs.ts` | `insertApiLog` menerima empat nilai baru; saring `params` & batasi ukurannya |
| `backend/src/routes/konteks.ts` | Isi kolom baru dari `req`; GET sukses tetap dilewati **kecuali** membawa `X-MCP-Actor` |
| `mcp/` (direktori baru) | **Baru** — server MCP: `package.json`, `src/index.ts`, `src/client.ts`, `src/tools/*.ts` |
| `docs/rancangan-mcp-server.md` | Dokumen ini |

`mcp/` sengaja di luar `backend/` supaya dependensinya (SDK MCP) tidak masuk ke
`package.json` backend, dan `npm install` di backend tetap tidak berubah.

---

## 5. Kompatibilitas

- **Tidak ada perubahan perilaku pengiriman.** MCP hanya membaca dan memanggil
  endpoint yang sudah ada.
- **Tidak ada endpoint baru yang bisa mengirim pesan.** Batas di Bagian 3.8
  ditegakkan dengan tidak adanya tool, bukan dengan pemeriksaan runtime.
- **`api_logs` bertambah empat kolom** lewat `ensureColumn`, jadi baris lama
  tidak terganggu dan tetap terbaca (`actor`, `target_type`, `target_id`,
  `params` bernilai `NULL` untuk baris lama).
- **Volume `api_logs` naik** karena GET ber-`X-MCP-Actor` kini tercatat.
  Perkiraannya kecil: 12 tool × beberapa panggilan per audit, bukan polling.
- **Tidak ada tabel baru dan tidak ada endpoint baru.** Ini konsekuensi langsung
  dari koreksi 2.2, dan yang paling mengurangi risiko: tidak ada jalur tulis
  tambahan yang perlu diamankan.
- **Rate limit tidak berubah.** Konsekuensinya: trafik MCP ikut memakai ember
  per-IP `127.0.0.1` (2.6). Untuk skala sekarang (11 pesan/hari) ini tidak
  menjadi masalah; dicatat sebagai batas yang diketahui.

---

## 6. Cara verifikasi

Semua uji memakai database sementara di `/tmp` dan port cadangan, **bukan**
database produksi — mengikuti aturan yang sama dengan decision log.

| Uji | Membuktikan |
|---|---|
| `uji-mcp-tenant.mjs` | User non-admin **tidak** bisa membaca/menulis sesi user lain, untuk **semua** endpoint yang dipakai MCP. Inilah uji prasyarat. |
| `uji-api-logs-actor.mjs` | Permintaan ber-`X-MCP-Actor` tercatat (termasuk GET sukses); tanpa header, GET sukses tetap tidak tercatat |
| `uji-api-logs-params.mjs` | `params` terisi untuk aksi tulis, tersaring (nomor → hash, kredensial dibuang), dan dibatasi ukurannya |
| `uji-api-logs-pelaku.mjs` | `user_id` berasal dari kunci, bukan dari header; admin melihat semua, user biasa hanya miliknya |
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

**Sudah dikerjakan.** Celah ditutup lebih dulu, dengan uji yang memanggil setiap
endpoint memakai dua kunci berbeda (pemilik harus `2xx`, penyusup harus
`403`/`404`), dan uji itu dijalankan juga terhadap kode sebelum perbaikan untuk
memastikan ia memang menangkap kebocoran — 10 kegagalan di kode lama, 0 setelah
perbaikan. Panel diperiksa: seluruh panggilan di `panel/src/api.ts` memakai sesi
milik pengguna sendiri, dan `GET /metrics` tidak dipakai panel sama sekali.

### 7.2 Sisanya

- **Rekomendasi otomatis.** Itu Langkah 3, dan butuh data dari decision log yang
  sekarang masih kosong di produksi.
- **Transport HTTP untuk MCP.** Tidak perlu selama klien berjalan di mesin yang
  sama.
- **Tool untuk blast.** Sengaja ditolak (3.8).
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
   header itu — termasuk mengosongkannya supaya GET-nya tidak tercatat. Karena
   itu ia **bukan** autentikasi, dan `user_id` di `api_logs` tetap berasal dari
   kunci yang diverifikasi server. Yang bisa dipalsukan hanya label agennya,
   bukan pelakunya. Batas ini diterima: alternatifnya menambah mekanisme
   autentikasi kedua untuk MCP, yang justru menambah permukaan serangan.
3. **Aksi tulis yang gagal sebelum mencapai handler tidak tercatat `params`-nya.**
   Kalau permintaan ditolak `rateLimitHook` atau `requireAuth`, `onResponse`
   tetap berjalan tetapi `req.body` mungkin belum terurai. Barisnya tetap
   tercatat dengan `params` kosong. Ini wajar: yang ditolak belum melakukan
   apa-apa.
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

**Sudah diputuskan:** kolom baru di `api_logs` (bukan menempel ke `endpoint`),
dan audit diambil dari permintaan itu sendiri (bukan tabel `mcp_audit`).

Yang masih terbuka:

1. **Retensi `api_logs`.** Sekarang tidak ada pembersihan otomatis; yang ada
   hanya endpoint manual `POST /api-logs/clear` dengan `olderThanDays`. Dengan
   GET agen ikut tercatat, volumenya naik — perlu ditetapkan batas (mis. 90
   hari) sebelum MCP dipakai rutin. `antiban_decisions` memakai 30 hari, tetapi
   audit permintaan biasanya disimpan lebih lama.
2. **Apakah `params` perlu menyimpan nilai sebelum aksi?** Untuk menjawab "preset
   diubah dari apa ke apa", `params` saja tidak cukup — ia hanya memuat nilai
   baru. Pilihan: (a) biarkan, dan jawab "ke apa" saja; (b) tambah kolom
   `params_before` yang diisi handler. Opsi (b) lebih lengkap tetapi menyentuh
   setiap handler tulis.
3. **Apakah GET ber-`X-MCP-Actor` perlu dibatasi?** Tanpa batas, satu agen bisa
   membanjiri `api_logs` dengan pembacaan berulang. Opsi: batasi satu baris per
   (actor, endpoint, target) per menit, atau biarkan dan andalkan retensi.
4. **Baris audit bisa dihapus oleh yang diaudit.** `DELETE /api-logs` dan
   `POST /api-logs/clear` hanya memakai `requireAuth`; non-admin boleh menghapus
   log miliknya sendiri. Selama `api_logs` hanya catatan galat itu wajar, tetapi
   sebagai bukti audit ia cacat: pihak yang diaudit bisa menghapus jejaknya.
   **Belum diperbaiki** karena panel (`ApiLogsPage.tsx`) menampilkan tombol hapus
   untuk semua peran — mengubahnya menjadi admin-only akan memunculkan 403 di UI
   yang sekarang dipakai. Perlu keputusan tersendiri; alternatifnya kolom
   penanda `audit` yang membuat baris audit tidak bisa dihapus siapa pun kecuali
   admin, sementara log galat biasa tetap bisa dibersihkan pemiliknya.