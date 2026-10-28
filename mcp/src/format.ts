/**
 * Pemformat respons: mengubah JSON wa-api menjadi teks yang langsung menjawab
 * pertanyaan, bukan JSON mentah.
 *
 * Ukurannya sudah diukur (`backend/scripts/ukur-respons-mcp.sh`): `antiban`
 * 3.466 byte, dan 67%-nya adalah definisi seluruh preset. Yang dibuang di sini
 * hanya bagian yang memang tidak ditanyakan; sisanya ditampilkan utuh supaya
 * audit tidak kehilangan bukti.
 */

const ANGKA = (n: unknown): string =>
  typeof n === 'number' && Number.isFinite(n) ? String(n) : '-';

/** `null` pada `per100` berarti penyebutnya nol, bukan "0%". Bedakan. */
const RASIO = (r: unknown): string => {
  if (!r || typeof r !== 'object') return '-';
  const o = r as { count?: number; per100?: number | null };
  if (o.per100 === null || o.per100 === undefined) {
    return o.count ? `${o.count} (tanpa penyebut)` : '0';
  }
  return `${o.count ?? 0} (${o.per100}/100)`;
};

type Antiban = {
  numberProfile?: string;
  preset?: string;
  warmup?: {
    phase?: string;
    day?: number;
    totalDays?: number;
    todayLimit?: number;
    todaySent?: number;
    progress?: number;
  };
  rateLimiter?: { lastMinute?: number; lastHour?: number; lastDay?: number; knownChats?: number };
  timelock?: {
    isActive?: boolean;
    expiresAt?: string | null;
    errorCount?: number;
    enforcementType?: string | null;
    knownChats?: string[];
  };
  circadianMultiplier?: number;
  reconnectMultiplier?: number;
  recovery?: { currentPhase?: string; violations?: number; banType?: string | null };
  replyRatio?: {
    globalSent?: number;
    globalReceived?: number;
    globalRatio?: number;
    contactsOnCooldown?: number;
    perContact?: unknown[];
  };
  contactGraph?: {
    knownContacts?: number;
    pendingHandshakes?: number;
    strangersToday?: number;
    batchApprovals?: unknown[];
  };
  health?: {
    risk?: string;
    score?: number;
    reasons?: string[];
    recommendation?: string;
    stats?: Record<string, number>;
  };
  lid?: { totalMappings?: number; mode?: string };
};

export type InfoSesi = {
  id: string;
  name?: string;
  phone?: string;
  status?: string;
  numberProfile?: string;
  warmupDay?: number;
  messagesSentToday?: number;
  deliveryRate?: number;
  owner?: { name?: string; email?: string };
  queue?: { pendingCount?: number; isPaused?: boolean; estimatedWaitSeconds?: number };
};

export function formatDaftarSesi(sesi: InfoSesi[]): string {
  if (sesi.length === 0) {
    return 'Tidak ada sesi yang boleh Anda lihat.';
  }
  const baris = sesi.map((s, i) => {
    const q = s.queue;
    const antre = q
      ? ` · antrean ${q.pendingCount ?? 0}${q.isPaused ? ' (DIJEDA)' : ''}`
      : '';
    return `${i + 1}. ${s.id} — ${s.name ?? '(tanpa nama)'}\n` +
      `   ${s.status ?? '?'} · profil ${s.numberProfile ?? '?'} · warmup hari ${ANGKA(s.warmupDay)}` +
      ` · terkirim hari ini ${ANGKA(s.messagesSentToday)}${antre}`;
  });
  return `${sesi.length} sesi:\n\n${baris.join('\n')}`;
}

export function formatSesi(s: InfoSesi): string {
  const m = (s as any).metrics || {};
  const bagian = [
    `${s.id} — ${s.name ?? '(tanpa nama)'}`,
    `Status: ${s.status ?? '?'} · profil: ${s.numberProfile ?? '?'} · warmup hari ${ANGKA(s.warmupDay)}`,
    `Nomor: ${s.phone ?? '-'} · pemilik: ${s.owner?.name ?? '-'}${s.owner?.email ? ` <${s.owner.email}>` : ''}`,
    `Terkirim hari ini: ${ANGKA(s.messagesSentToday)} · delivery rate: ${ANGKA(s.deliveryRate)}%`,
  ];
  if (m.totalSent !== undefined) {
    bagian.push(
      `Total: ${ANGKA(m.totalSent)} terkirim, ${ANGKA(m.totalDelivered)} delivered, ` +
        `${ANGKA(m.totalFailed)} gagal · uptime ${ANGKA(m.uptimeHours)} jam · ` +
        `disconnect hari ini ${ANGKA(m.disconnectCountToday)}`,
    );
  }
  if (s.queue) {
    bagian.push(
      `Antrean: ${ANGKA(s.queue.pendingCount)} tertunda` +
        `${s.queue.isPaused ? ' (DIJEDA)' : ''}` +
        (s.queue.estimatedWaitSeconds ? ` · perkiraan tunggu ${s.queue.estimatedWaitSeconds} dtk` : ''),
    );
  }
  return bagian.join('\n');
}

/**
 * Format audit anti-ban.
 *
 * `catatan` ditambahkan di akhir, bukan disebar, supaya peringatan penting
 * (mis. preset broadcast mematikan sebagian guard) tidak tenggelam di antara
 * angka.
 */
export function formatAntiban(sessionId: string, a: Antiban, statusSesi?: string): string {
  const w = a.warmup ?? {};
  const rl = a.rateLimiter ?? {};
  const tl = a.timelock ?? {};
  const rc = a.recovery ?? {};
  const rr = a.replyRatio ?? {};
  const cg = a.contactGraph ?? {};
  const h = a.health ?? {};

  const kuota = w.todayLimit === -1 ? 'tanpa batas' : ANGKA(w.todayLimit);

  const baris: string[] = [];
  baris.push(`Sesi ${sessionId}${statusSesi ? ` (${statusSesi})` : ''}`);
  baris.push(`Preset: ${a.preset ?? '?'} · Profil: ${a.numberProfile ?? '?'}`);
  baris.push('');
  baris.push('Guard:');
  baris.push(
    `  warmup      ${w.phase ?? '?'}, hari ${ANGKA(w.day)}/${ANGKA(w.totalDays)}` +
      ` · kuota ${kuota} · terkirim hari ini ${ANGKA(w.todaySent)}`,
  );
  baris.push(
    `  timelock    ${tl.isActive ? `AKTIF sampai ${tl.expiresAt ?? '?'}` : 'tidak aktif'}` +
      ` · error ${ANGKA(tl.errorCount)}` +
      (tl.enforcementType ? ` · tipe ${tl.enforcementType}` : ''),
  );
  baris.push(`  rateLimiter ${ANGKA(rl.lastMinute)}/menit · ${ANGKA(rl.lastHour)}/jam · ${ANGKA(rl.lastDay)}/hari`);
  baris.push(`  circadian   multiplier ${ANGKA(a.circadianMultiplier)}`);
  baris.push(`  recovery    fase ${rc.currentPhase ?? '?'} · pelanggaran ${ANGKA(rc.violations)}`);
  baris.push(
    `  replyRatio  ${ANGKA(rr.globalSent)} terkirim / ${ANGKA(rr.globalReceived)} dibalas` +
      ` (${ANGKA(rr.globalRatio)}) · kontak cooldown ${ANGKA(rr.contactsOnCooldown)}`,
  );
  baris.push(
    `  contactGraph ${ANGKA(cg.knownContacts)} dikenal · ${ANGKA(cg.pendingHandshakes)} handshake tertunda` +
      ` · ${ANGKA(cg.strangersToday)} orang asing hari ini`,
  );
  baris.push('');
  baris.push(`Kesehatan: ${h.risk ?? '?'} (skor ${ANGKA(h.score)})`);
  if (Array.isArray(h.reasons) && h.reasons.length > 0) {
    for (const alasan of h.reasons) baris.push(`  - ${alasan}`);
  }
  if (h.recommendation) baris.push(`  Saran: ${h.recommendation}`);

  // Peringatan yang mengubah cara membaca angka di atas. Tanpa ini, "replyRatio
  // 0" pada preset broadcast terbaca sebagai masalah, padahal guard-nya memang
  // dimatikan.
  const catatan: string[] = [];
  if (a.preset === 'broadcast') {
    catatan.push(
      'Preset broadcast menonaktifkan replyRatio dan contactGraph. Angka 0 pada keduanya berarti ' +
        '"tidak diperiksa", bukan "diperiksa dan aman".',
    );
  }
  if (tl.isActive) {
    catatan.push('Timelock sedang aktif: pengiriman ditahan sampai waktu kedaluwarsa.');
  }
  if (rc.currentPhase && rc.currentPhase !== 'normal') {
    catatan.push(`Fase recovery "${rc.currentPhase}" sedang berjalan — laju pengiriman dikurangi.`);
  }
  if (catatan.length > 0) {
    baris.push('');
    for (const c of catatan) baris.push(`Catatan: ${c}`);
  }
  return baris.join('\n');
}

export function formatMetrik(sessionId: string, m: any): string {
  const rates = m?.rates ?? {};
  const baris = [
    `Metrik ${sessionId}`,
    `Terkirim: ${ANGKA(m?.sent)} · total error: ${ANGKA(m?.totalErrors)}`,
    `  err463 (reachout)     ${RASIO(rates.err463)}`,
    `  err429 (rate limit)   ${RASIO(rates.err429)}`,
    `  tidak terdaftar       ${RASIO(rates.errNotRegistered)}`,
    `  error lain            ${RASIO(rates.errOther)}`,
    `  kontak diblokir       ${RASIO(rates.blockedContacts)}`,
    `Kesehatan: ${m?.health ?? '?'}${m?.updatedAt ? ` · diperbarui ${m.updatedAt}` : ''}`,
  ];
  if (m?.sent === 0) {
    baris.push('');
    baris.push('Catatan: belum ada pengiriman tercatat, jadi rasio per 100 belum bisa dihitung.');
  }
  return baris.join('\n');
}

export function formatAntrean(q: any): string {
  const byStatus = q?.byStatus && typeof q.byStatus === 'object' ? q.byStatus : {};
  const entri = Object.entries(byStatus as Record<string, number>);
  const baris = [
    `Antrean ${q?.sessionId ?? '?'}`,
    `Tertunda: ${ANGKA(q?.pendingCount)} · prioritas: ${ANGKA(q?.priorityPendingCount)}` +
      ` · VIP: ${ANGKA(q?.vipPendingCount)}`,
    `Status: ${q?.isPaused ? 'DIJEDA' : 'berjalan'}` +
      (q?.autoResumeInMs ? ` · lanjut otomatis dalam ${Math.round(q.autoResumeInMs / 1000)} dtk` : ''),
    `Total pesan: ${ANGKA(q?.totalMessages)}`,
  ];
  if (entri.length > 0) {
    baris.push('Per status:');
    for (const [k, v] of entri.sort((a, b) => Number(b[1]) - Number(a[1]))) {
      baris.push(`  ${k}: ${v}`);
    }
  }
  return baris.join('\n');
}

/**
 * Ringkasan pesan — bukan payload mentah.
 *
 * Endpoint riwayat menerima `limit` sampai 200 dan 30 pesan saja sudah 7.485
 * byte; mengirim JSON mentah ke konteks agen menghabiskannya dalam satu
 * panggilan. Yang ditampilkan: penerima, status, waktu, dan potongan teks.
 */
export function formatPesan(daftar: any[], total: number, batasTeks = 120): string {
  if (!Array.isArray(daftar) || daftar.length === 0) {
    return `Tidak ada pesan (total ${ANGKA(total)}).`;
  }
  const baris = [`${daftar.length} dari ${ANGKA(total)} pesan (terbaru dulu):`, ''];
  for (const p of daftar) {
    let teks = typeof p.text === 'string' ? p.text : '';
    if (teks.length > batasTeks) teks = `${teks.slice(0, batasTeks)}…`;
    const gagal = p.errorDetail ? ` · galat: ${String(p.errorDetail).slice(0, 100)}` : '';
    baris.push(
      `- ${p.timestamp ?? '?'} → ${p.to ?? '?'} [${p.status ?? '?'}]${p.batchId ? ` batch ${p.batchId}` : ''}` +
        `${gagal}${teks ? `\n  "${teks}"` : ''}`,
    );
  }
  if (total > daftar.length) {
    baris.push('');
    baris.push(`(${total - daftar.length} pesan lain tidak ditampilkan — perbesar limit atau persempit filter)`);
  }
  return baris.join('\n');
}

export function formatKeputusan(ringkasan: any[], rincian: any[], total: number): string {
  if ((!ringkasan || ringkasan.length === 0) && (!rincian || rincian.length === 0)) {
    return (
      'Tidak ada keputusan guard tercatat pada rentang ini.\n\n' +
      'Catatan: tabel keputusan baru terisi saat ada pengiriman. Kosong berarti "belum ada ' +
      'pengiriman sejak pencatatan aktif", bukan "tidak ada penolakan".'
    );
  }
  const baris: string[] = [];
  if (ringkasan.length > 0) {
    baris.push('Ringkasan per guard/keputusan:');
    for (const r of ringkasan) {
      baris.push(
        `  ${r.guard ?? '?'} → ${r.decision ?? '?'}: ${ANGKA(r.total ?? r.count)}` +
          (r.reasons ? ` (${r.reasons})` : ''),
      );
    }
    baris.push('');
  }
  if (rincian.length > 0) {
    baris.push(`${rincian.length} dari ${ANGKA(total)} keputusan terbaru:`);
    for (const d of rincian) {
      baris.push(
        `- ${d.created_at ?? d.createdAt ?? '?'} ${d.guard ?? '?'} → ${d.decision ?? '?'}` +
          `${d.reason ? `: ${d.reason}` : ''}${d.session_id ? ` (${d.session_id})` : ''}`,
      );
    }
  }
  return baris.join('\n');
}
