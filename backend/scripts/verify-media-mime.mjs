// Uji: berkas media harus disajikan dengan MIME yang benar.
//
// Bug asal: endpoint GET /api/v1/media/:id menebak MIME dengan membalik peta
// MIME->ekstensi yang hanya memuat '.jpg'. Akibatnya berkas '.jpeg' disajikan
// sebagai 'application/octet-stream'. Baileys meneruskan mimetype itu apa adanya
// ke WhatsApp; gambar ber-mimetype octet-stream ditolak di sisi penerima dan
// pesan tetap tercatat 'sent' — kegagalan senyap tanpa error di log.
//
// Uji ini mengunci perilaku resolveMediaMime() dan resolveOutboundMime() supaya
// regresi yang sama tidak lolos lagi.

// --- Salinan logika dari backend/src/server.ts ---
const MEDIA_MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.webm': 'audio/webm',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function resolveMediaMime(ext, declaredMime) {
  const clean = (declaredMime || '').split(';')[0].trim().toLowerCase();
  if (clean && clean !== 'application/octet-stream' && /^[a-z]+\/[a-z0-9.+-]+$/.test(clean)) {
    return clean;
  }
  return MEDIA_MIME_BY_EXT[ext.toLowerCase()] || clean || 'application/octet-stream';
}

// --- Salinan logika dari backend/src/engine/BaileysEngine.ts ---
const GENERIC_MIMES = new Set(['application/octet-stream', 'binary/octet-stream', '']);
const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function sniffMime(buf) {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

function resolveOutboundMime(rawMime, url, fileName, buf) {
  const clean = (rawMime || '').split(';')[0].trim().toLowerCase();
  if (clean && !GENERIC_MIMES.has(clean)) return clean;
  const candidates = [fileName, url ? url.split('?')[0] : ''];
  for (const c of candidates) {
    const ext = (c || '').split('.').pop()?.toLowerCase() || '';
    if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  }
  return sniffMime(buf) || clean || 'application/octet-stream';
}

// Magic bytes berkas nyata
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-1.4\n', 'ascii');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
const LAIN = Buffer.from('bukan media');

let pass = 0, fail = 0;
function uji(nama, aktual, harap) {
  if (aktual === harap) { pass++; console.log(`  PASS  ${nama}`); }
  else { fail++; console.log(`  FAIL  ${nama}\n        harap: ${harap}\n        dapat: ${aktual}`); }
}

console.log('\n=== A. resolveMediaMime: ekstensi tanpa metadata ===');
uji('.jpg  -> image/jpeg', resolveMediaMime('.jpg'), 'image/jpeg');
uji('.jpeg -> image/jpeg (bug asal)', resolveMediaMime('.jpeg'), 'image/jpeg');
uji('.jpe  -> image/jpeg', resolveMediaMime('.jpe'), 'image/jpeg');
uji('.png  -> image/png', resolveMediaMime('.png'), 'image/png');
uji('.pdf  -> application/pdf', resolveMediaMime('.pdf'), 'application/pdf');
uji('.webp -> image/webp', resolveMediaMime('.webp'), 'image/webp');
uji('.mp4  -> video/mp4', resolveMediaMime('.mp4'), 'video/mp4');
uji('.docx -> msword docx', resolveMediaMime('.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
uji('.bin  -> octet-stream (tak dikenal)', resolveMediaMime('.bin'), 'application/octet-stream');
uji('huruf besar .JPEG tetap benar', resolveMediaMime('.JPEG'), 'image/jpeg');

console.log('\n=== B. resolveMediaMime: metadata unggahan diutamakan ===');
uji('metadata image/jpeg menang atas ekstensi', resolveMediaMime('.bin', 'image/jpeg'), 'image/jpeg');
uji('metadata dengan charset dibersihkan', resolveMediaMime('.bin', 'image/png; charset=binary'), 'image/png');
uji('metadata octet-stream DIABAIKAN, pakai ekstensi', resolveMediaMime('.jpeg', 'application/octet-stream'), 'image/jpeg');
uji('metadata kosong -> pakai ekstensi', resolveMediaMime('.jpeg', ''), 'image/jpeg');
uji('metadata sampah -> pakai ekstensi', resolveMediaMime('.png', 'bukan-mime'), 'image/png');

console.log('\n=== C. resolveOutboundMime: header spesifik dipakai apa adanya ===');
uji('image/jpeg dari header dipertahankan', resolveOutboundMime('image/jpeg', 'http://x/a.jpeg', 'a.jpeg', JPEG), 'image/jpeg');
uji('application/pdf dipertahankan', resolveOutboundMime('application/pdf', 'http://x/a.pdf', 'a.pdf', PDF), 'application/pdf');

console.log('\n=== D. resolveOutboundMime: octet-stream ditebak ulang (bug asal) ===');
uji('octet-stream + URL .jpeg -> image/jpeg', resolveOutboundMime('application/octet-stream', 'https://wa-api.srvx.my.id/api/v1/media/89ecb55f444140b58a2cc1bd.jpeg', undefined, JPEG), 'image/jpeg');
uji('octet-stream + URL .jpg  -> image/jpeg', resolveOutboundMime('application/octet-stream', 'http://x/a.jpg', undefined, JPEG), 'image/jpeg');
uji('octet-stream + fileName menang', resolveOutboundMime('application/octet-stream', 'http://x/kosong', 'WhatsApp Image 2026-10-01.jpeg', JPEG), 'image/jpeg');
uji('octet-stream + URL .png  -> image/png', resolveOutboundMime('application/octet-stream', 'http://x/a.png', undefined, PNG), 'image/png');
uji('octet-stream + URL .pdf  -> application/pdf', resolveOutboundMime('application/octet-stream', 'http://x/a.pdf', undefined, PDF), 'application/pdf');
uji('header kosong + URL .jpeg -> image/jpeg', resolveOutboundMime('', 'http://x/a.jpeg', undefined, JPEG), 'image/jpeg');

console.log('\n=== E. resolveOutboundMime: magic bytes saat ekstensi tak dikenal ===');
uji('URL tanpa ekstensi + isi JPEG -> image/jpeg', resolveOutboundMime('application/octet-stream', 'http://x/download', undefined, JPEG), 'image/jpeg');
uji('URL tanpa ekstensi + isi PNG  -> image/png', resolveOutboundMime('application/octet-stream', 'http://x/download', undefined, PNG), 'image/png');
uji('URL tanpa ekstensi + isi PDF  -> application/pdf', resolveOutboundMime('application/octet-stream', 'http://x/download', undefined, PDF), 'application/pdf');
uji('URL .webp + isi WEBP -> image/webp', resolveOutboundMime('application/octet-stream', 'http://x/a.webp', undefined, WEBP), 'image/webp');
uji('isi tak dikenal -> octet-stream (jujur)', resolveOutboundMime('application/octet-stream', 'http://x/a.xyz', undefined, LAIN), 'application/octet-stream');

console.log('\n=== F. query string tidak mengacaukan deteksi ekstensi ===');
uji('URL .jpeg?token=abc -> image/jpeg', resolveOutboundMime('application/octet-stream', 'http://x/a.jpeg?token=abc&v=2', undefined, JPEG), 'image/jpeg');

console.log(`\n=== HASIL: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
