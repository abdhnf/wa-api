/**
 * Uji fungsional decision log pada DB KOSONG (bukan salinan produksi).
 *
 * Kenapa DB kosong: salinan wa.db membawa kredensial sesi WA hidup dan bisa
 * ikut menyambung ke sesi yang sama. Yang perlu dibuktikan di sini hanya:
 * skema terbentuk, pencatatan jalan, dan query baca mengembalikan bentuk benar.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'wa-dl-'));
// Nama env mengikuti config.ts: DATABASE_PATH, bukan DB_PATH.
process.env.DATABASE_PATH = join(dir, 'test.db');

const { db } = await import('../dist/db/client.js');
const { recordGuardDecision, hashRecipient, summarizeDecisions, listDecisions } = await import('../dist/db/decision-log.js');
// Impor db.js untuk memicu efek samping skema (CREATE TABLE).
await import('../dist/db.js');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
};

console.log('=== 1. Skema terbentuk? ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='antiban_decisions'").all();
check('tabel antiban_decisions ada', tables.length === 1);

const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='antiban_decisions'").all();
check('4 index dibuat', idx.length >= 4, `dapat ${idx.length}: ${idx.map(i => i.name).join(', ')}`);

const cols = db.prepare("SELECT name FROM pragma_table_info('antiban_decisions')").all().map(r => r.name);
for (const c of ['id','session_id','guard','decision','reason','message_id','batch_id','recipient_hash','metrics','threshold','preset','created_at']) {
  check(`kolom ${c}`, cols.includes(c));
}

console.log('\n=== 2. Pencatatan allow & block ===');
recordGuardDecision({
  sessionId: 'sess-test', guard: 'contactGraph', decision: 'allow',
  reason: 'Guard contact graph NONAKTIF pada preset ini',
  messageId: 'msg-1', batchId: 'cmp-1',
  recipientHash: hashRecipient('6281234567890'),
  metrics: { knownChats: 0 }, threshold: { enabled: false },
  preset: 'broadcast',
});
recordGuardDecision({
  sessionId: 'sess-test', guard: 'rateLimiter', decision: 'block',
  reason: 'Kuota batas harian sesi tercapai',
  messageId: 'msg-2', preset: 'broadcast',
});
const n = db.prepare('SELECT COUNT(*) AS n FROM antiban_decisions').get().n;
check('2 baris tercatat', n === 2, `dapat ${n}`);

console.log('\n=== 3. PII tidak bocor ===');
const row = db.prepare("SELECT recipient_hash, reason FROM antiban_decisions WHERE message_id='msg-1'").get();
check('nomor mentah TIDAK tersimpan', !JSON.stringify(row).includes('6281234567890'));
check('hash 16 karakter', /^[0-9a-f]{16}$/.test(row.recipient_hash), row.recipient_hash);

// Regresi: bug ini pernah lolos karena tidak ada uji yang menyentuhnya.
// `0812...` dan `62812...` adalah nomor yang SAMA. Sebelum normalisasi awalan,
// keduanya menghasilkan hash berbeda sehingga pengelompokan "berapa pesan ke
// satu penerima" pecah tanpa error apa pun. Setiap varian penulisan nomor yang
// lazim di Indonesia harus bertemu di satu hash.
console.log('\n=== 3b. Regresi normalisasi nomor (bug yang pernah lolos) ===');
const kanonik = hashRecipient('6281234567890');
const varian = [
  ['081234567890', 'awalan 0'],
  ['6281234567890', 'awalan 62'],
  ['+62 812-3456-7890', 'plus, spasi, strip'],
  ['0812 3456 7890', 'spasi'],
  ['6281234567890@s.whatsapp.net', 'JID WhatsApp'],
  ['6281234567890:12@s.whatsapp.net', 'JID dengan device'],
  ['0062 812 3456 7890', 'awalan internasional 00'],
];
for (const [nomor, label] of varian) {
  check(`varian "${label}" -> hash sama`, hashRecipient(nomor) === kanonik,
    `${nomor} -> ${hashRecipient(nomor)} vs ${kanonik}`);
}
check('nomor berbeda menghasilkan hash berbeda', hashRecipient('6281234567891') !== kanonik);
check('kosong -> null', hashRecipient('') === null && hashRecipient(null) === null);
check('tanpa digit -> null', hashRecipient('abc-def') === null);


console.log('\n=== 4. Query baca ===');
const sum = summarizeDecisions({ sessionId: 'sess-test', sinceHours: 24 });
check('summary mengelompokkan per guard', sum.length === 2, JSON.stringify(sum));
const list = listDecisions({ sessionId: 'sess-test', limit: 10 });
check('list total=2', list.total === 2);
check('list rows=2', list.rows.length === 2);
check('urutan terbaru dulu', list.rows[0].guard === 'rateLimiter', list.rows[0].guard);

console.log('\n=== 5. Filter ===');
check('filter guard', listDecisions({ sessionId: 'sess-test', guard: 'contactGraph' }).total === 1);
check('filter decision', listDecisions({ sessionId: 'sess-test', decision: 'block' }).total === 1);
check('filter batch', listDecisions({ batchId: 'cmp-1' }).total === 1);
check('limit dipaksa <=200', listDecisions({ limit: 9999 }).rows.length <= 200);

console.log('\n=== 6. Ketahanan: pencatatan tidak boleh melempar ===');
let threw = false;
try {
  // guard tidak valid & metrics melingkar (circular) — harus ditelan, bukan melempar
  const circ = {}; circ.self = circ;
  recordGuardDecision({ sessionId: 'sess-test', guard: 'warmup', decision: 'allow', metrics: circ });
} catch { threw = true; }
check('tidak melempar saat metrics circular', !threw);

console.log('\n=== 7. Retensi: buang baris lama, sisakan yang baru ===');
const { pruneDecisions } = await import('../dist/db/decision-log.js');
// Sisipkan satu baris bertanggal 60 hari lalu, lalu pangkas dengan batas 30 hari.
db.prepare(`INSERT INTO antiban_decisions (id, session_id, guard, decision, created_at)
            VALUES ('old-1', 'sess-test', 'warmup', 'allow', datetime('now','-60 days'))`).run();
const beforePrune = db.prepare('SELECT COUNT(*) AS n FROM antiban_decisions').get().n;
const removed = pruneDecisions(30);
const afterPrune = db.prepare('SELECT COUNT(*) AS n FROM antiban_decisions').get().n;
check('baris 60 hari terhapus', removed >= 1, `removed=${removed}`);
check('jumlah berkurang', afterPrune === beforePrune - removed, `${beforePrune} -> ${afterPrune}`);
check('baris baru tetap ada', db.prepare("SELECT COUNT(*) AS n FROM antiban_decisions WHERE message_id='msg-1'").get().n === 1);

console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
rmSync(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
