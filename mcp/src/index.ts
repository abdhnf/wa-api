#!/usr/bin/env node
/**
 * Server MCP untuk wa-api — audit & setup terbatas.
 *
 * Bentuk: proses terpisah, bicara ke wa-api lewat HTTP dengan `X-API-Key` milik
 * pengguna yang menjalankan agen. Bukan in-process, karena kegagalan MCP tidak
 * boleh menjatuhkan pengiriman pesan, dan MCP tidak boleh punya jalan pintas ke
 * SessionManager yang tidak dimiliki manusia lewat API.
 *
 * Transport: stdio. Tidak ada port baru, tidak ada kredensial kedua.
 *
 * Konfigurasi (variabel lingkungan):
 *   WA_API_BASE_URL  bawaan http://127.0.0.1:3100
 *   WA_API_KEY       wajib — kunci milik pengguna
 *   WA_MCP_ACTOR     label agen, mengisi kolom audit `actor`
 *   WA_API_TIMEOUT_MS bawaan 20000
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { bacaKonfigurasi, buatKlien, GalatApi } from './client.js';
import { daftarkanToolBaca } from './tools/baca.js';
import { daftarkanToolTulis, DAFTAR_TOOL_TULIS } from './tools/tulis.js';

async function main(): Promise<void> {
  const konfig = bacaKonfigurasi();
  const klien = buatKlien(konfig);

  const server = new McpServer({
    name: 'wa-api',
    version: '0.1.0',
  });

  daftarkanToolBaca(server, klien);
  daftarkanToolTulis(server, klien);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Sengaja ke stderr, bukan stdout: stdout dipakai protokol JSON-RPC, dan
  // menulis apa pun ke sana akan merusak koneksi ke klien.
  process.stderr.write(
    `[wa-mcp] siap · wa-api ${konfig.baseUrl} · actor "${konfig.actor}" · ` +
      `${7 + DAFTAR_TOOL_TULIS.length} tool (7 baca, ${DAFTAR_TOOL_TULIS.length} tulis)\n`,
  );
}

main().catch((err) => {
  // Galat konfigurasi/penyambungan dilaporkan ke stderr lalu keluar dengan kode
  // bukan-nol, supaya klien MCP menampilkannya sebagai kegagalan start — bukan
  // sebagai tool yang misteriusnya tidak pernah berhasil.
  if (err instanceof GalatApi) {
    process.stderr.write(`[wa-mcp] gagal: HTTP ${err.status} pada ${err.jalur}: ${err.pesanAsli}\n`);
  } else {
    process.stderr.write(`[wa-mcp] gagal: ${err?.message ?? err}\n`);
  }
  process.exit(1);
});
