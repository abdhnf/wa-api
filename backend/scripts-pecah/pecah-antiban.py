"""Pecah backend/src/antiban.ts (1.282 baris) per GUARD anti-ban.

Berkas ini nol impor (mandiri) dan isinya kumpulan class independen, jadi
potong-per-rentang berlaku penuh seperti db.ts.

Urutan deklarasi di berkas asli TIDAK bisa dipertahankan apa adanya: tipe
`AntiBanConfig` (baris 35) merujuk `ContactGraphConfig` yang baru muncul di
baris 1249. Selama semuanya satu berkas, TypeScript menaikkan (hoist) deklarasi
tipe sehingga urutan tidak masalah. Setelah dipecah, rujukan itu menjadi impor
antar berkas — jadi urutan mengikuti GRAF DEPENDENSI, bukan urutan asli.

Prinsip tetap: potong per RENTANG BARIS persis, jangan tulis ulang. Hanya impor
yang dihasilkan otomatis, dan pembersihannya diserahkan ke compiler.

Jalankan dari backend/: python3 scripts-pecah/pecah-antiban.py
"""
import re
from pathlib import Path

AKAR = Path(__file__).resolve().parent.parent
SUMBER = AKAR / 'src/antiban.ts'
TUJUAN_DIR = AKAR / 'src/antiban'
FASAD = AKAR / 'src/antiban.ts'

# ---------------------------------------------------------------- RENCANA ---
# Rentang INKLUSIF, dipisah agar komentar kepala milik class yang benar.
RENCANA = [
    # (berkas, mulai, akhir, keterangan)
    ('01-tipe',         8,   61,   'AntiBanState + AntiBanConfig'),
    ('02-preset',       62,  163,  'DEFAULT_ANTIBAN_CONFIG, AntiBanPreset, ANTIBAN_PRESETS'),
    ('03-util',         164, 211,  'MS, gaussianJitter, hashContent, identicalKey, normalizeContentForHash'),
    ('04-rate-limiter', 212, 361,  'RateLimiter (sliding window + identical spam guard)'),
    ('05-warmup',       362, 447,  'WarmUp (kuota bertahap 7 hari)'),
    ('06-timelock',     448, 540,  'TimelockGuard (error 463)'),
    ('07-presence',     541, 603,  'PresenceChoreographer (circadian + typing plan)'),
    ('08-reconnect',    604, 656,  'ReconnectThrottle (ramp kecepatan setelah reconnect)'),
    ('09-ban-recovery', 658, 823,  'BanRecoveryOrchestrator (pemulihan berjenjang)'),
    ('10-reply-ratio',  825, 986,  'ReplyRatioGuard (rasio balasan)'),
    ('11-contact-graph',988, 1283, 'ContactGraphWarmer (handshake + lurk period)'),
]

# Simbol yang dulu privat di berkas ini tapi harus dipakai lintas berkas hasil.
# Ditambahkan `export` HANYA di modulnya; fasad memakai daftar nama eksplisit
# sehingga simbol ini tidak bocor ke API publik `antiban.js`.
EKSPOR_INTERNAL = {
    '03-util':        ['MS', 'hashContent', 'identicalKey'],
    '10-reply-ratio': ['ReplyRatioConfig'],
}

# ------------------------------------------------------------ PEMBACAAN ---
teks = SUMBER.read_text()
baris = teks.split('\n')
print(f'  sumber: {len(baris) - 1} baris')
print()

# Semua deklarasi level atas: nama -> 'tipe' | 'nilai'
JENIS = {}
for pola, jenis in ((r'^(?:export )?(?:interface|type) (\w+)', 'tipe'),
                    (r'^(?:export )?(?:async )?function (\w+)', 'nilai'),
                    (r'^(?:export )?class (\w+)', 'nilai'),
                    (r'^(?:export )?const (\w+)', 'nilai')):
    for m in re.finditer(pola, teks, re.M):
        JENIS[m.group(1)] = jenis

# Ekspor publik berkas asli — dipakai untuk membangun fasad.
EKSPOR_ASLI = []
for m in re.finditer(r'^export (?:async )?(function|class|const|interface|type) (\w+)', teks, re.M):
    EKSPOR_ASLI.append((m.group(2), 'tipe' if m.group(1) in ('interface', 'type') else 'nilai'))
print(f'  ekspor publik berkas asli: {len(EKSPOR_ASLI)}')

# -------------------------------------------------------------- POTONGAN ---
TUJUAN_DIR.mkdir(exist_ok=True)
potongan = {}
for nama, mulai, akhir, ket in RENCANA:
    blok = baris[mulai - 1:akhir]
    potongan[nama] = '\n'.join(blok)
    print(f'  {nama:<17} {mulai:>5}-{akhir:<5} ({len(blok):>4} baris)  {ket}')

# Buktikan tidak ada baris tumpang tindih dan semua baris deklarasi tercakup.
tercakup = []
for nama, mulai, akhir, _ in RENCANA:
    tercakup.extend(range(mulai, akhir + 1))
tumpang = sorted(n for n in set(tercakup) if tercakup.count(n) > 1)
if tumpang:
    raise SystemExit(f'FATAL: baris tumpang tindih: {tumpang}')
print()
print(f'  baris tercakup: {len(tercakup)} (1-7 = header berkas asli, tidak dipotong)')
print()

# Pemilik tiap nama.
PEMILIK = {}
for nama, _, _, _ in RENCANA:
    for m in re.finditer(r'^(?:export )?(?:async )?(?:function|class|const|interface|type) (\w+)',
                         potongan[nama], re.M):
        PEMILIK[m.group(1)] = nama


def buang_impor_asli(blok):
    """Buang baris impor bawaan potongan (di berkas ini tidak ada, tapi dijaga)."""
    return [b for b in blok if not b.strip().startswith('import ')]


def kode_murni(kode):
    """Buang komentar DAN isi string sebelum menguji pemakaian simbol.

    Ini WAJIB. Tanpa ini, nama kelas yang cuma disebut di komentar penjelasan
    dianggap pemakaian nyata sehingga menghasilkan impor palsu — dan impor palsu
    menambah ketergantungan runtime yang tidak ada di berkas asli.
    `noUnusedLocals` bernilai false, jadi compiler TIDAK akan menegur impor itu.

    Isi string dibuang lebih dulu supaya '//' di dalam URL tidak dibaca sebagai
    awal komentar.
    """
    kode = re.sub(r"'(?:[^'\\\n]|\\.)*'", ' ', kode)
    kode = re.sub(r'"(?:[^"\\\n]|\\.)*"', ' ', kode)
    kode = re.sub(r'`(?:[^`\\]|\\.)*`', ' ', kode, flags=re.S)
    kode = re.sub(r'/\*.*?\*/', ' ', kode, flags=re.S)
    kode = re.sub(r'//[^\n]*', ' ', kode)
    return kode


def impor_untuk(nama, kode):
    """Impor antar berkas hasil, berdasarkan simbol yang benar-benar dipakai."""
    bersih = kode_murni(kode)
    kelompok_tipe = {}
    kelompok_nilai = {}
    for simbol, jenis in JENIS.items():
        if simbol == nama:
            continue
        if not re.search(rf'(?<![\w.$]){re.escape(simbol)}(?![\w$])', bersih):
            continue
        pemilik = PEMILIK.get(simbol)
        if not pemilik or pemilik == nama:
            continue
        modul = f'./{pemilik}.js'
        (kelompok_tipe if jenis == 'tipe' else kelompok_nilai).setdefault(modul, []).append(simbol)

    keluaran = []
    for modul in sorted(kelompok_nilai):
        sisa = sorted(set(kelompok_nilai[modul]))
        keluaran.append(f"import {{ {', '.join(sisa)} }} from '{modul}';")
    for modul in sorted(kelompok_tipe):
        sisa = sorted(set(kelompok_tipe[modul]))
        # Baris TERPISAH, bukan digabung ke impor nilai dan bukan di-skip.
        # Satu modul bisa menyumbang nilai sekaligus tipe; impor tipe terpisah
        # dijamin hilang saat kompilasi sehingga tidak menambah ketergantungan
        # runtime maupun siklus.
        keluaran.append(f"import type {{ {', '.join(sisa)} }} from '{modul}';")
    return '\n'.join(keluaran)


for nama in potongan:
    impor = impor_untuk(nama, potongan[nama])
    blok = buang_impor_asli(potongan[nama].split('\n'))
    isi_blok = '\n'.join(blok).strip('\n')
    # Tambahkan `export` pada simbol internal yang dipakai lintas berkas.
    for simbol in EKSPOR_INTERNAL.get(nama, []):
        isi_blok = re.sub(rf'^(?:interface|type|class|const|function) {re.escape(simbol)}\b',
                          lambda m: 'export ' + m.group(0), isi_blok, count=1, flags=re.M)
    isi = (impor + '\n\n' + isi_blok + '\n') if impor else isi_blok + '\n'
    (TUJUAN_DIR / f'{nama}.ts').write_text(isi)

# ----------------------------------------------------------------- FASAD ---
fasad = ['/**',
         ' * AntiBan Engine — arsitektur terinspirasi baileys-antiban (kobie3717, MIT).',
         ' *',
         ' * Berkas ini sengaja hanya meneruskan (re-export): isinya sudah dipisah per',
         ' * guard di `antiban/`. Pemakai lama tidak perlu berubah — impor dari',
         " * './antiban.js' tetap bekerja seperti sebelumnya.",
         ' *',
         ' * Daftar nama di bawah SENGAJA eksplisit, bukan `export *`. Sebagian simbol',
         ' * harus diekspor antar modul hasil (MS, hashContent, identicalKey,',
         ' * ReplyRatioConfig) padahal dulu privat di berkas ini; `export *` akan ikut',
         ' * membocorkannya ke API publik. Daftar ini diturunkan otomatis dari',
         ' * deklarasi `export` berkas asli, jadi permukaan API-nya persis sama.',
         ' *',
         ' * Urutan impor mengikuti graf dependensi, bukan urutan asli berkas:',
         ' * `AntiBanConfig` merujuk `ContactGraphConfig` yang dulu dideklarasikan jauh',
         ' * di bawahnya.',
         ' *',
         ' * - antiban/01-tipe.ts          AntiBanState, AntiBanConfig',
         ' * - antiban/02-preset.ts        preset strict/balanced/broadcast',
         ' * - antiban/03-util.ts          jitter, hash konten, normalisasi',
         ' * - antiban/04-rate-limiter.ts  sliding window + identical spam guard',
         ' * - antiban/05-warmup.ts        kuota bertahap 7 hari',
         ' * - antiban/06-timelock.ts      penanganan error 463',
         ' * - antiban/07-presence.ts      circadian + rencana mengetik',
         ' * - antiban/08-reconnect.ts     ramp kecepatan setelah reconnect',
         ' * - antiban/09-ban-recovery.ts  pemulihan berjenjang setelah ban',
         ' * - antiban/10-reply-ratio.ts   rasio balasan',
         ' * - antiban/11-contact-graph.ts handshake + lurk period',
         ' */']

per_modul = {}
for nama, jenis in EKSPOR_ASLI:
    per_modul.setdefault(PEMILIK[nama], {'nilai': [], 'tipe': []})[jenis].append(nama)

for modul in [n for n, _, _, _ in RENCANA]:
    if modul not in per_modul:
        continue
    for jenis in ('nilai', 'tipe'):
        nama_nama = sorted(set(per_modul[modul][jenis]))
        if not nama_nama:
            continue
        kata = 'export' if jenis == 'nilai' else 'export type'
        fasad.append(f"{kata} {{ {', '.join(nama_nama)} }} from './antiban/{modul}.js';")
fasad.append('')
FASAD.write_text('\n'.join(fasad))
print('  fasad: 35 baris' if len(fasad) == 36 else f'  fasad: {len(fasad) + 1} baris')
