// Uji: pengunduhan media harus MENOLAK respons yang bukan berkas media.
// Bug asal: fetch 404 -> body HTML dikirim ke WhatsApp sebagai "gambar",
// ditolak di sisi WA, tapi status pesan tetap 'sent' tanpa error (senyap).
import { createServer } from 'node:http';

// Salinan logika yang dipakai BaileysEngine.sendMessage (mode media, jalur mediaUrl)
async function ambilMedia(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`Gagal mengunduh media: HTTP ${res.status} ${res.statusText} dari ${url}`);
  }
  const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ct === 'text/html' || ct === 'application/json') {
    throw new Error(`URL media mengembalikan ${ct}, bukan berkas media (HTTP ${res.status}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`Media kosong (0 byte) dari ${url}`);
  return { buf, mime: res.headers.get('content-type') || 'application/octet-stream' };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Server tiruan yang meniru perilaku nginx+Cloudflare saat media rusak
const server = createServer((req, res) => {
  if (req.url === '/media-ok.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(PNG);
  }
  if (req.url === '/media-404.jpeg') {
    // Persis seperti nginx: 404 dengan body HTML kecil
    res.writeHead(404, { 'Content-Type': 'text/html' });
    return res.end('<html><head><title>404 Not Found</title></head></html>');
  }
  if (req.url === '/media-json') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end('{"error":"ID media tidak valid."}');
  }
  // HTTP 200 tapi body HTML: inilah kasus yang hanya tertangkap cek content-type
  // (mis. proxy/CDN yang mengembalikan halaman error dengan status 200).
  if (req.url === '/media-200-html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<html><body>Halaman error</body></html>');
  }
  if (req.url === '/media-kosong.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return res.end(Buffer.alloc(0));
  }
  if (req.url === '/media-menggantung') return; // tidak pernah menjawab
  res.writeHead(500);
  res.end('x');
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
async function uji(nama, fn, harapGagal, harapPesan) {
  try {
    const hasil = await fn();
    if (harapGagal) {
      console.log(`FAIL | ${nama}`);
      console.log(`       seharusnya GAGAL, tapi berhasil (${hasil.buf.length} byte)`);
      fail++;
    } else {
      console.log(`PASS | ${nama} (${hasil.buf.length} byte, ${hasil.mime})`);
      pass++;
    }
  } catch (e) {
    if (!harapGagal) {
      console.log(`FAIL | ${nama}`);
      console.log(`       seharusnya BERHASIL, tapi gagal: ${e.message}`);
      fail++;
    } else if (harapPesan && !e.message.includes(harapPesan)) {
      console.log(`FAIL | ${nama}`);
      console.log(`       pesan tidak memuat "${harapPesan}": ${e.message}`);
      fail++;
    } else {
      console.log(`PASS | ${nama}`);
      console.log(`       -> ${e.message.slice(0, 90)}`);
      pass++;
    }
  }
}

console.log('=== MEDIA: harus DITOLAK ===');
await uji('404 + body HTML (kasus produksi nyata)', () => ambilMedia(`${base}/media-404.jpeg`), true, 'HTTP 404');
await uji('404 + body JSON (tertangkap cek res.ok)', () => ambilMedia(`${base}/media-json`), true, 'HTTP 404');
await uji('HTTP 200 + body HTML (tertangkap cek content-type)', () => ambilMedia(`${base}/media-200-html`), true, 'text/html');
await uji('HTTP 200 tapi 0 byte', () => ambilMedia(`${base}/media-kosong.png`), true, '0 byte');
await uji('URL menggantung -> timeout 30s', () => ambilMedia(`${base}/media-menggantung`), true);

console.log('\n=== MEDIA: harus BERHASIL ===');
await uji('PNG sah', () => ambilMedia(`${base}/media-ok.png`), false);

server.close();
console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
