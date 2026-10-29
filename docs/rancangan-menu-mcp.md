# Rancangan: Menu MCP pada panel wa-api

Status: **sebagian selesai, bentuk akhirnya berubah.** Rancangan ini ditulis
sebelum langkah 1 dikerjakan; setelah langkah 1 selesai, keputusan "satu tab MCP"
pada bagian 2 dibatalkan — lihat bagian 7.
Prasyarat yang sudah selesai: isolasi tenant (`972ed10`), kolom audit + filter GET
selektif (`f32f814`), tiga celah bukti audit (`8d8ce74`), server MCP 12 tool
(`b75c9fd`).

---

## 1. Masalah yang sebenarnya

Permintaan awal berbunyi "buatkan rancangan menu untuk frontend MCP". Kalau
dibaca sebagai "tambah satu tab berisi daftar tool", hasilnya akan menjadi halaman
dokumentasi yang tidak menjawab pertanyaan siapa pun. Tiga hal yang saya temukan
saat memeriksa kode mengubah bentuk rancangannya:

**1.1 Panel belum punya menu MCP sama sekali — dan itu bukan kekurangan yang
paling mendesak.**

`App.tsx` punya tujuh tab: Playground, Monitor & Queue, Sessions, API Logs, Docs,
Users, Settings. Tidak ada satu pun yang menyebut MCP. Tetapi masalah pertama
bukan ketiadaan tab itu.

**1.2 Data audit sudah tersimpan tetapi tidak terlihat.**

`GET /api/v1/api-logs` mengembalikan `actor`, `target_type`, `target_id`,
`params`, `params_before`, dan `audit`. `ApiLogsPage.tsx` mendefinisikan
`ApiLogItem` **tanpa** keenam field itu, dan tabelnya hanya menampilkan Method,
Endpoint, Status, Latency, IP, User, Waktu. Artinya: sejak `f32f814` dan
`8d8ce74`, server mencatat siapa agennya, apa yang disentuh, nilai sebelum dan
sesudah — dan tidak ada satu tempat pun di panel yang bisa membacanya.

Jadi menu MCP bukan halaman baru yang menampilkan data baru. Ia terutama
**membuka data yang sudah ada**.

**1.3 Pendaftaran klien MCP terjadi di luar panel, dan itu disengaja.**

MCP dijalankan sebagai proses terpisah dengan `WA_API_KEY`, `WA_API_BASE_URL`,
`WA_MCP_ACTOR` sebagai variabel lingkungan. Panel tidak bisa "mendaftarkan" klien
MCP, karena pendaftaran itu terjadi di berkas konfigurasi klien (Claude Desktop,
Cursor, dan sejenisnya) di komputer pengguna — bukan di server.

Konsekuensinya rancangan ini **tidak** membuat form "tambah klien MCP". Yang bisa
dilakukan panel adalah hal yang benar-benar miliknya: menerbitkan kunci,
menunjukkan cara memasang, dan **menampilkan apa yang dilakukan agen itu**.

---

## 2. Keputusan bentuk: satu tab, tiga lapis

Menu baru: **MCP** (`TabId: 'mcp'`), di bawah API Logs pada grup navigasi inti.

```
Playground
Monitor & Queue
Sessions
API Logs
MCP                    <- baru
Docs
---
Users & API Keys       (admin)
System Settings        (admin)
```

Satu tab, tiga lapis isi, masing-masing menjawab satu pertanyaan:

| Lapis | Pertanyaan | Sumber data |
|---|---|---|
| **Aktivitas** | "Agen saya melakukan apa?" | `api_logs` where `actor is not null` |
| **Kunci** | "Agen mana yang punya akses, dan kapan terakhir dipakai?" | `users` + `api_logs` agregat |
| **Pemasangan** | "Bagaimana cara memasangnya?" | statis, dari `mcp/README.md` |

Alasan digabung satu tab, bukan tiga: ketiganya dipakai dalam satu alur kerja —
menerbitkan kunci, menempel konfigurasi, lalu memeriksa apakah agennya benar-benar
bekerja. Memisahkannya menjadi tiga menu berarti pengguna harus berpindah tab di
tengah satu tugas.

---

## 3. Lapis A — Aktivitas agen

### 3.1 Yang ditampilkan

Tabel, satu baris per panggilan yang membawa `X-MCP-Actor`:

| Kolom | Isi | Kenapa |
|---|---|---|
| Waktu | `created_at` (WIB) | urutan kejadian |
| Agen | `actor` | label yang dikirim klien |
| Aksi | `method` + `endpoint` yang dipadatkan | "apa yang dilakukan" |
| Sasaran | `target_type` / `target_id` | sesi mana |
| Perubahan | `params_before` → `params` | "dari apa ke apa" |
| Hasil | `status_code` + `duration_ms` | berhasil atau tidak |

Kolom **Perubahan** adalah alasan utama lapis ini ada. Baris seperti

```
wa_set_antiban_preset · sess-mu2512ti · preset: strict → broadcast · 200 · 84 ms
```

menjawab pertanyaan yang sebelumnya harus dijawab dengan membaca database
langsung. Tanpa `params_before`, baris yang sama hanya berbunyi "diubah menjadi
broadcast" — dan untuk aksi yang bisa dibalik, itu setengah jawaban.

### 3.2 Aturan tampilan yang menentukan benar-tidaknya pembacaan

**a. `params_before` kosong bukan berarti "tidak ada perubahan".**

Hanya handler yang membaca nilai lama yang mengisinya (sekarang baru
`PUT /sessions/:id/antiban`). Untuk endpoint lain kolomnya `NULL`. Menampilkan
`NULL` sebagai "—" akan membuat pembaca menyimpulkan tidak ada perubahan; yang
benar adalah **"nilai lama tidak dicatat untuk aksi ini"**. Dua keadaan ini harus
tampil berbeda:

```
preset: strict → broadcast      (nilai lama tercatat)
preset: → broadcast             (nilai lama tidak dicatat, bukan "kosong")
```

**b. `params` sudah tersaring — jangan menampilkan seolah utuh.**

Nomor telepon tersimpan sebagai `hash:…`, kredensial sebagai `[REDACTED]`, isi
panjang dipotong dengan penanda. Kolom Perubahan perlu keterangan kecil
"nilai tersaring" agar tidak dikira data mentah. Yang **tidak** boleh: menambah
tombol "lihat nilai asli", karena nilai aslinya memang tidak disimpan.

**c. Aksi yang ditolak tetap muncul, dan itu benar.**

Baris `403`/`429` dengan `params` kosong berarti permintaan ditolak sebelum
handler berjalan. Menyembunyikannya akan membuat percobaan yang gagal — justru
yang paling perlu dilihat saat mendiagnosis agen yang salah konfigurasi — hilang
dari layar.

**d. Preset `broadcast` diberi penanda bahaya.**

`wa_audit_antiban` sudah memperingatkan bahwa pada preset ini `contactGraph` dan
`replyRatio` tidak berjalan. Baris audit yang mengubah preset **menjadi**
`broadcast` harus membawa penanda yang sama di panel, supaya tidak terbaca sebagai
perubahan setting biasa. Ini kasus nyata: `sess-mu2512ti` memakai preset ini
ketika nomornya terblokir.

### 3.3 Yang TIDAK ditampilkan

- **Isi pesan.** `wa_list_messages` membaca pesan; menampilkannya di sini akan
  membuat panel menjadi salinan isi percakapan pengguna. Cukup jumlah dan
  endpointnya.
- **Tombstone "agen sedang online".** MCP tidak terhubung ke server; ia hanya
  memanggil HTTP saat dipakai. Tidak ada status yang bisa ditampilkan, dan
  mengarang indikator hijau adalah kebohongan yang paling mudah dihindari dengan
  tidak membuatnya.
- **Tombol hapus per baris.** Baris ber-`audit = 1` sudah tidak bisa dihapus
  non-admin (`8d8ce74`). Menampilkan tombol yang pasti gagal lebih buruk daripada
  tidak menampilkannya; hapus tetap tersedia lewat API Logs untuk admin.

---

## 4. Lapis B — Kunci & pemakaian

### 4.1 Isi

Daftar pemilik kunci yang pernah memakai MCP:

| Kolom | Isi |
|---|---|
| Pengguna | nama + email |
| Kunci | 8 karakter awal + `…` (bukan kunci penuh) |
| Panggilan 24 jam | jumlah baris `actor is not null` |
| Panggilan 7 hari | idem |
| Terakhir dipakai | `max(created_at)` |
| Agen terlihat | daftar `actor` berbeda |

Kolom **Agen terlihat** memanfaatkan sifat `X-MCP-Actor` yang jujur tentang
kelemahannya: header itu bisa dipalsukan (lihat `docs/rancangan-mcp-server.md`
8.2), jadi yang ditampilkan adalah "label yang pernah dikirim", **bukan** "klien
yang terverifikasi". Dua agen berbeda bisa jadi satu orang; satu agen bisa jadi
dua label. Panel harus mengatakan itu, bukan menyembunyikannya di balik tabel yang
terlihat pasti.

### 4.2 Tombol yang boleh ada

- **Terbitkan kunci baru** — memakai `apiRotateMyKey()` / `apiRotateApiKey(userId)`
  yang sudah ada. Konsekuensinya harus dinyatakan di dialog konfirmasi: kunci lama
  langsung berhenti bekerja, dan setiap klien MCP yang memakainya akan gagal
  sampai diperbarui.
- **Salin potongan konfigurasi** — menghasilkan blok JSON berisi
  `WA_API_BASE_URL` dan `WA_MCP_ACTOR` dengan kunci **disensor**, ditambah
  petunjuk menempelkan kunci asli. Kunci penuh tidak pernah ditampilkan ulang
  setelah dialog penerbitan ditutup — kalau ditampilkan, ia menjadi kebocoran yang
  menunggu screenshot.

### 4.3 Tombol yang TIDAK boleh ada

- **Cabut akses MCP tanpa mencabut kunci.** Tidak ada konsep scope per kunci di
  sistem ini (lihat `rancangan-mcp-server.md` 2.5): API key = seluruh hak
  pemiliknya. Tombol "nonaktifkan MCP" akan berbohong — MCP tetap bisa memanggil
  apa pun selama kuncinya berlaku. Yang benar: nonaktifkan **pengguna**, dan
  katakan bahwa itu mematikan API-nya juga.
- **Batasi tool per agen.** Belum ada penegakannya di server; daftar putih saat
  ini hidup di dalam proses MCP (`DAFTAR_TOOL_TULIS`), bukan di wa-api. Panel yang
  menampilkan centang-centang tool akan menjadi kontrol yang tidak mengontrol
  apa pun. Kalau ini dibutuhkan, penegakannya harus dibuat dulu di server —
  dan itu pekerjaan tersendiri, bukan bagian dari rancangan menu.

---

## 5. Lapis C — Pemasangan

Satu panel berisi:

1. Perintah build: `cd mcp && npm install && npm run build`.
2. Blok konfigurasi klien dengan placeholder, bukan kunci asli.
3. Daftar 12 tool, dipisah baca/tulis, dengan penanda bahwa lima tool tulis bisa
   dibalik.
4. Peringatan batas: `WA_MCP_ACTOR` adalah **label, bukan autentikasi**.

Isi lapis ini diambil dari `mcp/README.md` — tetapi **tidak** disalin mentah.
README menjelaskan cara kerja; panel menjelaskan cara memasang. Kalau keduanya
sama persis, salah satunya akan tertinggal saat yang lain berubah. Panel cukup
memuat bagian yang dibutuhkan pengguna dan menautkan README untuk sisanya.

---

## 6. Perubahan yang dibutuhkan

### 6.1 Backend — dua endpoint baru

**`GET /api/v1/mcp/activity`**

```
?page=1&limit=25&actor=<label>&status=all|error&userId=<id, admin saja>
```

Membaca `api_logs` dengan `actor IS NOT NULL`. Non-admin disaring ke
`user_id = dirinya` — aturan yang sama dengan `GET /api-logs`, memakai
`kepemilikan.ts` yang sudah ada agar tidak ada salinan aturan kedua.

**`GET /api/v1/mcp/usage`**

Agregat per pengguna: jumlah panggilan 24 jam / 7 hari, `max(created_at)`,
`group_concat(distinct actor)`. Non-admin hanya melihat barisnya sendiri.

Keduanya **baca saja**. Tidak ada endpoint MCP baru yang menulis — aksi tulis
tetap lewat tool MCP, supaya satu-satunya jalur perubahan yang tercatat sebagai
"dilakukan agen" adalah jalur agen.

> Catatan volume: `f32f814` sudah membuat `idx_api_logs_actor_time ON
> api_logs (actor, created_at DESC) WHERE actor IS NOT NULL` — partial index yang
> persis cocok dengan query ini, jadi **tidak perlu index baru**. Ini juga alasan
> filter `actor IS NOT NULL` harus ditulis apa adanya: kalau diganti
> `COALESCE(actor,'') <> ''` atau `actor != ''`, SQLite berhenti memakai index
> parsial itu dan query menjadi pemindaian penuh.

### 6.2 Panel — empat perubahan

| Berkas | Perubahan |
|---|---|
| `App.tsx` | `TabId` + entri `coreNavItems` + blok render |
| `api.ts` | `apiGetMcpActivity()`, `apiGetMcpUsage()` |
| `ApiLogsPage.tsx` | `ApiLogItem` + enam field; kolom Agen & Perubahan |
| `McpPage.tsx` | berkas baru: tiga lapis di atas |

`ApiLogsPage.tsx` **ikut berubah**, meski bukan bagian dari menu MCP. Alasannya:
tanpa perubahan itu, kolom `actor` hanya bisa dilihat di halaman MCP, sementara
pertanyaan "request ini datang dari agen atau dari orang" muncul persis saat
seseorang sedang membaca log. Menambahkannya di sana murah; membuat halaman
kedua yang menampilkan tabel yang sama mahal.

### 6.3 Yang tidak berubah

- Tidak ada tabel baru. Semua data berasal dari `api_logs` dan `users`.
- Tidak ada perubahan pada proses MCP.
- Tidak ada migrasi skema.

---

## 7. Urutan pengerjaan

1. ~~`ApiLogItem` + kolom Agen & Perubahan di `ApiLogsPage.tsx`.~~ **Selesai
   (`6ab53d0`).** Formatter dipisah ke `panel/src/lib/perubahanAudit.ts` agar
   bisa diuji; 25 asersi + pembanding mutasi, dan uji e2e 15 asersi yang
   membuktikan server benar-benar mengirim kolomnya.
2. ~~Lapis C — panduan pemasangan.~~ **Selesai, tetapi di tab Docs, bukan tab
   MCP** (section `04. MCP untuk Agen AI`). Distribusinya tetap dari checkout
   proyek ini — server MCP tidak diterbitkan ke npm — sehingga panduan memuat
   langkah build dan menunjuk `mcp/dist/index.js`.
3. Lapis B — kartu pemakaian kunci. **Rumahnya tab Users & API Keys**, bukan
   halaman baru; masih butuh `GET /api/v1/mcp/usage`.
4. Lapis A — **tidak dikerjakan sebagai halaman.** Tabelnya sudah ada di API
   Logs; yang belum ada hanya filter "hanya agen" di `ApiLogsPage.tsx`.
5. `GET /api/v1/mcp/activity` hanya diperlukan bila filter agen tidak cukup
   dikerjakan di endpoint `api-logs` yang sudah ada.

### Mengapa bentuknya berubah

Lapis A sudah punya rumah setelah langkah 1. Membuat tab MCP berarti menampilkan
tabel yang sama di dua tempat, dengan dua salinan aturan tampilan — termasuk
pembedaan "nilai lama tidak dicatat" vs "tidak ada perubahan" yang sudah diuji di
`perubahanAudit.ts`. Lapis C tidak butuh backend sama sekali, dan lapis B
menempel pada tempat kunci memang dikelola. Satu tab baru tidak menambah
kemampuan apa pun yang belum bisa dijangkau.

Langkah 1 sengaja lebih dulu: kalau setelah itu ternyata halaman terpisah tidak
dibutuhkan, langkah 3–4 bisa dipersempit tanpa membuang pekerjaan.

---

## 8. Cara memverifikasi (bukan asumsi)

Mengikuti kebiasaan yang sudah dipakai: uji harus bisa **gagal**.

1. **Uji isolasi.** Pengguna A dan B, masing-masing dengan agen sendiri. A
   memanggil MCP; B membuka halaman MCP → hanya melihat barisnya sendiri.
   Bandingkan dengan kode sebelum perubahan: harus muncul kebocoran.
2. **Uji `params_before` terlihat.** Ubah preset dua kali dengan actor; halaman
   harus menampilkan `strict → broadcast`, bukan `→ broadcast`. Mutasi: kosongkan
   `catatNilaiSebelum` → uji harus gagal.
3. **Uji pembedaan "tidak dicatat" vs "kosong".** Panggil endpoint tulis yang
   belum mengisi `params_before`; baris harus tampil sebagai "tidak dicatat",
   bukan "—".
4. **Uji baris ditolak tetap tampil.** Panggil dengan kunci tidak berhak → `403`;
   baris harus muncul di halaman.
5. **Uji kunci tersensor.** Respons `GET /mcp/usage` tidak boleh memuat kunci
   utuh, hanya 8 karakter awal.

---

## 9. Yang sengaja tidak dikerjakan

1. **Registrasi klien MCP dari panel.** Mustahil tanpa mengubah arsitektur: MCP
   dikonfigurasi di komputer pengguna, bukan di server. Yang bisa dilakukan panel
   adalah memberi kunci dan contoh konfigurasi.
2. **Indikator status agen.** Tidak ada koneksi persisten untuk dilaporkan.
3. **Pembatasan tool per agen.** Butuh penegakan di server lebih dulu.
4. **Penampil isi pesan.** Panel bukan tempat menyalin percakapan pengguna.
5. **Pembatas panggilan per agen** (gap 8.4 di rancangan MCP) — masih terbuka,
   dan sebaiknya diselesaikan di server sebelum halaman ini dipakai rutin.
   Halaman yang menampilkan "panggilan 24 jam" akan membuat batas yang tidak ada
   terlihat seolah ada.

---

## 10. Risiko

| Risiko | Akibat | Sikap |
|---|---|---|
| Panel menampilkan `actor` seolah terverifikasi | salah atribusi | beri label "label yang dikirim klien", bukan "klien" |
| Tombol "nonaktifkan MCP" dibuat | rasa aman palsu | jangan dibuat; jelaskan kenapa |
| `params` dibaca sebagai data mentah | salah paham isi | keterangan "nilai tersaring" |
| Halaman MCP jadi tempat mengubah setting | jalur audit ganda | halaman baca saja; aksi tetap lewat tool |
| Retensi 90 hari memotong riwayat yang sedang diselidiki | bukti hilang | sudah dapat dikonfigurasi di `retensi.ts`; sebutkan umur retensi di halaman |
