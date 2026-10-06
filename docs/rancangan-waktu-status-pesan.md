# Rancangan: Waktu per Perubahan Status Pesan

Status: **rancangan, belum diimplementasikan.**
Basis kode: `a053460`.

---

## 1. Masalah

Panel hanya menampilkan **satu** waktu untuk setiap pesan: waktu antrean dibuat.
Tidak ada informasi kapan pesan benar-benar dikirim, kapan sampai, dan kapan
dibaca. Akibatnya dua hal:

- Operator tidak bisa membedakan pesan yang baru masuk antrean dari pesan yang
  sudah lama menunggu jeda anti-ban, karena keduanya menampilkan waktu yang sama.
- Durasi nyata pengiriman tidak bisa diukur. Tidak ada cara menjawab "pesan ini
  butuh berapa lama dari antrean sampai dibaca".

### Kondisi sekarang, dengan bukti

| hal | keadaan | letak |
|---|---|---|
| Kolom waktu di tabel `messages` | hanya `created_at` | `backend/src/db/skema.ts:55` |
| Waktu yang dikirim ke panel | `p.timestamp = r.created_at` | `backend/src/db/pesan.ts:240` |
| Status disimpan di mana | kolom `status` **dan** `payload.status` | `backend/src/db/pesan.ts:63-73` |
| Titik perubahan status | 18 pemanggilan `updateMessageStatus()` | `session-manager.ts` (12), `engine/BaileysEngine.ts` (6) |
| Tampilan di panel | satu label "Waktu" | `UsersPage.tsx:1361` |

Catatan penting: waktu antrean saat ini **sudah** waktu nyata — diisi saat
`insertMessage()` dipanggil, bukan saat kampanye dibuat. Jadi yang hilang bukan
kebenaran waktu antrean, melainkan waktu untuk status-status **sesudahnya**.

---

## 2. Temuan yang menentukan bentuk rancangan

### 2.1 WhatsApp mengirim waktu asli, dan sekarang dibuang

Ini temuan utama. Baileys menyertakan timestamp asli peristiwa pada kedua event
yang membawa perubahan status, tetapi kode saat ini mengabaikannya:

- `messages.update` → `update.messageTimestamp` (epoch detik, dari `attrs.t`)
  — `backend/node_modules/@whiskeysockets/baileys/lib/Socket/messages-recv.js:1201`
- `message-receipt.update` → `receipt.receiptTimestamp` atau `receipt.readTimestamp`
  — baris 1188-1193 berkas yang sama

Artinya untuk `sent`, `delivered`, dan `read` kita **tidak perlu menebak** dari
jam server. Waktu asli tersedia dan tinggal dipakai.

### 2.2 `message-receipt.update` hanya untuk grup

Dari sumber library, event itu hanya di-emit bila
`isJidGroup(remoteJid) || isJidStatusBroadcast(remoteJid)`. Untuk chat pribadi,
receipt dikirim lewat `messages.update`.

Ini bertentangan dengan komentar di `BaileysEngine.ts:198-201` yang menyebut
event receipt sebagai "jalur yang paling andal" untuk `read`/`delivered`.
Untuk chat pribadi, jalur itu tidak akan pernah terpicu.

**Perlu diuji, belum saya buktikan dari trafik nyata.** Yang jelas: rancangan
ini harus membaca timestamp dari **kedua** jalur, supaya benar untuk grup
maupun chat pribadi.

### 2.3 `pacing` dipanggil berulang untuk pesan yang sama

Di `session-manager.ts` ada tiga pemanggilan `pacing` (baris 1165, 1191, 1197)
dalam satu siklus pengiriman, ditambah pengembalian pesan ke depan antrean lewat
`holdMessageAtFront()` saat batas blast tercapai. Bila pengembalian itu terjadi
setelah `pacing`, pesan akan dikirim ulang dan `pacing` terpicu lagi.

**Konsekuensi:** menulis waktu tanpa syarat akan menimpa waktu `pacing` pertama
dengan yang terakhir. Perlu aturan "tulis sekali".

### 2.4 Tidak ada riwayat, dan itu memang perlu

Saat ini `payload` adalah snapshot keadaan terakhir. Menyimpan waktu per status
di dalamnya berarti status yang sudah terlewat **tidak** punya waktu — misalnya
pesan yang langsung `read` tanpa pernah tercatat `delivered`.

Karena itu bentuk datanya harus **akumulatif**: setiap status menambah satu
entri, tidak pernah mengganti seluruh isi.

---

## 3. Rancangan

### 3.1 Keputusan penyimpanan: perluas `payload`, bukan tabel baru

**Dipilih:** tambah field `statusTimes` di dalam `payload` JSON.

**Alasan:**
- Sudah jadi pola berkas ini — `status`, `jitterDelayMs`, `errorDetail` semua di
  `payload`. Menambah satu field mengikuti pola yang ada.
- Tidak perlu join. `mapMessageRow()` hanya perlu satu baris tambahan.
- Tidak ada perubahan skema tabel dan tidak ada migrasi kolom.

**Opsi yang ditolak:**

| opsi | kenapa ditolak |
|---|---|
| Kolom terpisah (`queued_at`, `sent_at`, ...) | Perlu `ALTER TABLE` per status; status baru menuntut migrasi lagi. `ensureColumn()` bisa, tapi menambah kolom untuk data yang sifatnya daftar itu tidak tepat. |
| Tabel baru `message_events` | Paling benar secara model data, tapi berlebihan untuk volume sekarang (92 baris pesan di VM, 1,5 MB). Menambah tabel + indeks + query join + retensi tersendiri. Bisa ditinjau ulang bila nanti perlu riwayat lengkap dengan pelaku dan alasan. |

### 3.2 Bentuk data

```jsonc
"statusTimes": {
  "queued":    1780000000000,
  "pacing":    1780000012000,
  "sending":   1780000013500,
  "sent":      1780000014000,
  "delivered": 1780000020000,
  "read":      1780000031000
}
```

- Nilai: epoch milidetik (number), supaya konsisten dengan perhitungan durasi
  di panel dan tidak perlu parsing tanggal.
- Kunci: nama status, sama persis dengan yang sudah dipakai.
- Status terminal (`failed`, `cancelled`, `invalid_number`, `not_registered`)
  ikut dicatat. Berguna untuk menjawab "berapa lama menunggu sebelum gagal".
- Bentuknya objek, bukan array, supaya pencarian waktu satu status tidak perlu
  menelusuri daftar, dan supaya "tulis sekali" mudah diterapkan.

### 3.3 Sumber waktu per status

| status | sumber waktu | sifat |
|---|---|---|
| `queued` | jam server saat `insertMessage()` | waktu nyata antrean |
| `pacing` | jam server saat jeda dimulai | waktu nyata |
| `sending` | jam server sesaat sebelum panggil Baileys | waktu nyata |
| `sent` | `update.messageTimestamp` bila ada, jika tidak jam server | **waktu asli WhatsApp** |
| `delivered` | `receipt.receiptTimestamp` atau `update.messageTimestamp` | **waktu asli WhatsApp** |
| `read` | `receipt.readTimestamp` / `playedTimestamp` / `update.messageTimestamp` | **waktu asli WhatsApp** |
| `failed` dan terminal lain | jam server | waktu nyata kegagalan |

Untuk status di luar cakupan WhatsApp, jam server sudah benar — tidak ada sumber
lain yang lebih akurat. Yang penting adalah tidak ada lagi status yang memakai
waktu antrean.

**Catatan satuan:** timestamp WhatsApp dalam **detik** (epoch), sedangkan yang
disimpan dalam **milidetik**. Konversi wajib dilakukan di satu tempat saja, dan
harus menolak nilai yang tidak masuk akal (mis. `0` atau kosong) supaya tidak
menghasilkan tahun 1970.

### 3.4 Perubahan inti: `updateMessageStatus()`

Tanda tangan fungsi ditambah satu parameter opsional:

```
updateMessageStatus(id, status, errorDetail?, jitterDelayMs?, waktuKejadian?)
```

- `waktuKejadian` diisi hanya oleh pemanggil yang punya timestamp asli
  (`BaileysEngine.ts`). Pemanggil lain tidak berubah sama sekali.
- Di dalam fungsi: baca `statusTimes` yang ada, lalu tulis **hanya bila kunci
  status itu belum ada**.
- Bila `waktuKejadian` tidak diisi, pakai `Date.now()`.
- Pemeriksaan "tolak kemunduran status" (`STATUS_RANK`) tetap seperti sekarang
  dan tidak diubah. Penulisan waktu berjalan setelah pemeriksaan itu lolos,
  jadi waktu hanya tercatat untuk transisi yang memang diterima.

**Kenapa "tulis sekali":** itu yang menyelesaikan masalah 2.3 tanpa mengubah
alur antrean sama sekali. `pacing` boleh terpicu berkali-kali; yang tercatat
tetap kemunculan pertama, yaitu saat pesan benar-benar mulai menunggu jeda.

### 3.5 Retensi

`payload` bertambah sekitar 180-220 byte per pesan. Pada 10.000 pesan itu
sekitar 2 MB tambahan. Tidak perlu tindakan sekarang.

Bila nanti perlu dipangkas, aturannya jelas: simpan 7 kunci pertama saja
(rantai utama), buang sisanya. Belum dilakukan karena menghilangkan data yang
justru diminta.

---

## 4. Perubahan per berkas

| berkas | perubahan | perkiraan |
|---|---|---|
| `backend/src/types.ts` | field `statusTimes?: Partial<Record<MessageStatus, number>>` di `OutboundMessage` | +3 baris |
| `backend/src/db/pesan.ts` | parameter baru, logika "tulis sekali", normalisasi satuan | +25 baris |
| `backend/src/db/pesan.ts` | `mapMessageRow()` meneruskan `statusTimes` | +1 baris |
| `backend/src/engine/BaileysEngine.ts` | kirim `update.messageTimestamp` pada 3 pemanggilan status | +3 baris |
| `backend/src/engine/BaileysEngine.ts` | kirim `receipt.receiptTimestamp` / `readTimestamp` | +4 baris |
| `panel/src/lib/messageStatus.tsx` | label + urutan tampilan rantai status | +15 baris |
| `panel/src/components/UsersPage.tsx` | modal detail: ganti satu baris "Waktu" jadi daftar waktu per status | +30 baris |
| `panel/src/components/RealtimeMonitor.tsx` | tooltip pada badge status berisi waktu status itu | +10 baris |

Backend: sekitar 35 baris. Panel: sekitar 55 baris. Tidak ada perubahan skema
tabel, tidak ada migrasi, tidak ada dependensi baru.

---

## 5. Kompatibilitas

- **Pesan lama (92 baris di VM) tidak punya `statusTimes`.** Tidak bisa
  direkonstruksi — waktu kejadiannya tidak pernah disimpan, dan menebak dari
  `created_at` justru akan menampilkan angka palsu. Panel harus menampilkan
  keadaan kosong yang jujur untuk baris lama.
- **Tidak ada perubahan bentuk respons API yang memutus.** Field baru bersifat
  tambahan; panel versi lama mengabaikannya.
- **`resetStuckMessages()`** mengembalikan status `pacing`/`sending` ke `queued`.
  Dengan aturan "tulis sekali", kunci `pacing`/`sending` tetap ada dari percobaan
  sebelumnya. Ini **perlu diputuskan**: apakah percobaan ulang menambah kunci
  baru (butuh penamaan berbeda), atau kunci lama dibiarkan. Usulan: biarkan,
  karena yang ditanyakan operator adalah "kapan pesan ini mulai diproses", dan
  itu memang percobaan pertama.

---

## 6. Cara verifikasi

Prinsipnya sama seperti pemecahan berkas sebelumnya: **bukti dari perilaku, bukan
dari build hijau.**

| # | yang diuji | cara | kriteria lulus |
|---|---|---|---|
| 1 | Waktu ditulis sekali | unit: panggil `updateMessageStatus(id,'pacing')` tiga kali dengan jeda | nilai `statusTimes.pacing` sama dengan panggilan pertama |
| 2 | Konversi satuan benar | unit: masukkan epoch detik dari WhatsApp | tersimpan dalam milidetik, selisih < 1 detik dari waktu asli |
| 3 | Nilai tidak masuk akal ditolak | unit: masukkan `0`, `undefined`, `null`, `-1` | jatuh ke jam server, bukan tahun 1970 |
| 4 | Rantai status lengkap | uji end-to-end kirim 1 pesan ke nomor uji, tunggu sampai dibaca | keenam kunci ada, urutannya menaik |
| 5 | Timestamp asli benar-benar terpakai | bandingkan `statusTimes.delivered` dengan waktu yang terlihat di aplikasi WhatsApp penerima | selisih < 2 detik |
| 6 | `message-receipt.update` terpicu atau tidak | log sementara di kedua listener, kirim ke grup **dan** ke chat pribadi | ketahuan jalur mana yang benar-benar dipakai |
| 7 | Tidak mengganggu alur antrean | jalankan 5 skrip uji backend yang ada | 5 lulus, 0 gagal |
| 8 | Panel | buka modal detail pesan baru dan pesan lama | baru: daftar waktu; lama: keadaan kosong yang jelas, bukan angka palsu |

Poin 6 penting: temuan 2.2 berasal dari membaca kode library, **bukan** dari
trafik nyata. Sebelum implementasi, itu perlu dipastikan dulu supaya tidak
menulis kode untuk jalur yang tidak pernah terpicu.

---

## 7. Yang tidak dikerjakan

- **Tidak mengubah** `STATUS_RANK` dan aturan penolakan kemunduran status.
- **Tidak mengubah** alur antrean, pacing, atau anti-ban.
- **Tidak menambah** kolom atau tabel baru.
- **Tidak mengisi** waktu untuk pesan lama.
- **Tidak menyentuh** `session-manager.ts` selain menambah argumen pada
  pemanggilan yang sudah ada.

---

## 8. Gap analysis — untuk diisi

Kolom terakhir sengaja kosong, untuk diisi setelah pemeriksaan sendiri.

| # | aspek | keadaan sekarang | usulan | dampak bila tidak dikerjakan | verifikasi |
|---|---|---|---|---|---|
| 1 | Waktu antrean | ada, nyata | dipertahankan | — | |
| 2 | Waktu pacing | tidak ada | jam server, tulis sekali | jeda anti-ban tetap tak terlihat | |
| 3 | Waktu sending | tidak ada | jam server | durasi kirim tak terukur | |
| 4 | Waktu sent | tidak ada | timestamp asli WhatsApp | tidak bisa banding dengan jam penerima | |
| 5 | Waktu delivered | tidak ada | timestamp asli WhatsApp | tidak bisa ukur latensi jaringan | |
| 6 | Waktu read | tidak ada | timestamp asli WhatsApp | tidak bisa ukur waktu baca | |
| 7 | Waktu gagal | tidak ada | jam server | tidak bisa ukur berapa lama sebelum gagal | |
| 8 | Riwayat percobaan ulang | tidak ada | tidak dikerjakan | percobaan ulang tidak terekam | |
| 9 | Pesan lama | tidak ada | tidak diisi | 92 baris tetap kosong | |
| 10 | Tampilan panel | satu label "Waktu" | daftar per status | operator masih salah paham | |
| 11 | Jalur receipt grup vs pribadi | belum dipastikan | diuji dulu | kode untuk jalur mati | |

---

## 9. Hal yang perlu diputuskan sebelum implementasi

1. **Satuan tampilan di panel.** Waktu absolut (`14:04:52`) atau selisih dari
   antrean (`+3,2 detik`)? Usulan: absolut di modal detail, selisih di tooltip
   badge — karena pertanyaan yang berbeda butuh bentuk yang berbeda.
2. **Percobaan ulang.** Bila pesan dikembalikan ke antrean lalu dikirim ulang,
   apakah waktu percobaan kedua perlu disimpan terpisah? Usulan: tidak, untuk
   sekarang.
3. **Temuan 2.2 perlu diuji lebih dulu**, sebelum kode ditulis. Bila
   `message-receipt.update` memang tidak pernah terpicu untuk chat pribadi,
   komentar di `BaileysEngine.ts:198-201` juga perlu dikoreksi karena
   menyesatkan.
