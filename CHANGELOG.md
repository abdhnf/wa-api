1|# Changelog
2|
3|Semua perubahan penting pada `wa-api` didokumentasikan di file ini.
4|Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
5|[Semantic Versioning](https://semver.org/lang/id/).
6|
7|---
8|
9|## [Unreleased] — panduan MCP tersedia di panel

Sebelum ini satu-satunya petunjuk menjalankan MCP ada di `mcp/README.md` di
dalam repository. Panel sendiri tidak menyebut MCP sama sekali, sehingga
pemilik kunci tidak punya cara mengetahui bahwa MCP ada atau bagaimana
menjalankannya.

### Added

- Section **`04. MCP untuk Agen AI`** di tab Docs panel: kebutuhan, langkah
  membangun server MCP, blok konfigurasi klien, cara membuktikan agen benar-benar
  terhubung, daftar 12 tool, dan batas yang perlu diketahui.

### Changed

- `mcp/` memakai `pnpm-lock.yaml` (sebelumnya `package-lock.json`), menyamakan
  repo dengan `backend/` dan `panel/`.

### Keputusan yang ditetapkan

- **MCP dijalankan dari checkout proyek ini, tidak diterbitkan ke npm.**
  `mcp/package.json` tetap `private: true`. Konsekuensinya panduan wajib memuat
  langkah build, karena `dist/` tidak ikut repository.
- **Kunci API tidak dirender di blok konfigurasi.** Blok memakai placeholder dan
  menunjuk ke Users & API Keys; panel tidak menampilkan ulang kunci penuh setelah
  dialog penerbitan ditutup.
- **Tidak ada tab MCP baru.** Lapis pemasangan masuk Docs, lapis kunci masuk
  Users & API Keys, lapis aktivitas sudah ada di API Logs sejak `6ab53d0`.
- **`WA_API_BASE_URL` tidak ditulis tetap.** Nilainya dihitung dari alamat panel
  yang sedang dibuka, dengan catatan bahwa klien MCP di komputer lain harus
  memakai alamat yang dapat dijangkau dari sana.

### Verifikasi

- Panel: `tsc` bersih, build bersih, section tampil di 207 dengan
  `WA_API_BASE_URL` terisi benar, dan pada 390 px tidak menimbulkan scroll
  horizontal.
- Harness MCP tetap **37/37** terhadap `mcp/dist/index.js`.

---

## [Unreleased] — kolom audit tampil di panel
53|
54|Langkah 1 dari `docs/rancangan-menu-mcp.md`. Data audit sudah tersimpan sejak
55|`f32f814` dan `8d8ce74`, tetapi `ApiLogItem` tidak punya keenam field-nya —
56|sehingga tidak ada satu tempat pun di panel yang bisa membacanya.
57|
58|### Added
59|
60|- `ApiLogItem` + `actor`, `targetType`, `targetId`, `params`, `paramsBefore`,
61|  `audit`; dua kolom baru di tabel: **Agen** dan **Perubahan**.
62|- `panel/src/lib/perubahanAudit.ts` — formatter "nilai lama → nilai baru",
63|  dipisah dari komponen karena di sinilah letak keputusan yang menentukan
64|  benar-tidaknya pembacaan, bukan urusan tata letak.
65|
66|### Aturan tampilan yang ditetapkan
67|
68|- **`params_before` NULL berarti "nilai lama tidak dicatat untuk aksi ini"**,
69|  bukan "tidak ada perubahan". Baris tampil `preset: → broadcast` dengan catatan
70|  kecil, bukan `—`. Dua keadaan ini dibedakan karena menyamakannya membuat
71|  pembaca menyimpulkan kebalikan dari yang terjadi.
72|- **Nilai lama ada, nilai baru kosong** tampil `preset: strict → ∅` — bukan `—`.
73|- **Baris `403`/`429` tetap tampil** dengan `—`: permintaan ditolak sebelum
74|  handler berjalan, jadi memang belum melakukan apa pun.
75|- **Perubahan menjadi preset `broadcast` ditandai bahaya**, karena pada preset
76|  itu `contactGraph` dan `replyRatio` tidak berjalan — "allow" di sana berarti
77|  "dimatikan", bukan "diperiksa dan aman".
78|- **`params` diberi keterangan "nilai tersaring"**; tidak ada tombol "lihat nilai
79|  asli", karena nilai aslinya memang tidak disimpan.
80|- **Tombol hapus & checkbox disembunyikan untuk baris audit non-admin**, diganti
81|  ikon kunci. Menampilkan tombol yang pasti gagal lebih buruk daripada tidak
82|  menampilkannya, dan mencentangnya membuat "hapus 5" menghasilkan "3 dihapus"
83|  tanpa penjelasan. `select-all` ikut melewati baris terkunci.
84|- Teks modal pembersihan diperbaiki: sebelumnya menjanjikan seluruh log terhapus,
85|  padahal untuk non-admin baris audit tidak ikut — dan retensi otomatis sudah
86|  berjalan di server, jadi pembersihan manual bukan lagi retensi rutin.
87|
88|### Catatan pengujian
89|
90|`uji-perubahan-audit-panel.mjs` — 25 asersi, **plus pembanding mutasi**. Tiga
91|mutasi sengaja dijalankan:
92|
93|| Mutasi | Hasil |
94||---|---|
95|| hapus catatan "nilai lama tidak dicatat" | tertangkap (21/25) |
96|| tanda bahaya `broadcast` dimatikan | tertangkap (19/25) |
97|| `if (!baru && !lama)` → `if (!baru)` | **LOLOS 22/22 pada percobaan pertama** |
98|
99|Mutasi ketiga membongkar lubang nyata di uji saya: tidak ada kasus "nilai lama
100|ada, nilai baru kosong", padahal formatter punya cabangnya dan baris seperti itu
101|nyata (DELETE dengan body kosong). Setelah kasus itu ditambahkan, mutasinya
102|tertangkap (23/25).
103|
104|`uji-e2e-kolom-audit.sh` — 15 asersi lewat HTTP pada server sungguhan. Uji unit
105|membuktikan formatter benar untuk input yang saya karang sendiri; uji ini
106|membuktikan server benar-benar **mengirim** kolomnya. Tanpa itu, satu salah tulis
107|nama kolom di `listApiLogs` akan lolos semua uji unit dan tabelnya tetap kosong.
108|Termasuk: nomor telepon di `params` tidak terkirim mentah ke panel.
109|
110|Uji ini sendiri sempat salah lapor: blok node mencetak `OK` untuk 12 asersi
111|tetapi bash hanya menghitung 2, sehingga ringkasannya berbunyi "2 lulus". Sudah
112|diperbaiki agar bash yang menghitung, bukan node yang mencetak.
113|
114|Regresi: celah-audit 11/11, api-logs-audit 11/11, tenant 32/32, qr-jwt 4/4,
115|audit-params 64/64, decision-log 39/39, integrasi 22/22, normalisasi 28/28,
116|uji-mcp 37/37; `tsc` panel 0 error; build panel OK.
117|
118|---
119|
120|## [Unreleased] — rancangan menu MCP di panel
121|
122|`docs/rancangan-menu-mcp.md` — rancangan, belum ada kode.
123|
124|Temuan yang mengubah bentuknya: **`ApiLogsPage.tsx` belum menampilkan satu pun
125|kolom audit.** Server sudah menyimpan `actor`, `target_type`, `target_id`,
126|`params`, `params_before`, dan `audit` sejak `f32f814` dan `8d8ce74`, tetapi
127|`ApiLogItem` tidak punya keenam field itu dan tabelnya hanya menampilkan method,
128|endpoint, status, latency, IP, user, dan waktu. Jadi menu MCP terutama membuka
129|data yang sudah ada, bukan menampilkan data baru.
130|
131|Tiga hal yang sengaja tidak dirancang, karena akan menjadi kontrol yang tidak
132|mengontrol apa pun:
133|
134|- **Registrasi klien MCP dari panel.** MCP dikonfigurasi di komputer pengguna,
135|  bukan di server; panel tidak punya cara "mendaftarkan" klien.
136|- **Tombol "nonaktifkan MCP".** Tidak ada konsep scope per kunci — API key =
137|  seluruh hak pemiliknya. Tombol itu akan berbohong.
138|- **Pembatasan tool per agen.** Daftar putih saat ini hidup di proses MCP, bukan
139|  di wa-api; panel yang menampilkan centang tool tidak menegakkan apa pun.
140|
141|Satu koreksi faktual terhadap draf pertama: index untuk query aktivitas **sudah
142|ada** (`idx_api_logs_actor_time`, partial pada `actor IS NOT NULL`), jadi tidak
143|perlu index baru — dan filter `actor IS NOT NULL` harus ditulis apa adanya, sebab
144|`COALESCE(actor,'')` akan mematikan pemakaian index parsial itu.
145|
146|---
147|
148|## [Unreleased] — tiga celah bukti audit
149|
150|`api_logs` sudah menyimpan siapa, menyentuh apa, dan dengan nilai apa. Tiga hal
151|membuatnya belum bisa dipakai sebagai bukti; ketiganya ditutup di sini.
152|
153|### Added
154|
155|- **`params_before`** — kolom untuk nilai *sebelum* aksi. Sebelumnya audit bisa
156|  menjawab "preset diubah menjadi broadcast", tidak "dari apa" — dan untuk aksi
157|  yang bisa dibalik, pertanyaan kedua itulah yang menentukan. Sengaja **tidak**
158|  diisi otomatis oleh hook `onResponse`: server hanya melihat permintaan yang
159|  sedang berjalan, bukan keadaan sebelumnya, jadi mengisinya di sana berarti
160|  mencatat sesuatu yang belum terjadi. Yang mengisi adalah handler yang memang
161|  sudah membaca nilai lama, lewat `catatNilaiSebelum(req, …)`. Dipasang di
162|  `PUT /sessions/:id/antiban`.
163|- **Retensi otomatis** (`backend/src/retensi.ts`) — dijalankan server sekali
164|  sehari; baris audit disimpan 90 hari, catatan galat 30 hari (sama seperti
165|  `antiban_decisions`). Dua ambang, bukan satu: pertanyaan "siapa melakukan apa
166|  bulan lalu" biasanya baru muncul setelah beberapa minggu, sedangkan galat biasa
167|  tidak perlu selama itu.
168|- **`audit`** — penanda baris bukti. Baris bertanda ini tidak bisa dihapus
169|  non-admin, sedangkan catatan galat biasa tetap bisa dibersihkan pemiliknya.
170|
171|### Kenapa retensi harus di server
172|
173|`POST /api-logs/clear` sengaja tidak bisa menghapus baris audit — kalau bisa,
174|pihak yang diaudit dapat menghapus jejaknya sendiri. Konsekuensinya endpoint itu
175|tidak akan pernah menyusutkan tabel, sementara volume naik karena GET dari agen
176|kini ikut tercatat. Pembersihannya karena itu dipindah ke sisi server, dan
177|jumlah yang dihapus dicatat ke log agar bukan penghapusan senyap.
178|
179|### Fixed
180|
181|- **Penyaring `params` menyensor `typingWPM`.** Pola rahasia menangkap `pin` di
182|  dalam "ty**pin**g", sehingga angka kecepatan mengetik — bagian konfigurasi
183|  anti-ban yang justru ingin diaudit — tersimpan sebagai `[REDACTED]`. Diperbaiki
184|  dengan daftar pengecualian eksplisit, **bukan** dengan melonggarkan pola:
185|  mengubahnya menjadi `(^|[_-])pin$` akan meloloskan `pinCode`, jauh lebih
186|  berbahaya daripada satu angka yang tersensor.
187|
188|### Catatan pengujian
189|
190|`backend/scripts/uji-celah-audit.sh` — 11 asersi lewat HTTP sungguhan pada DB
191|kosong di `/tmp` dan port cadangan. Yang dibuktikan, bukan diasumsikan:
192|
193|- `params_before.preset = "strict"` sementara `params.preset = "broadcast"`
194|  sesudah dua kali perubahan berturut-turut — jadi nilai lama benar-benar dibaca
195|  dari keadaan yang berlaku, bukan dari nilai bawaan.
196|- Non-admin menghapus baris audit → `deletedCount: 0`, `dilewati: 1`, barisnya
197|  masih ada; admin menghapus baris yang sama → benar-benar hilang. Tanpa asersi
198|  kedua, "tidak bisa dihapus" bisa berarti "tidak bisa dihapus siapa pun".
199|- Baris galat biasa tetap bisa dihapus pemiliknya — ini yang menjaga tombol di
200|  panel tidak berubah menjadi 403.
201|- Retensi: baris 100 hari hilang (audit & galat), baris hari ini tidak ikut.
202|
203|Regresi: `uji-audit-params` 64/64, `uji-api-logs-audit` 11/11, tenant 32/32,
204|qr-jwt 4/4, decision-log 39/39, integrasi 22/22, normalisasi 28/28,
205|`uji-mcp` 37/37.
206|
207|---
208|
209|## [Unreleased] — server MCP untuk audit & setup terbatas
210|
211|`mcp/` — proses terpisah, transport stdio, 12 tool (7 baca + 5 tulis yang bisa
212|dibalik). Rancangan & alasannya di `docs/rancangan-mcp-server.md`, cara pakai di
213|`mcp/README.md`.
214|
215|Dua keputusan yang menentukan bentuknya:
216|
217|- **Proses terpisah, bukan in-process.** Kalau MCP berjalan di dalam backend dan
218|  crash, seluruh antrean pesan berhenti. Sebagai proses terpisah, kegagalannya
219|  terkurung, dan SDK MCP tidak masuk ke proses produksi.
220|- **Otorisasi sepenuhnya di wa-api.** MCP hanya meneruskan API key pemiliknya;
221|  ia tidak punya pemeriksaan hak sendiri. `403` diteruskan sebagai `403`, tidak
222|  ditafsirkan sebagai "tidak ada".
223|
224|### Added
225|
226|- `mcp/src/client.ts` — satu jalur untuk semua permintaan, supaya `X-MCP-Actor`
227|  tidak mungkin terlupa di satu tool dan bukan di tool lain (tanpa header itu,
228|  GET yang berhasil tidak tercatat sebagai bukti audit).
229|- `mcp/src/format.ts` — pemformat yang menjawab pertanyaan, bukan membuang JSON
230|  mentah. Diukur: `antiban` 3.466 byte, 67%-nya definisi seluruh preset yang
231|  tidak ditanyakan; sesudah diformat menjadi ~530 karakter.
232|- `mcp/src/tools/baca.ts`, `mcp/src/tools/tulis.ts` — 12 tool.
233|- `backend/scripts/uji-mcp.mjs` (37 asersi) — uji lewat JSON-RPC sungguhan.
234|- `backend/scripts/ukur-respons-mcp.sh`, `bentuk-respons.sh` — pengukur ukuran
235|  respons dan pencetak bentuk JSON, dipakai agar formatter ditulis dari data
236|  nyata.
237|
238|### Catatan pengujian
239|
240|Uji ini menemukan tiga hal yang tidak terlihat dari membaca kode:
241|
242|1. **Pemeriksaan kata kunci tidak cukup.** Tool bernama `wa_bersihkan_antrean`
243|   yang memanggil `queue/clear` lolos dari filter kata terlarang. Yang
244|   menangkapnya adalah perbandingan dengan daftar putih nama tool.
245|2. **Asersi "nilai lama dilaporkan" semula terlalu lemah** — ia lulus walau
246|   handler tidak membaca nilai lama sama sekali. Diperbaiki agar memeriksa
247|   nilainya, bukan hanya ada/tidaknya panah pada pesan.
248|3. **Peringatan preset `broadcast` tidak teruji.** Tanpa peringatan itu, angka
249|   `replyRatio 0` terbaca sebagai masalah padahal guard-nya memang dimatikan.
250|
251|Ketiganya ditemukan dengan merusak kode dengan sengaja lalu memastikan uji
252|gagal — bukan dengan membaca ulang uji yang hijau.
253|
254|### Belum dikerjakan
255|
256|- Retensi `api_logs` otomatis, `params_before`, dan pembatasan `DELETE
257|  /api-logs` untuk non-admin (lihat bagian sebelumnya).
258|- Pembatasan jumlah panggilan per agen; sekarang masih bergantung pada rate limit
259|  per-IP wa-api.
260|- `WA_MCP_ACTOR` bisa dipalsukan — diterima, karena ia label dan bukan
261|  autentikasi; pelaku tetap diambil dari kunci yang diverifikasi.
262|
263|---
264|
265|## [Unreleased] — isolasi tenant pada rute sesi
266|
267|Prasyarat untuk server MCP multi-tenant. Selama satu API key bisa menyentuh sesi
268|milik user lain, MCP hanya akan membungkus kebocoran itu dengan antarmuka yang
269|lebih rapi — dan memberi agen AI kemampuan menghentikan antrean atau memutus
270|sesi tenant lain.
271|
272|Sebelum perubahan ini, enam endpoint pada `routes/sessions.ts` hanya memakai
273|`requireAuth` tanpa pemeriksaan kepemilikan sama sekali, dan satu endpoint
274|(`GET /metrics`) mengembalikan laporan seluruh tenant dalam satu respons. Satu
275|pola pemeriksaan yang benar sudah ada, tetapi disalin ke sebagian handler saja —
276|justru handler yang tidak menyalinnya yang bocor.
277|
278|### Added
279|
280|- **`backend/src/kepemilikan.ts`** — `periksaKepemilikanSesi()`, `tolakSesi()`,
281|  dan `idSesiMilik()`. Membaca `sessions.user_id` dari database, bukan dari
282|  `manager.getSession()`, karena pemeriksaan otorisasi tidak boleh bergantung
283|  pada koneksi WhatsApp yang mungkin sedang putus.
284|- **Uji:** `scripts/uji-tenant-isolasi.sh` (32 asersi) menjalankan server pada DB
285|  kosong di `/tmp` dan port cadangan, lalu memanggil setiap endpoint dengan dua
286|  kunci berbeda: kunci pemilik harus 2xx, kunci penyusup harus 403/404. Uji yang
287|  sama dijalankan terhadap kode **sebelum** perbaikan dan gagal 10 kali — tanpa
288|  pembanding itu, uji hijau tidak membuktikan apa pun.
289|- **Uji:** `scripts/uji-qr-jwt.sh` (4 asersi) untuk alur pairing panel yang
290|  memakai `requireJwt`, karena rute itu tidak mengisi `req.apiKeyUser` dan
291|  identitasnya harus diambil dari `req.user.id`.
292|
293|### Fixed
294|
295|- `GET /sessions/:id/metrics`, `GET /sessions/:id/queue/status`,
296|  `POST /sessions/:id/queue/pause|resume|clear`, `PATCH /sessions/:id`,
297|  `POST /sessions/:id/logout|reconnect|pair`, `DELETE /sessions/:id`, dan
298|  `GET /sessions/:id/qr` kini memeriksa kepemilikan.
299|- `GET /metrics` disaring: non-admin hanya menerima laporan sesi miliknya.
300|- Enam salinan blok pemeriksaan yang sudah ada (`antiban`, `contact-graph`)
301|  diganti ke helper yang sama, supaya tidak ada dua cara berbeda menjawab
302|  pertanyaan yang sama.
303|
304|### Catatan
305|
306|- Sesi tanpa `user_id` tetap boleh diakses. Kolom itu punya `DEFAULT
307|  'usr_c26f74d6'`, jadi baris lama tidak `NULL`; aturan ini hanya jaring pengaman
308|  agar sesi yang belum terklasifikasi tidak mengunci admin dari sesinya sendiri.
309|- Sesi yang tidak ada dijawab **404**, bukan 403, supaya tidak membocorkan bahwa
310|  id tersebut ada.
311|
312|---
313|
314|## [Unreleased] — `api_logs` sebagai bukti audit, bukan hanya catatan galat
315|
316|Persiapan untuk server MCP yang akan dipakai agen AI melakukan audit dan setup
317|terbatas. Rancangan lengkapnya ada di `docs/rancangan-mcp-server.md`.
318|
319|Arah yang diambil: **audit adalah permintaan itu sendiri**, bukan catatan
320|terpisah yang dilaporkan pemanggil. Server sudah melihat setiap request lewat
321|hook `onResponse`; menyuruh agen menulis baris audit sendiri akan membuat satu
322|aksi menghasilkan dua catatan yang bisa berbeda, menjadikan agen saksi atas
323|perbuatannya sendiri, dan menambah endpoint tulis yang justru bisa dipakai
324|menulis baris audit palsu.
325|
326|### Added
327|
328|- **Empat kolom audit pada `api_logs`** (`backend/src/db/skema.ts`): `actor`,
329|  `target_type`, `target_id`, `params`. Ditambahkan lewat `ensureColumn`, jadi
330|  baris lama tetap terbaca dengan nilai `NULL`. Dua index parsial menyertainya,
331|  diletakkan **setelah** `ensureColumn` karena index pada kolom yang belum ada
332|  membuat instalasi DB baru gagal.
333|- **`backend/src/audit-params.ts`** — penyaring `req.body` sebelum disimpan.
334|  Nomor telepon diganti hash lewat `hashRecipient()` (fungsi yang sama dengan
335|  `antiban_decisions`, sehingga hash-nya bisa dikorelasikan), field yang
336|  namanya mengandung kredensial diganti `[REDACTED]`, ukuran dibatasi 2 KB,
337|  kedalaman 4 tingkat, array 20 elemen. Tanpa ini `api_logs` berubah menjadi
338|  salinan data pribadi dan kredensial — log audit yang menyimpan rahasia bukan
339|  audit, melainkan kebocoran kedua.
340|- **Uji:** `scripts/uji-audit-params.mjs` (59 asersi) dan
341|  `scripts/uji-api-logs-audit.sh` (11 asersi, lewat HTTP sungguhan pada DB
342|  kosong di `/tmp`).
343|
344|### Changed
345|
346|- **GET yang berhasil kini dicatat bila membawa `X-MCP-Actor`**
347|  (`backend/src/routes/konteks.ts`). Sebelumnya seluruh GET sukses dibuang
348|  tanpa syarat, sehingga operasi baca agen tidak akan berjejak sama sekali.
349|  Filter tidak dihapus — panel melakukan polling GET terus-menerus — melainkan
350|  dibuat selektif.
351|- **`insertApiLog()` dan `listApiLogs()`** menerima dan mengembalikan empat
352|  kolom baru (`backend/src/db/api-logs.ts`).
353|
354|### Catatan
355|
356|- **Cacat yang ditemukan tetapi belum diperbaiki:** `DELETE /api-logs` dan
357|  `POST /api-logs/clear` hanya memakai `requireAuth`, sehingga non-admin bisa
358|  menghapus log miliknya sendiri. Sebagai catatan galat itu wajar; sebagai bukti
359|  audit itu cacat, karena pihak yang diaudit bisa menghapus jejaknya. Perbaikan
360|  belum dilakukan karena panel menampilkan tombol hapus untuk semua peran —
361|  mengubahnya menjadi admin-only akan memunculkan 403 di UI yang sekarang
362|  dipakai. Perlu keputusan tersendiri.
363|- **`params` hanya menyimpan nilai baru**, bukan nilai sebelumnya. Untuk
364|  menjawab "preset diubah dari apa ke apa", `params` saja tidak cukup.
365|- **Retensi `api_logs` belum otomatis.** Volume naik karena GET agen ikut
366|  tercatat; batas retensi perlu ditetapkan sebelum MCP dipakai rutin.
367|
368|---
369|
370|## [Unreleased] — Pencatatan guard warm-up & penolakan seluruh sesi
371|
372|Dua cacat pada instrumentasi decision log yang **tidak memunculkan error** dan
373|tidak tertangkap uji regex mana pun — keduanya ditemukan lewat probe yang
374|menghitung baris pada database sungguhan.
375|
376|### Fixed
377|
378|- **Guard warm-up tercatat di tempat yang salah** (`backend/src/session-manager.ts`).
379|  Pencatatan berada di dalam `checkHealth()`, yang sebenarnya fungsi **seleksi
380|  sesi**, bukan jalur kirim. Akibatnya salah pada dua kondisi sekaligus: dengan
381|  autorotate aktif dan tiga sesi kandidat, satu pengiriman menghasilkan **3 baris**
382|  `warmup` tanpa `message_id` (satu per kandidat); dengan autorotate mati —
383|  instalasi satu sesi, setup paling umum — guard ini **tidak pernah tercatat sama
384|  sekali**, padahal justru di sesi baru warm-up paling mungkin menahan. Kini
385|  dicatat lewat `catatWarmup()` di `resolveSession()`, dipanggil dari tiga jalur
386|  yang memilih sesi (satu-sesi, sticky session, rotasi). Hasil probe: **1 baris
387|  per pengiriman** pada kedua kondisi.
388|- **Penolakan seluruh sesi tidak tercatat sama sekali.** Ketika semua kandidat
389|  ditolak `checkHealth()`, `resolveSession()` mengembalikan sesi dengan alasan
390|  "semua sesi sedang limit" tanpa satu baris pun di decision log — padahal inilah
391|  kasus yang paling perlu ditelusuri, karena pesan benar-benar tertahan. Kini
392|  dicatat **satu baris** `sessionHealth` berisi rincian penolakan tiap sesi di
393|  `metrics`, sehingga tidak mengulang masalah duplikasi seperti pada warm-up.
394|
395|### Added
396|
397|- **`scripts/uji-rasio-keputusan.mjs`** — mengukur jumlah baris per percobaan
398|  kirim pada tiga kondisi (autorotate mati, aktif dengan tiga kandidat, dan tiga
399|  panggilan berurutan). Inilah yang membuktikan cacat di atas dengan angka.
400|- **`scripts/uji-session-health-block.mjs`** — memaksa kuota warm-up kedua sesi
401|  habis, lalu memastikan penolakan seluruh sesi tercatat tepat satu baris
402|  `sessionHealth` beserta rinciannya.
403|- **4 asersi regresi** di `uji-decision-log-integrasi.mjs` (total 22) yang
404|  memastikan pencatatan tidak kembali ke dalam `checkHealth()` dan
405|  `catatWarmup()` tetap dipanggil di ketiga jalur pemilihan sesi.
406|
407|### Notes
408|
409|- **Baris `warmup` tetap tanpa `message_id`.** `resolveSession()` dipanggil
410|  sebelum pesan dibuat, jadi pengaitan ke satu pesan belum mungkin tanpa
411|  mengubah urutan alur. Analisis per penerima tetap bisa dilakukan lewat
412|  `recipient_hash` + `created_at`.
413|- **Volume terukur:** 6 baris per percobaan kirim, sekitar **12.000 baris/bulan**
414|  (±4,6 MB) pada beban 56 pesan/hari, dengan retensi 30 hari.
415|
416|---
417|
418|## [Unreleased] — Perbaikan normalisasi nomor & IP privat di nilai bawaan
419|
420|Dua bug yang ditemukan saat menulis uji untuk decision log. Keduanya berjenis
421|sama: **tidak memunculkan error**, hanya menghasilkan nilai yang "kelihatan
422|benar" padahal salah.
423|
424|### Fixed
425|
426|- **Awalan internasional `00` pada nomor telepon** (`backend/src/phone.ts`).
427|  `006281234567890` dinormalisasi menjadi `62006281234567890` — nomor yang tidak
428|  pernah ada. Penyebabnya, awalan `00` masuk ke cabang `startsWith('0')` sehingga
429|  nol pertama dibuang lalu `62` ditambahkan di depannya. `normalisasiNomor()`
430|  dipakai pendaftaran user, penambahan user oleh admin, dan onboarding — jadi
431|  nomor yang ditulis dengan cara internasional ditolak sebagai tidak valid.
432|- **`hashRecipient()` punya aturan normalisasi sendiri** (`backend/src/db/decision-log.ts`).
433|  Sebelumnya hanya mengubah awalan `0` menjadi `62`, sehingga menyimpang dari
434|  jalur kirim untuk nomor berawalan `00` dan nomor tanpa awalan. Akibatnya satu
435|  penerima bisa menghasilkan dua hash berbeda, dan pengelompokan "berapa pesan
436|  ke satu penerima" pecah tanpa terlihat. Kini memakai `normalisasiNomor()`
437|  sebagai satu-satunya sumber bentuk kanonik.
438|- **IP privat VM di 17 lokasi.** Alamat IP privat VM pengembangan tertanam di
439|  nilai bawaan kode produksi (`panel-url.ts`, `blast_dashboard_url` di tiga
440|  berkas route), contoh konfigurasi, skrip verifikasi, dan contoh di panel. Di
441|  produksi alamat itu menghasilkan tautan yang tidak bisa dibuka pengguna tanpa
442|  error apa pun. Nilai bawaan kini `localhost`; setting di produksi sudah terisi
443|  domain publik sehingga tidak terpengaruh.
444|
445|### Changed
446|
447|- **Alamat bawaan Blast Dashboard disatukan.** Sebelumnya ditulis ulang di empat
448|  tempat (`auth.ts` dua kali, `pengaturan.ts`, `users.ts`). Kini satu konstanta
449|  `BLAST_DASHBOARD_URL_BAWAAN`, sejajar dengan `PANEL_BASE_URL_BAWAAN`.
450|- **`db/keputusan.ts` → `db/decision-log.ts`.** Satu fitur sebelumnya memakai dua
451|  bahasa nama berkas (Indonesia di `db/`, Inggris di `antiban-decision-log.ts`).
452|  Identifier yang diekspor tetap Inggris seperti seluruh kode lain.
453|
454|### Added
455|
456|- **`scripts/uji-normalisasi-nomor.mjs`** — 28 asersi: 11 varian penulisan nomor,
457|  9 masukan tidak valid, konsistensi `nomorValid()`. Sebelumnya `normalisasiNomor()`
458|  tidak punya uji sama sekali.
459|- **Uji regresi normalisasi di `uji-decision-log.mjs`** — 7 varian penulisan nomor
460|  harus bertemu di satu hash. Uji inilah yang menemukan bug `00` di atas.
461|
462|---
463|
464|## [Unreleased] — Decision log anti-ban
465|
466|Sistem anti-ban punya tujuh guard yang berjalan, tapi **tidak meninggalkan jejak
467|keputusan**. Saat sebuah nomor terblokir, pertanyaan "guard mana yang seharusnya
468|menahan ini, dan kenapa tidak?" tidak bisa dijawab dari data: `messages.status`
469|berubah tanpa alasan, `api_logs` mencatat HTTP bukan keputusan guard, dan
470|`antiban_state` hanya menyimpan kondisi akhir.
471|
472|Bagian ini menambahkan tabel `antiban_decisions` dan instrumentasi enam guard.
473|**Tidak ada perilaku pengiriman yang berubah** — hanya pembacaan nilai yang sudah
474|ada, dicatat per evaluasi.
475|
476|### Added
477|
478|- **Tabel `antiban_decisions`** (`backend/src/db/skema.ts`) — satu baris per
479|  evaluasi guard, bukan per pesan. Satu pesan bisa dievaluasi berkali-kali
480|  (setiap antrean bangun); menyimpannya sebagai kolom di `messages` akan
481|  menimpa riwayat percobaan sebelumnya. Empat index: per sesi+waktu, per
482|  guard+keputusan+waktu, per `message_id` (parsial), dan per `batch_id`
483|  (parsial) — dua terakhir parsial karena guard level sesi memang tanpa
484|  `message_id`.
485|- **Modul `backend/src/db/decision-log.ts`** — `recordGuardDecision`,
486|  `hashRecipient`, `evaluateGuard`, `summarizeDecisions`, `listDecisions`,
487|  `pruneDecisions`. Murni SQL, tanpa impor domain, supaya bisa diuji tanpa
488|  memuat `SessionManager` beserta dependensi WhatsApp-nya.
489|- **Jembatan `backend/src/antiban-decision-log.ts`** — tahu konteks sesi
490|  (`getSessionAntiBanPreset`). Preset ikut dicatat karena `allow` pada
491|  `broadcast` berarti hal yang berbeda dari `allow` pada `strict`: yang kedua
492|  "diperiksa dan aman", yang pertama bisa berarti "guard-nya dimatikan".
493|- **Instrumentasi tujuh guard** (`backend/src/session-manager.ts`): `recovery`,
494|  `timelock`, `replyRatio`, `contactGraph`, `rateLimiter`, `warmup`, dan
495|  `sessionHealth`. Keputusan `allow` **dan** `block` sama-sama dicatat — guard
496|  yang menahan sudah memanggil `console.warn`, yang meloloskan tidak, sehingga
497|  tanpa mencatat `allow` tidak ada cara mengukur seberapa dekat pengiriman ke
498|  ambang batas.
499|- **Dua endpoint baca** (`backend/src/routes/operasional.ts`):
500|  `GET /api/v1/antiban/decisions/summary` dan `GET /api/v1/antiban/decisions`
501|  (paginasi + filter guard/decision/batch/sesi/waktu). Non-admin hanya bisa
502|  membaca sesi miliknya; tanpa `sessionId` mendapat `400`. Tidak ada endpoint
503|  tulis — decision log hanya diisi jalur pengiriman.
504|- **Tujuh skrip verifikasi** di `backend/scripts/`, semuanya memakai database
505|  sementara di `/tmp`: unit (39 asersi), integrasi (22 asersi), rasio keputusan,
506|  penolakan seluruh sesi, boot, E2E HTTP (63 asersi), migrasi pada salinan DB,
507|  plus fixture seed.
508|
509|### Notes
510|
511|- **Tanpa PII.** Yang disimpan hanya `recipient_hash` (SHA-256, 16 hex), metrik,
512|  dan ambang — tidak pernah isi pesan atau nomor mentah.
513|- **`hashRecipient` menormalkan awalan nomor** (`0812…` → `62812…`), disamakan
514|  dengan `validatePhoneFormat()`. Tanpa itu satu penerima menghasilkan dua hash
515|  dan analisis "berapa kali orang ini dikirimi" jadi salah.
516|- **Pencatatan tidak pernah menggagalkan pengiriman.** `recordGuardDecision()`
517|  menelan semua error menjadi `console.warn` sekali per kejadian; antrean tidak
518|  boleh macet gara-gara audit.
519|- **Migrasi non-destruktif**, diuji pada salinan database berisi data nyata:
520|  10 tabel lama utuh, jumlah baris tidak berubah, tidak ada kolom hilang.
521|- **Retensi 30 hari** lewat `pruneDecisions()` oportunistik; tanpa cron baru.
522|- Rancangan lengkap beserta gap yang masih terbuka: `docs/rancangan-decision-log-antiban.md`.
523|
524|---
525|
526|## [Unreleased] — Waktu per transisi status pesan
527|
528|Fitur ini menjawab satu pertanyaan yang sebelumnya tidak bisa dijawab panel:
529|**kapan** sebuah pesan berpindah status, dan **berapa lama** jedanya. Sebelumnya
530|kolom waktu di semua tabel hanya memuat `created_at` — waktu pesan masuk antrean.
531|Di bawah badge "Terkirim", angka itu menyesatkan, karena jeda anti-ban bisa
532|membuat selisihnya bermenit-menit.
533|
534|Backend menyimpan waktu tiap transisi di `payload.statusTimes` (tanpa migrasi
535|skema) memakai timestamp asli WhatsApp. Panel dan dashboard membacanya.
536|
537|### Added
538|
539|- **`statusTimes` di payload pesan** (`backend/src/db/pesan.ts`). Diisi di
540|  `insertMessage` (waktu antrean) dan `updateMessageStatus` (tiap transisi).
541|  Timestamp yang tidak masuk akal jatuh ke jam server.
542|- **Kolom jam status terkini di sel Status, empat tabel panel:**
543|  Playground, Monitor & Queue, Admin Command Center, dan modal Log pengguna.
544|  Jam ditulis langsung di bawah badge supaya bisa dibandingkan antar baris tanpa
545|  membuka tooltip — tooltip tidak tersedia di layar sentuh.
546|- **Util bersama `panel/src/lib/messageStatus.tsx`:** `susunBarisWaktu`,
547|  `ringkasWaktu`, `jamStatusTerakhir`, komponen `JamStatus`. Satu sumber
548|  kebenaran; sebelumnya `getStatusBadge` diduplikasi dengan isi berbeda.
549|
550|### Fixed
551|
552|- **Status terminal selain `failed` tidak pernah tampil.** Panel hanya
553|  menangani `failed`, sehingga pesan `not_registered` / `invalid_number` /
554|  `cancelled` — yang waktunya sudah dicatat backend — tampil seolah masih di
555|  antrean. Daftar kini sejalan dengan `FORCED_STATUSES` di backend.
556|- **Pesan gagal tampil dengan centang hijau di modal Log pengguna.** Ikon hanya
557|  memeriksa `failed`, jadi `not_registered` dan `invalid_number` terlihat
558|  berhasil saat operator memindai daftar.
559|- **Label status mentah di modal Log pengguna.** `LABEL_STATUS_PESAN` hanya
560|  memuat enam status; sisanya tampil apa adanya (`not_registered`). Kini lengkap.
561|- **`typeof NaN === 'number'`** membuat `NaN`/`Infinity` lolos dan tampil
562|  sebagai baris berjam `-`. Diganti `Number.isFinite` di semua jalur.
563|
564|### Changed
565|
566|- **Header kolom "Waktu" menjadi "Masuk Antrean"** di keempat tabel. Kolom itu
567|  memang berisi `created_at`; tanpa penamaan ulang, ia mudah tertukar dengan jam
568|  status yang kini ada di sel Status.
569|
570|### Catatan
571|
572|- **Pesan lama tidak bisa direkonstruksi.** Pesan yang dibuat sebelum fitur ini
573|  tidak punya `statusTimes`; panel menampilkan "Tidak ada catatan waktu per
574|  tahap" apa adanya, bukan mengarang waktu dari `created_at`.
575|- **Uji:** suite `wa-api` **8/8 lulus** (termasuk `uji-util-waktu-panel.mjs`
576|  **34/34**).
577|
578|---
579|
580|## [Unreleased] — Pemecahan berkas besar backend
581|
582|**Tema:** memecah empat berkas backend yang sudah terlalu besar menjadi modul per domain, tanpa mengubah perilaku.
583|**Basis:** `8129a33` (main).
584|
585|Ringkasan: empat berkas backend menumpuk 5.430 baris — `server.ts` 2.094, `db.ts` 1.444, `antiban.ts` 1.282, `mail-templates.ts` 610. Menelusuri satu handler berarti menggulir ribuan baris, dan menyentuh satu bagian berisiko menyenggol bagian lain di berkas yang sama. Keempatnya dipecah menjadi 36 berkas di empat direktori, dengan berkas aslinya kini berupa fasad re-export. Yang dijaga ketat bukan sekadar "build hijau", tetapi **perilaku yang tidak berubah**: untuk `db.ts` itu urutan efek samping saat impor (skema, migrasi kolom, index, seed), untuk `antiban.ts` itu 135 pengamatan perilaku delapan guard dengan jam dan RNG dibekukan, untuk `mail-templates.ts` itu keluaran HTML karakter per karakter.
586|
587|### Changed
588|
589|- **`server.ts` 2.094 → 35 baris** (`backend/src/server.ts`, 9 berkas di `backend/src/routes/`).
590|  Bootstrap tipis: plugin, hook, dan `listen`. Handler dipisah per domain — `auth` 14 route, `pesan` 12, `sessions` 25, `pengaturan` 10, `users` 8, `operasional` 5, sisanya `schemas`/`media`/`konteks`. Daftar route **dibangkitkan dari sumber**, bukan ditulis manual: percobaan pertama dengan daftar manual menghasilkan 72 dari 74 route karangan.
591|
592|- **`mail-templates.ts` 610 → 35 baris** (`backend/src/mail-templates.ts`, 4 berkas di `backend/src/email/`).
593|  Dipisah menurut jenis email: `dasar` (warna, font, escaping), `reset-password`, `registrasi`, `uji`.
594|
595|- **`db.ts` 1.444 → 44 baris** (`backend/src/db.ts`, 12 berkas di `backend/src/db/`).
596|  Dipisah per domain data: `client` (satu-satunya pemilik koneksi), `skema`, `users`, `pesan`, `api-logs`, `jeda`, `reset-password`, `sessions`, `kuota`, `lid`, `kesehatan`, `admin`. Berkas aslinya menyisipkan seksi antar domain (users → reset-password → users lagi → kuota), sehingga satu berkas hasil boleh terdiri dari beberapa rentang baris.
597|
598|- **`antiban.ts` 1.282 → 42 baris** (`backend/src/antiban.ts`, 11 berkas di `backend/src/antiban/`).
599|  Dipisah per guard: `tipe`, `preset`, `util`, `rate-limiter`, `warmup`, `timelock`, `presence`, `reconnect`, `ban-recovery`, `reply-ratio`, `contact-graph`.
600|
601|- **Fasad memakai daftar nama eksplisit, bukan `export *`** (`backend/src/antiban.ts`).
602|  Empat simbol (`MS`, `hashContent`, `identicalKey`, `ReplyRatioConfig`) dulu privat di `antiban.ts` tetapi harus dipakai lintas modul hasil. Simbol itu diekspor **hanya di modulnya**, dan fasad dibangkitkan dari daftar `export` berkas asli sehingga permukaan API tidak bertambah satu nama pun. `export *` akan ikut membocorkannya.
603|
604|- **Perkakas pemecahan disimpan di repo** (`backend/scripts-pecah/`).
605|  Generator per berkas (`pecah-*.py`), verifier isi + permukaan API (`verifikasi-*.py`), banding perilaku (`banding-http.mjs`, `banding-email.mjs`, `banding-antiban.mjs`), pre-flight deploy (`pra-deploy.py`), dan jaring uji (`jalankan-uji.sh`). Tujuannya agar pemecahan berkas berikutnya tidak dikerjakan dengan cara yang berbeda-beda.
606|
607|### Notes for reviewer
608|
609|- **Verifikasi yang dijalankan, per tahap:** baris kode hasil dibandingkan sebagai multiset dengan berkas asli (tidak ada hilang, tidak ada baru); permukaan API dibandingkan nama per nama; `npx tsc` exit 0; 5 skrip uji backend lulus 0 gagal; 74/74 route identik status dan bentuk respons terhadap build pra-refactor; dan untuk `antiban.ts` 135 pengamatan perilaku identik.
610|- **`db.ts` diverifikasi lebih jauh** karena isinya bukan sekadar kumpulan fungsi: begitu diimpor ia menjalankan PRAGMA, CREATE TABLE, migrasi kolom, index, dan seed. Diuji dengan database kosong **dan** database lama yang dibuka versi baru (migrasi idempoten), lalu dibandingkan: 10 tabel, 12 index, 11 `settings`, 22 kolom `users` — sama persis.
611|- **`antiban.ts` diuji perilakunya, bukan hanya isinya.** `banding-antiban.mjs` membekukan `Date` dan `Math.random` dengan benih tetap (wajib: ada 37 pemakaian `Date.now()` dan 7 `Math.random()`), menjalankan skenario yang sama pada build lama dan build pecahan, lalu membandingkan hasilnya. Skrip yang sama dijalankan di VM dengan Node 22 terhadap `dist` yang benar-benar dideploy — 135 pengamatan identik, sama seperti Node 26 lokal.
612|- **Sudah dideploy ke VM dev 207 dan diverifikasi:** 57 berkas `js` identik dengan build lokal (md5 agregat), `NRestarts=0`, tanpa error di journal, DB produksi utuh, 3 sesi WhatsApp tetap `connected`, dan 9router `Up 9 days (healthy)`.
613|- **`antiban.ts` terbukti benar-benar berjalan di produksi**, bukan sekadar dimuat: journal VM mencatat `[AntiBan] Timelock 463 untuk sesi ... telah dicabut oleh WhatsApp` dari `TimelockGuard` di modul hasil pemecahan.
614|- **`session-manager.ts` (1.344 baris) sengaja TIDAK dipecah.** Isinya satu fungsi dan satu class dengan 46 method yang semuanya memakai `this` (167 pemakaian `this.`), dengan state yang saling terkait (engine, queues, pausedSessions, antiban, health, lidResolver, metrics). Memecahnya berarti memisahkan state bersama — itu menulis ulang, bukan memotong per rentang, dan berkas itu ada di jalur kirim pesan. Ambang yang dipakai: bila jumlah pemakaian `this.` pada satu class mendekati jumlah method-nya, berkas itu bukan kandidat potong-per-rentang.
615|- **Batas cakupan:** yang tidak diuji tetap pesan yang benar-benar terkirim dan pairing WhatsApp, karena keduanya butuh nomor asli.
616|- **Rollback per tahap tersedia** sebagai direktori `dist.bak-*` di VM (`-pecah`, `-email`, `-db`, `-antiban`), masing-masing cukup di-`mv` kembali lalu restart `wa-backend.service`.
617|
618|---
619|
620|## [Unreleased] — Registrasi akun & email selamat datang
621|
622|**Tema:** notifikasi email saat pendaftaran, kolom nomor WhatsApp di form registrasi, dan halaman pengenalan setelah daftar lewat Google.
623|**Basis:** `c896df3` (main).
624|
625|Ringkasan: pendaftaran sebelumnya tidak memberi umpan balik apa pun — akun terbentuk, tetapi pengguna tidak menerima email dan tidak tahu batas pemakaiannya. Pendaftar lewat Google lebih parah lagi: mereka tidak melewati formulir, sehingga akun terbentuk tanpa nomor WhatsApp dan tanpa penjelasan kuota. Tiga hal itu ditutup di sini.
626|
627|### Added
628|
629|- **Email selamat datang untuk dua jalur pendaftaran** (`backend/src/notifikasi-email.ts`, `backend/src/mail-templates.ts`).
630|  Dikirim setelah akun benar-benar terbentuk, dengan isi yang dibedakan menurut jalurnya:
631|  - Pendaftaran form manual: tombol mengarah ke dashboard.
632|  - Pendaftaran lewat Google: tombol "Lengkapi Nomor WhatsApp" mengarah ke `/onboarding`.
633|  Email hanya dikirim untuk akun yang **baru dibuat**. Pengguna lama yang login ulang tidak dikirimi lagi — dibedakan lewat `upsertGoogleUser()` yang kini mengembalikan `{ user, baru }`.
634|  Kegagalan kirim email sengaja tidak melempar galat: akun sudah ada di database, dan SMTP yang mati tidak boleh membatalkan pendaftaran.
635|
636|- **Kolom nomor WhatsApp di form registrasi** (`panel/src/components/AuthPage.tsx`, `backend/src/server.ts`).
637|  Opsional, bertipe `tel`. Nomor dinormalkan ke bentuk kanonik `628...` lewat `normalisasiNomor()` yang sudah dipakai endpoint admin, sehingga `0812-3456-789` dan `+62 812 3456 789` tersimpan identik. Nomor tidak valid ditolak `400` dengan pesan yang menyebut format yang diterima; nomor yang sudah dipakai akun lain ditolak `409`.
638|
639|- **Halaman pengenalan setelah daftar lewat Google** (`panel/src/components/OnboardingPage.tsx`, rute `/onboarding`).
640|  Menampilkan sisa kuota harian dan mingguan, lalu meminta nomor WhatsApp. Nomor boleh dikosongkan dan masih dapat dilengkapi kapan saja. Halaman ini hanya muncul untuk akun Google yang baru dibuat, ditandai lewat `perluOnboarding` pada respons `/auth/google`.
641|
642|- **`PATCH /api/v1/auth/me`** (`backend/src/server.ts`).
643|  Melengkapi profil sendiri. Dipakai halaman pengenalan untuk menyimpan nomor tanpa akses admin. Menolak nomor tidak valid (`400`) dan nomor milik akun lain (`409`); kirim `phone: ""` untuk menghapus nomor.
644|
645|- **Uji end-to-end pendaftaran** (`backend/scripts/uji-e2e-daftar.mjs`, 40 pemeriksaan).
646|  Mendaftar lewat HTTP sungguhan, menangkap email di SMTP sink lokal, lalu membaca kembali isinya — jadi yang diperiksa adalah email yang benar-benar diterima pengguna, bukan template yang dipanggil langsung. Mencakup pula penolakan nomor, tabrakan nomor antar akun, dan toggle pendaftaran publik.
647|
648|- **Pratinjau email pendaftaran** (`backend/scripts/generate-preview-email.mjs`).
649|  Dua varian (manual dan Google) disajikan berdampingan supaya perbedaan isinya terlihat langsung.
650|
651|### Fixed
652|
653|- **Toggle pendaftaran publik tidak dihormati endpoint** (`backend/src/server.ts`).
654|  `registration_enabled = false` hanya menyembunyikan formulir di UI; `POST /auth/register` tetap terbuka bagi siapa pun yang tahu alamatnya. Endpoint kini menolak `403` saat toggle mati. Pendaftaran lewat Google sengaja tetap diizinkan — perilaku lama yang dipertahankan dan kini tertulis eksplisit di kode.
655|
656|- **Nomor WhatsApp basi di panel setelah onboarding** (`panel/src/App.tsx`).
657|  `onSelesai` menghapus penanda onboarding dari objek state `auth.user` yang diambil saat halaman dibuka, lalu menulisnya kembali ke `localStorage` — menimpa nomor yang baru saja disimpan. Akibatnya panel menampilkan nomor kosong meski server sudah menyimpannya. Kini penanda dihapus dari data yang sudah tersimpan.
658|
659|### Security
660|
661|- **`passwordHash` ikut terkirim ke browser lewat `POST /auth/google`** (`backend/src/server.ts`).
662|  Handler mengembalikan objek user utuh, sehingga hash password ikut dalam respons dan tersimpan di `localStorage` panel. Sudah disamakan dengan `/auth/login` yang memakai daftar field eksplisit. Terverifikasi: respons kini memuat 0 kemunculan `passwordHash`.
663|
664|### Notes for reviewer
665|
666|- 40/40 uji baru lulus; tiga uji lama (`uji-reset-password`, `uji-telepon`, `uji-e2e-reset`) dijalankan ulang tanpa regresi.
667|- Terverifikasi di browser: pendaftaran manual lewat UI menyimpan `6281277776666`; klik Google mengarahkan ke `/onboarding`; menyimpan nomor dari onboarding mengisi `6281922221111` dan menghapus penanda. Responsif pada 375/768/1440 px tanpa overflow horizontal.
668|- Sudah dideploy ke VM dev 207 dan diverifikasi: `dist` backend identik dengan build lokal (md5 empat berkas), bundel panel identik (md5 JS dan CSS), 3 sesi WhatsApp tetap `connected` setelah restart, dan satu email pendaftaran sungguhan terkirim lewat Brevo.
669|- **Batas cakupan:** jalur Google **belum diuji di produksi**. Google OAuth di VM dev belum aktif dan mengaktifkannya butuh Client ID sungguhan. Alur tersebut baru terbukti di lingkungan uji dengan GSI disimulasikan.
670|- Dependensi `nodemailer@10.0.14` disalin manual ke `node_modules` VM. `package.json` VM **tidak boleh diubah** — auto-install pnpm gagal karena `pnpm` tidak ada di PATH systemd, dan `wa-backend.service` akan mati.
671|
672|---
673|
674|## [Unreleased] — Basis URL panel konsisten & bisa diatur dari panel
675|
676|**Tema:** satu sumber kebenaran untuk alamat panel yang dipakai menyusun tautan di email.
677|**Basis:** `f3b6de9` (main).
678|
679|Ringkasan: tautan reset password dan tautan pada email selamat datang membaca sumber yang berbeda, sehingga nilai dari tabel `settings` hanya berpengaruh pada salah satunya. Akibatnya admin yang mengubah alamat panel dari UI akan mendapati email selamat datang benar sementara tautan reset password tetap menunjuk alamat pengembangan — kegagalan senyap, karena tidak ada error yang muncul dan email tetap terkirim. Selain itu tidak ada jalan sama sekali untuk mengisi alamat itu dari panel: endpoint `PATCH /settings` tidak menerimanya dan UI tidak menyediakannya.
680|
681|### Fixed
682|
683|- **Tautan reset password mengabaikan tabel `settings`** (`backend/src/password-reset.ts`).
684|  Baris ini membaca `process.env.PANEL_BASE_URL` sendiri, sementara `notifikasi-email.ts` membaca tabel `settings` lebih dulu. Nilai cadangannya alamat pengembangan (`http://localhost:5174`), jadi di produksi tautan yang sampai ke pengguna tidak bisa dibuka — tanpa satu pun error.
685|
686|### Added
687|
688|- **Modul `backend/src/panel-url.ts`** sebagai satu sumber kebenaran basis URL panel.
689|  Urutan prioritas: tabel `settings` → env `PANEL_BASE_URL` → alamat pengembangan. Nilai dari tabel dibaca **setiap pemanggilan**, bukan di-cache saat modul dimuat, supaya perubahan dari panel langsung berlaku pada email berikutnya tanpa restart — restart memutus sesi WhatsApp, jadi itu bukan langkah yang boleh diwajibkan hanya untuk memperbaiki alamat.
690|- **`panelBaseUrl` pada `GET`/`PATCH /api/v1/settings`** (`backend/src/server.ts`).
691|  Nilai kosong sah dan berarti "jangan pakai nilai dari tabel". Nilai selain itu wajib diawali `http://` atau `https://` tanpa spasi — alamat tanpa skema akan menghasilkan tautan relatif di email dan tidak bisa diklik. Nilai tidak sah ditolak `400` dan **tidak** tersimpan.
692|- **Kolom "Alamat Panel untuk Tautan Email"** di Settings (`panel/src/components/SettingsPage.tsx`, `panel/src/api.ts`).
693|  Ditaruh terpisah dari integrasi Blast Dashboard karena keduanya alamat yang berbeda dan mudah tertukar.
694|
695|### Notes for reviewer
696|
697|- Uji baru `backend/scripts/uji-base-url-panel.mjs` — **15 LULUS / 0 GAGAL**, dijalankan di atas DB `/tmp` terpisah dengan SMTP sink lokal, jadi email yang diperiksa adalah email yang benar-benar dikirim backend.
698|- **Uji merah dijalankan:** `password-reset.ts` dikembalikan sementara ke perilaku lama, dan uji itu gagal tepat pada dua assertion yang menggambarkan bug-nya (tautan tidak memakai nilai tabel, dan masih memakai nilai env) sementara 13 assertion lain tetap lulus. Ini membuktikan ujinya menangkap regresi, bukan sekadar selalu hijau.
699|- Regresi tanpa kegagalan: `uji-e2e-reset` 32/0, `uji-e2e-daftar` 40/0, `uji-reset-password` 27/0, `uji-telepon` 18/0.
700|- **Batas cakupan:** belum diuji terhadap SMTP sungguhan (Brevo) — hanya sink lokal. Tampilan kolom baru sudah dikompilasi tetapi belum diperiksa di browser.
701|
702|---
703|
704|## [Unreleased]
705|
706|### Docs
707|- **API Reference lengkap**: `panel/src/components/Docs.tsx` kini mendokumentasikan **65/65 endpoint** (sebelumnya 24 entri, 22 cocok). Ditambahkan 43 endpoint yang belum terdokumentasi, termasuk Contact Graph whitelist (Layer 8), Queue & Batches, Media & Files, Auto-Rotate, dan Admin audit.
708|- **Perbaikan path salah** (terverifikasi terhadap `server.ts`):
709|  - `POST /sessions/:id/disconnect` -> `POST /sessions/:id/logout` (route `disconnect` tidak pernah ada).
710|  - `GET /messages/:id/status` -> `GET /messages/status/:id` (urutan segmen terbalik).
711|  - `README.md`: `/api/v1/messages/media` -> `/api/v1/messages/send-media`.
712|- **4 section baru** di UI Docs: Media & Files, Queue & Batches, Settings & Auto-Rotate, Admin & Audit.
713|- Tipe `method` dan peta warna diperluas agar `PUT` terdukung (dipakai `/sessions/:id/antiban`).
714|
715| — branch `main`
716|
717|**Tema:** refactor UI/UX Contact Graph Whitelist ke Dedicated Modal & responsif Delivery Queue mobile.
718|
719|### Added
720|
721|- **Dedicated Modal Manajemen Whitelist Contact Graph** (`panel/src/components/RealtimeMonitor.tsx`).
722|  Mengisolasi pengelolaan batch whitelist penerima ke dalam modal dialog terpisah (`showContactGraphModal`), memisahkan antara pemantauan metrik dan manajemen data:
723|  - **Grid Anti-Ban Simetris**: Kartu Layer 8 (Contact Graph) tetap kompak dengan tinggi seragam (222px) sejajar Layer 5–7, menampilkan ringkasan status batch dan 1 tombol aksi bersih `Kelola Whitelist Penerima...`.
724|  - **Quick Batch Selector**: Tombol pill interaktif untuk memilih dan beralih cepat antar kampanye yang telah memiliki whitelist.
725|  - **Live Phone Detection Counter**: Textarea pendaftaran otomatis menghitung jumlah nomor valid secara real-time sebelum didaftarkan.
726|  - **Search & Filter Penerima**: Menyediakan kolom pencarian nomor telepon instan saat batch memiliki puluhan hingga ratusan nomor.
727|  - **Aksi Cabut Granular & Massal**: Mendukung pencabutan per nomor (`handleRevokeBatchRecipient`) maupun seluruh nomor per batch (`handleRevokeBatchAll`).
728|
729|### Fixed
730|
731|- **Overflow horizontal header Delivery Queue pada viewport mobile** (`panel/src/components/RealtimeMonitor.tsx`).
732|  Sebelumnya kontainer header tabel dipaksa dalam satu baris horizontal (`flex items-center justify-between`) tanpa pembungkus (`wrap`). Setelah penambahan selector page size (`10, 25, 50, 100`), lebar konten melebar hingga 540px pada viewport 375px (`scrollWidth: 540` vs `clientWidth: 349`), mengakibatkan judul terhimpit 87px dan tombol kontrol antrean meluap keluar batas kartu.
733|  Diperbaiki dengan reflow responsif:
734|  - Header utama berubah menjadi susunan bertingkat (`flex-col lg:flex-row lg:items-center justify-between gap-3`).
735|  - Toolbar kontrol antrean (tombol Jeda/Lanjut, selector baris per halaman, dan counter badge) dibungkus rapi dengan `flex-wrap gap-2`.
736|  - Paginasi footer disesuaikan dengan touch target ergonomis (`h-8 w-8`) dan teks status halaman yang ringkas (`Hal X/Y`) agar muat rapi di satu baris tanpa scroll horizontal.
737|
738|### Notes for reviewer
739|
740|- Terverifikasi via Browser CDP live pada viewport 375x812: `header.clientWidth: 349, header.scrollWidth: 349`, zero horizontal overflow. Tampilan desktop (1280px) tetap sejajar horizontal tanpa regresi.
741|
742|---
743|
744|## [Merged] — branch `fix/antiban-guard-resilience-20260916`
745|
746|**Tema:** resiliensi guard anti-ban, auto-resume antrean, persistensi status jeda.
747|**Basis:** `570d547` (main). **Sudah di-merge ke `main` dan berjalan di produksi.**
748|
749|Ringkasan singkat untuk tim dev: sebelumnya 3 dari 4 guard anti-ban membuang pesan
750|ke status `failed` permanen saat terpicu, sementara satu-satunya guard yang menahan
751|pesan justru memacetkan antrean karena `pauseQueue()` tidak punya jalur pemulihan
752|otomatis. Branch ini menyeragamkan semuanya menjadi "tahan pesan + jeda sementara +
753|lanjut sendiri", mempersist status jeda agar bertahan melewati restart, memperbaiki
754|bug yang membuat delay pacing terkalikan 10x, dan memperbaiki `db.ts` yang selalu
755|gagal pada instalasi database baru.
756|
757|### Fixed
758|
759|- **`db.ts` selalu gagal pada database baru** (`db.ts`).
760|  Blok `CREATE INDEX` dijalankan **sebelum** `ensureColumn()`, padahal 5 dari 8 index
761|  menyentuh kolom yang baru ditambahkan lewat migrasi ringan (`priority`, `batch_id`,
762|  `user_id`, `wa_message_id`). Fresh install selalu berhenti dengan
763|  `no such column: priority`. Blok index dipindah ke setelah seluruh `ensureColumn`.
764|  Ditemukan saat menyiapkan lingkungan uji — sebelumnya tidak terlihat karena
765|  database produksi sudah punya semua kolom.
766|
767|- **`record()` dan `getDelay()` memakai hash yang berbeda** (`antiban.ts`).
768|  `record()` meng-hash konten mentah sementara `getDelay()`/`getDelayReason()`
769|  meng-hash konten ternormalisasi, sehingga kunci pelacak tidak pernah cocok dan
770|  guard anti-spam tidak menyala. Keduanya kini memakai hash yang sama.
771|
772|- **Delay pacing terkalikan 10x pada setiap pengiriman** (`session-manager.ts`).
773|  `ab.reconnect.onReconnect()` dipanggil di jalur sukses kirim pesan, sehingga
774|  `ReconnectThrottle.multiplier` selalu bernilai ~0.1 dan setiap `totalDelay`
775|  terbagi 0.1 (efektif dikali 10). Bukti dari data produksi: dari 97 pesan,
776|  14 pesan mencatat `jitter_delay_ms` 25–60 detik padahal batas desain preset
777|  `balanced` hanya ~11 detik. Pemanggilan dihapus; throttle kini hanya dipicu
778|  oleh reconnect socket sungguhan lewat `engine.onReconnectCallback`.
779|
780|- **Guard anti-spam konten identik tidak pernah aktif** (`antiban.ts`).
781|  Hash konten dihitung dari pesan hasil render, sementara dashboard menyisipkan
782|  nama penerima per kontak. Akibatnya 52 pesan blast dengan isi identik
783|  menghasilkan 52 hash berbeda dan `maxIdenticalMessages` tidak pernah tercapai.
784|  Ditambahkan `normalizeContentForHash()` yang menyamarkan baris personalisasi
785|  (`Yth.`, `Kepada`, `Dear`, `Halo`, `Hai`, `Hi`) sebelum hashing. Pesan tanpa
786|  baris sapaan tidak terpengaruh.
787|
788|- **Pesan hilang dari antrean saat guard memblokir** (`session-manager.ts`).
789|  Guard `timelock`, `replyRatio`, dan `contactGraph` menandai pesan `failed`
790|  lalu `continue` — pesan permanen keluar dari antrean tanpa retry. Kini
791|  keempat guard memakai pola yang sama dengan rate limiter: pesan dikembalikan
792|  ke depan antrean (`holdMessageAtFront`) lalu antrean dijeda sementara.
793|
794|### Added
795|
796|- **Penjadwal auto-resume antrean** (`session-manager.ts` → `scheduleAutoResume()`).
797|  Sebelumnya satu-satunya pemanggil `resumeQueue()` adalah endpoint manual, jadi
798|  setiap `pauseQueue()` otomatis berarti antrean berhenti sampai ada manusia yang
799|  klik Resume. Sekarang setiap jeda otomatis menjadwalkan pembukaan kembali:
800|  sisa waktu blokir dijepit ke rentang **5 detik – 1 jam** dengan margin 5%,
801|  timer bersifat `unref()` agar tidak menahan proses Node, dan jadwal yang lebih
802|  cepat tidak ditimpa oleh jadwal yang lebih lambat.
803|
804|- **Persistensi status jeda antrean** (`db.ts`, `session-manager.ts`).
805|  `pausedSessions` dan `pausedBatches` sebelumnya hanya in-memory, sehingga
806|  restart service menghapus seluruh jeda dan antrean langsung berjalan kembali
807|  tanpa sepengetahuan operator. Kini disimpan ke tabel `settings`
808|  (`queue_paused_sessions`, `queue_paused_batches`) dan dipulihkan saat startup
809|  lewat `restoreQueuePauseState()`, dipanggil dari `recoverPendingMessages()`.
810|  Entri non-jeda dibuang saat disimpan agar tabel tidak menumpuk data basi.
811|
812|- **`remainingMs()` pada setiap guard** (`antiban.ts`) sebagai sumber waktu tunggu
813|  bagi penjadwal auto-resume: `TimelockGuard`, `ReplyRatioGuard`,
814|  `BanRecoveryOrchestrator`, dan `ContactGraphWarmer`.
815|
816|- **Flag `distraction` per-preset anti-ban** (`antiban.ts`). `PresenceChoreographer`
817|  punya jeda "distraksi manusiawi" 5–20 menit dengan peluang 5%. Untuk blast 52
818|  pesan itu berarti 2–3 pesan terkena jeda panjang tanpa alasan. Flag ini
819|  `false` pada preset `broadcast` dan `strict`, tetap `true` pada `balanced`
820|  (chat interaktif).
821|
822|- **`autoResumeInMs` pada `QueueSessionStatus`** (`types.ts`) supaya UI dapat
823|  menampilkan sisa waktu sampai antrean terbuka kembali.
824|
825|### Changed
826|
827|- **Guard pesan identik kini dihitung per penerima** (`antiban.ts`).
828|  Sebelumnya `maxIdenticalMessages` dihitung global per konten, sehingga setelah
829|  normalisasi hash aktif, pengumuman yang sama ke 52 orang akan diblokir — padahal
830|  itu broadcast yang sah. Kunci pelacak kini gabungan **penerima + hash konten**:
831|  - Pengumuman sama ke 52 penerima berbeda → lolos (broadcast normal)
832|  - Pesan sama 12x ke satu orang → diblokir di ambang preset
833|  - 12 pesan berbeda ke satu orang → lolos
834|
835|- **`normalizeContentForHash()` diekspor** dari `antiban.ts` agar dapat diuji
836|  terpisah dan dipakai ulang oleh jalur validasi lain.
837|
838|### Catatan penting untuk reviewer
839|
840|- Perubahan ini **belum diuji terhadap nomor WhatsApp produksi**. Verifikasi yang
841|  dilakukan bersifat unit/integration test lokal + smoke test server (lihat bagian
842|  Verifikasi) — bukan uji lapangan.
843|- **Dampak kecepatan:** menghapus `onReconnect()` di jalur sukses membuat
844|  pengiriman blast menjadi **~10x lebih cepat** dari kondisi saat ini. Ini adalah
845|  keputusan throughput, **bukan** peningkatan keamanan nomor. Untuk blast bervolume
846|  besar, pertimbangkan preset `broadcast` dan pantau metrik 463/429.
847|- `contactGraph` masih berstatus `enabled: false` (default). Jika diaktifkan,
848|  kontak baru akan diblokir sampai handshake 1 jam — pastikan perilaku ini
849|  diinginkan sebelum mengaktifkannya di production.
850|
851|### Verifikasi
852|
853|**38 skenario uji** dijalankan terhadap hasil build (`dist/`) dan server nyata di
854|port terpisah (bukan production):
855|
856|*Round 1 — guard & auto-resume (22 skenario):*
857|- Normalisasi hash: 52 pesan identik → 1 hash; konten berbeda tetap beda hash;
858|  pesan tanpa baris sapaan tidak berubah.
859|- Flag `distraction`: 0 dari 20.000 pesan pada preset `broadcast` terkena jeda;
860|  preset `balanced` tetap ~5%.
861|- `remainingMs()`: idle → 0, aktif → positif, guard nonaktif → 0.
862|- Penjadwal auto-resume: penjepitan batas bawah/atas, pembersihan saat resume
863|  manual, dan antrean benar-benar terbuka sendiri setelah masa blokir lewat.
864|
865|*Round 2 — db fresh install, persistensi, guard identik (16 skenario):*
866|- `db.ts` berhasil inisialisasi pada database kosong dan membentuk 8 index.
867|- Status jeda tersimpan, entri non-jeda dibuang, dan instance `SessionManager`
868|  baru memulihkan jeda dari database (simulasi restart).
869|- Guard identik: broadcast 52 orang berbeda → 0 diblokir; spam 12x ke satu orang
870|  → diblokir; 12 pesan berbeda ke satu orang → 0 diblokir.
871|
872|*Smoke test server (`dist/server.js`, database bersih, port 3199):*
873|- `GET /api/v1/health` → `{"status":"ok"}`.
874|- `GET /sessions/:id/queue/status` mengembalikan field baru `autoResumeInMs`.
875|- `POST /batches/:id/pause` menulis ke tabel `settings`.
876|- **Setelah proses benar-benar dimatikan dan dijalankan ulang**, batch masih
877|  berstatus `isPaused: true` dengan alasan aslinya — membuktikan persistensi
878|  bekerja lintas restart.
879|
880|### Diketahui belum diperbaiki (di luar cakupan branch ini)
881|
882|- **Dua sumber kebenaran untuk status pause.** Dashboard *set* jeda per-batch
883|  (`pauseBatch`) tetapi *membaca* per-sesi (`fetchQueueStatus`). UI bisa
884|  menampilkan status yang keliru.
885|- **Status `pending` masih ambigu** — dipakai untuk "menunggu di dashboard"
886|  sekaligus "menunggu di gateway".
887|- **Pembatalan kampanye masih tercatat `failed`,** bukan `cancelled`, sehingga
888|  ikut menurunkan `delivery_rate` sesi.
889|- **Dashboard belum punya selector preset antiban.** Endpoint backend
890|  (`getAntiBanStatus` / `updateAntiBanSettings`) sudah tersedia.
891|- **Monitoring report-rate belum ada.** Tidak ada pengukuran berapa penerima yang
892|  mem-block/report nomor — padahal ini faktor paling menentukan reputasi nomor.
893|- **`date.timezone = PRC` pada `php.ini`** (UTC+8) di server; Laravel sudah aman
894|  lewat `APP_TIMEZONE`, tetapi kode PHP yang memakai `date()` native masih drift.
895|- **`onTimelockUpdate()` belum pernah dipanggil**, sehingga `timeEnforcementEnds`
896|  asli dari WhatsApp tidak pernah dipakai (timelock selalu berasumsi 60 detik).