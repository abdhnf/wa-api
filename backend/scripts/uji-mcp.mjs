/**
 * Uji server MCP lewat protokol sungguhan (JSON-RPC stdio), bukan dengan
 * memanggil fungsi internalnya.
 *
 * Kenapa harus lewat protokol: yang mudah salah pada server MCP bukan logika
 * tool, melainkan hal-hal yang hanya terlihat dari luar — tool tidak teregistrasi,
 * skema input ditolak, stdout tercemar log sehingga JSON-RPC rusak, atau galat
 * tidak diteruskan sebagai hasil tool melainkan menjatuhkan proses.
 *
 * Yang dibuktikan:
 *  A. 12 tool teregistrasi (7 baca + 5 tulis) dan tidak lebih.
 *  B. Tidak ada tool berbahaya (kirim pesan, hapus sesi, logout, kelola user,
 *     queue/clear) — diperiksa dari daftar yang benar-benar teregistrasi.
 *  C. Tool baca mengembalikan teks yang berisi data sesi nyata.
 *  D. Tool tulis benar-benar mengubah keadaan, dan bisa dibalik.
 *  E. Isolasi tenant berlaku juga lewat MCP: kunci user lain ditolak 403.
 *  F. Backend mati -> galat yang jelas, proses tidak crash.
 *  G. GET lewat MCP tercatat di api_logs dengan actor dari header.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as tunggu } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const INI = dirname(fileURLToPath(import.meta.url));
const AKAR = join(INI, '..');
const MCP_ENTRY = join(AKAR, '..', 'mcp', 'dist', 'index.js');

let PASS = 0;
let FAIL = 0;
const ok = (m) => { PASS++; console.log(`  OK   ${m}`); };
const bad = (m, d) => { FAIL++; console.log(`  FAIL ${m} -> ${d}`); };

async function portBebas() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** Klien MCP minimal lewat stdio: kirim JSON-RPC, tunggu balasan dengan id sama. */
function buatMcp(env) {
  const anak = spawn(process.execPath, [MCP_ENTRY], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let buf = '';
  const tunggu = new Map();
  let id = 0;
  let stderr = '';

  anak.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const baris = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!baris) continue;
      let msg;
      try { msg = JSON.parse(baris); } catch { continue; }
      if (msg.id !== undefined && tunggu.has(msg.id)) {
        const { resolve, reject } = tunggu.get(msg.id);
        tunggu.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    }
  });
  anak.stderr.on('data', (d) => { stderr += d.toString(); });

  function kirim(method, params) {
    const myId = ++id;
    return new Promise((resolve, reject) => {
      tunggu.set(myId, { resolve, reject });
      anak.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
      setTimeout(() => {
        if (tunggu.has(myId)) {
          tunggu.delete(myId);
          reject(new Error(`timeout menunggu ${method}`));
        }
      }, 25000);
    });
  }

  return {
    kirim,
    stderr: () => stderr,
    tutup: () => { try { anak.kill('SIGTERM'); } catch {} },
  };
}

const T = mkdtempSync(join(tmpdir(), 'wa-mcp-uji-'));
const DB = join(T, 't.db');
const PORT = await portBebas();
const BASE = `http://127.0.0.1:${PORT}`;

let srv;
let mcp;

try {
  // ---- backend di DB kosong, port cadangan ----
  srv = spawn(process.execPath, [join(AKAR, 'dist', 'server.js')], {
    env: { ...process.env, DATABASE_PATH: DB, PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET: 'mcp-uji' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logSrv = '';
  srv.stdout.on('data', (d) => { logSrv += d.toString(); });
  srv.stderr.on('data', (d) => { logSrv += d.toString(); });

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/v1/health`);
      if (r.ok) break;
    } catch {}
    await tunggu(500);
  }

  const ADMIN_KEY = (logSrv.match(/wa_live_[a-f0-9]{40,}/) || [])[0];
  if (!ADMIN_KEY) throw new Error('kunci admin tidak ditemukan di log server');

  // Fixture: user non-admin pemilik sesi + user lain untuk uji isolasi.
  const fix = await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--no-warnings', join(AKAR, 'scripts', 'seed-mcp-uji.mjs')], {
      env: { ...process.env, DATABASE_PATH: DB },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.stderr.on('data', (d) => { out += d.toString(); });
    p.on('exit', (c) => (c === 0 ? resolve(out) : reject(new Error(out))));
  });

  const ambil = (kunci) => {
    const m = fix.match(new RegExp(`${kunci}:([^\\s]+)`));
    return m ? m[1] : '';
  };
  const KEY_A = ambil('KEYA');
  const KEY_B = ambil('KEYB');
  const SESS_A = ambil('SESSA');
  const SESS_B = ambil('SESSB');
  if (!KEY_A || !KEY_B || !SESS_A || !SESS_B) throw new Error(`fixture tidak lengkap: ${fix}`);
  console.log(`  fixture: sesi A=${SESS_A} · sesi B=${SESS_B} · kunci [REDACTED]`);

  // ---- MCP dengan kunci user A ----
  mcp = buatMcp({
    WA_API_BASE_URL: BASE,
    WA_API_KEY: KEY_A,
    WA_MCP_ACTOR: 'hermes-uji',
    WA_API_TIMEOUT_MS: '15000',
  });

  await mcp.kirim('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'uji', version: '1' },
  });
  mcp.kirim('notifications/initialized', {}).catch(() => {});

  console.log('\n=== A. Daftar tool yang teregistrasi ===');
  const daftar = await mcp.kirim('tools/list', {});
  const nama = (daftar.tools || []).map((t) => t.name).sort();
  console.log(`  ${nama.length} tool: ${nama.join(', ')}`);

  const bacaHarap = [
    'wa_list_sessions', 'wa_get_session', 'wa_audit_antiban', 'wa_get_queue',
    'wa_get_metrics', 'wa_list_messages', 'wa_audit_decisions',
  ];
  const tulisHarap = [
    'wa_set_antiban_preset', 'wa_pause_queue', 'wa_resume_queue',
    'wa_reconnect_session', 'wa_reset_cooldown',
  ];
  for (const t of [...bacaHarap, ...tulisHarap]) {
    if (nama.includes(t)) ok(`tool ${t} terdaftar`);
    else bad(`tool ${t}`, 'TIDAK terdaftar');
  }
  if (nama.length === 12) ok(`jumlah tool tepat 12 (7 baca + 5 tulis)`);
  else bad('jumlah tool', `${nama.length} (harap 12)`);

  console.log('\n=== B. Tidak ada tool berbahaya ===');
  const terlarang = ['send', 'blast', 'kirim', 'delete', 'hapus', 'logout', 'clear', 'user', 'key'];
  const ketemu = nama.filter((n) => terlarang.some((k) => n.toLowerCase().includes(k)));
  if (ketemu.length === 0) ok('tidak ada tool kirim/hapus/logout/kelola-user/queue-clear');
  else bad('tool berbahaya', ketemu.join(', '));

  // Daftar putih: nama tool dibandingkan dengan daftar yang disetujui, bukan hanya
  // diperiksa kata kuncinya. Pemeriksaan kata kunci akan meloloskan tool baru
  // bernama netral (mis. "wa_bersihkan_antrean") yang sebenarnya berbahaya.
  const DISETUJUI = new Set([...bacaHarap, ...tulisHarap]);
  const takDikenal = nama.filter((n) => !DISETUJUI.has(n));
  if (takDikenal.length === 0) ok('tidak ada tool di luar daftar yang disetujui');
  else bad('tool tak terduga', `${takDikenal.join(', ')} — perlu keputusan sadar sebelum ditambahkan`);

  const hilang = [...DISETUJUI].filter((n) => !nama.includes(n));
  if (hilang.length === 0) ok('semua tool yang disetujui ada (tidak ada yang hilang diam-diam)');
  else bad('tool hilang', hilang.join(', '));

  console.log('\n=== C. Tool baca mengembalikan data nyata ===');
  const panggil = async (name, args = {}) => {
    const r = await mcp.kirim('tools/call', { name, arguments: args });
    const t = (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return { teks: t, isError: r.isError === true };
  };

  const ls = await panggil('wa_list_sessions');
  if (!ls.isError && ls.teks.includes(SESS_A)) ok('wa_list_sessions memuat sesi A');
  else bad('wa_list_sessions', ls.teks.slice(0, 160));
  if (!ls.teks.includes(SESS_B)) ok('wa_list_sessions TIDAK memuat sesi B (isolasi tenant)');
  else bad('wa_list_sessions', 'sesi B ikut terlihat');

  const ab = await panggil('wa_audit_antiban', { sessionId: SESS_A });
  if (!ab.isError && /warmup/i.test(ab.teks) && /timelock/i.test(ab.teks)) ok('wa_audit_antiban memuat guard');
  else bad('wa_audit_antiban', ab.teks.slice(0, 200));
  if (ab.teks.length < 2500) ok(`wa_audit_antiban ringkas (${ab.teks.length} char, bukan JSON mentah 3.466)`);
  else bad('wa_audit_antiban', `terlalu besar: ${ab.teks.length} char`);

  const mt = await panggil('wa_get_metrics', { sessionId: SESS_A });
  if (!mt.isError && /err463/.test(mt.teks)) ok('wa_get_metrics memuat err463');
  else bad('wa_get_metrics', mt.teks.slice(0, 160));

  const q = await panggil('wa_get_queue', { sessionId: SESS_A });
  if (!q.isError && /Antrean/.test(q.teks)) ok('wa_get_queue berfungsi');
  else bad('wa_get_queue', q.teks.slice(0, 160));

  const msgs = await panggil('wa_list_messages', { sessionId: SESS_A, limit: 3 });
  if (!msgs.isError && msgs.teks.length < 2500) ok(`wa_list_messages dibatasi (${msgs.teks.length} char untuk 3 pesan)`);
  else bad('wa_list_messages', msgs.teks.slice(0, 200));

  const dec = await panggil('wa_audit_decisions', { sessionId: SESS_A });
  if (!dec.isError && /keputusan/i.test(dec.teks)) ok('wa_audit_decisions berfungsi (kosong tapi jelas)');
  else bad('wa_audit_decisions', dec.teks.slice(0, 160));

  console.log('\n=== D. Tool tulis mengubah keadaan dan bisa dibalik ===');
  const preset0 = (await panggil('wa_audit_antiban', { sessionId: SESS_A })).teks.match(/Preset: (\w+)/)?.[1];
  const ubah = await panggil('wa_set_antiban_preset', { sessionId: SESS_A, preset: 'strict' });
  // Asersi ini harus memeriksa NILAI LAMA-nya, bukan hanya "ada panah ke strict".
  // Versi lemah (`/→ "strict"/`) tetap lulus walau nilai lama tidak dibaca sama
  // sekali — dan itu justru cacat yang ingin dicegah: tanpa nilai lama, agen tidak
  // tahu harus mengembalikan ke apa.
  const lamaDilaporkan = new RegExp(`"${preset0}" → "strict"`).test(ubah.teks);
  if (!ubah.isError && lamaDilaporkan) ok(`nilai lama benar-benar dibaca ("${preset0}" → "strict")`);
  else bad('wa_set_antiban_preset: nilai lama', ubah.teks.slice(0, 200));

  const preset1 = (await panggil('wa_audit_antiban', { sessionId: SESS_A })).teks.match(/Preset: (\w+)/)?.[1];
  if (preset1 === 'strict') ok('perubahan preset terbaca kembali (strict)');
  else bad('verifikasi preset', `terbaca "${preset1}"`);

  const balik = await panggil('wa_set_antiban_preset', { sessionId: SESS_A, preset: preset0 || 'balanced' });
  const preset2 = (await panggil('wa_audit_antiban', { sessionId: SESS_A })).teks.match(/Preset: (\w+)/)?.[1];
  if (preset2 === (preset0 || 'balanced')) ok(`perubahan bisa dibalik (kembali "${preset2}")`);
  else bad('pembalikan preset', `terbaca "${preset2}", harap "${preset0}"`);

  // Peringatan preset broadcast: tanpa ini, "replyRatio 0" pada preset broadcast
  // terbaca sebagai masalah, padahal guard-nya memang dimatikan. Diuji karena
  // inilah satu-satunya tempat MCP menambahkan tafsir, bukan meneruskan angka.
  await panggil('wa_set_antiban_preset', { sessionId: SESS_A, preset: 'broadcast' });
  const abBroadcast = await panggil('wa_audit_antiban', { sessionId: SESS_A });
  if (/broadcast menonaktifkan replyRatio dan contactGraph/i.test(abBroadcast.teks)) {
    ok('wa_audit_antiban memperingatkan bahwa broadcast mematikan sebagian guard');
  } else {
    bad('peringatan broadcast', abBroadcast.teks.slice(-220));
  }
  await panggil('wa_set_antiban_preset', { sessionId: SESS_A, preset: preset0 || 'balanced' });

  const jeda = await panggil('wa_pause_queue', { sessionId: SESS_A, reason: 'uji mcp' });
  if (!jeda.isError && /dijeda/i.test(jeda.teks)) ok('antrean bisa dijeda');
  else bad('wa_pause_queue', jeda.teks.slice(0, 160));
  const lanjut = await panggil('wa_resume_queue', { sessionId: SESS_A });
  if (!lanjut.isError && /dilanjutkan/i.test(lanjut.teks)) ok('antrean bisa dilanjutkan (dibalik)');
  else bad('wa_resume_queue', lanjut.teks.slice(0, 160));

  console.log('\n=== E. Isolasi tenant berlaku lewat MCP ===');
  const curang = await panggil('wa_get_metrics', { sessionId: SESS_B });
  if (curang.isError && /403|milik pengguna lain|ditolak/i.test(curang.teks)) ok('sesi user lain ditolak lewat MCP');
  else bad('isolasi tenant', `isError=${curang.isError} teks=${curang.teks.slice(0, 140)}`);

  const curangTulis = await panggil('wa_pause_queue', { sessionId: SESS_B });
  if (curangTulis.isError && /403|milik pengguna lain|ditolak/i.test(curangTulis.teks)) ok('tool tulis pada sesi user lain ditolak');
  else bad('isolasi tenant (tulis)', `isError=${curangTulis.isError} teks=${curangTulis.teks.slice(0, 140)}`);

  console.log('\n=== F. Backend mati -> galat jelas, proses tidak crash ===');
  mcp.tutup();
  await tunggu(300);
  const mcpMati = buatMcp({
    WA_API_BASE_URL: 'http://127.0.0.1:1',
    WA_API_KEY: KEY_A,
    WA_MCP_ACTOR: 'hermes-uji',
    WA_API_TIMEOUT_MS: '3000',
  });
  await mcpMati.kirim('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'uji', version: '1' },
  });
  const rMati = await mcpMati.kirim('tools/call', { name: 'wa_list_sessions', arguments: {} });
  const tMati = (rMati.content || []).map((c) => c.text).join(' ');
  if (/tidak dapat dihubungi/i.test(tMati)) ok('backend mati dilaporkan jelas');
  else bad('backend mati', tMati.slice(0, 200));
  if (rMati.isError === true) ok('dilaporkan sebagai isError, bukan crash');
  else bad('isError', `isError=${rMati.isError}`);
  mcpMati.tutup();
  await tunggu(300);

  console.log('\n=== G. GET lewat MCP tercatat di api_logs ===');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(DB);
  const baris = db
    .prepare("SELECT actor, method, endpoint, status_code FROM api_logs WHERE actor IS NOT NULL ORDER BY id DESC LIMIT 20")
    .all();
  db.close();
  if (baris.length > 0) ok(`${baris.length} baris audit ber-actor tercatat`);
  else bad('audit', 'tidak ada baris dengan actor');

  const adaGet = baris.some((b) => String(b.method) === 'GET');
  if (adaGet) ok('GET ber-actor ikut tercatat (tanpa actor akan dilewati)');
  else bad('audit GET', `tidak ada GET: ${JSON.stringify(baris.slice(0, 3))}`);

  const actorBenar = baris.every((b) => b.actor === 'hermes-uji');
  if (actorBenar) ok('actor terisi dari header X-MCP-Actor');
  else bad('actor', JSON.stringify(baris.slice(0, 3)));
} catch (err) {
  bad('uji berjalan', err?.message ?? String(err));
} finally {
  try { mcp?.tutup(); } catch {}
  try { srv?.kill('SIGTERM'); } catch {}
  await tunggu(400);
  try { srv?.kill('SIGKILL'); } catch {}
  rmSync(T, { recursive: true, force: true });
}

console.log(`\n=== HASIL: ${PASS} lulus, ${FAIL} gagal ===`);
process.exit(FAIL === 0 ? 0 : 1);
