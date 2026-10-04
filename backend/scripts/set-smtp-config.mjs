// Simpan kredensial SMTP untuk wa-api secara aman.
//
// KENAPA SKRIP INI ADA
// Kunci SMTP itu kredensial yang bisa dipakai mengirim email atas nama domain.
// Tiga aturan yang dipegang skrip ini:
//   1. Kunci TIDAK BOLEH lewat chat.
//   2. Kunci TIDAK BOLEH masuk git (folder scripts/ di repo ini tracked).
//   3. Kunci TIDAK BOLEH terlihat di layar saat diketik.
//
// Skrip ini membaca kunci dengan input tersembunyi, menuliskannya ke file mode
// 0600 di LUAR repo (~/.config/wa-api/mail.env), lalu MEMVERIFIKASI kredensial
// ke server SMTP sebelum dianggap berhasil. Verifikasi itu penting: salah ketik
// ketahuan saat itu juga, bukan nanti ketika user gagal reset password.
//
// Jalankan: node scripts/set-smtp-config.mjs
//
// Tidak ada nilai rahasia yang pernah dicetak ke stdout, dan file hasilnya
// hanya bisa dibaca pemiliknya (mode 0600).

import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect } from 'node:net';
import { mkdirSync, writeFileSync, existsSync, readFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR_KONFIG = join(homedir(), '.config', 'wa-api');
const FILE_KONFIG = join(DIR_KONFIG, 'mail.env');

// Default Brevo. Kalau provider lain, nilai ini bisa ditimpa lewat pertanyaan.
const PRESET = {
  host: 'smtp-relay.brevo.com',
  port: '465',
  secure: 'true',
};

function tulis(teks) {
  process.stdout.write(teks);
}

function tanya(pertanyaan, bawaan) {
  return new Promise((resolve) => {
    process.stdout.write(bawaan ? `${pertanyaan} [${bawaan}]: ` : `${pertanyaan}: `);
    const onData = (chunk) => {
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      const nilai = String(chunk).replace(/[\r\n]+$/, '').trim();
      resolve(nilai || bawaan || '');
    };
    process.stdin.resume();
    process.stdin.once('data', onData);
  });
}

/**
 * Input tersembunyi. Karakter tidak ditampilkan sama sekali, tidak ada asterisk,
 * supaya panjang kunci pun tidak bocor ke rekaman layar atau log terminal.
 */
function tanyaRahasia(pertanyaan) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const adalahTty = Boolean(stdin.isTTY);
    const rawSebelumnya = stdin.isRaw;

    tulis(pertanyaan);
    stdin.resume();
    stdin.setEncoding('utf8');
    if (adalahTty && stdin.setRawMode) stdin.setRawMode(true);

    let buf = '';
    const onData = (ch) => {
      for (const karakter of ch) {
        if (karakter === '\r' || karakter === '\n') {
          stdin.removeListener('data', onData);
          if (adalahTty && stdin.setRawMode) stdin.setRawMode(rawSebelumnya || false);
          stdin.pause();
          tulis('\n');
          resolve(buf);
          return;
        }
        if (karakter === '\u0003') {
          // Ctrl+C
          if (adalahTty && stdin.setRawMode) stdin.setRawMode(rawSebelumnya || false);
          tulis('\n');
          process.exit(130);
        }
        if (karakter === '\u007f' || karakter === '\b') {
          buf = buf.slice(0, -1);
          continue;
        }
        // Abaikan escape sequence (tombol panah dll) supaya tidak masuk ke nilai.
        if (karakter === '\u001b') continue;
        buf += karakter;
      }
    };
    stdin.on('data', onData);
  });
}

/**
 * Susun isi email uji dalam format RFC 5322.
 *
 * Header minimal yang wajib ada supaya email tidak dianggap spam:
 * From, To, Subject, Date, Message-ID, MIME-Version, Content-Type.
 * Tanpa Date dan Message-ID, banyak server menaikkan skor spam.
 */
function susunEmail({ dari, dariNama, tujuan }) {
  const sekarang = new Date();
  const idPesan = `<${sekarang.getTime()}.${Math.random().toString(36).slice(2)}@mail.srvx.my.id>`;
  const isi = [
    'Ini email uji dari skrip konfigurasi SMTP wa-api.',
    '',
    'Kalau kamu menerima ini, artinya:',
    '  1. Autentikasi SMTP Brevo berhasil',
    '  2. Alamat pengirim sudah diverifikasi di Brevo',
    '  3. Email tidak masuk folder spam',
    '',
    `Dikirim: ${sekarang.toISOString()}`,
    '',
  ].join('\r\n');

  const header = [
    `From: ${dariNama} <${dari}>`,
    `To: <${tujuan}>`,
    'Subject: Uji konfigurasi SMTP wa-api',
    `Date: ${sekarang.toUTCString()}`,
    `Message-ID: ${idPesan}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    'Auto-Submitted: auto-generated',
  ].join('\r\n');

  // Diakhiri CRLF.CRLF sebagai penanda akhir DATA pada protokol SMTP.
  return `${header}\r\n\r\n${isi}\r\n.\r\n`;
}

/**
 * Verifikasi kredensial dengan melakukan handshake SMTP sungguhan.
 *
 * Sengaja tanpa dependency: koneksi socket + dialog SMTP minimal (EHLO, STARTTLS,
 * AUTH LOGIN). Dua mode yang didukung, karena Brevo menerima keduanya dan salah
 * satu pasti dipakai:
 *   - port 465: TLS langsung sejak awal (implicit TLS)
 *   - port 587: koneksi polos dulu, lalu dinaikkan ke TLS lewat STARTTLS
 *
 * Kalau mode-nya salah, errornya membingungkan ("koneksi ditutup server"),
 * jadi mode ditentukan dari port dan STARTTLS ditangani eksplisit.
 *
 * Dua tingkat pengujian:
 *   - tanpa `tujuan`: hanya menguji autentikasi (tidak ada email terkirim)
 *   - dengan `tujuan`: lanjut sampai MAIL FROM / RCPT TO / DATA, jadi sekaligus
 *     membuktikan alamat pengirim sudah diverifikasi di sisi Brevo. Ini yang
 *     tidak bisa dibuktikan oleh autentikasi saja.
 */
function ujiSmtp({ host, port, user, pass, tujuan = null, dari = null, dariNama = null }) {
  return new Promise((resolve) => {
    const modeTlsLangsung = String(port) === '465';
    let selesai = false;
    let sock = null;

    const beres = (hasil) => {
      if (selesai) return;
      selesai = true;
      try { if (sock) sock.destroy(); } catch {}
      resolve(hasil);
    };

    // Mesin status dialog SMTP. Dipisah dari urusan socket supaya bisa dipakai
    // ulang setelah upgrade STARTTLS (handler data diganti, status dilanjutkan).
    let buf = '';
    let tahap = 0; // 0=sapaan 1=ehlo 2=starttls 3=ehlo-ulang 4=auth 5=user 6=pass
    let setelahStartTls = false;

    const pasangHandler = (socket) => {
      socket.setEncoding('utf8');
      socket.setTimeout(15000, () => beres({ ok: false, pesan: 'Timeout saat menghubungi server SMTP (15 detik).' }));
      socket.on('error', (e) => beres({ ok: false, pesan: `Koneksi gagal: ${e.message}` }));
      socket.on('close', () => beres({ ok: false, pesan: 'Koneksi ditutup server sebelum autentikasi selesai.' }));

      socket.on('data', (data) => {
        buf += data;
        let idx;
        while ((idx = buf.indexOf('\r\n')) !== -1) {
          const baris = buf.slice(0, idx);
          buf = buf.slice(idx + 2);

          const m = /^(\d{3})([ -])(.*)$/.exec(baris);
          if (!m) continue;
          if (m[2] === '-') continue; // baris lanjutan, tunggu baris terakhir

          const kode = Number(m[1]);
          const teks = m[3];

          if (tahap === 0) {
            if (kode !== 220) return beres({ ok: false, pesan: `Sapaan server tidak dikenali (${kode}): ${teks}` });
            tahap = 1;
            socket.write('EHLO wa-api.local\r\n');
          } else if (tahap === 1) {
            if (kode !== 250) return beres({ ok: false, pesan: `EHLO ditolak (${kode}): ${teks}` });
            if (modeTlsLangsung) {
              tahap = 4;
              socket.write('AUTH LOGIN\r\n');
            } else {
              tahap = 2;
              socket.write('STARTTLS\r\n');
            }
          } else if (tahap === 2) {
            if (kode !== 220) {
              return beres({
                ok: false,
                pesan: `STARTTLS ditolak (${kode}): ${teks}. Coba port 465, atau pastikan server mendukung STARTTLS.`,
              });
            }
            // Naikkan koneksi polos ini ke TLS, lalu lanjutkan dialog dari awal.
            const socketTls = new tlsConnect({ socket, servername: host }, () => {
              setelahStartTls = true;
              buf = '';
              tahap = 3;
              socketTls.write('EHLO wa-api.local\r\n');
            });
            socketTls.setEncoding('utf8');
            socketTls.setTimeout(15000, () => beres({ ok: false, pesan: 'Timeout saat negosiasi TLS (15 detik).' }));
            socketTls.on('error', (e) => beres({ ok: false, pesan: `Negosiasi TLS gagal: ${e.message}` }));
            socket = socketTls;
            pasangHandler(socketTls);
            return; // handler lama berhenti di sini
          } else if (tahap === 3) {
            if (kode !== 250) return beres({ ok: false, pesan: `EHLO setelah TLS ditolak (${kode}): ${teks}` });
            tahap = 4;
            socket.write('AUTH LOGIN\r\n');
          } else if (tahap === 4) {
            if (kode !== 334) return beres({ ok: false, pesan: `AUTH LOGIN tidak didukung (${kode}): ${teks}` });
            tahap = 5;
            socket.write(`${Buffer.from(user, 'utf8').toString('base64')}\r\n`);
          } else if (tahap === 5) {
            if (kode !== 334) return beres({ ok: false, pesan: `Username ditolak (${kode}): ${teks}` });
            tahap = 6;
            socket.write(`${Buffer.from(pass, 'utf8').toString('base64')}\r\n`);
          } else if (tahap === 6) {
            if (kode !== 235) {
              return beres({ ok: false, pesan: `Kredensial ditolak (${kode}): ${teks}` });
            }
            if (!tujuan) {
              return beres({
                ok: true,
                pesan: `Autentikasi diterima server (${modeTlsLangsung ? 'TLS langsung' : 'STARTTLS'}).`,
              });
            }
            tahap = 7;
            socket.write(`MAIL FROM:<${dari}>\r\n`);
          } else if (tahap === 7) {
            if (kode !== 250) {
              return beres({
                ok: false,
                pesan:
                  `MAIL FROM ditolak (${kode}): ${teks}\n` +
                  `         Kemungkinan besar alamat pengirim "${dari}" belum diverifikasi di Brevo.\n` +
                  '         Cek: Brevo -> Senders, Domains & Dedicated IPs -> pastikan domain/subdomain terverifikasi.',
              });
            }
            tahap = 8;
            socket.write(`RCPT TO:<${tujuan}>\r\n`);
          } else if (tahap === 8) {
            if (kode !== 250 && kode !== 251) {
              return beres({ ok: false, pesan: `RCPT TO ditolak (${kode}): ${teks}` });
            }
            tahap = 9;
            socket.write('DATA\r\n');
          } else if (tahap === 9) {
            if (kode !== 354) return beres({ ok: false, pesan: `DATA ditolak (${kode}): ${teks}` });
            tahap = 10;
            socket.write(susunEmail({ dari, dariNama, tujuan }));
          } else if (tahap === 10) {
            if (kode !== 250) {
              return beres({ ok: false, pesan: `Email ditolak setelah DATA (${kode}): ${teks}` });
            }
            socket.write('QUIT\r\n');
            return beres({
              ok: true,
              pesan: `Email uji terkirim ke ${tujuan} (${modeTlsLangsung ? 'TLS langsung' : 'STARTTLS'}).`,
            });
          }
        }
      });
    };

    sock = modeTlsLangsung
      ? tlsConnect({ host, port: Number(port), servername: host }, () => {})
      : netConnect({ host, port: Number(port) }, () => {});

    if (setelahStartTls) return; // tidak pernah terjadi; jaga-jaga
    pasangHandler(sock);
  });
}

function bacaKonfigurasiLama() {
  if (!existsSync(FILE_KONFIG)) return null;
  const isi = readFileSync(FILE_KONFIG, 'utf8');
  const map = {};
  for (const baris of isi.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(baris.trim());
    if (m) map[m[1]] = m[2];
  }
  return map;
}

async function utama() {
  // Mode kirim: verifikasi kredensial tersimpan LALU kirim email uji sungguhan.
  // Ini satu-satunya cara membuktikan alamat pengirim sudah diverifikasi di Brevo;
  // autentikasi saja tidak membuktikannya.
  const argKirim = process.argv.find((a) => a.startsWith('--send='));
  if (argKirim) {
    const tujuan = argKirim.slice('--send='.length).trim();
    if (!tujuan || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(tujuan)) {
      console.error('  Format tujuan tidak valid. Contoh: --send=nama@domain.com');
      process.exit(2);
    }
    const cfg = bacaKonfigurasiLama();
    if (!cfg) {
      console.error(`  Tidak ada konfigurasi tersimpan di ${FILE_KONFIG}`);
      process.exit(2);
    }
    console.log('');
    console.log(`  Mengirim email uji via ${cfg.MAIL_HOST}:${cfg.MAIL_PORT}`);
    console.log(`    dari   : ${cfg.MAIL_FROM_ADDRESS}`);
    console.log(`    tujuan : ${tujuan}`);
    console.log('');
    const hasil = await ujiSmtp({
      host: cfg.MAIL_HOST,
      port: cfg.MAIL_PORT,
      user: cfg.MAIL_USER,
      pass: cfg.MAIL_PASS,
      tujuan,
      dari: cfg.MAIL_FROM_ADDRESS,
      dariNama: cfg.MAIL_FROM_NAME || 'wa-api',
    });
    if (hasil.ok) {
      console.log(`  OK: ${hasil.pesan}`);
      console.log('  Cek kotak masuk (dan folder spam) tujuan.');
      process.exit(0);
    }
    console.error(`  GAGAL: ${hasil.pesan}`);
    process.exit(1);
  }

  // Mode uji: verifikasi kredensial yang SUDAH tersimpan, tanpa menanyakan apa pun.
  // Berguna untuk memastikan kunci masih berlaku (mis. setelah rotasi di Brevo).
  if (process.argv.includes('--test')) {
    const cfg = bacaKonfigurasiLama();
    if (!cfg) {
      console.error(`  Tidak ada konfigurasi tersimpan di ${FILE_KONFIG}`);
      process.exit(2);
    }
    console.log('');
    console.log(`  Menguji kredensial tersimpan ke ${cfg.MAIL_HOST}:${cfg.MAIL_PORT} ...`);
    const hasil = await ujiSmtp({
      host: cfg.MAIL_HOST,
      port: cfg.MAIL_PORT,
      user: cfg.MAIL_USER,
      pass: cfg.MAIL_PASS,
    });
    if (hasil.ok) {
      console.log(`  OK: ${hasil.pesan}`);
      process.exit(0);
    }
    console.error(`  GAGAL: ${hasil.pesan}`);
    process.exit(1);
  }

  console.log('');
  console.log('  Konfigurasi SMTP wa-api');
  console.log('  Kunci tidak akan ditampilkan, tidak masuk git, dan tidak lewat chat.');
  console.log('');

  if (!process.stdin.isTTY) {
    console.error('  DITOLAK: skrip ini butuh terminal interaktif (TTY) untuk input tersembunyi.');
    console.error('  Kalau input tidak tersembunyi, kunci bisa terlihat di riwayat terminal.');
    process.exit(2);
  }

  const lama = bacaKonfigurasiLama();
  if (lama) {
    console.log(`  Konfigurasi lama ditemukan di ${FILE_KONFIG}`);
    console.log(`    host : ${lama.MAIL_HOST || '-'}`);
    console.log(`    user : ${lama.MAIL_USER ? lama.MAIL_USER.slice(0, 3) + '***' : '-'}`);
    console.log(`    kunci: [${lama.MAIL_PASS ? lama.MAIL_PASS.length : 0} karakter tersimpan]`);
    console.log('  Melanjutkan akan menimpanya.');
    console.log('');
  }

  const host = await tanya('  SMTP host', lama?.MAIL_HOST || PRESET.host);
  const port = await tanya('  SMTP port', lama?.MAIL_PORT || PRESET.port);
  const user = await tanya('  Login SMTP (email akun Brevo)', lama?.MAIL_USER || '');
  const dariAlamat = await tanya('  Alamat pengirim (from)', lama?.MAIL_FROM_ADDRESS || 'noreply@mail.srvx.my.id');
  const dariNama = await tanya('  Nama pengirim (from name)', lama?.MAIL_FROM_NAME || 'wa-api');

  console.log('');
  console.log('  Kunci SMTP: ketikan tidak akan terlihat di layar.');
  const kunci1 = await tanyaRahasia('  Kunci SMTP: ');
  if (!kunci1) {
    console.error('  DITOLAK: kunci kosong.');
    process.exit(2);
  }
  const kunci2 = await tanyaRahasia('  Ulangi kunci SMTP: ');
  if (kunci1 !== kunci2) {
    console.error('  DITOLAK: kedua isian tidak sama. Tidak ada yang disimpan.');
    process.exit(2);
  }

  console.log('');
  console.log(`  Memverifikasi kredensial ke ${host}:${port} ...`);
  const hasil = await ujiSmtp({ host, port, user, pass: kunci1 });

  if (!hasil.ok) {
    console.error('');
    console.error(`  GAGAL: ${hasil.pesan}`);
    console.error('  Tidak ada yang disimpan. Periksa kembali host/port/login/kunci, lalu ulangi.');
    console.error('');
    console.error('  Catatan: kunci SMTP Brevo berbeda dari password akun. Ambil di');
    console.error('  dashboard Brevo -> SMTP & API -> SMTP, bukan password login.');
    process.exit(1);
  }

  console.log(`  OK: ${hasil.pesan}`);

  mkdirSync(DIR_KONFIG, { recursive: true, mode: 0o700 });
  const isi = [
    '# Kredensial SMTP wa-api. JANGAN di-commit, JANGAN dikirim lewat chat.',
    `# Dibuat: ${new Date().toISOString()}`,
    `MAIL_HOST=${host}`,
    `MAIL_PORT=${port}`,
    `MAIL_SECURE=${port === '465' ? 'true' : 'false'}`,
    `MAIL_USER=${user}`,
    `MAIL_PASS=${kunci1}`,
    `MAIL_FROM_ADDRESS=${dariAlamat}`,
    `MAIL_FROM_NAME=${dariNama}`,
    '',
  ].join('\n');

  writeFileSync(FILE_KONFIG, isi, { mode: 0o600 });
  chmodSync(FILE_KONFIG, 0o600);

  console.log('');
  console.log(`  Tersimpan: ${FILE_KONFIG} (mode 0600, di luar repo git)`);
  console.log(`  Panjang kunci tersimpan: ${kunci1.length} karakter`);
  console.log('');
  console.log('  Kredensial sudah terverifikasi diterima server SMTP.');
  console.log('  Langkah berikutnya: hubungkan file ini ke konfigurasi aplikasi');
  console.log('  (tabel settings wa-api) saat fitur reset password dibangun.');
  console.log('');
}

utama().catch((e) => {
  console.error(`  ERROR tak terduga: ${e.message}`);
  process.exit(1);
});
