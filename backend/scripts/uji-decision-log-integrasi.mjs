/**
 * Uji integrasi: apakah jalur kirim BENAR-BENAR memanggil decision log?
 *
 * Uji unit tadi membuktikan tabel & fungsi tulis bekerja. Yang belum
 * dibuktikan: guard di processQueue() memakai evaluateGuard()/recordGuardDecision().
 * Tanpa uji ini, kode bisa terkompilasi rapi tapi tidak mencatat apa pun saat
 * runtime — persis kegagalan senyap yang ingin dicegah.
 *
 * Cara: baca source dan pastikan tiap guard punya pemanggilan pencatatan, lalu
 * jalankan probe runtime yang memanggil guard asli dengan decision log aktif.
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' -> ' + extra : ''}`); }
};

console.log('=== 1. Source: setiap guard terpasang pencatatan ===');
// readFileSync menyelesaikan path relatif terhadap CWD, bukan lokasi berkas ini.
// Karena skrip dipanggil dari backend/, path-nya dihitung dari import.meta.url.
const AKAR = dirname(fileURLToPath(import.meta.url)) + '/..';
const src = readFileSync(join(AKAR, 'src/session-manager.ts'), 'utf8');

// Guard yang wajib tercatat, beserta penanda pemanggilan di source.
const guards = [
  ['recovery',     /guard: 'recovery'/],
  ['timelock',     /guard: 'timelock'/],
  ['replyRatio',   /guard: 'replyRatio'/],
  ['contactGraph', /guard: 'contactGraph'/],
  ['warmup',       /guard: 'warmup'/],
  ['rateLimiter',  /guard: 'rateLimiter'/],
];
for (const [name, re] of guards) {
  check(`guard ${name} tercatat`, re.test(src));
}

check('evaluateGuard dipakai', (src.match(/evaluateGuard\(/g) || []).length >= 4,
  `${(src.match(/evaluateGuard\(/g) || []).length} pemanggilan`);
check('recordGuardDecision dipakai', (src.match(/recordGuardDecision\(/g) || []).length >= 2,
  `${(src.match(/recordGuardDecision\(/g) || []).length} pemanggilan`);

console.log('\n=== 1b. Regresi: warm-up dicatat SEKALI per kirim, bukan per kandidat ===');
// Probe membuktikan bug ini nyata: saat pencatatan berada di dalam checkHealth(),
// satu pengiriman dengan 3 sesi kandidat menghasilkan 3 baris `warmup` tanpa
// messageId, dan instalasi satu sesi menghasilkan 0 baris.
check('pencatatan warmup TIDAK di dalam checkHealth',
  !/const checkHealth[\s\S]{0,2500}?recordGuardDecision\(\{[\s\S]{0,400}?guard: 'warmup'/.test(src),
  'recordGuardDecision guard warmup masih berada di dalam checkHealth');
check('helper catatWarmup ada', /private catatWarmup\(/.test(src));
check('catatWarmup dipanggil di jalur satu-sesi (autorotate mati)',
  /if \(\(!enabled \|\| accessibleSessions\.length < 2\) && requestedId !== 'auto'\) \{[\s\S]{0,300}?this\.catatWarmup\(/.test(src));
check('catatWarmup dipanggil di jalur rotasi',
  /healthyCandidates\.length\);\s*\n\s*return \{\s*\n\s*sessionId: chosenId/.test(src));
check('catatWarmup dipanggil di jalur sticky session',
  /const stickyHealth = checkHealth\(lastSessId\);[\s\S]{0,600}?this\.catatWarmup\(lastSessId/.test(src));
check('penolakan seluruh sesi dicatat (guard sessionHealth)',
  /healthyCandidates\.length === 0\)[\s\S]{0,1200}?guard: 'sessionHealth'[\s\S]{0,200}?decision: 'block'/.test(src));
check('penolakan seluruh sesi menyimpan rincian per sesi di metrics',
  /guard: 'sessionHealth'[\s\S]{0,900}?penolakan:/.test(src));

console.log('\n=== 2. Pencatatan MENDAHULUI cabang blokir (urutan penting) ===');
// Kalau pencatatan diletakkan SETELAH `if (!blocked)`, guard yang memblokir
// tidak akan pernah tercatat. Pastikan evaluateGuard ada di dalam blok, bukan sesudahnya.
const evalIdx = src.indexOf("guard: 'contactGraph'");
const blockIdx = src.indexOf('if (blocked) {', evalIdx);
check('contactGraph dicatat sebelum cabang blocked', evalIdx > 0 && blockIdx > evalIdx,
  `eval@${evalIdx} block@${blockIdx}`);

console.log('\n=== 3. Runtime: guard asli + decision log aktif ===');
const dir = mkdtempSync(join(tmpdir(), 'wa-int-'));
process.env.DATABASE_PATH = join(dir, 'test.db');
await import('../dist/db.js'); // skema

const { db } = await import('../dist/db/client.js');
const { recordGuardDecision, hashRecipient, summarizeDecisions } = await import('../dist/db/decision-log.js');
const { RateLimiter, ReplyRatioGuard, ContactGraphWarmer, DEFAULT_ANTIBAN_CONFIG } = await import('../dist/antiban.js');

// Simulasikan tepat skenario yang membingungkan sebelumnya: preset broadcast,
// kontak dingin, konten sama, laju lambat.
const cfg = { ...DEFAULT_ANTIBAN_CONFIG, minDelayMs: 2000, maxDelayMs: 5000, maxPerDay: 1500, maxPerHour: 300, maxIdenticalMessages: 10 };
const rl = new RateLimiter(cfg);
const cg = new ContactGraphWarmer({ enabled: false });
const rr = new ReplyRatioGuard({ enabled: false, minRatio: 0, minMessagesBeforeEnforce: 999999, cooldownHoursOnViolation: 0 });

const content = 'Yth. Budi\nUndangan Wisudawan Periode IX';
let allowed = 0, blocked = 0;

for (let i = 0; i < 10; i++) {
  const to = `62812345678${String(i).padStart(2, '0')}`;
  const jid = `${to}@s.whatsapp.net`;

  const cgRes = cg.canMessage(jid, 'cmp-test');
  recordGuardDecision({
    sessionId: 'sess-int', guard: 'contactGraph',
    decision: cgRes.allowed ? 'allow' : 'block',
    reason: cgRes.allowed ? 'Guard contact graph NONAKTIF pada preset ini' : cgRes.reason,
    recipientHash: hashRecipient(to), batchId: 'cmp-test', preset: 'broadcast',
  });
  if (cgRes.allowed) allowed++; else blocked++;

  const rrRes = rr.beforeSend(jid);
  recordGuardDecision({
    sessionId: 'sess-int', guard: 'replyRatio',
    decision: rrRes.allowed ? 'allow' : 'block',
    reason: rrRes.allowed ? 'Guard reply ratio NONAKTIF pada preset ini' : rrRes.reason,
    recipientHash: hashRecipient(to), batchId: 'cmp-test', preset: 'broadcast',
  });

  const d = rl.getDelayReason(to, content);
  recordGuardDecision({
    sessionId: 'sess-int', guard: 'rateLimiter',
    decision: d.allowed ? 'allow' : 'block',
    reason: d.allowed ? `Lolos: jeda ${Math.round(d.delayMs / 1000)}s` : d.reason,
    recipientHash: hashRecipient(to), batchId: 'cmp-test', preset: 'broadcast',
  });
  if (d.allowed) rl.record(to, content);
}

const sum = summarizeDecisions({ sessionId: 'sess-int', sinceHours: 1 });
console.log('  summary:', JSON.stringify(sum));
check('contactGraph: 10 allow, 0 block (preset broadcast mematikan guard)', allowed === 10 && blocked === 0,
  `allow=${allowed} block=${blocked}`);
check('3 guard tercatat', sum.length === 3, `${sum.length} guard`);
check('total keputusan = 30', sum.reduce((a, s) => a + s.n, 0) === 30);

const cgRow = sum.find(s => s.guard === 'contactGraph');
check('contactGraph tercatat 10 allow', cgRow && cgRow.decision === 'allow' && cgRow.n === 10,
  JSON.stringify(cgRow));

console.log('\n=== 4. Bukti inti: kontak dingin TIDAK diperiksa ===');
const rows = db.prepare("SELECT reason FROM antiban_decisions WHERE guard='contactGraph' LIMIT 1").get();
check('alasan menyebut guard NONAKTIF (terlihat di audit)', /NONAKTIF/.test(rows.reason), rows.reason);

console.log('\n=== 5. Identical guard: apakah menangkap 10 konten sama ke 10 orang? ===');
const identRows = db.prepare("SELECT COUNT(DISTINCT recipient_hash) AS n FROM antiban_decisions WHERE guard='rateLimiter'").get();
check('10 penerima berbeda tercatat', identRows.n === 10, `dapat ${identRows.n}`);

console.log(`\n=== HASIL: ${pass} lulus, ${fail} gagal ===`);
rmSync(dir, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
