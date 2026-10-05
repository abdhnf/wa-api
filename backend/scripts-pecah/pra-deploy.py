#!/usr/bin/env python3
"""Bandingkan md5 seluruh berkas dist lokal vs VM sebelum menimpa apa pun.

Yang boleh berbeda HANYA berkas yang memang jadi sasaran refactor tahap ini.
Berkas lain yang ikut berbeda berarti ada perubahan tak tercatat di VM — dan
menimpa berarti menghapusnya. Dalam kasus itu deploy harus dihentikan.

Tahap 1 (server.ts):        server.js
Tahap 2 (mail-templates.ts): mail-templates.js

Jalankan dari backend/: python3 scripts-pecah/pra-deploy.py
"""
import subprocess
import sys
from pathlib import Path

AKAR = Path(__file__).resolve().parent.parent

# Berkas yang isinya memang berubah karena refactor, per tahap.
BOLEH_BERBEDA = {
    'server.js',          # tahap 1 — 2.095 baris jadi bootstrap tipis
    'mail-templates.js',  # tahap 2 — 610 baris jadi fasad re-export
    'db.js',              # tahap 3 — 1.444 baris jadi fasad re-export
    'antiban.js',         # tahap 4 — 1.282 baris jadi fasad re-export
}


def kumpulkan(teks):
    """Parse keluaran `md5sum`: '<hash>  <path>' (dua spasi)."""
    d = {}
    for ln in teks.split('\n'):
        ln = ln.rstrip()
        if not ln:
            continue
        # split(None, 1) tahan terhadap jumlah spasi yang berubah-ubah — memakai
        # partition('  ') rapuh karena satu spasi yang tergeser membuat seluruh
        # baris gagal diparse dan hasilnya "0 berkas" yang menyesatkan.
        bagian = ln.split(None, 1)
        if len(bagian) != 2:
            continue
        h, nama = bagian
        nama = nama.strip()
        if nama.startswith('dist/'):
            nama = nama[len('dist/'):]
        d[nama] = h
    return d


def md5_lokal():
    r = subprocess.run(
        ['find', 'dist', '-name', '*.js', '-exec', 'md5sum', '{}', ';'],
        capture_output=True, text=True, cwd=AKAR,
    )
    return kumpulkan(r.stdout)


def md5_vm():
    r = subprocess.run(
        ['ssh', 'vm207', 'cd ~/dev/wa-server-backend && find dist -name "*.js" -exec md5sum {} \\;'],
        capture_output=True, text=True,
    )
    return kumpulkan(r.stdout)


L = md5_lokal()
V = md5_vm()

if not L:
    print('  STOP: tidak ada berkas .js di dist lokal — build dulu.')
    sys.exit(1)

print(f'  berkas lokal : {len(L)}')
print(f'  berkas VM    : {len(V)}')

sama = sorted(n for n in L if n in V and L[n] == V[n])
beda = sorted(n for n in L if n in V and L[n] != V[n])
hanya_lokal = sorted(n for n in L if n not in V)
hanya_vm = sorted(n for n in V if n not in L)

print()
print(f'  identik        : {len(sama)}')
print(f'  berbeda isi    : {len(beda)}')
print(f'  hanya di lokal : {len(hanya_lokal)}')
print(f'  hanya di VM    : {len(hanya_vm)}')

print()
print('  --- berbeda isi ---')
for n in beda:
    tanda = 'DIHARAPKAN' if n in BOLEH_BERBEDA else 'TAK TERDUGA'
    print(f'    {tanda:<24} {n}')

print()
print('  --- hanya di lokal (berkas baru) ---')
for n in hanya_lokal:
    print(f'    {n}')

if hanya_vm:
    print()
    print('  --- hanya di VM (akan hilang kalau ditimpa) ---')
    for n in hanya_vm:
        print(f'    {n}')

tak_terduga = [n for n in beda if n not in BOLEH_BERBEDA] + hanya_vm

print()
if tak_terduga:
    print(f'  STOP: {len(tak_terduga)} berkas tak terduga — jangan timpa sebelum ditelusuri.')
    sys.exit(1)
print(f'  AMAN: hanya {sorted(beda)} berubah isi, sisanya identik atau berkas baru.')
