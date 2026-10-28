# wa-mcp — server MCP untuk audit & setup terbatas

Server MCP (stdio) yang membungkus sebagian wa-api menjadi tool untuk agen AI.
Rancangan dan alasannya ada di [`../docs/rancangan-mcp-server.md`](../docs/rancangan-mcp-server.md);
berkas ini hanya cara memakainya.

## Kenapa proses terpisah

Bukan bagian dari `backend/`. Kalau MCP berjalan in-process dan crash, ia
menjatuhkan pengiriman pesan. Sebagai proses terpisah, kegagalannya terkurung,
dan dependensinya (SDK MCP) tidak masuk ke proses yang sedang melayani antrean.

## Konfigurasi

| Variabel | Wajib | Bawaan | Keterangan |
|---|---|---|---|
| `WA_API_KEY` | ya | — | API key milik pengguna yang menjalankan agen |
| `WA_API_BASE_URL` | tidak | `http://127.0.0.1:3100` | Alamat wa-api |
| `WA_MCP_ACTOR` | tidak | `mcp` | Label agen, mengisi kolom audit `actor` |
| `WA_API_TIMEOUT_MS` | tidak | `20000` | Batas waktu satu permintaan |

`WA_MCP_ACTOR` **hanya label, bukan autentikasi**. Siapa pun yang punya API key
bisa mengisinya dengan apa saja. Pelaku sebenarnya tetap diambil server dari
kunci yang diverifikasi, jadi yang bisa dipalsukan hanya nama agennya.

## Build

```bash
cd mcp
npm install
npm run build
```

## Daftarkan di klien MCP

```json
{
  "mcpServers": {
    "wa-api": {
      "command": "node",
      "args": ["/path/ke/wa-api/mcp/dist/index.js"],
      "env": {
        "WA_API_KEY": "<kunci milik pengguna>",
        "WA_API_BASE_URL": "http://127.0.0.1:3100",
        "WA_MCP_ACTOR": "hermes-nama-pengguna"
      }
    }
  }
}
```

Satu proses per pengguna, dengan kunci masing-masing. Tidak ada kunci bersama
yang disimpan MCP.

## Tool

**Baca (7):** `wa_list_sessions`, `wa_get_session`, `wa_audit_antiban`,
`wa_get_queue`, `wa_get_metrics`, `wa_list_messages`, `wa_audit_decisions`.

**Tulis (5), semuanya bisa dibalik:** `wa_set_antiban_preset`, `wa_pause_queue`,
`wa_resume_queue`, `wa_reconnect_session`, `wa_reset_cooldown`.

**Sengaja tidak ada:** kirim pesan/blast, hapus sesi, logout, kelola user, dan
`queue/clear`. `queue/clear` dan blast adalah dua operasi yang paling mungkin
dipanggil agen tanpa sengaja karena keduanya terdengar seperti "bersihkan" dan
"kirim pengumuman" — dan tidak ada jalan pulang untuk keduanya.

Batas ini dijaga uji, bukan hanya niat: `uji-mcp.mjs` membandingkan daftar tool
yang **benar-benar teregistrasi** dengan daftar putih. Pemeriksaan kata kunci saja
tidak cukup — tool bernama `wa_bersihkan_antrean` yang memanggil `queue/clear`
akan lolos dari pemeriksaan kata kunci, dan memang pernah lolos saat diuji.

## Otorisasi

MCP **tidak** punya pemeriksaan hak sendiri. Ia meneruskan kunci, dan wa-api yang
memutuskan. Kalau wa-api menjawab `403`, MCP melaporkan `403` dengan pesan
aslinya — tidak menafsirkannya sebagai "tidak ada".

Konsekuensinya: batas akses agen sama dengan batas akses pemilik kuncinya. Itu
sebabnya isolasi tenant di wa-api harus benar lebih dulu (sudah, lihat
`CHANGELOG.md`).

## Uji

```bash
cd backend && npm run build && node --no-warnings scripts/uji-mcp.mjs
```

Uji ini bicara JSON-RPC sungguhan ke proses MCP, bukan memanggil fungsinya
langsung — karena yang mudah salah pada server MCP justru hal yang hanya terlihat
dari luar: tool tidak teregistrasi, stdout tercemar log sehingga protokol rusak,
atau galat menjatuhkan proses alih-alih dilaporkan sebagai `isError`.
