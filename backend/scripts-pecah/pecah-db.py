"""Pecah backend/src/db.ts (1.444 baris, 78 ekspor) per DOMAIN DATA.

Berkas ini istimewa karena sebagian isinya adalah EFEK SAMPING SAAT IMPOR, bukan
sekadar deklarasi: skema, migrasi kolom, index, seed settings, dan seed admin
semuanya berjalan begitu modul dimuat. Memindahkannya sembarangan akan membuat
tabel tidak pernah dibuat dan aplikasi gagal start.

Karena itu blok efek samping dipindah UTUH dan berurutan ke satu modul
(`db/skema.ts`), dan fasad `db.ts` memuatnya lebih dulu sebelum apa pun.

Prinsip tetap sama seperti tahap 1 dan 2: potong per RENTANG BARIS persis dari
berkas asli, jangan tulis ulang. Hanya baris impor yang dihasilkan otomatis,
dan pembersihannya diserahkan ke compiler (TS6133/TS6192), bukan regex.

Jalankan dari backend/: python3 scripts-pecah/pecah-db.py
"""
import re
import subprocess
from pathlib import Path

AKAR = Path(__file__).resolve().parent.parent
SUMBER = AKAR / 'src/db.ts'
TUJUAN_DIR = AKAR / 'src/db'
FASAD = AKAR / 'src/db.ts'

# ---------------------------------------------------------------- RENCANA ---
# Setiap berkas boleh terdiri dari BEBERAPA rentang. Berkas aslinya menyisipkan
# seksi (users → reset-password → users lagi → kuota → sessions), jadi
# mengelompokkan per domain menuntut lebih dari satu rentang.
#
# Setiap rentang WAJIB utuh secara sintaksis: mulai di awal deklarasi/komentar
# dan berakhir tepat setelah `}` penutup. Rentang yang membelah badan fungsi
# menghasilkan galat kurung yang membingungkan (TS1005/TS1128) — ini sudah
# pernah terjadi dan terdeteksi lewat build, bukan lewat mata.
#
# 'efek' menandai modul yang isinya berjalan saat impor (bukan hanya deklarasi).
RENCANA = [
    # (berkas, [rentang...], keterangan)
    ('client',         [(1, 12)],           'koneksi DB: mkdir + new DatabaseSync'),
    ('skema',          [(14, 223)],         'EFEK: PRAGMA, CREATE TABLE, migrasi kolom, index, seed settings'),
    ('users',          [(225, 338), (441, 549)], 'akun, kunci API, PIN/token blast, mapUser'),
    ('reset-password', [(340, 439)],        'token reset password (hash SHA-256)'),
    ('kuota',          [(551, 635)],        'validasi & increment kuota harian/mingguan/bulanan'),
    ('sessions',       [(637, 727)],        'sesi WhatsApp + profil nomor'),
    ('pesan',          [(728, 1015)],       'pesan keluar/masuk, antrean, webhook, antiban state'),
    ('lid',            [(1017, 1078)],      'pemetaan LID <-> nomor telepon'),
    ('kesehatan',      [(1080, 1132)],      'skor risiko + pengaturan antiban per sesi'),
    ('jeda',           [(1134, 1266)],      'persistensi status jeda antrean'),
    ('api-logs',       [(1268, 1407)],      'log permintaan API'),
    ('admin',          [(1409, 1442)],      'seed Super Admin saat instalasi baru'),
]

# Modul yang murni efek samping — tidak mengekspor apa pun.
MURNI_EFEK = {'skema'}

# ------------------------------------------------------------ PEMBACAAN ---
teks = SUMBER.read_text()
baris = teks.split('\n')
print(f'  sumber: {len(baris) - 1} baris')
print()

# Nama yang dideklarasikan level atas di berkas asli + nama yang diekspor.
DEKLARASI_ASLI = {}
EKSPOR_ASLI = set()
for m in re.finditer(r'^export (?:async )?function (\w+)', teks, re.M):
    DEKLARASI_ASLI[m.group(1)] = True
    EKSPOR_ASLI.add(m.group(1))
for m in re.finditer(r'^export const (\w+)', teks, re.M):
    DEKLARASI_ASLI[m.group(1)] = True
    EKSPOR_ASLI.add(m.group(1))
for m in re.finditer(r'^export (?:interface|type|class) (\w+)', teks, re.M):
    DEKLARASI_ASLI[m.group(1)] = True
    EKSPOR_ASLI.add(m.group(1))

# Nama privat (tidak diekspor) — harus tetap privat sesudah pemecahan.
PRIVAT_ASLI = set()
for m in re.finditer(r'^(?:async )?function (\w+)', teks, re.M):
    PRIVAT_ASLI.add(m.group(1))
for m in re.finditer(r'^const (\w+)', teks, re.M):
    PRIVAT_ASLI.add(m.group(1))
PRIVAT_ASLI -= EKSPOR_ASLI

print(f'  ekspor asli : {len(EKSPOR_ASLI)}')
print(f'  privat asli : {len(PRIVAT_ASLI)} ({sorted(PRIVAT_ASLI)})')
print()

# -------------------------------------------------------------- POTONGAN ---
TUJUAN_DIR.mkdir(exist_ok=True)
potongan = {}
for nama, rentang, ket in RENCANA:
    blok = []
    for mulai, akhir in rentang:
        blok.extend(baris[mulai - 1:akhir])
    potongan[nama] = '\n'.join(blok)
    jumlah_kode = sum(1 for b in blok if b.strip() and not b.strip().startswith('//'))
    rinci = ', '.join(f'{a}-{b}' for a, b in rentang)
    print(f'  {nama:<15} {rinci:<16} ({len(blok):>3} baris, {jumlah_kode:>3} kode)  {ket}')

# Buktikan tidak ada baris yang hilang atau terduplikasi antar rentang.
tercakup = []
for nama, rentang, _ in RENCANA:
    for mulai, akhir in rentang:
        tercakup.extend(range(mulai, akhir + 1))
tumpang = sorted(n for n in set(tercakup) if tercakup.count(n) > 1)
if tumpang:
    raise SystemExit(f'FATAL: baris tumpang tindih antar rentang: {tumpang}')
print()
print(f'  baris tercakup: {len(tercakup)} dari {len(baris) - 1}')
print()

# Pemilik setiap nama ekspor, untuk menghasilkan impor antar modul.
PEMILIK = {}
for nama, _rentang, _ket in RENCANA:
    for m in re.finditer(r'^export (?:async )?function (\w+)', potongan[nama], re.M):
        PEMILIK[m.group(1)] = nama
    for m in re.finditer(r'^export const (\w+)', potongan[nama], re.M):
        PEMILIK[m.group(1)] = nama
    for m in re.finditer(r'^export (?:interface|type|class) (\w+)', potongan[nama], re.M):
        PEMILIK[m.group(1)] = nama

# Simbol dari luar db.ts.
LUAR = {
    'hashPassword': ('../security.js', False),
    'generateApiKey': ('../security.js', False),
    'config': ('../config.js', False),
    'SessionInfo': ('../types.js', True),
    'UserRecord': ('../types.js', True),
    'OutboundMessage': ('../types.js', True),
    'WebhookRecord': ('../types.js', True),
    'db': ('./client.js', False),
    # Modul stdlib — hanya dipakai client.ts. Kalau tidak didaftarkan di sini,
    # client.ts kehilangan impornya dan gagal dengan TS2304 "Cannot find name".
    'DatabaseSync': ('node:sqlite', False),
    'mkdirSync': ('node:fs', False),
    'dirname': ('node:path', False),
}

# ---------------------------------------------------------------- IMPOR ---
def token_dipakai(kode, nama):
    """Apakah `nama` dipakai sebagai token di dalam kode."""
    return re.search(rf'(?<![\w.$]){re.escape(nama)}(?![\w$])', kode) is not None


def buang_impor_asli(blok):
    """Buang baris impor bawaan blok.

    Impor selalu dihasilkan ulang per modul. Kalau baris impor asli ikut
    tersalin, hasilnya impor ganda (TS2300) DAN path-nya salah — path asli
    relatif terhadap `src/`, sedangkan berkas baru berada di `src/db/`.
    """
    keluaran = []
    for b in blok:
        s = b.strip()
        if s.startswith('import ') or s.startswith('} from '):
            continue
        keluaran.append(b)
    return keluaran


def impor_untuk(nama, kode):
    """Baris impor untuk sebuah modul, berdasarkan simbol yang dipakainya.

    Kandidat mencakup ekspor db.ts SENDIRI dan simbol luar (types.ts,
    security.ts, config.ts). Kalau hanya ekspor db.ts yang dipertimbangkan,
    tipe seperti `OutboundMessage` dan helper seperti `hashPassword` tidak
    pernah terimpor.

    Impor dibuat LENGKAP dulu (semua kandidat yang terpakai), lalu dibersihkan
    oleh compiler. Menebak dengan regex terbukti salah berulang kali; compiler
    yang jadi hakim.
    """
    kandidat_semua = (EKSPOR_ASLI | set(LUAR)) - {'db'}
    simbol = [s for s in kandidat_semua if token_dipakai(kode, s)]

    kelompok = {}
    for s in simbol:
        if s in LUAR:
            modul, _tipe = LUAR[s]
        elif s in PEMILIK:
            pemilik = PEMILIK[s]
            if pemilik == nama:
                continue  # dideklarasikan di berkas ini sendiri
            modul = f'./{pemilik}.js'
        else:
            continue
        kelompok.setdefault(modul, []).append(s)

    # `db` selalu dari client.ts, kecuali di client.ts sendiri.
    if nama != 'client' and token_dipakai(kode, 'db'):
        kelompok.setdefault('./client.js', []).append('db')

    keluaran = []
    for modul in sorted(kelompok):
        nama_simbol = sorted(set(kelompok[modul]))
        # Hanya tipe → pakai `import type` supaya tidak jadi impor runtime.
        hanya_tipe = modul == '../types.js' and all(
            LUAR.get(s, (None, False))[1] for s in nama_simbol)
        kata = 'import type' if hanya_tipe else 'import'
        keluaran.append(f"{kata} {{ {', '.join(nama_simbol)} }} from '{modul}';")
    return '\n'.join(keluaran)


for nama in potongan:
    if nama in MURNI_EFEK:
        impor = "import { db } from './client.js';"
    else:
        impor = impor_untuk(nama, potongan[nama])
    blok = buang_impor_asli(potongan[nama].split('\n'))
    isi_blok = '\n'.join(blok).strip('\n')
    isi = (impor + '\n\n' + isi_blok + '\n') if impor else isi_blok + '\n'
    (TUJUAN_DIR / f'{nama}.ts').write_text(isi)

# ----------------------------------------------------------------- FASAD ---
fasad = ['/**',
         ' * Akses database wa-api.',
         ' *',
         ' * Berkas ini sengaja hanya meneruskan (re-export): isinya sudah dipisah per',
         ' * domain data di `db/`. Pemakai lama tidak perlu berubah — impor dari',
         " * './db.js' tetap bekerja seperti sebelumnya.",
         ' *',
         " * PENTING: urutan muat berkas ini bukan gaya penulisan, melainkan syarat",
         ' * kebenaran. `db/skema.ts` berisi efek samping (CREATE TABLE, migrasi kolom,',
         ' * index, seed settings) yang HARUS berjalan sebelum fungsi lain dipakai.',
         ' * Karena itu ia diimpor lebih dulu, dan `seedDefaultAdmin()` dipanggil',
         ' * paling akhir setelah semua modul selesai dimuat.',
         ' *',
         ' * - db/client.ts          koneksi DatabaseSync',
         ' * - db/skema.ts           skema, migrasi, index, seed settings (efek samping)',
         ' * - db/users.ts           akun, kunci API, PIN/token blast',
         ' * - db/reset-password.ts  token reset password',
         ' * - db/kuota.ts           kuota harian/mingguan/bulanan',
         ' * - db/sessions.ts        sesi WhatsApp',
         ' * - db/pesan.ts           pesan keluar/masuk, antrean, webhook',
         ' * - db/lid.ts             pemetaan LID <-> nomor telepon',
         ' * - db/kesehatan.ts       skor risiko sesi',
         ' * - db/jeda.ts            status jeda antrean',
         ' * - db/api-logs.ts        log permintaan API',
         ' * - db/admin.ts           seed Super Admin',
         ' */',
         "import './db/skema.js';",
         '',
         "export * from './db/client.js';",
         "export * from './db/users.js';",
         "export * from './db/reset-password.js';",
         "export * from './db/sessions.js';",
         "export * from './db/pesan.js';",
         "export * from './db/kuota.js';",
         "export * from './db/lid.js';",
         "export * from './db/kesehatan.js';",
         "export * from './db/jeda.js';",
         "export * from './db/api-logs.js';",
         "export * from './db/admin.js';",
         '',
         "import { seedDefaultAdmin } from './db/admin.js';",
         '',
         '// Instalasi baru: buat Super Admin pertama. Dijalankan setelah skema ada.',
         'seedDefaultAdmin();',
         '']
FASAD.write_text('\n'.join(fasad))

print('  berkas dibuat:')
for f in sorted(TUJUAN_DIR.glob('*.ts')):
    print(f'    src/db/{f.name:<22} {len(f.read_text().splitlines()):>4} baris')
print(f'    src/db.ts{"":<18} {len(FASAD.read_text().splitlines()):>4} baris')
