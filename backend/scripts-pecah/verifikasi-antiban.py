"""Verifikasi mekanis pemecahan antiban.ts.

Dua hal yang dibuktikan:
  1. Seluruh baris kode berkas asli ada tepat SEKALI di hasil pemecahan.
     Dibandingkan sebagai multiset, bukan urutan, karena pengelompokan ulang
     memang mengubah urutan baris.
  2. Permukaan API `antiban.ts` tidak berubah.

CATATAN: `export` yang ditambahkan pada simbol internal (MS, hashContent,
identicalKey, ReplyRatioConfig) dinormalisasi di KEDUA sisi sebelum
dibandingkan — yang diuji isi kodenya, bukan kata kunci export-nya.

Jalankan dari backend/: python3 scripts-pecah/verifikasi-antiban.py
"""
import re
import subprocess
from collections import Counter
from pathlib import Path

AKAR = Path(__file__).resolve().parent.parent
ASLI = Path('/tmp/antiban.ts.asli')
HASIL = AKAR / 'src/antiban.ts'
DIR_HASIL = AKAR / 'src/antiban'
GAGAL = []


def baris_kode(teks):
    """Baris kode yang diperhitungkan: buang kosong, impor, dan normalisasi export."""
    hasil = []
    for b in teks.split('\n'):
        s = b.strip()
        if not s or s.startswith('import '):
            continue
        # `export` yang ditambahkan generator dinormalisasi agar perbandingan
        # menguji isi kode, bukan kata kunci export.
        s = re.sub(r'^export (type |async )?(?=(?:interface|type|class|const|function) )', '', s)
        hasil.append(s)
    return hasil


def ekspor_sumber(teks):
    nama = set()
    nama.update(re.findall(r'^export (?:async )?function (\w+)', teks, re.M))
    nama.update(re.findall(r'^export const (\w+)', teks, re.M))
    nama.update(re.findall(r'^export class (\w+)', teks, re.M))
    nama.update(re.findall(r'^export interface (\w+)', teks, re.M))
    nama.update(re.findall(r'^export type (\w+)', teks, re.M))
    # Bentuk `export { A, B } from './x.js'` dan `export type { C } from ...`.
    # Fasad memakai bentuk ini supaya simbol internal tidak ikut bocor.
    for blok in re.findall(r'^export (?:type )?\{([^}]*)\}', teks, re.M):
        for bagian in blok.split(','):
            bagian = bagian.strip()
            if not bagian:
                continue
            # `A as B` -> nama publiknya B
            nama.add(bagian.split(' as ')[-1].strip())
    # `export *` tidak menyebut nama — ditandai supaya bisa diperiksa terpisah.
    if re.search(r'^export \* from', teks, re.M):
        nama.add('__REEXPORT_SEMUA__')
    return nama


def tanpa_komentar(teks):
    """Buang komentar dan isi string — untuk menguji pemakaian simbol."""
    teks = re.sub(r"'(?:[^'\\\n]|\\.)*'", ' ', teks)
    teks = re.sub(r'"(?:[^"\\\n]|\\.)*"', ' ', teks)
    teks = re.sub(r'`(?:[^`\\]|\\.)*`', ' ', teks, flags=re.S)
    teks = re.sub(r'/\*.*?\*/', ' ', teks, flags=re.S)
    teks = re.sub(r'//[^\n]*', ' ', teks)
    return teks


print('=== 1. ISI BERKAS ===')
# Header berkas asli (baris 1-7: blok komentar /** ... */) SENGAJA tidak
# dipotong — isinya sudah pindah ke docstring fasad. Jadi hanya baris 8+ yang
# dibandingkan; kalau header ikut dihitung, ia selalu terbaca "hilang".
asli_kode = baris_kode('\n'.join(ASLI.read_text().split('\n')[7:]))
# Hanya modul di src/antiban/ yang dibandingkan: isinya potongan persis dari
# berkas asli. Fasad `antiban.ts` SELURUHNYA dihasilkan generator (impor,
# re-export, komentar) sehingga tidak boleh ikut dibandingkan sebagai potongan.
hasil_kode = []
for f in sorted(DIR_HASIL.glob('*.ts')):
    hasil_kode += baris_kode(f.read_text())

c_asli = Counter(asli_kode)
c_hasil = Counter(hasil_kode)
hilang = c_asli - c_hasil
baru = c_hasil - c_asli

print(f'  baris kode asli : {len(asli_kode)}')
print(f'  baris kode hasil: {len(hasil_kode)}')
if hilang:
    print(f'  HILANG ({sum(hilang.values())}):')
    for b, n in list(hilang.items())[:10]:
        print(f'    {n}x {b[:80]}')
    GAGAL.append('ada baris hilang')
else:
    print('  tidak ada baris hilang')
if baru:
    print(f'  BARU ({sum(baru.values())}):')
    for b, n in list(baru.items())[:10]:
        print(f'    {n}x {b[:80]}')
    GAGAL.append('ada baris baru')
else:
    print('  tidak ada baris baru')

print()
print('=== 2. PERMUKAAN API ===')
api_asli = ekspor_sumber(ASLI.read_text())
api_hasil = ekspor_sumber(HASIL.read_text())
fasad_reexport = '__REEXPORT_SEMUA__' in api_hasil
api_hasil.discard('__REEXPORT_SEMUA__')

print(f'  ekspor asli : {len(api_asli)}')
print(f'  ekspor fasad: {len(api_hasil)}')
kurang = sorted(api_asli - api_hasil)
tambah = sorted(api_hasil - api_asli)
if kurang:
    print(f'  KURANG: {kurang}')
    GAGAL.append('ekspor berkurang')
if tambah:
    print(f'  BERTAMBAH: {tambah}')
    GAGAL.append('ekspor bertambah')
if not kurang and not tambah:
    print('  permukaan API identik')

# Buktikan fasad TIDAK memakai `export *` (kalau ya, simbol internal bocor).
if fasad_reexport:
    print('  CATATAN: fasad memakai export * (tidak dipakai di sini)')
else:
    print('  fasad pakai daftar nama eksplisit (simbol internal tidak bocor)')

# Simbol internal harus ADA di modulnya tapi TIDAK ADA di fasad.
print()
print('=== 3. SIMBOL INTERNAL TIDAK BOCOR ===')
INTERNAL = {'03-util': ['MS', 'hashContent', 'identicalKey'], '10-reply-ratio': ['ReplyRatioConfig']}
# Fasad menyebut nama-nama ini DI KOMENTAR (untuk menjelaskan kenapa daftarnya
# eksplisit). Karena itu komentar harus dibuang dulu, kalau tidak setiap nama
# yang disebut di penjelasan akan terbaca sebagai "bocor".
teks_fasad = tanpa_komentar(HASIL.read_text())
for modul, simbol in INTERNAL.items():
    isi_modul = (DIR_HASIL / f'{modul}.ts').read_text()
    for s in simbol:
        ada_modul = bool(re.search(rf'^export (?:interface|type|class|const|function) {re.escape(s)}\b',
                                   isi_modul, re.M))
        ada_fasad = bool(re.search(rf'(?<![\w.$]){re.escape(s)}(?![\w$])', teks_fasad))
        tanda = 'OK' if (ada_modul and not ada_fasad) else 'MASALAH'
        if tanda == 'MASALAH':
            GAGAL.append(f'{s} bocor/tiada')
        print(f'  {tanda:<8} {s:<20} di modul: {ada_modul}  di fasad: {ada_fasad}')

print()
print('=== 4. PERMUKAAN API DI dist ===')
r = subprocess.run(
    ['node', '--no-warnings', '-e', "import('./dist/antiban.js').then(m => console.log(Object.keys(m).join('\\n')))"],
    capture_output=True, text=True, cwd=AKAR, env={'PATH': '/usr/bin:/bin:/usr/local/bin'})
if r.returncode != 0:
    print(f'  GAGAL memuat dist/antiban.js: {r.stderr.strip()[:200]}')
    GAGAL.append('dist tidak bisa dimuat')
else:
    dist_api = [n for n in r.stdout.strip().split('\n') if n]
    print(f'  ekspor nilai di dist: {len(dist_api)}')
    # Interface/type hilang saat kompilasi — itu wajar.
    tipe_saja = sorted(api_asli - set(dist_api))
    print(f'  tidak ada di dist ({len(tipe_saja)}, harus interface/type): {tipe_saja}')
    for t in tipe_saja:
        sumber = (DIR_HASIL).glob('*.ts')
        deklarasi = [f.name for f in sumber
                     if re.search(rf'^export (?:interface|type) {re.escape(t)}\b', f.read_text(), re.M)]
        if not deklarasi:
            print(f'    MASALAH: {t} bukan interface/type tapi hilang di dist')
            GAGAL.append(f'{t} hilang di dist')
    # Ekspor nilai asli harus SEMUA ada di dist.
    nilai_asli = {n for n in api_asli
                  if re.search(rf'^export (?:async )?(?:function|class|const) {re.escape(n)}\b',
                               ASLI.read_text(), re.M)}
    kurang_dist = sorted(nilai_asli - set(dist_api))
    if kurang_dist:
        print(f'  MASALAH: ekspor nilai hilang di dist: {kurang_dist}')
        GAGAL.append('ekspor nilai hilang di dist')
    else:
        print(f'  semua {len(nilai_asli)} ekspor nilai ada di dist')

print()
if GAGAL:
    print(f'  GAGAL: {GAGAL}')
    raise SystemExit(1)
print('  SEMUA VERIFIKASI LULUS')
