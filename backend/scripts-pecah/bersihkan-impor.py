#!/usr/bin/env python3
"""Buang impor tak terpakai memakai COMPILER sebagai hakim.

KENAPA BUKAN REGEX: deteksi impor tak terpakai dengan pola teks sudah terbukti
salah berulang kali. Regex cocok pada kata di dalam komentar (mis. `hashPassword`
yang hanya disebut di komentar penjelasan), pada nama field (`config` di dalam
`antiban_config`), pada string, dan pada tipe. Semuanya menghasilkan impor
"terpakai" yang sebenarnya tidak.

Cara yang benar: biarkan `tsc --noUnusedLocals` yang menilai, baca kode galatnya,
buang yang dimaksud, ulangi sampai bersih.

  TS6133  'X' is declared but its value is never read   → buang penanda X
  TS6192  All imports in import declaration are unused  → buang seluruh baris

Hanya baris impor di dalam direktori sasaran yang disentuh. Galat TS6133 lain
(variabel lokal yang memang tidak terpakai di berkas lain) dilaporkan apa adanya
dan TIDAK diubah — itu masalah lama yang bukan urusan pemecahan berkas.

Jalankan dari backend/: python3 scripts-pecah/bersihkan-impor.py [dir]
"""
import re
import subprocess
import sys
from pathlib import Path

AKAR = Path(__file__).resolve().parent.parent
SASARAN = sys.argv[1] if len(sys.argv) > 1 else 'src/db'


def jalankan_tsc():
    r = subprocess.run(
        ['npx', 'tsc', '-p', 'tsconfig.json', '--noUnusedLocals', '--noEmit'],
        capture_output=True, text=True, cwd=AKAR,
    )
    return r.stdout + r.stderr


def galat_impor(teks):
    """Galat tak-terpakai yang menunjuk berkas di dalam direktori sasaran."""
    hasil = []
    for ln in teks.split('\n'):
        m = re.match(r'^(src/[\w./-]+\.ts)\((\d+),(\d+)\): error (TS6133|TS6192): (.*)$', ln.strip())
        if not m:
            continue
        berkas, baris, _kol, kode, pesan = m.groups()
        if not berkas.startswith(SASARAN.rstrip('/') + '/'):
            continue
        nama = None
        if kode == 'TS6133':
            n = re.search(r"'([^']+)' is declared", pesan)
            if not n:
                continue
            nama = n.group(1)
        hasil.append((berkas, int(baris), kode, nama))
    return hasil


def buang_penanda(baris_teks, nama):
    """Buang `nama` dari daftar penanda impor pada satu baris."""
    m = re.match(r"^(\s*import\s+(?:type\s+)?\{)([^}]*)(\}\s+from\s+.+)$", baris_teks)
    if not m:
        return None
    kepala, isi, ekor = m.groups()
    penanda = [p.strip() for p in isi.split(',') if p.strip()]
    sisa = [p for p in penanda if p != nama]
    if len(sisa) == len(penanda):
        return None  # nama tidak ada di baris ini
    if not sisa:
        return ''  # tidak ada sisa → buang seluruh baris
    return f'{kepala} {", ".join(sisa)} {ekor}'


putaran = 0
dibuang = []
while putaran < 8:
    putaran += 1
    teks = jalankan_tsc()
    galat = galat_impor(teks)

    semua_unused = [ln for ln in teks.split('\n') if 'error TS6133' in ln or 'error TS6192' in ln]
    lain = [ln for ln in semua_unused if not any(
        ln.startswith(g[0]) for g in galat)]

    print(f'  putaran {putaran}: {len(galat)} impor tak terpakai di {SASARAN}/')
    if not galat:
        if lain:
            print()
            print(f'  catatan: {len(lain)} penanda tak terpakai LAIN di luar {SASARAN}/')
            print('           (masalah lama, bukan akibat pemecahan — tidak diubah)')
            for ln in lain[:8]:
                print(f'           {ln.strip()}')
        break

    # Kelompokkan per berkas, urutkan baris menurun supaya nomor baris tidak
    # bergeser saat baris dihapus.
    per_berkas = {}
    for berkas, baris, kode, nama in galat:
        per_berkas.setdefault(berkas, []).append((baris, kode, nama))

    for berkas, daftar in per_berkas.items():
        p = AKAR / berkas
        isi = p.read_text().split('\n')
        for baris, kode, nama in sorted(daftar, reverse=True):
            idx = baris - 1
            if idx < 0 or idx >= len(isi):
                continue
            if kode == 'TS6192':
                dibuang.append(f'{berkas}:{baris} (seluruh baris)')
                del isi[idx]
            else:
                baru = buang_penanda(isi[idx], nama)
                if baru is None:
                    continue
                dibuang.append(f'{berkas}:{baris} {nama}')
                if baru == '':
                    del isi[idx]
                else:
                    isi[idx] = baru
        p.write_text('\n'.join(isi))

print()
print(f'  total dibuang: {len(dibuang)}')
for d in dibuang:
    print(f'    {d}')
