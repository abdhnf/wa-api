# Changelog

Semua perubahan penting pada `wa-api` didokumentasikan di file ini.
Format mengikuti [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan
[Semantic Versioning](https://semver.org/lang/id/).

---
## [Unreleased] — inbox, webhook yang benar-benar mengirim, dan chatbot

Sebelum ini gateway hanya bisa mengirim. `messages.upsert` dipakai untuk mencatat
metrik anti-ban lalu isi pesannya dibuang, sehingga tidak ada inbox, tidak ada
bahan untuk chatbot, dan tidak ada yang bisa dipancarkan sebagai event. Tabel
`webhooks` dan endpoint `POST/GET /webhooks` sudah ada, tetapi tidak ada satu pun
baris kode yang mengirim HTTP ke URL terdaftar — padahal `Docs.tsx` sudah
menjanjikan event `message.received`.

### Added

- **Inbox** (`inbound_messages`, `GET /inbound`, `GET /inbound/conversations`,
  `GET /inbound/conversation`). Pesan masuk dinormalisasi di `inbound.ts`:
  `append` (riwayat sinkronisasi), `fromMe`, dan `status@broadcast` disaring;
  grup disimpan dengan `chat_type = 'group'`; pembungkus `ephemeralMessage` /
  `viewOnceMessage` / `editedMessage` dibuka. Duplikat ditolak index unik
  `(session_id, wa_message_id)` — Baileys mengirim ulang pesan setelah reconnect.
- **Pengiriman webhook** (`webhook_deliveries`, `webhook.ts`). Antrean di SQLite,
  worker 2 detik, HMAC-SHA256 atas `${timestamp}.${body}`, header `X-WA-Event` /
  `X-WA-Delivery` / `X-WA-Timestamp` / `X-WA-Signature`, backoff 1m-5m-30m-2h-6h,
  maksimal 5 percobaan, batas 60 kiriman/menit per webhook. Event:
  `message.received`, `message.status`, `session.status`.
- **Endpoint webhook**: `PATCH`/`DELETE /webhooks/:id`, `POST /webhooks/:id/test`
  (kirim langsung, kembalikan status code + cuplikan balasan),
  `GET /webhooks/:id/deliveries`, `POST /webhooks/deliveries/:id/retry`.
- **Chatbot rule-based** (`chatbot_flows`, `chatbot_sessions`, `chatbot_optouts`,
  `chatbot.ts`, `routes/chatbot.ts`). Pencocokan `exact`/`contains`/`keyword`/
  `regex`, alur bertingkat dengan `steps`, cooldown per aturan, opt-out
  (STOP/BERHENTI), dan human takeover 24 jam saat operator membalas manual.
  Balasan masuk antrean `priority: 'high'` sehingga tetap tercatat di `messages`
  dan tetap kena pacing.
- **Panel**: tab Chatbot (aturan, uji coba tanpa mengirim, percakapan, opt-out)
  dan tab Webhooks (daftar, uji kirim, riwayat + retry).
- **Filter isi pesan pada webhook** (`webhooks.match_type`/`match_value`,
  `matcher.ts`). Sebelumnya cakupan webhook hanya bisa dibatasi per sesi dan per
  jenis chat — keduanya menjawab "dari nomor mana", bukan "pesan apa". Akibatnya
  webhook ke dashboard tiket tetap menerima setiap sapaan dan setiap balasan
  "terima kasih". `matchType` (`exact`/`contains`/`keyword`/`regex`) dan
  `matchValue` kini menyaring saat event dipancarkan. Istilah dan artinya sama
  persis dengan aturan chatbot karena keduanya memakai `matcher.ts` yang sama —
  aturan yang sudah terbukti di chatbot bisa disalin apa adanya. Filter hanya
  dinilai untuk event yang membawa pesan; `message.status` dan `session.status`
  tetap terkirim karena tidak punya teks untuk dicocokkan. Pesan bergambar
  dinilai dari caption-nya. Melepas filter: `matchType: null` pada `PATCH`.
- **Panel Webhook**: pilihan "Filter isi pesan" di modal tambah/ubah, beserta
  badge di daftar yang menunjukkan filter aktif (`Kata kunci: harga,ongkir`)
  atau `semua pesan`. Sebelumnya cakupan hanya terlihat dengan membuka formulir.
- **Header `X-WA-Webhook-Id`** pada setiap kiriman webhook. Secret bersifat per
  webhook, tetapi payload dan header lama tidak membawa penanda webhook mana yang
  mengirim. Penerima yang menerima kiriman dari lebih dari satu webhook harus
  mencoba setiap secret yang dimilikinya untuk memverifikasi tanda tangan — satu
  request yang gagal menjadi percobaan terhadap N kunci, dan tidak ada cara tahu
  kiriman itu seharusnya datang dari webhook mana. Nilainya bukan rahasia (hanya
  penunjuk baris konfigurasi), dan pemalsuan tetap butuh secret. Penyusunan
  header dipusatkan di `bangunHeaderWebhook()` supaya jalur antrean dan endpoint
  uji mengirim set header yang persis sama. Lihat README bagian Verifikasi dan
  `Docs.tsx`; keduanya kini memuat contoh pemetaan id → secret.
- **`X-WA-Idempotency-Key`** pada setiap kiriman webhook, disimpan di kolom
  `webhook_deliveries.idempotency_key`. `X-WA-Delivery` hanya menyatukan
  percobaan ulang dari satu baris antrean karena nilainya dibuat acak per
  pemancaran; dua pemancaran untuk kejadian yang sama (pesan yang dikirim ulang
  Baileys setelah reconnect, atau status yang berubah bolak-balik) menghasilkan
  dua nilai berbeda, sehingga penerima tidak bisa mengenalinya sebagai kiriman
  ganda. Kunci baru diturunkan dari isi kejadian — `msg_<sesi>_<waMessageId>`,
  `ack_<sesi>_<waMessageId>_<status>`, `sess_<sesi>_<status>_<waktu>` — dan
  dihitung SEKALI saat masuk antrean lalu disimpan, supaya percobaan ulang
  memakai nilai yang sama persis. `session.status` disangat dengan waktu karena
  transisi ke status yang sama bisa terjadi berkali-kali dan tiap kejadian itu
  berita tersendiri.
- **`X-WA-Retry-Count`** pada setiap kiriman, berisi percobaan ke berapa
  (`0` = pertama). Penerima bisa memakainya untuk observability tanpa menebak
  dari isi payload.
- **Batas jumlah webhook per akun** (`WEBHOOK_MAX_PER_USER`, default 16, `0`
  mematikan). Satu event masuk dipancarkan ke setiap webhook yang cocok, jadi
  jumlah yang tidak dibatasi melipatgandakan salinan payload, koneksi keluar,
  dan baris antrean per event. Hanya pendaftaran baru yang ditolak; webhook yang
  sudah ada tidak disentuh.
- **Panel: penampil body pengiriman.** Tombol `payload` di riwayat membuka body
  yang benar-benar dikirim, beserta `X-WA-Idempotency-Key`-nya. Payload sudah
  tersimpan di baris antrean, jadi tidak ada request tambahan. Sebelumnya
  "HTTP 500" hanya memberi tahu bahwa penerima menolak, bukan apa yang ditolak.

### Changed

- **Header Chatbot dan Webhook disamakan dengan halaman Playground dan API
  Logs.** Sebelumnya header di kedua halaman itu telanjang: judul `text-lg
  font-semibold` tanpa kartu, keterangan `text-sm`, dan tombol `h-9 text-sm`.
  Sekarang memakai pola yang sama dengan halaman lain di panel: satu kartu
  `bg-surface border border-line rounded-md p-4 sm:p-5`, ikon dalam kotak
  40x40 `bg-pine-wash`, judul `text-base font-bold`, keterangan `text-xs
  text-ink-muted`, dan tombol `px-3.5 py-2 text-xs font-semibold`. Diukur di
  browser: padding, radius, border, gap, ukuran ikon, ukuran dan bobot judul,
  ukuran dan warna keterangan, serta padding/ukuran/bobot tombol kini identik
  dengan halaman API Logs.
- **Sub-tab Chatbot dan Webhook memakai gaya sub-tab Monitor** (`px-4 py-2
  text-xs font-semibold`, aktif `bg-pine text-surface`), bukan gaya tab
  tersendiri.
- **Header tidak lagi meluber di lebar 640-1024px.** Judul dan keterangan
  mendapat `min-w-0` supaya bisa menyusut, dan grup tombol aksi memakai
  `flex-wrap`. Sebelumnya pada 753px tombol "Tambah aturan" terdorong keluar
  kartu.

- **Halaman Webhook dipecah menjadi dua tab: Endpoint dan Riwayat pengiriman.**
  Polanya mengikuti sub-tab di halaman Monitor. Daftar dan riwayat menjawab
  pertanyaan berbeda ("endpoint mana yang aktif" vs "kenapa kiriman ini gagal"),
  dan menyatukannya membuat satu halaman berisi dua tabel yang saling mendorong
  ke bawah. Tab Riwayat punya dropdown pemilih webhook; tombol Riwayat di kartu
  endpoint langsung membuka tab itu dengan webhook tersebut terpilih.
- **Riwayat pengiriman kembali memakai tabel**, bukan kartu. Tabelnya memakai
  `min-w-[720px]` di dalam `overflow-x-auto`, pola yang sama dengan tabel
  Delivery Queue di halaman Monitor: tabel menggeser di dalam kartunya sendiri,
  halaman tidak ikut menggeser. Kolom Waktu diletakkan paling kiri karena itu
  yang dicari lebih dulu saat menelusuri kegagalan.
- **Kartu endpoint webhook ditata ulang untuk layar sempit.** Isi kartu (badge
  status, URL, tag event, meta secret) tampil lebih dulu, lalu enam tombol aksi
  di baris sendiri di bawahnya; di `sm` ke atas aksi kembali ke kanan. Tombol
  Uji dan Riwayat menjadi ikon saja di bawah `sm` (dengan `aria-label`), supaya
  keenam aksi muat dalam satu baris 44px di kartu 336px. URL memakai
  `break-all` agar tidak memaksa satu kata per baris.
- **Halaman Chatbot dan Webhook kini punya layout mobile sendiri, bukan versi
  desktop yang diperkecil.** Tiga hal yang berubah:
  - **Percakapan chatbot** memakai pola master-detail di bawah `lg`: daftar
    ATAU jendela chat, tidak keduanya. Sebelumnya keduanya ditumpuk sehingga
    halaman setinggi ~120vh dan daftar harus digulir setiap kali membuka satu
    percakapan.
  - **Bar tab chatbot** membungkus menjadi dua baris di layar sempit, bukan
    meluber. Keempat tab tetap terlihat tanpa perlu digeser.
  - **Grup tombol aksi** pada kartu tidak lagi memaksa satu baris dengan
    `shrink-0`; isi kartu dan aksinya ditumpuk di layar sempit.
- **Target sentuh 44px di halaman Chatbot dan Webhook** lewat aturan
  `.wa-page` di `index.css`, hanya berlaku di bawah 1024px. Tombol di kedua
  halaman memakai `h-9` (36px), yang cukup untuk kursor tetapi tidak untuk
  jempol. Input, select, dan baris checkbox ikut dinaikkan; checkbox dan radio
  sendiri tidak.
- **Modal memakai `100dvh`, bukan `100vh`.** Di browser mobile `100vh` termasuk
  chrome browser, sehingga footer modal bisa terdorong keluar layar.
- **Em dash di teks yang tampil diganti** titik dua, titik, atau tanda kurung
  pada kedua halaman (toast, judul riwayat, label hint, placeholder sel kosong).
  Komentar kode tidak diubah.
- **Pencocokan teks dipindah ke `matcher.ts`** dan dipakai bersama oleh aturan
  chatbot serta filter webhook. Sebelumnya logikanya hanya ada di `chatbot.ts`;
  menyalinnya ke webhook akan membuat dua arti "cocok" yang perlahan berbeda —
  dan perbedaannya baru terlihat saat ada pesan nyata yang tidak diteruskan,
  jauh setelah konfigurasi disimpan.
- **`webhooks.match_type`/`match_value` bisa dilepas lewat `PATCH` dengan
  `matchType: null`**. `matchValue` ikut dihapus agar tidak tersisa nilai yatim
  yang menyala lagi begitu tipe dipasang.
- **Regex pada filter webhook divalidasi saat disimpan.** Regex yang salah tulis
  membuat filter tidak pernah cocok, dan bagi penerima itu tampak sama dengan
  "belum ada pesan" — bukan "aturan saya rusak".
- **Secret webhook minimal 16 karakter** (sebelumnya 8). HMAC dihitung atas isi
  yang diketahui penyerang, jadi secret pendek bisa ditebak dengan brute-force
  dan tebakan yang benar langsung menghasilkan tanda tangan yang sah. Batas ini
  hanya berlaku untuk secret yang dikirim klien; secret hasil generate server
  sudah 48 karakter.
- **URL webhook menolak kredensial tertanam** (`https://user:pass@host/…`) dan
  panjang di atas 2048 karakter. Kredensial di URL tidak pernah dipakai pengirim,
  tetapi tersimpan di database dan ikut tampil di panel serta riwayat.

### Fixed

- **Body pengiriman webhook tidak lagi disimpan sebulan penuh.**
  `webhook_deliveries.payload` memuat isi pesan pelanggan, dan sebelumnya baru
  hilang saat barisnya dipangkas 30 hari kemudian — termasuk untuk pengiriman
  yang sudah sukses, yang nilainya hanya berguna untuk menelusuri masalah dalam
  hitungan jam. Sekarang body dikosongkan setelah
  `WEBHOOK_PAYLOAD_RETENTION_HOURS` jam (default 24) untuk baris yang sudah
  selesai; barisnya tetap ada sebagai jejak audit. Baris `pending` tidak
  disentuh karena body-nya masih dibutuhkan worker. Pembersihan berjalan tiap
  jam, bukan menumpang pembersih harian, supaya jendela 24 jam tidak melebar
  jadi 48 jam. `0` mematikan pembersihan.
- **`POST /webhooks/deliveries/:id/retry` membalas `409` untuk body yang sudah
  dibersihkan**, bukan `404`. Sebelumnya baris seperti itu akan "berhasil"
  diantrekan dan mengirim string kosong ke penerima. Panel kini menyembunyikan
  tombol `ulangi` untuk baris tersebut dan menampilkan `body dibersihkan`.
- **CHANGELOG: 894 baris diawali nomor baris ganda** (`1|1|# Changelog`) yang
  ikut tertulis ke dalam berkas. Awalan itu dibersihkan; isinya tidak berubah.
  Lima baris tabel pada bagian audit juga jadi utuh kembali sebagai tabel.
- `secret` webhook tidak lagi dikembalikan mentah pada setiap pembacaan; hanya
  ditampilkan sekali saat dibuat, setelah itu disamarkan.
- `events` webhook divalidasi terhadap event yang benar-benar dipancarkan.
  Sebelumnya string apa pun diterima, termasuk langganan yang tidak akan pernah
  terkirim.
- `deliveryId` pada payload dan header `X-WA-Delivery` kini sama. Sebelumnya
  dibuat dua kali, sehingga penerima tidak punya kunci tunggal untuk dedupe.
- `message.status` hanya dipancarkan saat status benar-benar berubah. `pacing`
  dipanggil berkali-kali untuk satu pesan; tanpa syarat ini penerima dibanjiri
  kabar yang isinya sama.
- Alur chatbot yang dinonaktifkan di tengah percakapan kini berhenti, bukan
  melanjutkan memakai aturan yang sudah tidak dipakai.
- `X-WA-Delivery` pada endpoint uji kini sama dengan `deliveryId` di body-nya.
  Sebelumnya dibuat dua kali, sehingga payload uji tidak bisa dicocokkan dengan
  header-nya oleh penerima yang melakukan dedupe.
- Catatan pada `POST /webhooks/:id/rotate-secret` menyatakan kiriman pending
  memakai tanda tangan lama sampai dicoba ulang. Itu keliru: secret tidak pernah
  disimpan di baris antrean, `kirimSatu` membacanya ulang dari database setiap
  percobaan, sehingga kiriman pending langsung memakai secret baru.

### Catatan

- `userId` ikut dikirim pada payload `message.received`. Tanpa itu penerima
  harus menebak pemilik pesan dari sesi, dan hasilnya `unmapped` untuk pesan di
  luar kampanye — yaitu hampir semuanya.
- URL webhook boleh menunjuk alamat privat (dashboard biasanya di jaringan yang
  sama), tetapi alamat metadata cloud ditolak.

### Fixed (lanjutan) — 429 saat membuka tab Chatbot & Webhooks

`App.tsx` mengirim `showToast` sebagai arrow inline di JSX, sehingga identitas
prop itu berubah pada setiap render App. Halaman yang memakainya di dalam
`useCallback` lalu menganggapnya berubah, effect-nya jalan lagi, dan karena
pemuat data memanggil `showToast` di jalur galat, siklusnya menutup:
gagal -> toast -> render App -> prop baru -> effect jalan lagi. Backend
membatasi 240 permintaan/menit per IP, jadi batas itu habis dalam hitungan detik
dan halaman menampilkan 429.

- `App.tsx` kini punya satu callback stabil `notify` yang dipakai bersama oleh
  `ApiLogsPage`, `ChatbotPage`, `WebhooksPage`, dan `UsersPage`.
- `ChatbotPage`, `WebhooksPage`, `ApiLogsPage`, dan `AdminCommandCenter`
  menyimpan `showToast` di ref dan mengeluarkannya dari daftar dependensi, jadi
  tetap aman walau induk mengirim fungsi baru.
- `ChatbotPage`: `ujiSession` dikeluarkan dari dependensi pemuat data (nilainya
  hanya untuk pilihan awal, dan memasukkannya memicu pemuatan ulang daftar).

Bukti: uji render React 19 + jsdom dengan API yang selalu gagal — pola lama
menghasilkan 301 permintaan, pola baru 1 permintaan. Di server nyata, 20 kali
membuka tab Chatbot + 20 kali tab Webhooks = 60 permintaan, tanpa 429.

### Verifikasi

- Normalizer: 10 kasus (teks, extended, fromMe, append, status, grup, media,
  ephemeral, reaction, device suffix) — semua sesuai harapan.
- Webhook: tanda tangan valid diterima penerima uji; 404 dianggap permanen
  (menyerah), koneksi ditolak dicoba ulang dengan backoff; `deliveryId` payload
  sama dengan header.
- Chatbot: 20 kasus (opt-out, empat tipe pencocokan, alur bertingkat, jawaban
  tak dikenal, alur nonaktif) — semua lulus.
- End-to-end: pesan masuk di wa-api -> tersimpan di inbox -> event terkirim ->
  tersimpan di dashboard dengan `user_id` benar; `message.status` memperbarui
  hitungan kampanye dan idempoten saat dikirim ulang.
- `tsc` bersih (backend & panel), build backend/panel/dashboard bersih.

### Added — edit aturan, modal, bubble chat, dan typing

- **Edit aturan chatbot.** Sebelumnya hanya bisa tambah/hapus/aktif-nonaktif;
  mengubah balasan berarti menghapus lalu membuat ulang, yang ikut memutus
  percakapan yang sedang berjalan di aturan itu. Endpoint `PATCH` sudah ada
  tetapi tidak punya UI. Kini tombol pensil membuka formulir yang sama dengan
  "Tambah", terisi nilai lama.
- **Edit webhook.** Sama: `PATCH /webhooks/:id` sudah menerima URL, event, dan
  cakupan, tetapi panel tidak pernah memakainya — mengganti URL berarti
  mendaftar ulang dan kehilangan riwayat pengiriman.
- **Komponen `Modal` dan `ConfirmDialog` bersama** (`components/ui/Modal.tsx`).
  Sebelumnya setiap halaman menulis sendiri lapisan `fixed inset-0` dengan
  perilaku berbeda: ada yang bisa ditutup dengan Escape, ada yang tidak; ada
  yang mengunci scroll latar, ada yang tidak. Sekarang satu implementasi:
  Escape menutup (kecuali sedang menyimpan), klik latar menutup, scroll latar
  dikunci, fokus berpindah ke modal lalu kembali ke pemicunya.
- **`window.confirm` diganti `ConfirmDialog`** di Chatbot dan Webhooks. Kotak
  bawaan browser memblokir seluruh utas sehingga spinner tombol berhenti
  berputar, tidak bisa menjelaskan apa yang akan hilang, dan tidak mengikuti
  bahasa visual panel.
- **Tab Percakapan berbentuk bubble chat.** Sebelumnya hanya daftar kartu tanpa
  isi percakapan. Sekarang dua panel: daftar percakapan (cari nomor/nama,
  pesan terakhir, jumlah pesan) dan jendela riwayat dengan bubble, pemisah
  tanggal, serta jam per pesan. Riwayat diambil dari
  `GET /inbound/conversation`.
- **Sinyal "sedang mengetik" pada jalur prioritas tinggi.** Jalur ini dipakai
  balasan chatbot dan balasan manual operator. Sebelumnya ia hanya diam 1 detik
  lalu mengirim, sehingga balasan muncul tiba-tiba. Sekarang
  `computeTypingPlan()` dipakai — durasi mengikuti panjang balasan, dibatasi 8
  detik. Rencana presence yang sama sudah dipakai jalur blast, jadi tidak ada
  dua perilaku berbeda.
- **Dokumentasi Chatbot & Webhook di panel.** Bagian `webhooks` hanya memuat 2
  endpoint dan contoh responsnya sudah tidak sesuai (tidak ada `secret`).
  Sekarang 7 endpoint webhook (termasuk `rotate-secret` dan `deliveries`) dan 8
  endpoint chatbot, masing-masing dengan catatan verifikasi tanda tangan,
  cakupan sesi/jenis chat, dan urutan pemeriksaan aturan.

### Verifikasi (tambah/edit)

- `PATCH /chatbot/flows/:id` parsial: mengirim `{"enabled":false}` saja tidak
  menghapus `name`, `replyText`, maupun `matchValue`. Mengirim
  `{"sessionId":null}` mengosongkan cakupan sesi tanpa menyentuh field lain.
- `PATCH /webhooks/:id` mengubah URL, event, dan `chatTypes` sekaligus; secret
  tetap sama (rotasi hanya lewat endpoint khusus).
- `computeTypingPlan()` diuji pada panjang pesan 3–1200 karakter: durasi naik
  mengikuti panjang, lalu dipotong tepat 8000 ms. Dari 200 sampel acak, tidak
  ada satu pun yang melewati batas.
- Riwayat percakapan dari data nyata: `GET /inbound/conversations` menampilkan
  2 percakapan, dan `GET /inbound/conversation` mengembalikan 5 pesan untuk
  salah satunya — dengan `fromPhone` sudah berupa nomor asli meski
  `fromJid`-nya `@lid`.
- Kelas CSS baru (`wa-modal-pop`, `wa-bubble-in/out`, `wa-chat-scroll`)
  terkonfirmasi ada di bundel hasil build; `wa-typing-dot` yang sempat
  ditambahkan tetapi tidak dipakai sudah dihapus.
- `tsc` bersih (backend & panel), build backend & panel bersih.


### Fixed — audit lanjutan (404 palsu, cakupan webhook, dan toast)

**404 pada `/chatbot/flows` dan `/webhooks/:id/test` bukan bug kode.** Proses
`node dist/server.js` yang berjalan sudah hidup sejak 3 November, sebelum rute
itu ada. Berkas `dist/` sudah diperbarui tetapi prosesnya belum dimuat ulang,
jadi Fastify melayani rute versi lama. Setelah restart, semua endpoint menjawab
(401 tanpa kunci, 200 dengan kunci).

Yang benar-benar salah:

- **Toast tidak sesuai template.** `App.tsx` memakai kelas `.wa-alert`, yang
  menetapkan `width: 100%` untuk peringatan selebar kolom di dalam halaman. Pada
  elemen `fixed` hasilnya selebar layar, bukan sekotak kecil di pojok. Komponen
  `Toast.tsx` yang sudah ada di repo ternyata tidak pernah dipakai, dan kelas
  `animate-in` di dalamnya tidak berefek karena plugin `tailwindcss-animate`
  tidak terpasang. Sekarang `App.tsx` memakai `Toast.tsx`, dengan kelas baru
  `.wa-toast` (lebar mengikuti isi, maksimum 22rem) dan keyframe sendiri.
  Varian `info` juga tidak lagi dipaksa menjadi `success` hijau.
- **Webhook tidak bisa dibatasi per sesi maupun per jenis chat.** Satu webhook
  menerima semua pesan dari semua nomor milik akun. Untuk operasi dengan
  beberapa nomor, dashboard nomor A ikut menerima pesan nomor B. Ditambahkan
  kolom `session_id` dan `chat_types` pada `webhooks`, penyaringan di
  `listActiveWebhooksForEvent()`, serta pemilih sesi + jenis chat di panel.
  Webhook lama di-backfill ke `["private"]`.
- **Sesi fiktif diterima sebagai cakupan.** `tolakSesi()` meloloskan admin untuk
  sesi apa pun. Akibatnya webhook/aturan chatbot bisa disimpan dengan
  `sessionId` yang tidak ada — konfigurasi yang tidak akan pernah menyala, dan
  kesalahannya baru terlihat berhari-hari kemudian. Ditambahkan pemeriksaan
  keberadaan sesi (404) di webhook maupun chatbot.
- **`session.status` tidak pernah dipancarkan.** Event ini terdaftar, bisa
  dilanggan di panel, dan lolos validasi — tetapi tidak ada satu pun pemanggil
  `pancarkanEvent('session.status', ...)`. Pelanggannya menunggu event yang
  tidak akan datang. Ditambahkan `onSessionStatusCallback` di engine (dipanggil
  saat `open` dan `close`) dan handler `session.status` di dashboard.
- **`session.status` membanjiri antrean.** Setelah dipasang, terlihat sesi
  nyata naik-turun tiap ~2 detik pada jaringan buruk: 350 baris antrean dalam 4
  menit. Emisi sekarang di-debounce — status terakhir disimpan dan jeda minimum
  30 detik diberlakukan, sehingga hanya perubahan yang bertahan yang dikirim.
- **Secret tidak muncul untuk webhook lama.** Secret hanya dikembalikan sekali
  saat dibuat; webhook yang didaftarkan sebelum perilaku itu ada tidak punya
  salinan di mana pun, dan panel hanya menampilkan `whse••••ef53`. Menghapus
  lalu mendaftar ulang akan menghapus riwayat pengiriman. Ditambahkan
  `POST /webhooks/:id/rotate-secret` + tombol **Secret** di panel.
- **Nama sesi tidak terbaca.** Panel menampilkan id mentah (`sess-mu7l7bol`) di
  daftar aturan, percakapan, dan opt-out. Sekarang memakai nama nomor + status
  koneksi.
- **Inbox dashboard tidak bisa dipisah per sesi.** `GET /api/crm/inbox` selalu
  mengembalikan semua sesi. Ditambahkan filter `sessionId`, daftar sesi yang
  benar-benar punya pesan masuk, dan pemilih sesi di halaman Inbox.

### Verifikasi (audit lanjutan)

- Penyaringan cakupan diuji terhadap data nyata: hook yang dibatasi ke satu sesi
  hanya muncul untuk sesi itu; hook `chatTypes: ["private","group"]` muncul untuk
  keduanya, sedangkan hook `["private"]` tidak muncul untuk pesan grup.
- `session.status` end-to-end: event terkirim ke penerima uji dengan
  `sigValid=true` (HMAC terverifikasi), lalu dihapus.
- Inbox dashboard: dua sesi dengan pesan berbeda -> "Semua sesi" mengembalikan
  dua percakapan, filter per sesi mengembalikan satu, dan daftar sesi tetap
  lengkap agar pemilih tidak menyusut setelah dipilih.
- Rotasi secret, penolakan sesi fiktif (404), dan penolakan `chatTypes` asing
  (400) diuji lewat HTTP.
- Semua endpoint baru diuji dengan kunci nyata: `chatbot/flows`,
  `chatbot/sessions`, `chatbot/optouts`, `webhooks`, `inbound` -> 200.
- `tsc` bersih, build backend & panel bersih, `php -l` bersih.

### Fixed — LID diperlakukan sebagai nomor telepon

Ditemukan dari lalu lintas nyata saat audit, bukan dari uji sintetis. Satu pesan
masuk dari `14396814266545@lid` tersimpan dengan `from_phone = "14396814266545"`,
lalu chatbot membalas ke angka itu dan WhatsApp menjawab `not_registered`.

Tiga cacat yang saling menutupi:

1. **`phoneFromJid()` tidak mengenal `@lid`.** JID `@g.us`, `@broadcast`, dan
   `@newsletter` ditolak, tetapi `@lid` lolos dan digitnya dianggap nomor
   telepon. Angka itu id internal WhatsApp, bukan nomor yang bisa dikirimi
   pesan.
2. **`LidResolver` tidak pernah dipakai jalur inbox.** Resolver lengkap sudah
   ada (`lid-resolver.ts`) beserta tabel `lid_mappings` berisi 9 pemetaan yang
   benar — termasuk `14396814266545@lid -> 6282242168002` — tetapi `inbound.ts`
   tidak pernah menanyakannya.
3. **`learnLidFromMessageKey()` tidak pernah dipanggil.** Fungsi itu ada di
   `session-manager.ts` dan mengekstrak pasangan LID<->nomor dari
   `remoteJid`/`remoteJidAlt` tiap pesan — sumber pemetaan paling sering — tetapi
   tidak ada satu pun pemanggil, sehingga resolver hanya terisi dari metadata
   grup.

Perbaikan:

- `phoneFromJid()` mengembalikan `null` untuk `@lid`.
- `normalizeInbound()` menerima penyelesai LID dan menentukan nomor berurutan:
  JID itu sendiri -> `remoteJidAlt` -> pemetaan tersimpan -> `null`. Urutan ini
  memakai data yang paling langsung tersedia lebih dulu.
- `setPenyelesaiLid()` menyuntikkan `manager.getLidResolver().getPn()` ke jalur
  inbox, memakai resolver yang sama dengan jalur kirim supaya percakapan satu
  orang tidak terpecah dua kontak.
- `learnLidFromMessageKey()` kini dipanggil untuk setiap pesan masuk, sebelum
  normalisasi, sehingga pemetaan baru terkumpul dari lalu lintas biasa.
- Pengirim yang LID-nya belum diketahui menghasilkan `fromPhone = null`.
  Chatbot memang sudah berhenti untuk kasus itu — lebih baik diam daripada
  mengirim ke alamat yang tidak ada.
- Tiga baris lama di `inbound_messages` diperbaiki lewat `UPDATE` yang
  memetakan `from_jid` ke `lid_mappings.phone` (aman: index unik ada di
  `(session_id, wa_message_id)`, bukan di nomor).

Verifikasi: `LidResolver` di-hydrate dari tabel sungguhan (9 mapping) lalu
`normalizeInbound` dipanggil dengan key `@lid` — hasilnya
`fromPhone = 6283846612629`, sesuai pemetaan. LID tanpa pemetaan menghasilkan
`null`. `GET /inbound/conversations` kini menampilkan `6282242168002`, bukan
`14396814266545`.

---



## [Unreleased] — alamat API tidak lagi tertanam ke port dev

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

Langkah 1 dari `docs/rancangan-menu-mcp.md`. Data audit sudah tersimpan sejak
`f32f814` dan `8d8ce74`, tetapi `ApiLogItem` tidak punya keenam field-nya —
sehingga tidak ada satu tempat pun di panel yang bisa membacanya.

### Added

- `ApiLogItem` + `actor`, `targetType`, `targetId`, `params`, `paramsBefore`,
  `audit`; dua kolom baru di tabel: **Agen** dan **Perubahan**.
- `panel/src/lib/perubahanAudit.ts` — formatter "nilai lama → nilai baru",
  dipisah dari komponen karena di sinilah letak keputusan yang menentukan
  benar-tidaknya pembacaan, bukan urusan tata letak.

### Aturan tampilan yang ditetapkan

- **`params_before` NULL berarti "nilai lama tidak dicatat untuk aksi ini"**,
  bukan "tidak ada perubahan". Baris tampil `preset: → broadcast` dengan catatan
  kecil, bukan `—`. Dua keadaan ini dibedakan karena menyamakannya membuat
  pembaca menyimpulkan kebalikan dari yang terjadi.
- **Nilai lama ada, nilai baru kosong** tampil `preset: strict → ∅` — bukan `—`.
- **Baris `403`/`429` tetap tampil** dengan `—`: permintaan ditolak sebelum
  handler berjalan, jadi memang belum melakukan apa pun.
- **Perubahan menjadi preset `broadcast` ditandai bahaya**, karena pada preset
  itu `contactGraph` dan `replyRatio` tidak berjalan — "allow" di sana berarti
  "dimatikan", bukan "diperiksa dan aman".
- **`params` diberi keterangan "nilai tersaring"**; tidak ada tombol "lihat nilai
  asli", karena nilai aslinya memang tidak disimpan.
- **Tombol hapus & checkbox disembunyikan untuk baris audit non-admin**, diganti
  ikon kunci. Menampilkan tombol yang pasti gagal lebih buruk daripada tidak
  menampilkannya, dan mencentangnya membuat "hapus 5" menghasilkan "3 dihapus"
  tanpa penjelasan. `select-all` ikut melewati baris terkunci.
- Teks modal pembersihan diperbaiki: sebelumnya menjanjikan seluruh log terhapus,
  padahal untuk non-admin baris audit tidak ikut — dan retensi otomatis sudah
  berjalan di server, jadi pembersihan manual bukan lagi retensi rutin.

### Catatan pengujian

`uji-perubahan-audit-panel.mjs` — 25 asersi, **plus pembanding mutasi**. Tiga
mutasi sengaja dijalankan:

| Mutasi | Hasil |
|---|---|
| hapus catatan "nilai lama tidak dicatat" | tertangkap (21/25) |
| tanda bahaya `broadcast` dimatikan | tertangkap (19/25) |
| `if (!baru && !lama)` → `if (!baru)` | **LOLOS 22/22 pada percobaan pertama** |

Mutasi ketiga membongkar lubang nyata di uji saya: tidak ada kasus "nilai lama
ada, nilai baru kosong", padahal formatter punya cabangnya dan baris seperti itu
nyata (DELETE dengan body kosong). Setelah kasus itu ditambahkan, mutasinya
tertangkap (23/25).

`uji-e2e-kolom-audit.sh` — 15 asersi lewat HTTP pada server sungguhan. Uji unit
membuktikan formatter benar untuk input yang saya karang sendiri; uji ini
membuktikan server benar-benar **mengirim** kolomnya. Tanpa itu, satu salah tulis
nama kolom di `listApiLogs` akan lolos semua uji unit dan tabelnya tetap kosong.
Termasuk: nomor telepon di `params` tidak terkirim mentah ke panel.

Uji ini sendiri sempat salah lapor: blok node mencetak `OK` untuk 12 asersi
tetapi bash hanya menghitung 2, sehingga ringkasannya berbunyi "2 lulus". Sudah
diperbaiki agar bash yang menghitung, bukan node yang mencetak.

Regresi: celah-audit 11/11, api-logs-audit 11/11, tenant 32/32, qr-jwt 4/4,
audit-params 64/64, decision-log 39/39, integrasi 22/22, normalisasi 28/28,
uji-mcp 37/37; `tsc` panel 0 error; build panel OK.

---

## [Unreleased] — rancangan menu MCP di panel

`docs/rancangan-menu-mcp.md` — rancangan, belum ada kode.

Temuan yang mengubah bentuknya: **`ApiLogsPage.tsx` belum menampilkan satu pun
kolom audit.** Server sudah menyimpan `actor`, `target_type`, `target_id`,
`params`, `params_before`, dan `audit` sejak `f32f814` dan `8d8ce74`, tetapi
`ApiLogItem` tidak punya keenam field itu dan tabelnya hanya menampilkan method,
endpoint, status, latency, IP, user, dan waktu. Jadi menu MCP terutama membuka
data yang sudah ada, bukan menampilkan data baru.

Tiga hal yang sengaja tidak dirancang, karena akan menjadi kontrol yang tidak
mengontrol apa pun:

- **Registrasi klien MCP dari panel.** MCP dikonfigurasi di komputer pengguna,
  bukan di server; panel tidak punya cara "mendaftarkan" klien.
- **Tombol "nonaktifkan MCP".** Tidak ada konsep scope per kunci — API key =
  seluruh hak pemiliknya. Tombol itu akan berbohong.
- **Pembatasan tool per agen.** Daftar putih saat ini hidup di proses MCP, bukan
  di wa-api; panel yang menampilkan centang tool tidak menegakkan apa pun.

Satu koreksi faktual terhadap draf pertama: index untuk query aktivitas **sudah
ada** (`idx_api_logs_actor_time`, partial pada `actor IS NOT NULL`), jadi tidak
perlu index baru — dan filter `actor IS NOT NULL` harus ditulis apa adanya, sebab
`COALESCE(actor,'')` akan mematikan pemakaian index parsial itu.

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