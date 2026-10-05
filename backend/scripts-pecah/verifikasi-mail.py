"""Verifikasi mekanis pemecahan mail-templates.ts.

Dua hal yang dibuktikan:
  1. Isi kode tiap berkas hasil sama persis dengan potongan di berkas asli.
  2. Permukaan API (nama yang diekspor mail-templates.js) TIDAK berubah —
     inilah kontrak yang dipegang tiga berkas pemakai.
"""
import re
import subprocess
import sys
from pathlib import Path

AKAR = Path.home() / 'projects/wa-api/backend'
ASLI = Path('/tmp/mail-templates.ts.asli').read_text().split('\n')
EMAIL = AKAR / 'src' / 'email'

RENCANA = {
    'dasar.ts': [(20, 62)],
    'reset-password.ts': [(64, 294)],
    'registrasi.ts': [(295, 534)],
    'uji.ts': [(536, 610)],
}

gagal = 0

# ---------------------------------------------------------------- 1. isi kode
print('=== isi kode identik dengan berkas asli ===')
total = 0
for nama, rentang in RENCANA.items():
    jalur = EMAIL / nama
    if not jalur.exists():
        print(f'  HILANG {nama}')
        gagal += 1
        continue

    garis = jalur.read_text().split('\n')
    # Buang header JSDoc dan baris impor — yang dibandingkan hanya badan kode.
    idx = 0
    while idx < len(garis) and (garis[idx].startswith('/**') or garis[idx].startswith(' *')
                               or garis[idx].startswith(' */') or garis[idx].startswith('import ')
                               or garis[idx].strip() == ''):
        idx += 1
    bersih = [ln.rstrip() for ln in garis[idx:] if ln.strip()]

    harapan = []
    for a, b in rentang:
        harapan.extend(ASLI[a - 1:b])
    harapan = [ln.rstrip() for ln in harapan if ln.strip()]

    # dasar.ts sengaja menambah `export` pada WARNA/FONT. Normalisasi di KEDUA
    # sisi — prefiks itu tidak mengubah logika, dan kalau generator lupa
    # menambahkannya, compiler yang menangkapnya.
    if nama == 'dasar.ts':
        bersih = [re.sub(r'^export ', '', ln) for ln in bersih]
        harapan = [re.sub(r'^export ', '', ln) for ln in harapan]

    total += len(harapan)
    if bersih == harapan:
        print(f'  OK    {nama:<20} {len(harapan):>4} baris kode identik')
        continue

    gagal += 1
    print(f'  GAGAL {nama:<20} berbeda (hasil {len(bersih)} vs asli {len(harapan)})')
    for i in range(max(len(bersih), len(harapan))):
        x = bersih[i] if i < len(bersih) else '<tidak ada>'
        y = harapan[i] if i < len(harapan) else '<tidak ada>'
        if x != y:
            print(f'        baris {i + 1} hasil : {x[:100]}')
            print(f'        baris {i + 1} asli  : {y[:100]}')
            break

print(f'  total baris diverifikasi: {total}')

# ------------------------------------------------------ 2. permukaan API (source)
print()
print('=== permukaan API di sumber ===')


def ekspor_dari(teks):
    """Nama yang diekspor dari sebuah berkas TypeScript."""
    nama = set()
    nama.update(re.findall(r'^export (?:async )?function (\w+)', teks, re.M))
    nama.update(re.findall(r'^export const (\w+)', teks, re.M))
    nama.update(re.findall(r'^export interface (\w+)', teks, re.M))
    nama.update(re.findall(r'^export type (\w+)', teks, re.M))
    nama.update(re.findall(r'^export class (\w+)', teks, re.M))
    # Re-export, dua bentuk: `export { a, b } from` dan `export type { T } from`.
    # Bentuk kedua wajib ikut dikenali — kalau tidak, ekspor tipe terbaca sebagai
    # "hilang" padahal ada.
    for blok in re.findall(r'export (?:type )?\{([^}]+)\} from', teks):
        for n in blok.split(','):
            n = n.strip()
            if n:
                nama.add(n)
    return nama


def ekspor_tipe(teks):
    """Nama ekspor yang HANYA ada di tingkat tipe — hilang saat kompilasi."""
    nama = set(re.findall(r'^export (?:interface|type) (\w+)', teks, re.M))
    for blok in re.findall(r'export type \{([^}]+)\} from', teks):
        for n in blok.split(','):
            n = n.strip()
            if n:
                nama.add(n)
    return nama


asli_teks = Path('/tmp/mail-templates.ts.asli').read_text()
asli_api = ekspor_dari(asli_teks)
baru_api = ekspor_dari((AKAR / 'src/mail-templates.ts').read_text())
tipe = ekspor_tipe(asli_teks)

# Ekspor tipe (interface/type) tidak punya wujud saat runtime, jadi tidak bisa
# diperiksa di dist. Ia diperiksa di tingkat sumber, dan keberadaannya terbukti
# dari build tsc yang lulus — pemakai yang mengimpor tipe itu ikut dikompilasi.
nilai_asli = asli_api - tipe
nilai_baru = baru_api - tipe

print(f'  ekspor sebelum : {len(asli_api)} nama ({len(nilai_asli)} nilai + {len(tipe)} tipe)')
print(f'  ekspor sesudah : {len(baru_api)} nama ({len(nilai_baru)} nilai + {len(tipe)} tipe)')
print(f'  tipe (tak ada di runtime): {", ".join(sorted(tipe))}')

hilang = sorted(asli_api - baru_api)
baru = sorted(baru_api - asli_api)
if hilang:
    print(f'  GAGAL: {len(hilang)} ekspor HILANG: {hilang}')
    gagal += 1
if baru:
    print(f'  PERHATIAN: {len(baru)} ekspor BARU: {baru}')
if not hilang and not baru:
    print('  OK: permukaan API identik — pemakai lama tidak perlu diubah.')

# ------------------------------------------- 3. permukaan API (artefak terkompilasi)
print()
print('=== permukaan API di dist (hasil nyata, bukan teks sumber) ===')
r = subprocess.run(
    ['node', '-e', "const m=require('./dist/mail-templates.js');console.log(Object.keys(m).sort().join('\\n'))"],
    capture_output=True, text=True, cwd=AKAR,
)
if r.returncode != 0:
    print('  GAGAL: dist/mail-templates.js tidak bisa dimuat')
    print(f'    {r.stderr.strip()[:300]}')
    gagal += 1
else:
    nama_dist = [n for n in r.stdout.strip().split('\n') if n]
    print(f'  dist mengekspor {len(nama_dist)} nama:')
    for n in nama_dist:
        print(f'    {n}')
    # Bandingkan hanya ekspor NILAI; ekspor tipe memang tidak ada di runtime.
    hilang_dist = sorted(nilai_asli - set(nama_dist))
    if hilang_dist:
        print(f'  GAGAL: {len(hilang_dist)} ekspor nilai hilang di dist: {hilang_dist}')
        gagal += 1
    else:
        print(f'  OK: seluruh {len(nilai_asli)} ekspor nilai ada di artefak terkompilasi.')
        print(f'      ({len(tipe)} ekspor tipe tidak berlaku di runtime — diperiksa di tingkat sumber)')

print()
print(f'  berkas bermasalah: {gagal}')
sys.exit(1 if gagal else 0)
