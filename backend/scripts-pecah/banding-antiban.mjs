/**
 * Banding PERILAKU antiban: build lama (monolitik) vs build pecahan.
 *
 * KENAPA BUKAN TULIS ULANG UJI: memanggil dua versi modul yang sama di satu
 * skrip akan bertabrakan karena keduanya mengekspor nama identik. Yang aman
 * adalah menjalankan SATU skrip ini dua kali (sekali per build) dan membandingkan
 * berkas JSON hasilnya di luar.
 *
 * YANG DIKENDALIKAN: jam (Date) dan RNG (Math.random) dibekukan dengan benih
 * tetap. Tanpa itu, 37 pemakaian Date.now() dan 7 Math.random() membuat setiap
 * jalannya berbeda dan perbandingan apa pun jadi tidak sah.
 *
 * Jalankan: node --no-warnings scripts-pecah/banding-antiban.mjs <dir-dist> <keluaran.json>
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [dirDist, keluaran] = process.argv.slice(2);
if (!dirDist || !keluaran) {
  console.error('pakai: banding-antiban.mjs <dir-dist> <keluaran.json>');
  process.exit(2);
}

// --------------------------------------------------------- KENDALI WAKTU ---
// 2026-06-15T10:30:00.000Z — dipilih jam 10 UTC supaya jam lokal (WIB, UTC+7)
// jatuh di 17:00, bukan tengah malam: circadian multiplier butuh jam manusiawi.
const WAKTU_AWAL = Date.UTC(2026, 5, 15, 10, 30, 0);
let offsetMs = 0;
const RealDate = Date;
class JamBeku extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(WAKTU_AWAL + offsetMs);
    else super(...a);
  }
  static now() { return WAKTU_AWAL + offsetMs; }
}
globalThis.Date = JamBeku;

// ----------------------------------------------------------- KENDALI RNG ---
// LCG sederhana: cukup untuk mengulang urutan yang sama persis di kedua build.
let benih = 12345;
Math.random = () => {
  benih = (benih * 1103515245 + 12345) % 2147483648;
  return benih / 2147483648;
};

const majukan = (ms) => { offsetMs += ms; };

const M = await import(pathToFileURL(path.join(dirDist, 'antiban.js')).href);
const HASIL = [];
const catat = (nama, nilai) => HASIL.push({ nama, nilai });

// Ambang yang sama untuk kedua build, supaya perbandingannya setara.
const CFG = { ...M.DEFAULT_ANTIBAN_CONFIG };

// ------------------------------------------------------------ RateLimiter ---
{
  const rl = new M.RateLimiter(CFG);
  for (let i = 1; i <= 6; i++) {
    catat(`rl.delay.${i}`, rl.getDelay('628111', `pesan-${i}`));
    catat(`rl.reason.${i}`, rl.getDelayReason('628111', 'pesan-berulang'));
    rl.record('628111', 'pesan-berulang');
    majukan(400);
  }
  catat('rl.stats', rl.getStats());
  catat('rl.knownSebelum', rl.isKnownChat('628999'));
  rl.markKnownChat('628999');
  catat('rl.knownSesudah', rl.isKnownChat('628999'));
  const state = rl.exportState();
  catat('rl.state', state);
  const rl2 = new M.RateLimiter(CFG);
  rl2.restore(JSON.parse(JSON.stringify(state)));
  catat('rl.setelahPulih', rl2.getStats());
  rl.updateConfig({ maxPerMinute: 1 });
  catat('rl.cfgSetelahUpdate', rl.getConfig().maxPerMinute);
}

// ---------------------------------------------------------------- WarmUp ---
{
  const wu = new M.WarmUp({ ...CFG, distraction: false });
  for (let hari = 0; hari < 4; hari++) {
    catat(`wu.limit.hari${hari}`, wu.getDailyLimit());
    catat(`wu.canSend.hari${hari}`, wu.canSend());
    wu.record();
    wu.record();
    catat(`wu.status.hari${hari}`, wu.getStatus());
    majukan(86_400_000);
  }
  wu.setGraduated(true);
  catat('wu.lulus', wu.getStatus());
  const s = wu.exportState();
  catat('wu.state', s);
  const wu2 = new M.WarmUp({ ...CFG, distraction: false }, s, true);
  catat('wu.setelahPulih', wu2.getStatus());
}

// ------------------------------------------------------------ TimelockGuard ---
{
  const tl = new M.TimelockGuard(CFG);
  catat('tl.awal', tl.getState());
  catat('tl.canSend.awal', tl.canSend('628111'));
  tl.record463Error();
  catat('tl.setelah463', tl.getState());
  catat('tl.isTimelocked', tl.isTimelocked());
  catat('tl.remaining', tl.remainingMs());
  catat('tl.canSend.pernah', tl.canSend('628111'));
  tl.registerKnownChat('628111');
  catat('tl.canSend.dikenal', tl.canSend('628111'));
  const akhir = new RealDate(WAKTU_AWAL + 10 * 60_000);
  tl.onTimelockUpdate({ isActive: true, timeEnforcementEnds: akhir, enforcementType: 'rate' });
  catat('tl.update', tl.getState());
  catat('tl.canSend.rate', tl.canSend('628111'));
  tl.lift();
  catat('tl.setelahLift', tl.getState());
}

// ------------------------------------------------------ PresenceChoreographer ---
{
  const pc = new M.PresenceChoreographer(CFG);
  for (const jam of [0, 6, 12, 18, 23]) {
    offsetMs = jam * 3_600_000 - (WAKTU_AWAL % 86_400_000);
    catat(`pc.circadian.${jam}`, pc.getCircadianMultiplier());
  }
  offsetMs = 4 * 3_600_000;
  for (const panjang of [0, 1, 12, 200, 4000]) {
    catat(`pc.typing.${panjang}`, pc.computeTypingPlan(panjang));
  }
  for (let i = 0; i < 6; i++) catat(`pc.distraction.${i}`, pc.shouldPauseForDistraction());
}

// --------------------------------------------------------- ReconnectThrottle ---
{
  const rt = new M.ReconnectThrottle(CFG);
  catat('rt.awal', rt.exportState());
  rt.onDisconnect();
  catat('rt.setelahPutus', rt.exportState());
  majukan(1000);
  rt.onReconnect();
  const s = rt.exportState();
  catat('rt.setelahSambung', s);
  majukan(5000);
  rt.onDisconnect();
  rt.onReconnect();
  catat('rt.kedua', rt.exportState());
  const rt2 = new M.ReconnectThrottle(CFG);
  rt2.restoreState(JSON.parse(JSON.stringify(s)));
  catat('rt.setelahPulih', rt2.exportState());
}

// --------------------------------------------------- BanRecoveryOrchestrator ---
{
  const br = new M.BanRecoveryOrchestrator(CFG);
  catat('br.awal', br.beforeSend());
  for (const tipe of ['429', '463', '401', '500', 'unknownerror']) {
    br.reportError(tipe, `detail-${tipe}`);
    catat(`br.setelah.${tipe}`, br.exportState());
    catat(`br.beforeSend.${tipe}`, br.beforeSend());
    catat(`br.remaining.${tipe}`, br.remainingMs());
    majukan(30_000);
  }
  br.markRecovered();
  catat('br.pulih', br.exportState());
  const s = br.exportState();
  const br2 = new M.BanRecoveryOrchestrator(CFG);
  br2.restoreState(JSON.parse(JSON.stringify(s)));
  catat('br.setelahPulih', br2.exportState());
}

// ---------------------------------------------------------- ReplyRatioGuard ---
{
  const rr = new M.ReplyRatioGuard({ ...CFG, ...M.ANTIBAN_PRESETS.balanced.replyRatio, maxPerMinute: 1000 });
  for (let i = 0; i < 12; i++) {
    catat(`rr.beforeSend.${i}`, rr.beforeSend('628777'));
    rr.recordSent('628777');
    if (i % 3 === 0) rr.recordReceived('628777');
    majukan(60_000);
  }
  catat('rr.stats', rr.getStats());
  catat('rr.remaining', rr.remainingMs('628777'));
  for (let i = 0; i < 4; i++) catat(`rr.suggest.${i}`, rr.suggestReply('628777'));
  const s = rr.exportState();
  catat('rr.state', s);
  const rr2 = new M.ReplyRatioGuard({ ...CFG, ...M.ANTIBAN_PRESETS.balanced.replyRatio });
  rr2.restoreState(JSON.parse(JSON.stringify(s)));
  catat('rr.setelahPulih', rr2.getStats());
  rr.resetCooldown('628777');
  catat('rr.setelahReset', rr.beforeSend('628777'));
  rr.updateConfig({ minRatio: 0.5 });
  catat('rr.cfg', rr.getConfig().minRatio);
}

// -------------------------------------------------------- ContactGraphWarmer ---
{
  const cg = new M.ContactGraphWarmer({ ...M.DEFAULT_CONTACT_GRAPH_CONFIG, enabled: true });
  catat('cg.awal', cg.getConfig());
  catat('cg.canMessage.baru', cg.canMessage('628555'));
  cg.recordIncoming('628555');
  catat('cg.canMessage.setelahMasuk', cg.canMessage('628555'));
  cg.recordSent('628555');
  catat('cg.canMessage.setelahKirim', cg.canMessage('628555'));
  majukan(2 * 3_600_000);
  catat('cg.canMessage.setelahTunggu', cg.canMessage('628555'));
  catat('cg.remaining', cg.remainingMs('628555'));

  catat('cg.approve', cg.approveBatchRecipients(['628a', '628b', '628c'], 'batch-1'));
  catat('cg.isApproved.a', cg.isBatchApproved('628a', 'batch-1'));
  catat('cg.isApproved.x', cg.isBatchApproved('628x', 'batch-1'));
  catat('cg.approvals', cg.getBatchApprovals());
  catat('cg.recipients', cg.getBatchRecipients('batch-1'));
  catat('cg.revokeSatu', cg.revokeBatchRecipient('628b', 'batch-1'));
  catat('cg.revokeSisa', cg.revokeBatch('batch-1'));
  catat('cg.approvalsAkhir', cg.getBatchApprovals());

  cg.markGroupJoined('120363@g.us');
  catat('cg.lurk', cg.remainingMs('120363@g.us'));
  majukan(3 * 86_400_000);
  catat('cg.lurkSesudah', cg.remainingMs('120363@g.us'));
  catat('cg.stats', cg.getStats());
  const s = cg.exportState();
  const cg2 = new M.ContactGraphWarmer({ ...M.DEFAULT_CONTACT_GRAPH_CONFIG, enabled: true });
  cg2.restoreState(JSON.parse(JSON.stringify(s)));
  catat('cg.setelahPulih', cg2.getStats());
  cg.updateConfig({ handshakeMinDelayMs: 60_000 });
  catat('cg.cfg', cg.getConfig().handshakeMinDelayMs);
}

// ---------------------------------------------------- util + preset (fungsi) ---
for (const v of [0, 1, 500, 1500, 5000, 60_000]) {
  catat(`util.jitter.${v}`, M.gaussianJitter(v));
}
for (const s of ['', 'a', 'halo dunia', 'HALO', '  spasi  ']) {
  catat(`util.norm.${JSON.stringify(s)}`, M.normalizeContentForHash(s));
}
catat('preset.id', Object.keys(M.ANTIBAN_PRESETS));

const unik = new Set(HASIL.map((h) => h.nama));
if (unik.size !== HASIL.length) {
  console.error('FATAL: ada nama pengamatan yang bentrok — perbandingan tidak sah');
  process.exit(3);
}

writeFileSync(keluaran, JSON.stringify(HASIL, null, 2));
console.log(`  ${HASIL.length} pengamatan -> ${keluaran}`);
