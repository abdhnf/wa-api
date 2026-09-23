// Uji alur state pairing di BaileysEngine.
//
// Bug asal (sess-mu2512ti):
//   1. startPairing memanggil socket.logout() -> WhatsApp memutus perangkat,
//      padahal user hanya ingin scan ulang.
//   2. Creds lama tetap di disk, jadi Baileys menganggap dirinya terautentikasi
//      dan TIDAK PERNAH memancarkan QR -> GET /qr selamanya 404.
//   3. Socket lama yang di-end memancarkan 'close' setelah sesi baru dipasang,
//      dan handler 'close' menghapus sesi baru -> QR hilang.
//
// Uji ini memverifikasi LOGIKA state, bukan Baileys-nya, dengan meniru urutan
// event yang terjadi pada tiap skenario.

let pass = 0, fail = 0;
function cek(nama, aktual, harap) {
  const ok = JSON.stringify(aktual) === JSON.stringify(harap);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${nama}`);
  if (!ok) console.log(`       harap=${JSON.stringify(harap)}  aktual=${JSON.stringify(aktual)}`);
}

// ---- tiruan state sesi ----
function buatSesi(credsLamaAda) {
  return {
    socket: { id: 'socket-awal', alive: true },
    qrData: null,
    qrResolve: undefined,
    pairing: false,
    credsDiDisk: credsLamaAda,
    qrDiterbitkan: 0,
    credsDihapus: 0,
  };
}

// Handler 'connection.update' versi perbaikan
function onConnectionUpdate(s, socketDariEvent, u, buatSocketBaru) {
  // Penjagaan socket basi
  if (s && s.socket !== socketDariEvent) return 'diabaikan: socket basi';

  if (u.qr) {
    s.qrData = 'data:image/png;base64,QR';
    s.pairing = false;              // QR terbit => memang belum terautentikasi
    s.qrDiterbitkan++;
    if (s.qrResolve) { s.qrResolve(s.qrData); s.qrResolve = undefined; }
    return 'QR terbit';
  }
  if (!s) return 'tanpa sesi';
  if (u.connection === 'open') {
    if (s.pairing) {
      // konek pakai creds lama saat mode pairing -> buang creds, ganti socket
      s.socket = buatSocketBaru();
      s.credsDiDisk = false;
      s.credsDihapus++;
      return 'creds lama dibuang, socket diganti';
    }
    s.qrResolve?.('');
    return 'connected';
  }
  if (u.connection === 'close') {
    return 'close diproses';
  }
  return 'lainnya';
}

console.log('=== SKENARIO 1: creds lama ada -> QR harus muncul ===');
{
  const s = buatSesi(true);
  s.pairing = true;                      // startPairing menandai
  // Baileys konek memakai creds lama (bukan QR)
  const r1 = onConnectionUpdate(s, s.socket, { connection: 'open' }, () => ({ id: 'socket-baru', alive: true }));
  cek('creds lama terdeteksi & dibuang', r1, 'creds lama dibuang, socket diganti');
  cek('creds dihapus dari disk', s.credsDiDisk, false);
  cek('socket sudah diganti', s.socket.id, 'socket-baru');

  // Socket baru (tanpa creds) memancarkan QR
  const r2 = onConnectionUpdate(s, s.socket, { qr: 'raw-qr-string' }, () => s.socket);
  cek('QR terbit pada socket baru', r2, 'QR terbit');
  cek('pairing flag dimatikan setelah QR', s.pairing, false);
  cek('QR hanya terbit sekali', s.qrDiterbitkan, 1);
}

console.log('\n=== SKENARIO 2: creds TIDAK ada -> QR langsung muncul ===');
{
  const s = buatSesi(false);
  s.pairing = true;
  const r = onConnectionUpdate(s, s.socket, { qr: 'raw-qr-string' }, () => s.socket);
  cek('QR terbit tanpa buang creds', r, 'QR terbit');
  cek('creds tidak dihapus', s.credsDihapus, 0);
}

console.log('\n=== SKENARIO 3: setelah scan, JANGAN buang creds lagi (loop) ===');
{
  const s = buatSesi(false);
  s.pairing = true;
  onConnectionUpdate(s, s.socket, { qr: 'raw' }, () => s.socket);   // QR terbit
  // User scan -> Baileys konek 'open' dengan creds BARU
  const r = onConnectionUpdate(s, s.socket, { connection: 'open' }, () => ({ id: 'socket-x' }));
  cek('setelah scan: connected, bukan buang creds', r, 'connected');
  cek('creds TIDAK dihapus setelah scan', s.credsDihapus, 0);
  cek('QR tidak terbit lagi', s.qrDiterbitkan, 1);
}

console.log('\n=== SKENARIO 4: event "close" dari socket BASI harus diabaikan ===');
{
  const s = buatSesi(true);
  s.pairing = true;
  const socketLama = s.socket;
  onConnectionUpdate(s, socketLama, { connection: 'open' }, () => ({ id: 'socket-baru' }));
  cek('socket sudah diganti', s.socket.id, 'socket-baru');
  // Socket lama akhirnya memancarkan 'close' (terlambat)
  const r = onConnectionUpdate(s, socketLama, { connection: 'close' });
  cek('close dari socket basi DIABAIKAN', r, 'diabaikan: socket basi');
  cek('sesi baru tetap hidup', s.socket.id, 'socket-baru');
}

console.log('\n=== SKENARIO 5: bukan mode pairing -> tidak ada perubahan perilaku ===');
{
  const s = buatSesi(true);
  s.pairing = false;                     // sesi normal, bukan scan ulang
  const r = onConnectionUpdate(s, s.socket, { connection: 'open' }, () => ({ id: 'x' }));
  cek('sesi normal tetap connected', r, 'connected');
  cek('creds tidak disentuh', s.credsDihapus, 0);
}

console.log(`\n===== HASIL: ${pass} PASS / ${fail} FAIL =====`);
process.exit(fail > 0 ? 1 : 0);
