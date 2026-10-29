1|1|# Changelog
2|2|
3|3|Semua perubahan penting pada `wa-api` didokumentasikan di file ini.
4|4|Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
5|5|[Semantic Versioning](https://semver.org/lang/id/).
6|6|
7|7|---
8|8|
9|9|## [Unreleased] — alamat API tidak lagi tertanam ke port dev

`Docs.tsx` punya salinan sendiri dari logika `API_BASE`, dan salinan itu selalu
menempelkan `:3100` pada hostname. Di VM dev hasilnya benar, sehingga
penyimpangan tidak pernah terlihat; di hosting alamat itu mati karena port 3100
tidak diekspos dan API dilayani di `/api/v1` pada domain yang sama.

### Fixed

- `API_BASE` dan `API_ORIGIN` kini hanya didefinisikan di `panel/src/api.ts` dan
  diimpor komponen lain. Salinan di `Docs.tsx` dihapus.
- Tanpa `VITE_API_BASE`, alamat mengikuti `window.location.origin` — sehingga
  panel yang dipindah ke domain lain tidak perlu dibangun ulang hanya karena
  alamatnya berubah.

### Catatan

- `VITE_API_BASE` ditanam saat build, bukan dibaca saat runtime. Berkas `.env`
  yang diubah tanpa membangun ulang panel tidak berpengaruh. `.env.example`
  diperjelas: kosongkan di hosting, isi hanya bila panel dan API beda host.

### Verifikasi

- Build kode lama di port non-5174 menghasilkan `http://127.0.0.1:3100`
  (salah). Build baru tanpa `.env` menghasilkan origin yang sedang dibuka, dan
  dengan `VITE_API_BASE=https://wa-api.srvx.my.id/api/v1` menghasilkan
  `https://wa-api.srvx.my.id`.
- `tsc` bersih, build bersih.

---

## [Unreleased] — panduan MCP tersedia di panel
10|
11|Sebelum ini satu-satunya petunjuk menjalankan MCP ada di `mcp/README.md` di
12|dalam repository. Panel sendiri tidak menyebut MCP sama sekali, sehingga
13|pemilik kunci tidak punya cara mengetahui bahwa MCP ada atau bagaimana
14|menjalankannya.
15|
16|### Added
17|
18|- Section **`04. MCP untuk Agen AI`** di tab Docs panel: kebutuhan, langkah
19|  membangun server MCP, blok konfigurasi klien, cara membuktikan agen benar-benar
20|  terhubung, daftar 12 tool, dan batas yang perlu diketahui.
21|
22|### Changed
23|
24|- `mcp/` memakai `pnpm-lock.yaml` (sebelumnya `package-lock.json`), menyamakan
25|  repo dengan `backend/` dan `panel/`.
26|
27|### Keputusan yang ditetapkan
28|
29|- **MCP dijalankan dari checkout proyek ini, tidak diterbitkan ke npm.**
30|  `mcp/package.json` tetap `private: true`. Konsekuensinya panduan wajib memuat
31|  langkah build, karena `dist/` tidak ikut repository.
32|- **Kunci API tidak dirender di blok konfigurasi.** Blok memakai placeholder dan
33|  menunjuk ke Users & API Keys; panel tidak menampilkan ulang kunci penuh setelah
34|  dialog penerbitan ditutup.
35|- **Tidak ada tab MCP baru.** Lapis pemasangan masuk Docs, lapis kunci masuk
36|  Users & API Keys, lapis aktivitas sudah ada di API Logs sejak `6ab53d0`.
37|- **`WA_API_BASE_URL` tidak ditulis tetap.** Nilainya dihitung dari alamat panel
38|  yang sedang dibuka, dengan catatan bahwa klien MCP di komputer lain harus
39|  memakai alamat yang dapat dijangkau dari sana.
40|
41|### Verifikasi
42|
43|- Panel: `tsc` bersih, build bersih, section tampil di 207 dengan
44|  `WA_API_BASE_URL` terisi benar, dan pada 390 px tidak menimbulkan scroll
45|  horizontal.
46|- Harness MCP tetap **37/37** terhadap `mcp/dist/index.js`.
47|
48|---
49|
50|## [Unreleased] — kolom audit tampil di panel
51|53|
52|54|Langkah 1 dari `docs/rancangan-menu-mcp.md`. Data audit sudah tersimpan sejak
53|55|`f32f814` dan `8d8ce74`, tetapi `ApiLogItem` tidak punya keenam field-nya —
54|56|sehingga tidak ada satu tempat pun di panel yang bisa membacanya.
55|57|
56|58|### Added
57|59|
58|60|- `ApiLogItem` + `actor`, `targetType`, `targetId`, `params`, `paramsBefore`,
59|61|  `audit`; dua kolom baru di tabel: **Agen** dan **Perubahan**.
60|62|- `panel/src/lib/perubahanAudit.ts` — formatter "nilai lama → nilai baru",
61|63|  dipisah dari komponen karena di sinilah letak keputusan yang menentukan
62|64|  benar-tidaknya pembacaan, bukan urusan tata letak.
63|65|
64|66|### Aturan tampilan yang ditetapkan
65|67|
66|68|- **`params_before` NULL berarti "nilai lama tidak dicatat untuk aksi ini"**,
67|69|  bukan "tidak ada perubahan". Baris tampil `preset: → broadcast` dengan catatan
68|70|  kecil, bukan `—`. Dua keadaan ini dibedakan karena menyamakannya membuat
69|71|  pembaca menyimpulkan kebalikan dari yang terjadi.
70|72|- **Nilai lama ada, nilai baru kosong** tampil `preset: strict → ∅` — bukan `—`.
71|73|- **Baris `403`/`429` tetap tampil** dengan `—`: permintaan ditolak sebelum
72|74|  handler berjalan, jadi memang belum melakukan apa pun.
73|75|- **Perubahan menjadi preset `broadcast` ditandai bahaya**, karena pada preset
74|76|  itu `contactGraph` dan `replyRatio` tidak berjalan — "allow" di sana berarti
75|77|  "dimatikan", bukan "diperiksa dan aman".
76|78|- **`params` diberi keterangan "nilai tersaring"**; tidak ada tombol "lihat nilai
77|79|  asli", karena nilai aslinya memang tidak disimpan.
78|80|- **Tombol hapus & checkbox disembunyikan untuk baris audit non-admin**, diganti
79|81|  ikon kunci. Menampilkan tombol yang pasti gagal lebih buruk daripada tidak
80|82|  menampilkannya, dan mencentangnya membuat "hapus 5" menghasilkan "3 dihapus"
81|83|  tanpa penjelasan. `select-all` ikut melewati baris terkunci.
82|84|- Teks modal pembersihan diperbaiki: sebelumnya menjanjikan seluruh log terhapus,
83|85|  padahal untuk non-admin baris audit tidak ikut — dan retensi otomatis sudah
84|86|  berjalan di server, jadi pembersihan manual bukan lagi retensi rutin.
85|87|
86|88|### Catatan pengujian
87|89|
88|90|`uji-perubahan-audit-panel.mjs` — 25 asersi, **plus pembanding mutasi**. Tiga
89|91|mutasi sengaja dijalankan:
90|92|
91|93|| Mutasi | Hasil |
92|94||---|---|
93|95|| hapus catatan "nilai lama tidak dicatat" | tertangkap (21/25) |
94|96|| tanda bahaya `broadcast` dimatikan | tertangkap (19/25) |
95|97|| `if (!baru && !lama)` → `if (!baru)` | **LOLOS 22/22 pada percobaan pertama** |
96|98|
97|99|Mutasi ketiga membongkar lubang nyata di uji saya: tidak ada kasus "nilai lama
98|100|ada, nilai baru kosong", padahal formatter punya cabangnya dan baris seperti itu
99|101|nyata (DELETE dengan body kosong). Setelah kasus itu ditambahkan, mutasinya
100|102|tertangkap (23/25).
101|103|
102|104|`uji-e2e-kolom-audit.sh` — 15 asersi lewat HTTP pada server sungguhan. Uji unit
103|105|membuktikan formatter benar untuk input yang saya karang sendiri; uji ini
104|106|membuktikan server benar-benar **mengirim** kolomnya. Tanpa itu, satu salah tulis
105|107|nama kolom di `listApiLogs` akan lolos semua uji unit dan tabelnya tetap kosong.
106|108|Termasuk: nomor telepon di `params` tidak terkirim mentah ke panel.
107|109|
108|110|Uji ini sendiri sempat salah lapor: blok node mencetak `OK` untuk 12 asersi
109|111|tetapi bash hanya menghitung 2, sehingga ringkasannya berbunyi "2 lulus". Sudah
110|112|diperbaiki agar bash yang menghitung, bukan node yang mencetak.
111|113|
112|114|Regresi: celah-audit 11/11, api-logs-audit 11/11, tenant 32/32, qr-jwt 4/4,
113|115|audit-params 64/64, decision-log 39/39, integrasi 22/22, normalisasi 28/28,
114|116|uji-mcp 37/37; `tsc` panel 0 error; build panel OK.
115|117|
116|118|---
117|119|
118|120|## [Unreleased] — rancangan menu MCP di panel
119|121|
120|122|`docs/rancangan-menu-mcp.md` — rancangan, belum ada kode.
121|123|
122|124|Temuan yang mengubah bentuknya: **`ApiLogsPage.tsx` belum menampilkan satu pun
123|125|kolom audit.** Server sudah menyimpan `actor`, `target_type`, `target_id`,
124|126|`params`, `params_before`, dan `audit` sejak `f32f814` dan `8d8ce74`, tetapi
125|127|`ApiLogItem` tidak punya keenam field itu dan tabelnya hanya menampilkan method,
126|128|endpoint, status, latency, IP, user, dan waktu. Jadi menu MCP terutama membuka
127|129|data yang sudah ada, bukan menampilkan data baru.
128|130|
129|131|Tiga hal yang sengaja tidak dirancang, karena akan menjadi kontrol yang tidak
130|132|mengontrol apa pun:
131|133|
132|134|- **Registrasi klien MCP dari panel.** MCP dikonfigurasi di komputer pengguna,
133|135|  bukan di server; panel tidak punya cara "mendaftarkan" klien.
134|136|- **Tombol "nonaktifkan MCP".** Tidak ada konsep scope per kunci — API key =
135|137|  seluruh hak pemiliknya. Tombol itu akan berbohong.
136|138|- **Pembatasan tool per agen.** Daftar putih saat ini hidup di proses MCP, bukan
137|139|  di wa-api; panel yang menampilkan centang tool tidak menegakkan apa pun.
138|140|
139|141|Satu koreksi faktual terhadap draf pertama: index untuk query aktivitas **sudah
140|142|ada** (`idx_api_logs_actor_time`, partial pada `actor IS NOT NULL`), jadi tidak
141|143|perlu index baru — dan filter `actor IS NOT NULL` harus ditulis apa adanya, sebab
142|144|`COALESCE(actor,'')` akan mematikan pemakaian index parsial itu.
143|145|
144|146|---
145|147|
146|148|## [Unreleased] — tiga celah bukti audit
147|149|
148|150|`api_logs` sudah menyimpan siapa, menyentuh apa, dan dengan nilai apa. Tiga hal
149|151|membuatnya belum bisa dipakai sebagai bukti; ketiganya ditutup di sini.
150|152|
151|153|### Added
152|154|
153|155|- **`params_before`** — kolom untuk nilai *sebelum* aksi. Sebelumnya audit bisa
154|156|  menjawab "preset diubah menjadi broadcast", tidak "dari apa" — dan untuk aksi
155|157|  yang bisa dibalik, pertanyaan kedua itulah yang menentukan. Sengaja **tidak**
156|158|  diisi otomatis oleh hook `onResponse`: server hanya melihat permintaan yang
157|159|  sedang berjalan, bukan keadaan sebelumnya, jadi mengisinya di sana berarti
158|160|  mencatat sesuatu yang belum terjadi. Yang mengisi adalah handler yang memang
159|161|  sudah membaca nilai lama, lewat `catatNilaiSebelum(req, …)`. Dipasang di
160|162|  `PUT /sessions/:id/antiban`.
161|163|- **Retensi otomatis** (`backend/src/retensi.ts`) — dijalankan server sekali
162|164|  sehari; baris audit disimpan 90 hari, catatan galat 30 hari (sama seperti
163|165|  `antiban_decisions`). Dua ambang, bukan satu: pertanyaan "siapa melakukan apa
164|166|  bulan lalu" biasanya baru muncul setelah beberapa minggu, sedangkan galat biasa
165|167|  tidak perlu selama itu.
166|168|- **`audit`** — penanda baris bukti. Baris bertanda ini tidak bisa dihapus
167|169|  non-admin, sedangkan catatan galat biasa tetap bisa dibersihkan pemiliknya.
168|170|
169|171|### Kenapa retensi harus di server
170|172|
171|173|`POST /api-logs/clear` sengaja tidak bisa menghapus baris audit — kalau bisa,
172|174|pihak yang diaudit dapat menghapus jejaknya sendiri. Konsekuensinya endpoint itu
173|175|tidak akan pernah menyusutkan tabel, sementara volume naik karena GET dari agen
174|176|kini ikut tercatat. Pembersihannya karena itu dipindah ke sisi server, dan
175|177|jumlah yang dihapus dicatat ke log agar bukan penghapusan senyap.
176|178|
177|179|### Fixed
178|180|
179|181|- **Penyaring `params` menyensor `typingWPM`.** Pola rahasia menangkap `pin` di
180|182|  dalam "ty**pin**g", sehingga angka kecepatan mengetik — bagian konfigurasi
181|183|  anti-ban yang justru ingin diaudit — tersimpan sebagai `[REDACTED]`. Diperbaiki
182|184|  dengan daftar pengecualian eksplisit, **bukan** dengan melonggarkan pola:
183|185|  mengubahnya menjadi `(^|[_-])pin$` akan meloloskan `pinCode`, jauh lebih
184|186|  berbahaya daripada satu angka yang tersensor.
185|187|
186|188|### Catatan pengujian
187|189|
188|190|`backend/scripts/uji-celah-audit.sh` — 11 asersi lewat HTTP sungguhan pada DB
189|191|kosong di `/tmp` dan port cadangan. Yang dibuktikan, bukan diasumsikan:
190|192|
191|193|- `params_before.preset = "strict"` sementara `params.preset = "broadcast"`
192|194|  sesudah dua kali perubahan berturut-turut — jadi nilai lama benar-benar dibaca
193|195|  dari keadaan yang berlaku, bukan dari nilai bawaan.
194|196|- Non-admin menghapus baris audit → `deletedCount: 0`, `dilewati: 1`, barisnya
195|197|  masih ada; admin menghapus baris yang sama → benar-benar hilang. Tanpa asersi
196|198|  kedua, "tidak bisa dihapus" bisa berarti "tidak bisa dihapus siapa pun".
197|199|- Baris galat biasa tetap bisa dihapus pemiliknya — ini yang menjaga tombol di
198|200|  panel tidak berubah menjadi 403.
199|201|- Retensi: baris 100 hari hilang (audit & galat), baris hari ini tidak ikut.
200|202|
201|203|Regresi: `uji-audit-params` 64/64, `uji-api-logs-audit` 11/11, tenant 32/32,
202|204|qr-jwt 4/4, decision-log 39/39, integrasi 22/22, normalisasi 28/28,
203|205|`uji-mcp` 37/37.
204|206|
205|207|---
206|208|
207|209|## [Unreleased] — server MCP untuk audit & setup terbatas
208|210|
209|211|`mcp/` — proses terpisah, transport stdio, 12 tool (7 baca + 5 tulis yang bisa
210|212|dibalik). Rancangan & alasannya di `docs/rancangan-mcp-server.md`, cara pakai di
211|213|`mcp/README.md`.
212|214|
213|215|Dua keputusan yang menentukan bentuknya:
214|216|
215|217|- **Proses terpisah, bukan in-process.** Kalau MCP berjalan di dalam backend dan
216|218|  crash, seluruh antrean pesan berhenti. Sebagai proses terpisah, kegagalannya
217|219|  terkurung, dan SDK MCP tidak masuk ke proses produksi.
218|220|- **Otorisasi sepenuhnya di wa-api.** MCP hanya meneruskan API key pemiliknya;
219|221|  ia tidak punya pemeriksaan hak sendiri. `403` diteruskan sebagai `403`, tidak
220|222|  ditafsirkan sebagai "tidak ada".
221|223|
222|224|### Added
223|225|
224|226|- `mcp/src/client.ts` — satu jalur untuk semua permintaan, supaya `X-MCP-Actor`
225|227|  tidak mungkin terlupa di satu tool dan bukan di tool lain (tanpa header itu,
226|228|  GET yang berhasil tidak tercatat sebagai bukti audit).
227|229|- `mcp/src/format.ts` — pemformat yang menjawab pertanyaan, bukan membuang JSON
228|230|  mentah. Diukur: `antiban` 3.466 byte, 67%-nya definisi seluruh preset yang
229|231|  tidak ditanyakan; sesudah diformat menjadi ~530 karakter.
230|232|- `mcp/src/tools/baca.ts`, `mcp/src/tools/tulis.ts` — 12 tool.
231|233|- `backend/scripts/uji-mcp.mjs` (37 asersi) — uji lewat JSON-RPC sungguhan.
232|234|- `backend/scripts/ukur-respons-mcp.sh`, `bentuk-respons.sh` — pengukur ukuran
233|235|  respons dan pencetak bentuk JSON, dipakai agar formatter ditulis dari data
234|236|  nyata.
235|237|
236|238|### Catatan pengujian
237|239|
238|240|Uji ini menemukan tiga hal yang tidak terlihat dari membaca kode:
239|241|
240|242|1. **Pemeriksaan kata kunci tidak cukup.** Tool bernama `wa_bersihkan_antrean`
241|243|   yang memanggil `queue/clear` lolos dari filter kata terlarang. Yang
242|244|   menangkapnya adalah perbandingan dengan daftar putih nama tool.
243|245|2. **Asersi "nilai lama dilaporkan" semula terlalu lemah** — ia lulus walau
244|246|   handler tidak membaca nilai lama sama sekali. Diperbaiki agar memeriksa
245|247|   nilainya, bukan hanya ada/tidaknya panah pada pesan.
246|248|3. **Peringatan preset `broadcast` tidak teruji.** Tanpa peringatan itu, angka
247|249|   `replyRatio 0` terbaca sebagai masalah padahal guard-nya memang dimatikan.
248|250|
249|251|Ketiganya ditemukan dengan merusak kode dengan sengaja lalu memastikan uji
250|252|gagal — bukan dengan membaca ulang uji yang hijau.
251|253|
252|254|### Belum dikerjakan
253|255|
254|256|- Retensi `api_logs` otomatis, `params_before`, dan pembatasan `DELETE
255|257|  /api-logs` untuk non-admin (lihat bagian sebelumnya).
256|258|- Pembatasan jumlah panggilan per agen; sekarang masih bergantung pada rate limit
257|259|  per-IP wa-api.
258|260|- `WA_MCP_ACTOR` bisa dipalsukan — diterima, karena ia label dan bukan
259|261|  autentikasi; pelaku tetap diambil dari kunci yang diverifikasi.
260|262|
261|263|---
262|264|
263|265|## [Unreleased] — isolasi tenant pada rute sesi
264|266|
265|267|Prasyarat untuk server MCP multi-tenant. Selama satu API key bisa menyentuh sesi
266|268|milik user lain, MCP hanya akan membungkus kebocoran itu dengan antarmuka yang
267|269|lebih rapi — dan memberi agen AI kemampuan menghentikan antrean atau memutus
268|270|sesi tenant lain.
269|271|
270|272|Sebelum perubahan ini, enam endpoint pada `routes/sessions.ts` hanya memakai
271|273|`requireAuth` tanpa pemeriksaan kepemilikan sama sekali, dan satu endpoint
272|274|(`GET /metrics`) mengembalikan laporan seluruh tenant dalam satu respons. Satu
273|275|pola pemeriksaan yang benar sudah ada, tetapi disalin ke sebagian handler saja —
274|276|justru handler yang tidak menyalinnya yang bocor.
275|277|
276|278|### Added
277|279|
278|280|- **`backend/src/kepemilikan.ts`** — `periksaKepemilikanSesi()`, `tolakSesi()`,
279|281|  dan `idSesiMilik()`. Membaca `sessions.user_id` dari database, bukan dari
280|282|  `manager.getSession()`, karena pemeriksaan otorisasi tidak boleh bergantung
281|283|  pada koneksi WhatsApp yang mungkin sedang putus.
282|284|- **Uji:** `scripts/uji-tenant-isolasi.sh` (32 asersi) menjalankan server pada DB
283|285|  kosong di `/tmp` dan port cadangan, lalu memanggil setiap endpoint dengan dua
284|286|  kunci berbeda: kunci pemilik harus 2xx, kunci penyusup harus 403/404. Uji yang
285|287|  sama dijalankan terhadap kode **sebelum** perbaikan dan gagal 10 kali — tanpa
286|288|  pembanding itu, uji hijau tidak membuktikan apa pun.
287|289|- **Uji:** `scripts/uji-qr-jwt.sh` (4 asersi) untuk alur pairing panel yang
288|290|  memakai `requireJwt`, karena rute itu tidak mengisi `req.apiKeyUser` dan
289|291|  identitasnya harus diambil dari `req.user.id`.
290|292|
291|293|### Fixed
292|294|
293|295|- `GET /sessions/:id/metrics`, `GET /sessions/:id/queue/status`,
294|296|  `POST /sessions/:id/queue/pause|resume|clear`, `PATCH /sessions/:id`,
295|297|  `POST /sessions/:id/logout|reconnect|pair`, `DELETE /sessions/:id`, dan
296|298|  `GET /sessions/:id/qr` kini memeriksa kepemilikan.
297|299|- `GET /metrics` disaring: non-admin hanya menerima laporan sesi miliknya.
298|300|- Enam salinan blok pemeriksaan yang sudah ada (`antiban`, `contact-graph`)
299|301|  diganti ke helper yang sama, supaya tidak ada dua cara berbeda menjawab
300|302|  pertanyaan yang sama.
301|303|
302|304|### Catatan
303|305|
304|306|- Sesi tanpa `user_id` tetap boleh diakses. Kolom itu punya `DEFAULT
305|307|  'usr_c26f74d6'`, jadi baris lama tidak `NULL`; aturan ini hanya jaring pengaman
306|308|  agar sesi yang belum terklasifikasi tidak mengunci admin dari sesinya sendiri.
307|309|- Sesi yang tidak ada dijawab **404**, bukan 403, supaya tidak membocorkan bahwa
308|310|  id tersebut ada.
309|311|
310|312|---
311|313|
312|314|## [Unreleased] — `api_logs` sebagai bukti audit, bukan hanya catatan galat
313|315|
314|316|Persiapan untuk server MCP yang akan dipakai agen AI melakukan audit dan setup
315|317|terbatas. Rancangan lengkapnya ada di `docs/rancangan-mcp-server.md`.
316|318|
317|319|Arah yang diambil: **audit adalah permintaan itu sendiri**, bukan catatan
318|320|terpisah yang dilaporkan pemanggil. Server sudah melihat setiap request lewat
319|321|hook `onResponse`; menyuruh agen menulis baris audit sendiri akan membuat satu
320|322|aksi menghasilkan dua catatan yang bisa berbeda, menjadikan agen saksi atas
321|323|perbuatannya sendiri, dan menambah endpoint tulis yang justru bisa dipakai
322|324|menulis baris audit palsu.
323|325|
324|326|### Added
325|327|
326|328|- **Empat kolom audit pada `api_logs`** (`backend/src/db/skema.ts`): `actor`,
327|329|  `target_type`, `target_id`, `params`. Ditambahkan lewat `ensureColumn`, jadi
328|330|  baris lama tetap terbaca dengan nilai `NULL`. Dua index parsial menyertainya,
329|331|  diletakkan **setelah** `ensureColumn` karena index pada kolom yang belum ada
330|332|  membuat instalasi DB baru gagal.
331|333|- **`backend/src/audit-params.ts`** — penyaring `req.body` sebelum disimpan.
332|334|  Nomor telepon diganti hash lewat `hashRecipient()` (fungsi yang sama dengan
333|335|  `antiban_decisions`, sehingga hash-nya bisa dikorelasikan), field yang
334|336|  namanya mengandung kredensial diganti `[REDACTED]`, ukuran dibatasi 2 KB,
335|337|  kedalaman 4 tingkat, array 20 elemen. Tanpa ini `api_logs` berubah menjadi
336|338|  salinan data pribadi dan kredensial — log audit yang menyimpan rahasia bukan
337|339|  audit, melainkan kebocoran kedua.
338|340|- **Uji:** `scripts/uji-audit-params.mjs` (59 asersi) dan
339|341|  `scripts/uji-api-logs-audit.sh` (11 asersi, lewat HTTP sungguhan pada DB
340|342|  kosong di `/tmp`).
341|343|
342|344|### Changed
343|345|
344|346|- **GET yang berhasil kini dicatat bila membawa `X-MCP-Actor`**
345|347|  (`backend/src/routes/konteks.ts`). Sebelumnya seluruh GET sukses dibuang
346|348|  tanpa syarat, sehingga operasi baca agen tidak akan berjejak sama sekali.
347|349|  Filter tidak dihapus — panel melakukan polling GET terus-menerus — melainkan
348|350|  dibuat selektif.
349|351|- **`insertApiLog()` dan `listApiLogs()`** menerima dan mengembalikan empat
350|352|  kolom baru (`backend/src/db/api-logs.ts`).
351|353|
352|354|### Catatan
353|355|
354|356|- **Cacat yang ditemukan tetapi belum diperbaiki:** `DELETE /api-logs` dan
355|357|  `POST /api-logs/clear` hanya memakai `requireAuth`, sehingga non-admin bisa
356|358|  menghapus log miliknya sendiri. Sebagai catatan galat itu wajar; sebagai bukti
357|359|  audit itu cacat, karena pihak yang diaudit bisa menghapus jejaknya. Perbaikan
358|360|  belum dilakukan karena panel menampilkan tombol hapus untuk semua peran —
359|361|  mengubahnya menjadi admin-only akan memunculkan 403 di UI yang sekarang
360|362|  dipakai. Perlu keputusan tersendiri.
361|363|- **`params` hanya menyimpan nilai baru**, bukan nilai sebelumnya. Untuk
362|364|  menjawab "preset diubah dari apa ke apa", `params` saja tidak cukup.
363|365|- **Retensi `api_logs` belum otomatis.** Volume naik karena GET agen ikut
364|366|  tercatat; batas retensi perlu ditetapkan sebelum MCP dipakai rutin.
365|367|
366|368|---
367|369|
368|370|## [Unreleased] — Pencatatan guard warm-up & penolakan seluruh sesi
369|371|
370|372|Dua cacat pada instrumentasi decision log yang **tidak memunculkan error** dan
371|373|tidak tertangkap uji regex mana pun — keduanya ditemukan lewat probe yang
372|374|menghitung baris pada database sungguhan.
373|375|
374|376|### Fixed
375|377|
376|378|- **Guard warm-up tercatat di tempat yang salah** (`backend/src/session-manager.ts`).
377|379|  Pencatatan berada di dalam `checkHealth()`, yang sebenarnya fungsi **seleksi
378|380|  sesi**, bukan jalur kirim. Akibatnya salah pada dua kondisi sekaligus: dengan
379|381|  autorotate aktif dan tiga sesi kandidat, satu pengiriman menghasilkan **3 baris**
380|382|  `warmup` tanpa `message_id` (satu per kandidat); dengan autorotate mati —
381|383|  instalasi satu sesi, setup paling umum — guard ini **tidak pernah tercatat sama
382|384|  sekali**, padahal justru di sesi baru warm-up paling mungkin menahan. Kini
383|385|  dicatat lewat `catatWarmup()` di `resolveSession()`, dipanggil dari tiga jalur
384|386|  yang memilih sesi (satu-sesi, sticky session, rotasi). Hasil probe: **1 baris
385|387|  per pengiriman** pada kedua kondisi.
386|388|- **Penolakan seluruh sesi tidak tercatat sama sekali.** Ketika semua kandidat
387|389|  ditolak `checkHealth()`, `resolveSession()` mengembalikan sesi dengan alasan
388|390|  "semua sesi sedang limit" tanpa satu baris pun di decision log — padahal inilah
389|391|  kasus yang paling perlu ditelusuri, karena pesan benar-benar tertahan. Kini
390|392|  dicatat **satu baris** `sessionHealth` berisi rincian penolakan tiap sesi di
391|393|  `metrics`, sehingga tidak mengulang masalah duplikasi seperti pada warm-up.
392|394|
393|395|### Added
394|396|
395|397|- **`scripts/uji-rasio-keputusan.mjs`** — mengukur jumlah baris per percobaan
396|398|  kirim pada tiga kondisi (autorotate mati, aktif dengan tiga kandidat, dan tiga
397|399|  panggilan berurutan). Inilah yang membuktikan cacat di atas dengan angka.
398|400|- **`scripts/uji-session-health-block.mjs`** — memaksa kuota warm-up kedua sesi
399|401|  habis, lalu memastikan penolakan seluruh sesi tercatat tepat satu baris
400|402|  `sessionHealth` beserta rinciannya.
401|403|- **4 asersi regresi** di `uji-decision-log-integrasi.mjs` (total 22) yang
402|404|  memastikan pencatatan tidak kembali ke dalam `checkHealth()` dan
403|405|  `catatWarmup()` tetap dipanggil di ketiga jalur pemilihan sesi.
404|406|
405|407|### Notes
406|408|
407|409|- **Baris `warmup` tetap tanpa `message_id`.** `resolveSession()` dipanggil
408|410|  sebelum pesan dibuat, jadi pengaitan ke satu pesan belum mungkin tanpa
409|411|  mengubah urutan alur. Analisis per penerima tetap bisa dilakukan lewat
410|412|  `recipient_hash` + `created_at`.
411|413|- **Volume terukur:** 6 baris per percobaan kirim, sekitar **12.000 baris/bulan**
412|414|  (±4,6 MB) pada beban 56 pesan/hari, dengan retensi 30 hari.
413|415|
414|416|---
415|417|
416|418|## [Unreleased] — Perbaikan normalisasi nomor & IP privat di nilai bawaan
417|419|
418|420|Dua bug yang ditemukan saat menulis uji untuk decision log. Keduanya berjenis
419|421|sama: **tidak memunculkan error**, hanya menghasilkan nilai yang "kelihatan
420|422|benar" padahal salah.
421|423|
422|424|### Fixed
423|425|
424|426|- **Awalan internasional `00` pada nomor telepon** (`backend/src/phone.ts`).
425|427|  `006281234567890` dinormalisasi menjadi `62006281234567890` — nomor yang tidak
426|428|  pernah ada. Penyebabnya, awalan `00` masuk ke cabang `startsWith('0')` sehingga
427|429|  nol pertama dibuang lalu `62` ditambahkan di depannya. `normalisasiNomor()`
428|430|  dipakai pendaftaran user, penambahan user oleh admin, dan onboarding — jadi
429|431|  nomor yang ditulis dengan cara internasional ditolak sebagai tidak valid.
430|432|- **`hashRecipient()` punya aturan normalisasi sendiri** (`backend/src/db/decision-log.ts`).
431|433|  Sebelumnya hanya mengubah awalan `0` menjadi `62`, sehingga menyimpang dari
432|434|  jalur kirim untuk nomor berawalan `00` dan nomor tanpa awalan. Akibatnya satu
433|435|  penerima bisa menghasilkan dua hash berbeda, dan pengelompokan "berapa pesan
434|436|  ke satu penerima" pecah tanpa terlihat. Kini memakai `normalisasiNomor()`
435|437|  sebagai satu-satunya sumber bentuk kanonik.
436|438|- **IP privat VM di 17 lokasi.** Alamat IP privat VM pengembangan tertanam di
437|439|  nilai bawaan kode produksi (`panel-url.ts`, `blast_dashboard_url` di tiga
438|440|  berkas route), contoh konfigurasi, skrip verifikasi, dan contoh di panel. Di
439|441|  produksi alamat itu menghasilkan tautan yang tidak bisa dibuka pengguna tanpa
440|442|  error apa pun. Nilai bawaan kini `localhost`; setting di produksi sudah terisi
441|443|  domain publik sehingga tidak terpengaruh.
442|444|
443|445|### Changed
444|446|
445|447|- **Alamat bawaan Blast Dashboard disatukan.** Sebelumnya ditulis ulang di empat
446|448|  tempat (`auth.ts` dua kali, `pengaturan.ts`, `users.ts`). Kini satu konstanta
447|449|  `BLAST_DASHBOARD_URL_BAWAAN`, sejajar dengan `PANEL_BASE_URL_BAWAAN`.
448|450|- **`db/keputusan.ts` → `db/decision-log.ts`.** Satu fitur sebelumnya memakai dua
449|451|  bahasa nama berkas (Indonesia di `db/`, Inggris di `antiban-decision-log.ts`).
450|452|  Identifier yang diekspor tetap Inggris seperti seluruh kode lain.
451|453|
452|454|### Added
453|455|
454|456|- **`scripts/uji-normalisasi-nomor.mjs`** — 28 asersi: 11 varian penulisan nomor,
455|457|  9 masukan tidak valid, konsistensi `nomorValid()`. Sebelumnya `normalisasiNomor()`
456|458|  tidak punya uji sama sekali.
457|459|- **Uji regresi normalisasi di `uji-decision-log.mjs`** — 7 varian penulisan nomor
458|460|  harus bertemu di satu hash. Uji inilah yang menemukan bug `00` di atas.
459|461|
460|462|---
461|463|
462|464|## [Unreleased] — Decision log anti-ban
463|465|
464|466|Sistem anti-ban punya tujuh guard yang berjalan, tapi **tidak meninggalkan jejak
465|467|keputusan**. Saat sebuah nomor terblokir, pertanyaan "guard mana yang seharusnya
466|468|menahan ini, dan kenapa tidak?" tidak bisa dijawab dari data: `messages.status`
467|469|berubah tanpa alasan, `api_logs` mencatat HTTP bukan keputusan guard, dan
468|470|`antiban_state` hanya menyimpan kondisi akhir.
469|471|
470|472|Bagian ini menambahkan tabel `antiban_decisions` dan instrumentasi enam guard.
471|473|**Tidak ada perilaku pengiriman yang berubah** — hanya pembacaan nilai yang sudah
472|474|ada, dicatat per evaluasi.
473|475|
474|476|### Added
475|477|
476|478|- **Tabel `antiban_decisions`** (`backend/src/db/skema.ts`) — satu baris per
477|479|  evaluasi guard, bukan per pesan. Satu pesan bisa dievaluasi berkali-kali
478|480|  (setiap antrean bangun); menyimpannya sebagai kolom di `messages` akan
479|481|  menimpa riwayat percobaan sebelumnya. Empat index: per sesi+waktu, per
480|482|  guard+keputusan+waktu, per `message_id` (parsial), dan per `batch_id`
481|483|  (parsial) — dua terakhir parsial karena guard level sesi memang tanpa
482|484|  `message_id`.
483|485|- **Modul `backend/src/db/decision-log.ts`** — `recordGuardDecision`,
484|486|  `hashRecipient`, `evaluateGuard`, `summarizeDecisions`, `listDecisions`,
485|487|  `pruneDecisions`. Murni SQL, tanpa impor domain, supaya bisa diuji tanpa
486|488|  memuat `SessionManager` beserta dependensi WhatsApp-nya.
487|489|- **Jembatan `backend/src/antiban-decision-log.ts`** — tahu konteks sesi
488|490|  (`getSessionAntiBanPreset`). Preset ikut dicatat karena `allow` pada
489|491|  `broadcast` berarti hal yang berbeda dari `allow` pada `strict`: yang kedua
490|492|  "diperiksa dan aman", yang pertama bisa berarti "guard-nya dimatikan".
491|493|- **Instrumentasi tujuh guard** (`backend/src/session-manager.ts`): `recovery`,
492|494|  `timelock`, `replyRatio`, `contactGraph`, `rateLimiter`, `warmup`, dan
493|495|  `sessionHealth`. Keputusan `allow` **dan** `block` sama-sama dicatat — guard
494|496|  yang menahan sudah memanggil `console.warn`, yang meloloskan tidak, sehingga
495|497|  tanpa mencatat `allow` tidak ada cara mengukur seberapa dekat pengiriman ke
496|498|  ambang batas.
497|499|- **Dua endpoint baca** (`backend/src/routes/operasional.ts`):
498|500|  `GET /api/v1/antiban/decisions/summary` dan `GET /api/v1/antiban/decisions`
499|501|  (paginasi + filter guard/decision/batch/sesi/waktu). Non-admin hanya bisa
500|502|  membaca sesi miliknya; tanpa `sessionId` mendapat `400`. Tidak ada endpoint
501|503|  tulis — decision log hanya diisi jalur pengiriman.
502|504|- **Tujuh skrip verifikasi** di `backend/scripts/`, semuanya memakai database
503|505|  sementara di `/tmp`: unit (39 asersi), integrasi (22 asersi), rasio keputusan,
504|506|  penolakan seluruh sesi, boot, E2E HTTP (63 asersi), migrasi pada salinan DB,
505|507|  plus fixture seed.
506|508|
507|509|### Notes
508|510|
509|511|- **Tanpa PII.** Yang disimpan hanya `recipient_hash` (SHA-256, 16 hex), metrik,
510|512|  dan ambang — tidak pernah isi pesan atau nomor mentah.
511|513|- **`hashRecipient` menormalkan awalan nomor** (`0812…` → `62812…`), disamakan
512|514|  dengan `validatePhoneFormat()`. Tanpa itu satu penerima menghasilkan dua hash
513|515|  dan analisis "berapa kali orang ini dikirimi" jadi salah.
514|516|- **Pencatatan tidak pernah menggagalkan pengiriman.** `recordGuardDecision()`
515|517|  menelan semua error menjadi `console.warn` sekali per kejadian; antrean tidak
516|518|  boleh macet gara-gara audit.
517|519|- **Migrasi non-destruktif**, diuji pada salinan database berisi data nyata:
518|520|  10 tabel lama utuh, jumlah baris tidak berubah, tidak ada kolom hilang.
519|521|- **Retensi 30 hari** lewat `pruneDecisions()` oportunistik; tanpa cron baru.
520|522|- Rancangan lengkap beserta gap yang masih terbuka: `docs/rancangan-decision-log-antiban.md`.
521|523|
522|524|---
523|525|
524|526|## [Unreleased] — Waktu per transisi status pesan
525|527|
526|528|Fitur ini menjawab satu pertanyaan yang sebelumnya tidak bisa dijawab panel:
527|529|**kapan** sebuah pesan berpindah status, dan **berapa lama** jedanya. Sebelumnya
528|530|kolom waktu di semua tabel hanya memuat `created_at` — waktu pesan masuk antrean.
529|531|Di bawah badge "Terkirim", angka itu menyesatkan, karena jeda anti-ban bisa
530|532|membuat selisihnya bermenit-menit.
531|533|
532|534|Backend menyimpan waktu tiap transisi di `payload.statusTimes` (tanpa migrasi
533|535|skema) memakai timestamp asli WhatsApp. Panel dan dashboard membacanya.
534|536|
535|537|### Added
536|538|
537|539|- **`statusTimes` di payload pesan** (`backend/src/db/pesan.ts`). Diisi di
538|540|  `insertMessage` (waktu antrean) dan `updateMessageStatus` (tiap transisi).
539|541|  Timestamp yang tidak masuk akal jatuh ke jam server.
540|542|- **Kolom jam status terkini di sel Status, empat tabel panel:**
541|543|  Playground, Monitor & Queue, Admin Command Center, dan modal Log pengguna.
542|544|  Jam ditulis langsung di bawah badge supaya bisa dibandingkan antar baris tanpa
543|545|  membuka tooltip — tooltip tidak tersedia di layar sentuh.
544|546|- **Util bersama `panel/src/lib/messageStatus.tsx`:** `susunBarisWaktu`,
545|547|  `ringkasWaktu`, `jamStatusTerakhir`, komponen `JamStatus`. Satu sumber
546|548|  kebenaran; sebelumnya `getStatusBadge` diduplikasi dengan isi berbeda.
547|549|
548|550|### Fixed
549|551|
550|552|- **Status terminal selain `failed` tidak pernah tampil.** Panel hanya
551|553|  menangani `failed`, sehingga pesan `not_registered` / `invalid_number` /
552|554|  `cancelled` — yang waktunya sudah dicatat backend — tampil seolah masih di
553|555|  antrean. Daftar kini sejalan dengan `FORCED_STATUSES` di backend.
554|556|- **Pesan gagal tampil dengan centang hijau di modal Log pengguna.** Ikon hanya
555|557|  memeriksa `failed`, jadi `not_registered` dan `invalid_number` terlihat
556|558|  berhasil saat operator memindai daftar.
557|559|- **Label status mentah di modal Log pengguna.** `LABEL_STATUS_PESAN` hanya
558|560|  memuat enam status; sisanya tampil apa adanya (`not_registered`). Kini lengkap.
559|561|- **`typeof NaN === 'number'`** membuat `NaN`/`Infinity` lolos dan tampil
560|562|  sebagai baris berjam `-`. Diganti `Number.isFinite` di semua jalur.
561|563|
562|564|### Changed
563|565|
564|566|- **Header kolom "Waktu" menjadi "Masuk Antrean"** di keempat tabel. Kolom itu
565|567|  memang berisi `created_at`; tanpa penamaan ulang, ia mudah tertukar dengan jam
566|568|  status yang kini ada di sel Status.
567|569|
568|570|### Catatan
569|571|
570|572|- **Pesan lama tidak bisa direkonstruksi.** Pesan yang dibuat sebelum fitur ini
571|573|  tidak punya `statusTimes`; panel menampilkan "Tidak ada catatan waktu per
572|574|  tahap" apa adanya, bukan mengarang waktu dari `created_at`.
573|575|- **Uji:** suite `wa-api` **8/8 lulus** (termasuk `uji-util-waktu-panel.mjs`
574|576|  **34/34**).
575|577|
576|578|---
577|579|
578|580|## [Unreleased] — Pemecahan berkas besar backend
579|581|
580|582|**Tema:** memecah empat berkas backend yang sudah terlalu besar menjadi modul per domain, tanpa mengubah perilaku.
581|583|**Basis:** `8129a33` (main).
582|584|
583|585|Ringkasan: empat berkas backend menumpuk 5.430 baris — `server.ts` 2.094, `db.ts` 1.444, `antiban.ts` 1.282, `mail-templates.ts` 610. Menelusuri satu handler berarti menggulir ribuan baris, dan menyentuh satu bagian berisiko menyenggol bagian lain di berkas yang sama. Keempatnya dipecah menjadi 36 berkas di empat direktori, dengan berkas aslinya kini berupa fasad re-export. Yang dijaga ketat bukan sekadar "build hijau", tetapi **perilaku yang tidak berubah**: untuk `db.ts` itu urutan efek samping saat impor (skema, migrasi kolom, index, seed), untuk `antiban.ts` itu 135 pengamatan perilaku delapan guard dengan jam dan RNG dibekukan, untuk `mail-templates.ts` itu keluaran HTML karakter per karakter.
584|586|
585|587|### Changed
586|588|
587|589|- **`server.ts` 2.094 → 35 baris** (`backend/src/server.ts`, 9 berkas di `backend/src/routes/`).
588|590|  Bootstrap tipis: plugin, hook, dan `listen`. Handler dipisah per domain — `auth` 14 route, `pesan` 12, `sessions` 25, `pengaturan` 10, `users` 8, `operasional` 5, sisanya `schemas`/`media`/`konteks`. Daftar route **dibangkitkan dari sumber**, bukan ditulis manual: percobaan pertama dengan daftar manual menghasilkan 72 dari 74 route karangan.
589|591|
590|592|- **`mail-templates.ts` 610 → 35 baris** (`backend/src/mail-templates.ts`, 4 berkas di `backend/src/email/`).
591|593|  Dipisah menurut jenis email: `dasar` (warna, font, escaping), `reset-password`, `registrasi`, `uji`.
592|594|
593|595|- **`db.ts` 1.444 → 44 baris** (`backend/src/db.ts`, 12 berkas di `backend/src/db/`).
594|596|  Dipisah per domain data: `client` (satu-satunya pemilik koneksi), `skema`, `users`, `pesan`, `api-logs`, `jeda`, `reset-password`, `sessions`, `kuota`, `lid`, `kesehatan`, `admin`. Berkas aslinya menyisipkan seksi antar domain (users → reset-password → users lagi → kuota), sehingga satu berkas hasil boleh terdiri dari beberapa rentang baris.
595|597|
596|598|- **`antiban.ts` 1.282 → 42 baris** (`backend/src/antiban.ts`, 11 berkas di `backend/src/antiban/`).
597|599|  Dipisah per guard: `tipe`, `preset`, `util`, `rate-limiter`, `warmup`, `timelock`, `presence`, `reconnect`, `ban-recovery`, `reply-ratio`, `contact-graph`.
598|600|
599|601|- **Fasad memakai daftar nama eksplisit, bukan `export *`** (`backend/src/antiban.ts`).
600|602|  Empat simbol (`MS`, `hashContent`, `identicalKey`, `ReplyRatioConfig`) dulu privat di `antiban.ts` tetapi harus dipakai lintas modul hasil. Simbol itu diekspor **hanya di modulnya**, dan fasad dibangkitkan dari daftar `export` berkas asli sehingga permukaan API tidak bertambah satu nama pun. `export *` akan ikut membocorkannya.
601|603|
602|604|- **Perkakas pemecahan disimpan di repo** (`backend/scripts-pecah/`).
603|605|  Generator per berkas (`pecah-*.py`), verifier isi + permukaan API (`verifikasi-*.py`), banding perilaku (`banding-http.mjs`, `banding-email.mjs`, `banding-antiban.mjs`), pre-flight deploy (`pra-deploy.py`), dan jaring uji (`jalankan-uji.sh`). Tujuannya agar pemecahan berkas berikutnya tidak dikerjakan dengan cara yang berbeda-beda.
604|606|
605|607|### Notes for reviewer
606|608|
607|609|- **Verifikasi yang dijalankan, per tahap:** baris kode hasil dibandingkan sebagai multiset dengan berkas asli (tidak ada hilang, tidak ada baru); permukaan API dibandingkan nama per nama; `npx tsc` exit 0; 5 skrip uji backend lulus 0 gagal; 74/74 route identik status dan bentuk respons terhadap build pra-refactor; dan untuk `antiban.ts` 135 pengamatan perilaku identik.
608|610|- **`db.ts` diverifikasi lebih jauh** karena isinya bukan sekadar kumpulan fungsi: begitu diimpor ia menjalankan PRAGMA, CREATE TABLE, migrasi kolom, index, dan seed. Diuji dengan database kosong **dan** database lama yang dibuka versi baru (migrasi idempoten), lalu dibandingkan: 10 tabel, 12 index, 11 `settings`, 22 kolom `users` — sama persis.
609|611|- **`antiban.ts` diuji perilakunya, bukan hanya isinya.** `banding-antiban.mjs` membekukan `Date` dan `Math.random` dengan benih tetap (wajib: ada 37 pemakaian `Date.now()` dan 7 `Math.random()`), menjalankan skenario yang sama pada build lama dan build pecahan, lalu membandingkan hasilnya. Skrip yang sama dijalankan di VM dengan Node 22 terhadap `dist` yang benar-benar dideploy — 135 pengamatan identik, sama seperti Node 26 lokal.
610|612|- **Sudah dideploy ke VM dev 207 dan diverifikasi:** 57 berkas `js` identik dengan build lokal (md5 agregat), `NRestarts=0`, tanpa error di journal, DB produksi utuh, 3 sesi WhatsApp tetap `connected`, dan 9router `Up 9 days (healthy)`.
611|613|- **`antiban.ts` terbukti benar-benar berjalan di produksi**, bukan sekadar dimuat: journal VM mencatat `[AntiBan] Timelock 463 untuk sesi ... telah dicabut oleh WhatsApp` dari `TimelockGuard` di modul hasil pemecahan.
612|614|- **`session-manager.ts` (1.344 baris) sengaja TIDAK dipecah.** Isinya satu fungsi dan satu class dengan 46 method yang semuanya memakai `this` (167 pemakaian `this.`), dengan state yang saling terkait (engine, queues, pausedSessions, antiban, health, lidResolver, metrics). Memecahnya berarti memisahkan state bersama — itu menulis ulang, bukan memotong per rentang, dan berkas itu ada di jalur kirim pesan. Ambang yang dipakai: bila jumlah pemakaian `this.` pada satu class mendekati jumlah method-nya, berkas itu bukan kandidat potong-per-rentang.
613|615|- **Batas cakupan:** yang tidak diuji tetap pesan yang benar-benar terkirim dan pairing WhatsApp, karena keduanya butuh nomor asli.
614|616|- **Rollback per tahap tersedia** sebagai direktori `dist.bak-*` di VM (`-pecah`, `-email`, `-db`, `-antiban`), masing-masing cukup di-`mv` kembali lalu restart `wa-backend.service`.
615|617|
616|618|---
617|619|
618|620|## [Unreleased] — Registrasi akun & email selamat datang
619|621|
620|622|**Tema:** notifikasi email saat pendaftaran, kolom nomor WhatsApp di form registrasi, dan halaman pengenalan setelah daftar lewat Google.
621|623|**Basis:** `c896df3` (main).
622|624|
623|625|Ringkasan: pendaftaran sebelumnya tidak memberi umpan balik apa pun — akun terbentuk, tetapi pengguna tidak menerima email dan tidak tahu batas pemakaiannya. Pendaftar lewat Google lebih parah lagi: mereka tidak melewati formulir, sehingga akun terbentuk tanpa nomor WhatsApp dan tanpa penjelasan kuota. Tiga hal itu ditutup di sini.
624|626|
625|627|### Added
626|628|
627|629|- **Email selamat datang untuk dua jalur pendaftaran** (`backend/src/notifikasi-email.ts`, `backend/src/mail-templates.ts`).
628|630|  Dikirim setelah akun benar-benar terbentuk, dengan isi yang dibedakan menurut jalurnya:
629|631|  - Pendaftaran form manual: tombol mengarah ke dashboard.
630|632|  - Pendaftaran lewat Google: tombol "Lengkapi Nomor WhatsApp" mengarah ke `/onboarding`.
631|633|  Email hanya dikirim untuk akun yang **baru dibuat**. Pengguna lama yang login ulang tidak dikirimi lagi — dibedakan lewat `upsertGoogleUser()` yang kini mengembalikan `{ user, baru }`.
632|634|  Kegagalan kirim email sengaja tidak melempar galat: akun sudah ada di database, dan SMTP yang mati tidak boleh membatalkan pendaftaran.
633|635|
634|636|- **Kolom nomor WhatsApp di form registrasi** (`panel/src/components/AuthPage.tsx`, `backend/src/server.ts`).
635|637|  Opsional, bertipe `tel`. Nomor dinormalkan ke bentuk kanonik `628...` lewat `normalisasiNomor()` yang sudah dipakai endpoint admin, sehingga `0812-3456-789` dan `+62 812 3456 789` tersimpan identik. Nomor tidak valid ditolak `400` dengan pesan yang menyebut format yang diterima; nomor yang sudah dipakai akun lain ditolak `409`.
636|638|
637|639|- **Halaman pengenalan setelah daftar lewat Google** (`panel/src/components/OnboardingPage.tsx`, rute `/onboarding`).
638|640|  Menampilkan sisa kuota harian dan mingguan, lalu meminta nomor WhatsApp. Nomor boleh dikosongkan dan masih dapat dilengkapi kapan saja. Halaman ini hanya muncul untuk akun Google yang baru dibuat, ditandai lewat `perluOnboarding` pada respons `/auth/google`.
639|641|
640|642|- **`PATCH /api/v1/auth/me`** (`backend/src/server.ts`).
641|643|  Melengkapi profil sendiri. Dipakai halaman pengenalan untuk menyimpan nomor tanpa akses admin. Menolak nomor tidak valid (`400`) dan nomor milik akun lain (`409`); kirim `phone: ""` untuk menghapus nomor.
642|644|
643|645|- **Uji end-to-end pendaftaran** (`backend/scripts/uji-e2e-daftar.mjs`, 40 pemeriksaan).
644|646|  Mendaftar lewat HTTP sungguhan, menangkap email di SMTP sink lokal, lalu membaca kembali isinya — jadi yang diperiksa adalah email yang benar-benar diterima pengguna, bukan template yang dipanggil langsung. Mencakup pula penolakan nomor, tabrakan nomor antar akun, dan toggle pendaftaran publik.
645|647|
646|648|- **Pratinjau email pendaftaran** (`backend/scripts/generate-preview-email.mjs`).
647|649|  Dua varian (manual dan Google) disajikan berdampingan supaya perbedaan isinya terlihat langsung.
648|650|
649|651|### Fixed
650|652|
651|653|- **Toggle pendaftaran publik tidak dihormati endpoint** (`backend/src/server.ts`).
652|654|  `registration_enabled = false` hanya menyembunyikan formulir di UI; `POST /auth/register` tetap terbuka bagi siapa pun yang tahu alamatnya. Endpoint kini menolak `403` saat toggle mati. Pendaftaran lewat Google sengaja tetap diizinkan — perilaku lama yang dipertahankan dan kini tertulis eksplisit di kode.
653|655|
654|656|- **Nomor WhatsApp basi di panel setelah onboarding** (`panel/src/App.tsx`).
655|657|  `onSelesai` menghapus penanda onboarding dari objek state `auth.user` yang diambil saat halaman dibuka, lalu menulisnya kembali ke `localStorage` — menimpa nomor yang baru saja disimpan. Akibatnya panel menampilkan nomor kosong meski server sudah menyimpannya. Kini penanda dihapus dari data yang sudah tersimpan.
656|658|
657|659|### Security
658|660|
659|661|- **`passwordHash` ikut terkirim ke browser lewat `POST /auth/google`** (`backend/src/server.ts`).
660|662|  Handler mengembalikan objek user utuh, sehingga hash password ikut dalam respons dan tersimpan di `localStorage` panel. Sudah disamakan dengan `/auth/login` yang memakai daftar field eksplisit. Terverifikasi: respons kini memuat 0 kemunculan `passwordHash`.
661|663|
662|664|### Notes for reviewer
663|665|
664|666|- 40/40 uji baru lulus; tiga uji lama (`uji-reset-password`, `uji-telepon`, `uji-e2e-reset`) dijalankan ulang tanpa regresi.
665|667|- Terverifikasi di browser: pendaftaran manual lewat UI menyimpan `6281277776666`; klik Google mengarahkan ke `/onboarding`; menyimpan nomor dari onboarding mengisi `6281922221111` dan menghapus penanda. Responsif pada 375/768/1440 px tanpa overflow horizontal.
666|668|- Sudah dideploy ke VM dev 207 dan diverifikasi: `dist` backend identik dengan build lokal (md5 empat berkas), bundel panel identik (md5 JS dan CSS), 3 sesi WhatsApp tetap `connected` setelah restart, dan satu email pendaftaran sungguhan terkirim lewat Brevo.
667|669|- **Batas cakupan:** jalur Google **belum diuji di produksi**. Google OAuth di VM dev belum aktif dan mengaktifkannya butuh Client ID sungguhan. Alur tersebut baru terbukti di lingkungan uji dengan GSI disimulasikan.
668|670|- Dependensi `nodemailer@10.0.14` disalin manual ke `node_modules` VM. `package.json` VM **tidak boleh diubah** — auto-install pnpm gagal karena `pnpm` tidak ada di PATH systemd, dan `wa-backend.service` akan mati.
669|671|
670|672|---
671|673|
672|674|## [Unreleased] — Basis URL panel konsisten & bisa diatur dari panel
673|675|
674|676|**Tema:** satu sumber kebenaran untuk alamat panel yang dipakai menyusun tautan di email.
675|677|**Basis:** `f3b6de9` (main).
676|678|
677|679|Ringkasan: tautan reset password dan tautan pada email selamat datang membaca sumber yang berbeda, sehingga nilai dari tabel `settings` hanya berpengaruh pada salah satunya. Akibatnya admin yang mengubah alamat panel dari UI akan mendapati email selamat datang benar sementara tautan reset password tetap menunjuk alamat pengembangan — kegagalan senyap, karena tidak ada error yang muncul dan email tetap terkirim. Selain itu tidak ada jalan sama sekali untuk mengisi alamat itu dari panel: endpoint `PATCH /settings` tidak menerimanya dan UI tidak menyediakannya.
678|680|
679|681|### Fixed
680|682|
681|683|- **Tautan reset password mengabaikan tabel `settings`** (`backend/src/password-reset.ts`).
682|684|  Baris ini membaca `process.env.PANEL_BASE_URL` sendiri, sementara `notifikasi-email.ts` membaca tabel `settings` lebih dulu. Nilai cadangannya alamat pengembangan (`http://localhost:5174`), jadi di produksi tautan yang sampai ke pengguna tidak bisa dibuka — tanpa satu pun error.
683|685|
684|686|### Added
685|687|
686|688|- **Modul `backend/src/panel-url.ts`** sebagai satu sumber kebenaran basis URL panel.
687|689|  Urutan prioritas: tabel `settings` → env `PANEL_BASE_URL` → alamat pengembangan. Nilai dari tabel dibaca **setiap pemanggilan**, bukan di-cache saat modul dimuat, supaya perubahan dari panel langsung berlaku pada email berikutnya tanpa restart — restart memutus sesi WhatsApp, jadi itu bukan langkah yang boleh diwajibkan hanya untuk memperbaiki alamat.
688|690|- **`panelBaseUrl` pada `GET`/`PATCH /api/v1/settings`** (`backend/src/server.ts`).
689|691|  Nilai kosong sah dan berarti "jangan pakai nilai dari tabel". Nilai selain itu wajib diawali `http://` atau `https://` tanpa spasi — alamat tanpa skema akan menghasilkan tautan relatif di email dan tidak bisa diklik. Nilai tidak sah ditolak `400` dan **tidak** tersimpan.
690|692|- **Kolom "Alamat Panel untuk Tautan Email"** di Settings (`panel/src/components/SettingsPage.tsx`, `panel/src/api.ts`).
691|693|  Ditaruh terpisah dari integrasi Blast Dashboard karena keduanya alamat yang berbeda dan mudah tertukar.
692|694|
693|695|### Notes for reviewer
694|696|
695|697|- Uji baru `backend/scripts/uji-base-url-panel.mjs` — **15 LULUS / 0 GAGAL**, dijalankan di atas DB `/tmp` terpisah dengan SMTP sink lokal, jadi email yang diperiksa adalah email yang benar-benar dikirim backend.
696|698|- **Uji merah dijalankan:** `password-reset.ts` dikembalikan sementara ke perilaku lama, dan uji itu gagal tepat pada dua assertion yang menggambarkan bug-nya (tautan tidak memakai nilai tabel, dan masih memakai nilai env) sementara 13 assertion lain tetap lulus. Ini membuktikan ujinya menangkap regresi, bukan sekadar selalu hijau.
697|699|- Regresi tanpa kegagalan: `uji-e2e-reset` 32/0, `uji-e2e-daftar` 40/0, `uji-reset-password` 27/0, `uji-telepon` 18/0.
698|700|- **Batas cakupan:** belum diuji terhadap SMTP sungguhan (Brevo) — hanya sink lokal. Tampilan kolom baru sudah dikompilasi tetapi belum diperiksa di browser.
699|701|
700|702|---
701|703|
702|704|## [Unreleased]
703|705|
704|706|### Docs
705|707|- **API Reference lengkap**: `panel/src/components/Docs.tsx` kini mendokumentasikan **65/65 endpoint** (sebelumnya 24 entri, 22 cocok). Ditambahkan 43 endpoint yang belum terdokumentasi, termasuk Contact Graph whitelist (Layer 8), Queue & Batches, Media & Files, Auto-Rotate, dan Admin audit.
706|708|- **Perbaikan path salah** (terverifikasi terhadap `server.ts`):
707|709|  - `POST /sessions/:id/disconnect` -> `POST /sessions/:id/logout` (route `disconnect` tidak pernah ada).
708|710|  - `GET /messages/:id/status` -> `GET /messages/status/:id` (urutan segmen terbalik).
709|711|  - `README.md`: `/api/v1/messages/media` -> `/api/v1/messages/send-media`.
710|712|- **4 section baru** di UI Docs: Media & Files, Queue & Batches, Settings & Auto-Rotate, Admin & Audit.
711|713|- Tipe `method` dan peta warna diperluas agar `PUT` terdukung (dipakai `/sessions/:id/antiban`).
712|714|
713|715| — branch `main`
714|716|
715|717|**Tema:** refactor UI/UX Contact Graph Whitelist ke Dedicated Modal & responsif Delivery Queue mobile.
716|718|
717|719|### Added
718|720|
719|721|- **Dedicated Modal Manajemen Whitelist Contact Graph** (`panel/src/components/RealtimeMonitor.tsx`).
720|722|  Mengisolasi pengelolaan batch whitelist penerima ke dalam modal dialog terpisah (`showContactGraphModal`), memisahkan antara pemantauan metrik dan manajemen data:
721|723|  - **Grid Anti-Ban Simetris**: Kartu Layer 8 (Contact Graph) tetap kompak dengan tinggi seragam (222px) sejajar Layer 5–7, menampilkan ringkasan status batch dan 1 tombol aksi bersih `Kelola Whitelist Penerima...`.
722|724|  - **Quick Batch Selector**: Tombol pill interaktif untuk memilih dan beralih cepat antar kampanye yang telah memiliki whitelist.
723|725|  - **Live Phone Detection Counter**: Textarea pendaftaran otomatis menghitung jumlah nomor valid secara real-time sebelum didaftarkan.
724|726|  - **Search & Filter Penerima**: Menyediakan kolom pencarian nomor telepon instan saat batch memiliki puluhan hingga ratusan nomor.
725|727|  - **Aksi Cabut Granular & Massal**: Mendukung pencabutan per nomor (`handleRevokeBatchRecipient`) maupun seluruh nomor per batch (`handleRevokeBatchAll`).
726|728|
727|729|### Fixed
728|730|
729|731|- **Overflow horizontal header Delivery Queue pada viewport mobile** (`panel/src/components/RealtimeMonitor.tsx`).
730|732|  Sebelumnya kontainer header tabel dipaksa dalam satu baris horizontal (`flex items-center justify-between`) tanpa pembungkus (`wrap`). Setelah penambahan selector page size (`10, 25, 50, 100`), lebar konten melebar hingga 540px pada viewport 375px (`scrollWidth: 540` vs `clientWidth: 349`), mengakibatkan judul terhimpit 87px dan tombol kontrol antrean meluap keluar batas kartu.
731|733|  Diperbaiki dengan reflow responsif:
732|734|  - Header utama berubah menjadi susunan bertingkat (`flex-col lg:flex-row lg:items-center justify-between gap-3`).
733|735|  - Toolbar kontrol antrean (tombol Jeda/Lanjut, selector baris per halaman, dan counter badge) dibungkus rapi dengan `flex-wrap gap-2`.
734|736|  - Paginasi footer disesuaikan dengan touch target ergonomis (`h-8 w-8`) dan teks status halaman yang ringkas (`Hal X/Y`) agar muat rapi di satu baris tanpa scroll horizontal.
735|737|
736|738|### Notes for reviewer
737|739|
738|740|- Terverifikasi via Browser CDP live pada viewport 375x812: `header.clientWidth: 349, header.scrollWidth: 349`, zero horizontal overflow. Tampilan desktop (1280px) tetap sejajar horizontal tanpa regresi.
739|741|
740|742|---
741|743|
742|744|## [Merged] — branch `fix/antiban-guard-resilience-20260916`
743|745|
744|746|**Tema:** resiliensi guard anti-ban, auto-resume antrean, persistensi status jeda.
745|747|**Basis:** `570d547` (main). **Sudah di-merge ke `main` dan berjalan di produksi.**
746|748|
747|749|Ringkasan singkat untuk tim dev: sebelumnya 3 dari 4 guard anti-ban membuang pesan
748|750|ke status `failed` permanen saat terpicu, sementara satu-satunya guard yang menahan
749|751|pesan justru memacetkan antrean karena `pauseQueue()` tidak punya jalur pemulihan
750|752|otomatis. Branch ini menyeragamkan semuanya menjadi "tahan pesan + jeda sementara +
751|753|lanjut sendiri", mempersist status jeda agar bertahan melewati restart, memperbaiki
752|754|bug yang membuat delay pacing terkalikan 10x, dan memperbaiki `db.ts` yang selalu
753|755|gagal pada instalasi database baru.
754|756|
755|757|### Fixed
756|758|
757|759|- **`db.ts` selalu gagal pada database baru** (`db.ts`).
758|760|  Blok `CREATE INDEX` dijalankan **sebelum** `ensureColumn()`, padahal 5 dari 8 index
759|761|  menyentuh kolom yang baru ditambahkan lewat migrasi ringan (`priority`, `batch_id`,
760|762|  `user_id`, `wa_message_id`). Fresh install selalu berhenti dengan
761|763|  `no such column: priority`. Blok index dipindah ke setelah seluruh `ensureColumn`.
762|764|  Ditemukan saat menyiapkan lingkungan uji — sebelumnya tidak terlihat karena
763|765|  database produksi sudah punya semua kolom.
764|766|
765|767|- **`record()` dan `getDelay()` memakai hash yang berbeda** (`antiban.ts`).
766|768|  `record()` meng-hash konten mentah sementara `getDelay()`/`getDelayReason()`
767|769|  meng-hash konten ternormalisasi, sehingga kunci pelacak tidak pernah cocok dan
768|770|  guard anti-spam tidak menyala. Keduanya kini memakai hash yang sama.
769|771|
770|772|- **Delay pacing terkalikan 10x pada setiap pengiriman** (`session-manager.ts`).
771|773|  `ab.reconnect.onReconnect()` dipanggil di jalur sukses kirim pesan, sehingga
772|774|  `ReconnectThrottle.multiplier` selalu bernilai ~0.1 dan setiap `totalDelay`
773|775|  terbagi 0.1 (efektif dikali 10). Bukti dari data produksi: dari 97 pesan,
774|776|  14 pesan mencatat `jitter_delay_ms` 25–60 detik padahal batas desain preset
775|777|  `balanced` hanya ~11 detik. Pemanggilan dihapus; throttle kini hanya dipicu
776|778|  oleh reconnect socket sungguhan lewat `engine.onReconnectCallback`.
777|779|
778|780|- **Guard anti-spam konten identik tidak pernah aktif** (`antiban.ts`).
779|781|  Hash konten dihitung dari pesan hasil render, sementara dashboard menyisipkan
780|782|  nama penerima per kontak. Akibatnya 52 pesan blast dengan isi identik
781|783|  menghasilkan 52 hash berbeda dan `maxIdenticalMessages` tidak pernah tercapai.
782|784|  Ditambahkan `normalizeContentForHash()` yang menyamarkan baris personalisasi
783|785|  (`Yth.`, `Kepada`, `Dear`, `Halo`, `Hai`, `Hi`) sebelum hashing. Pesan tanpa
784|786|  baris sapaan tidak terpengaruh.
785|787|
786|788|- **Pesan hilang dari antrean saat guard memblokir** (`session-manager.ts`).
787|789|  Guard `timelock`, `replyRatio`, dan `contactGraph` menandai pesan `failed`
788|790|  lalu `continue` — pesan permanen keluar dari antrean tanpa retry. Kini
789|791|  keempat guard memakai pola yang sama dengan rate limiter: pesan dikembalikan
790|792|  ke depan antrean (`holdMessageAtFront`) lalu antrean dijeda sementara.
791|793|
792|794|### Added
793|795|
794|796|- **Penjadwal auto-resume antrean** (`session-manager.ts` → `scheduleAutoResume()`).
795|797|  Sebelumnya satu-satunya pemanggil `resumeQueue()` adalah endpoint manual, jadi
796|798|  setiap `pauseQueue()` otomatis berarti antrean berhenti sampai ada manusia yang
797|799|  klik Resume. Sekarang setiap jeda otomatis menjadwalkan pembukaan kembali:
798|800|  sisa waktu blokir dijepit ke rentang **5 detik – 1 jam** dengan margin 5%,
799|801|  timer bersifat `unref()` agar tidak menahan proses Node, dan jadwal yang lebih
800|802|  cepat tidak ditimpa oleh jadwal yang lebih lambat.
801|803|
802|804|- **Persistensi status jeda antrean** (`db.ts`, `session-manager.ts`).
803|805|  `pausedSessions` dan `pausedBatches` sebelumnya hanya in-memory, sehingga
804|806|  restart service menghapus seluruh jeda dan antrean langsung berjalan kembali
805|807|  tanpa sepengetahuan operator. Kini disimpan ke tabel `settings`
806|808|  (`queue_paused_sessions`, `queue_paused_batches`) dan dipulihkan saat startup
807|809|  lewat `restoreQueuePauseState()`, dipanggil dari `recoverPendingMessages()`.
808|810|  Entri non-jeda dibuang saat disimpan agar tabel tidak menumpuk data basi.
809|811|
810|812|- **`remainingMs()` pada setiap guard** (`antiban.ts`) sebagai sumber waktu tunggu
811|813|  bagi penjadwal auto-resume: `TimelockGuard`, `ReplyRatioGuard`,
812|814|  `BanRecoveryOrchestrator`, dan `ContactGraphWarmer`.
813|815|
814|816|- **Flag `distraction` per-preset anti-ban** (`antiban.ts`). `PresenceChoreographer`
815|817|  punya jeda "distraksi manusiawi" 5–20 menit dengan peluang 5%. Untuk blast 52
816|818|  pesan itu berarti 2–3 pesan terkena jeda panjang tanpa alasan. Flag ini
817|819|  `false` pada preset `broadcast` dan `strict`, tetap `true` pada `balanced`
818|820|  (chat interaktif).
819|821|
820|822|- **`autoResumeInMs` pada `QueueSessionStatus`** (`types.ts`) supaya UI dapat
821|823|  menampilkan sisa waktu sampai antrean terbuka kembali.
822|824|
823|825|### Changed
824|826|
825|827|- **Guard pesan identik kini dihitung per penerima** (`antiban.ts`).
826|828|  Sebelumnya `maxIdenticalMessages` dihitung global per konten, sehingga setelah
827|829|  normalisasi hash aktif, pengumuman yang sama ke 52 orang akan diblokir — padahal
828|830|  itu broadcast yang sah. Kunci pelacak kini gabungan **penerima + hash konten**:
829|831|  - Pengumuman sama ke 52 penerima berbeda → lolos (broadcast normal)
830|832|  - Pesan sama 12x ke satu orang → diblokir di ambang preset
831|833|  - 12 pesan berbeda ke satu orang → lolos
832|834|
833|835|- **`normalizeContentForHash()` diekspor** dari `antiban.ts` agar dapat diuji
834|836|  terpisah dan dipakai ulang oleh jalur validasi lain.
835|837|
836|838|### Catatan penting untuk reviewer
837|839|
838|840|- Perubahan ini **belum diuji terhadap nomor WhatsApp produksi**. Verifikasi yang
839|841|  dilakukan bersifat unit/integration test lokal + smoke test server (lihat bagian
840|842|  Verifikasi) — bukan uji lapangan.
841|843|- **Dampak kecepatan:** menghapus `onReconnect()` di jalur sukses membuat
842|844|  pengiriman blast menjadi **~10x lebih cepat** dari kondisi saat ini. Ini adalah
843|845|  keputusan throughput, **bukan** peningkatan keamanan nomor. Untuk blast bervolume
844|846|  besar, pertimbangkan preset `broadcast` dan pantau metrik 463/429.
845|847|- `contactGraph` masih berstatus `enabled: false` (default). Jika diaktifkan,
846|848|  kontak baru akan diblokir sampai handshake 1 jam — pastikan perilaku ini
847|849|  diinginkan sebelum mengaktifkannya di production.
848|850|
849|851|### Verifikasi
850|852|
851|853|**38 skenario uji** dijalankan terhadap hasil build (`dist/`) dan server nyata di
852|854|port terpisah (bukan production):
853|855|
854|856|*Round 1 — guard & auto-resume (22 skenario):*
855|857|- Normalisasi hash: 52 pesan identik → 1 hash; konten berbeda tetap beda hash;
856|858|  pesan tanpa baris sapaan tidak berubah.
857|859|- Flag `distraction`: 0 dari 20.000 pesan pada preset `broadcast` terkena jeda;
858|860|  preset `balanced` tetap ~5%.
859|861|- `remainingMs()`: idle → 0, aktif → positif, guard nonaktif → 0.
860|862|- Penjadwal auto-resume: penjepitan batas bawah/atas, pembersihan saat resume
861|863|  manual, dan antrean benar-benar terbuka sendiri setelah masa blokir lewat.
862|864|
863|865|*Round 2 — db fresh install, persistensi, guard identik (16 skenario):*
864|866|- `db.ts` berhasil inisialisasi pada database kosong dan membentuk 8 index.
865|867|- Status jeda tersimpan, entri non-jeda dibuang, dan instance `SessionManager`
866|868|  baru memulihkan jeda dari database (simulasi restart).
867|869|- Guard identik: broadcast 52 orang berbeda → 0 diblokir; spam 12x ke satu orang
868|870|  → diblokir; 12 pesan berbeda ke satu orang → 0 diblokir.
869|871|
870|872|*Smoke test server (`dist/server.js`, database bersih, port 3199):*
871|873|- `GET /api/v1/health` → `{"status":"ok"}`.
872|874|- `GET /sessions/:id/queue/status` mengembalikan field baru `autoResumeInMs`.
873|875|- `POST /batches/:id/pause` menulis ke tabel `settings`.
874|876|- **Setelah proses benar-benar dimatikan dan dijalankan ulang**, batch masih
875|877|  berstatus `isPaused: true` dengan alasan aslinya — membuktikan persistensi
876|878|  bekerja lintas restart.
877|879|
878|880|### Diketahui belum diperbaiki (di luar cakupan branch ini)
879|881|
880|882|- **Dua sumber kebenaran untuk status pause.** Dashboard *set* jeda per-batch
881|883|  (`pauseBatch`) tetapi *membaca* per-sesi (`fetchQueueStatus`). UI bisa
882|884|  menampilkan status yang keliru.
883|885|- **Status `pending` masih ambigu** — dipakai untuk "menunggu di dashboard"
884|886|  sekaligus "menunggu di gateway".
885|887|- **Pembatalan kampanye masih tercatat `failed`,** bukan `cancelled`, sehingga
886|888|  ikut menurunkan `delivery_rate` sesi.
887|889|- **Dashboard belum punya selector preset antiban.** Endpoint backend
888|890|  (`getAntiBanStatus` / `updateAntiBanSettings`) sudah tersedia.
889|891|- **Monitoring report-rate belum ada.** Tidak ada pengukuran berapa penerima yang
890|892|  mem-block/report nomor — padahal ini faktor paling menentukan reputasi nomor.
891|893|- **`date.timezone = PRC` pada `php.ini`** (UTC+8) di server; Laravel sudah aman
892|894|  lewat `APP_TIMEZONE`, tetapi kode PHP yang memakai `date()` native masih drift.
893|895|- **`onTimelockUpdate()` belum pernah dipanggil**, sehingga `timeEnforcementEnds`
894|896|  asli dari WhatsApp tidak pernah dipakai (timelock selalu berasumsi 60 detik).