"""Verifikasi mekanis pemecahan db.ts.

Dua hal yang dibuktikan:
  1. Seluruh baris kode berkas asli ada tepat SEKALI di hasil pemecahan.
     Dibandingkan sebagai multiset, bukan urutan, karena pengelompokan ulang
     per domain memang mengubah urutan seksi (berkas aslinya menyisipkan seksi).
  2. Permukaan API (78 ekspor) utuh di sumber maupun di dist.

Urutan EFEK SAMPING tidak diperiksa di sini — itu diuji terpisah dengan
menjalankan modul terhadap database baru dan database lama.

Jalankan dari backend/: python3 scripts-pecah/verifikasi-db.py
"""
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

AKAR = Path(__file__).resolve().parent.parent
ASLI = Path('/tmp/db.ts.asli')
HASIL = AKAR / 'src/db.ts'
DIR_HASIL = AKAR / 'src/db'

gagal = 0

if not ASLI.exists():
    raise SystemExit('FATAL: /tmp/db.ts.asli tidak ada — backup sumber hilang.')

# ------------------------------------------------- 1. ISI KODE IDENTIK ---
print('=== isi kode identik dengan berkas asli ===')


def baris_kode(teks, buang_impor=True):
    """Baris kode yang diperhitungkan untuk perbandingan isi.

    Yang dibuang: baris kosong, baris impor, dan baris yang MEMANG dihasilkan
    ulang oleh generator (re-export fasad, pemanggilan seedDefaultAdmin,
    serta docstring fasad). Kalau tidak dibuang di KEDUA sisi, keduanya
    terbaca sebagai 'baris hilang' dan 'baris baru' padahal keduanya sengaja.
    """
    hasil = []
    in_doc = False
    for b in teks.split('\n'):
        s = b.strip()
        if not s:
            continue
        # Blok docstring /** ... */ di kepala berkas.
        if s == '/**':
            in_doc = True
            continue
        if in_doc:
            if s == '*/':
                in_doc = False
            continue
        if buang_impor and (s.startswith('import ') or s.startswith('} from ')):
            continue
        if s.startswith('export * from'):
            continue
        if s == 'seedDefaultAdmin();':
            continue
        hasil.append(s)
    return hasil


asli_kode = baris_kode(ASLI.read_text())
# Hanya modul di src/db/ yang dibandingkan: isinya potongan persis dari berkas
# asli. Fasad `db.ts` SELURUHNYA dihasilkan generator (impor, re-export,
# pemanggilan seed), jadi membandingkannya sebagai potongan akan selalu
# melaporkan "baris baru". Permukaan API fasad diperiksa terpisah di bawah.
hasil_kode = []
for f in sorted(DIR_HASIL.glob('*.ts')):
    hasil_kode += baris_kode(f.read_text())

ca = Counter(asli_kode)
ch = Counter(hasil_kode)

hilang = ca - ch
tambah = ch - ca

print(f'  baris kode asli   : {sum(ca.values())} ({len(ca)} unik)')
print(f'  baris kode hasil  : {sum(ch.values())} ({len(ch)} unik)')
print()

if hilang:
    gagal += 1
    print(f'  GAGAL: {sum(hilang.values())} baris HILANG:')
    for b, n in list(hilang.items())[:12]:
        print(f'    x{n}  {b[:88]}')
else:
    print('  OK: tidak ada baris asli yang hilang.')

if tambah:
    gagal += 1
    print(f'  GAGAL: {sum(tambah.values())} baris BARU tak dikenal:')
    for b, n in list(tambah.items())[:12]:
        print(f'    x{n}  {b[:88]}')
else:
    print('  OK: tidak ada baris baru di luar berkas asli.')

# --------------------------------------------------- 2. PERMUKAAN API ---
print()
print('=== permukaan API ===')


def ekspor_sumber(teks):
    nama = set()
    nama.update(re.findall(r'^export (?:async )?function (\w+)', teks, re.M))
    nama.update(re.findall(r'^export const (\w+)', teks, re.M))
    nama.update(re.findall(r'^export (?:interface|type|class) (\w+)', teks, re.M))
    for blok in re.findall(r'export (?:type )?\{([^}]+)\} from', teks):
        for n in blok.split(','):
            n = n.strip()
            if n:
                nama.add(n)
    # Re-export massal: `export * from './db/x.js'`. Fasad memakai bentuk ini,
    # jadi kalau tidak dikenali, fasad terbaca "mengekspor 0 nama".
    if re.search(r'^export \* from', teks, re.M):
        nama.add('__REEXPORT_SEMUA__')
    return nama


api_asli = ekspor_sumber(ASLI.read_text())
api_hasil = ekspor_sumber(HASIL.read_text())
fasad_reexport = '__REEXPORT_SEMUA__' in api_hasil
api_hasil.discard('__REEXPORT_SEMUA__')

print(f'  ekspor asli  : {len(api_asli)}')
print(f'  ekspor fasad : {len(api_hasil)}' + (' (+ re-export massal)' if fasad_reexport else ''))

if fasad_reexport:
    print('  OK: fasad memakai re-export massal — seluruh ekspor diteruskan.')
else:
    kurang = sorted(api_asli - api_hasil)
    if kurang:
        gagal += 1
        print(f'  GAGAL: {len(kurang)} ekspor tidak diteruskan fasad: {kurang}')
    else:
        print('  OK: fasad meneruskan seluruh ekspor.')

# Tiap nama harus benar-benar dideklarasikan di salah satu modul db/.
pemilik = {}
for f in sorted(DIR_HASIL.glob('*.ts')):
    t = f.read_text()
    for n in ekspor_sumber(t):
        pemilik.setdefault(n, f.name)

tak_ada = sorted(n for n in api_asli if n not in pemilik)
if tak_ada:
    gagal += 1
    print(f'  GAGAL: {len(tak_ada)} ekspor tidak ada di modul mana pun: {tak_ada}')
else:
    print(f'  OK: seluruh {len(api_asli)} ekspor punya modul pemilik.')

# Perbandingan dengan artefak terkompilasi (wujud nyata saat runtime).
print()
print('=== permukaan API di dist ===')
r = subprocess.run(
    ['node', '--no-warnings', '-e', "import('./dist/db.js').then(m => console.log(Object.keys(m).join('\\n')))"],
    capture_output=True, text=True, cwd=AKAR,
)
if r.returncode != 0:
    gagal += 1
    print(f'  GAGAL memuat dist/db.js: {r.stderr.strip()[:400]}')
else:
    nama_dist = set(n for n in r.stdout.strip().split('\n') if n)
    print(f'  dist mengekspor {len(nama_dist)} nama')
    # Bandingkan hanya ekspor NILAI; interface/type memang tidak ada di runtime.
    tipe_asli = set(re.findall(r'^export (?:interface|type) (\w+)', ASLI.read_text(), re.M))
    nilai_asli = api_asli - tipe_asli
    hilang_dist = sorted(nilai_asli - nama_dist)
    if hilang_dist:
        gagal += 1
        print(f'  GAGAL: {len(hilang_dist)} ekspor nilai hilang di dist: {hilang_dist}')
    else:
        print(f'  OK: seluruh {len(nilai_asli)} ekspor nilai ada di artefak terkompilasi.')
        print(f'      ({len(tipe_asli)} ekspor tipe tidak berlaku di runtime — diperiksa di tingkat sumber)')

print()
print(f'  berkas bermasalah: {gagal}')
sys.exit(1 if gagal else 0)
