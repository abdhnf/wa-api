"""Bandingkan dua berkas JSON hasil banding-antiban.mjs."""
import json
import sys

a = json.load(open(sys.argv[1]))
b = json.load(open(sys.argv[2]))
print(f'  lama: {len(a)} pengamatan | baru: {len(b)} pengamatan')

if len(a) != len(b):
    print('  GAGAL: jumlah pengamatan berbeda')
    sys.exit(1)

beda = []
for x, y in zip(a, b):
    if x['nama'] != y['nama']:
        beda.append((x['nama'], y['nama'], 'NAMA BEDA'))
    elif json.dumps(x['nilai'], sort_keys=True) != json.dumps(y['nilai'], sort_keys=True):
        beda.append((x['nama'], x['nilai'], y['nilai']))

if beda:
    print(f'  GAGAL: {len(beda)} pengamatan berbeda')
    for nama, va, vb in beda[:12]:
        print(f'    {nama}')
        print(f'      lama: {json.dumps(va)[:150]}')
        print(f'      baru: {json.dumps(vb)[:150]}')
    sys.exit(1)

print('  IDENTIK — seluruh pengamatan sama persis')
# Ringkas cakupan supaya kelihatan apa yang benar-benar diuji.
kelompok = {}
for x in a:
    kunci = x['nama'].split('.')[0]
    kelompok[kunci] = kelompok.get(kunci, 0) + 1
print('  cakupan: ' + ', '.join(f'{k}={v}' for k, v in sorted(kelompok.items())))
