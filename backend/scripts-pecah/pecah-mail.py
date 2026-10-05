"""Pecah backend/src/mail-templates.ts (610 baris) per JENIS EMAIL.

Tiga jenis email di berkas ini: reset password, registrasi berhasil, dan email
uji. Masing-masing punya pasangan HTML + teks biasa. Bagian yang dipakai
bersama (palet warna, font, escapeHtml, BRAND) dipisah ke `dasar.ts`.

Pendekatan sama seperti pemecahan server.ts: badan kode DIPOTONG per rentang
baris dari berkas asli, bukan ditulis ulang. Yang dihasilkan otomatis hanya
deklarasi impor dan re-export.

`mail-templates.ts` tetap ada sebagai pintu masuk (re-export), sehingga tiga
berkas pemakainya (notifikasi-email.ts, password-reset.ts, routes/pengaturan.ts)
TIDAK perlu diubah sama sekali.

Jalankan dari ~/projects/wa-api/backend:
    cp /tmp/mail-templates.ts.asli src/mail-templates.ts && rm -rf src/email
    python3 scripts-pecah/pecah-mail.py
"""
import re
import subprocess
from pathlib import Path

AKAR = Path(__file__).resolve().parent.parent
SUMBER = AKAR / 'src' / 'mail-templates.ts'
TUJUAN = AKAR / 'src' / 'email'

baris = SUMBER.read_text().split('\n')


def potong(a, b):
    return '\n'.join(baris[a - 1:b])


# Simbol bersama yang tinggal di email/dasar.ts.
SIMBOL_DASAR = ['WARNA', 'FONT', 'escapeHtml', 'BRAND']

# nama berkas -> (judul, [rentang baris], nama yang perlu ditambah `export`)
RENCANA = [
    ('dasar.ts', (
        'Bagian bersama seluruh template email.\n\n'
        'Palet dan bentuknya mengikuti panel wa-api (src/index.css): latar krem hangat,\n'
        'kartu putih bergaris tipis, aksen hijau "pine", sudut membulat 6px (rounded-md\n'
        'Tailwind), dan kotak logo "WA" hijau seperti di halaman Auth.\n\n'
        'KENAPA HTML-nya BERTABEL, BUKAN flexbox/grid:\n'
        'Klien email tidak seragam. Outlook memakai mesin render Word, Gmail membuang\n'
        'sebagian <style> di kepala dokumen, dan banyak klien lain tidak mendukung\n'
        'flexbox sama sekali. Tabel + style inline adalah satu-satunya susunan yang\n'
        'tampil konsisten di semuanya. Ini bukan kode yang boleh "dirapikan" jadi\n'
        'div+flex — hasilnya akan berantakan justru di klien yang paling banyak dipakai.\n\n'
        'Warna ditulis sebagai literal hex, bukan var(--color-*), karena variabel CSS\n'
        'tidak didukung di sebagian besar klien email.',
        [(20, 62)],
        ['WARNA', 'FONT'],
    )),
    ('reset-password.ts', (
        'Email reset password: versi HTML dan versi teks biasa.',
        [(64, 294)],
        [],
    )),
    ('registrasi.ts', (
        'Email selamat datang untuk akun yang baru mendaftar: versi HTML dan\n'
        'versi teks biasa.',
        [(295, 534)],
        [],
    )),
    ('uji.ts', (
        'Email uji koneksi SMTP — dikirim dari halaman Pengaturan untuk memastikan\n'
        'konfigurasi email bekerja.',
        [(536, 610)],
        [],
    )),
]


def doc(judul):
    return '/**\n' + '\n'.join(' * ' + ln if ln else ' *' for ln in judul.split('\n')) + '\n */'


def impor_dasar(teks):
    """Impor simbol bersama yang benar-benar dipakai badan berkas ini."""
    dipakai = [n for n in SIMBOL_DASAR if re.search(r'(?<!\.)\b' + re.escape(n) + r'\b', teks)]
    if not dipakai:
        return []
    return [f"import {{ {', '.join(dipakai)} }} from './dasar.js';"]


def tulis(nama, judul, rentang, promosi):
    badan = '\n'.join(potong(a, b) for a, b in rentang)

    # Tambahkan `export` pada nama yang memang perlu dipakai berkas lain.
    # Hanya nama di daftar ini — `ribuan()` misalnya sengaja dibiarkan internal.
    for nm in promosi:
        badan = re.sub(
            r'^(const ' + re.escape(nm) + r'\b)',
            r'export \1',
            badan,
            count=1,
            flags=re.M,
        )

    impor = [] if nama == 'dasar.ts' else impor_dasar(badan)
    bagian = [doc(judul)]
    if impor:
        bagian.append('\n'.join(impor))
    bagian.append(badan)

    isi = '\n'.join(bagian) + '\n'
    (TUJUAN / nama).write_text(isi)
    return isi


TUJUAN.mkdir(parents=True, exist_ok=True)

hasil = {}
for nama, (judul, rentang, promosi) in RENCANA:
    hasil[nama] = tulis(nama, judul, rentang, promosi)

# ------------------------------------------------- mail-templates.ts (pintu masuk)
# Re-export supaya tiga berkas pemakai tidak perlu disentuh.
GALERI = {
    'dasar.ts': ['escapeHtml', 'BRAND'],
    'reset-password.ts': ['DataEmailReset', 'bangunTautanReset',
                          'templateResetPassword', 'templateResetPasswordTeks'],
    'registrasi.ts': ['DataEmailRegistrasi', 'templateRegistrasiBerhasil',
                      'templateRegistrasiBerhasilTeks'],
    'uji.ts': ['DataEmailUji', 'templateEmailUji', 'templateEmailUjiTeks'],
}

pintu = [
    '/**',
    ' * Template email untuk wa-api.',
    ' *',
    ' * Berkas ini sengaja hanya meneruskan (re-export): isinya sudah dipisah per',
    ' * jenis email di `email/`. Pemakai lama tidak perlu berubah — impor dari',
    " * './mail-templates.js' tetap bekerja seperti sebelumnya.",
    ' *',
    ' * - email/dasar.ts           palet, font, escapeHtml, BRAND',
    ' * - email/reset-password.ts  email reset password',
    ' * - email/registrasi.ts      email selamat datang akun baru',
    ' * - email/uji.ts             email uji koneksi SMTP',
    ' */',
]
for berkas, nama_nama in GALERI.items():
    daftar = ',\n  '.join(nama_nama)
    pintu.append(f"export {{\n  {daftar},\n}} from './email/{berkas[:-3]}.js';")

SUMBER.write_text('\n'.join(pintu) + '\n')

# ------------------------------------------------------------------ pembersihan
POLA_TAK_TERPAKAI = re.compile(
    r"^src/(?:email/)?([\w.-]+)\.ts\(\d+,\d+\): error TS6133: '([^']+)' is declared but its value is never read\."
)


def bersihkan(maks_putaran=6):
    """Buang impor tak terpakai dengan compiler sebagai hakim, bukan regex."""
    for putaran in range(maks_putaran):
        r = subprocess.run(
            ['npx', 'tsc', '-p', 'tsconfig.json', '--noUnusedLocals', '--noEmit'],
            capture_output=True, text=True, cwd=AKAR,
        )
        temuan = {}
        for ln in (r.stdout + r.stderr).split('\n'):
            m = POLA_TAK_TERPAKAI.match(ln.strip())
            if m:
                temuan.setdefault(m.group(1), set()).add(m.group(2))
        temuan = {k: v for k, v in temuan.items() if k in ('dasar', 'reset-password', 'registrasi', 'uji')}
        if not temuan:
            return putaran, 0

        berubah = False
        for nama_berkas, buang in temuan.items():
            jalur = TUJUAN / (nama_berkas + '.ts')
            if not jalur.exists():
                continue
            teks = jalur.read_text()
            for nm in buang:
                def ganti(m):
                    nonlocal berubah
                    isi = [x.strip() for x in m.group(1).split(',') if x.strip()]
                    sisa = [x for x in isi if x != nm]
                    if len(sisa) == len(isi):
                        return m.group(0)
                    berubah = True
                    if not sisa:
                        return ''
                    return f"import {{ {', '.join(sisa)} }} from {m.group(2)};"
                teks = re.sub(r"import \{ ([^}]+) \} from ('[^']+');", ganti, teks)
                teks = re.sub(r'\n\n\n+', '\n\n', teks)
            jalur.write_text(teks)

        if not berubah:
            return putaran, len(temuan)
    return maks_putaran, -1


print('=== pembersihan impor tak terpakai ===')
putaran, sisa = bersihkan()
print(f'  {"bersih setelah " + str(putaran) + " putaran" if sisa == 0 else f"PERHATIAN: {sisa} sisa setelah {putaran} putaran"}')

print()
print('=== berkas yang dihasilkan ===')
for nama in list(hasil) + ['mail-templates.ts']:
    p = (TUJUAN / nama) if nama != 'mail-templates.ts' else SUMBER
    print(f'  {nama:<20} {len(p.read_text().splitlines()):>5} baris')
