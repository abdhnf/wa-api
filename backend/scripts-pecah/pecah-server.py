"""Pecah backend/src/server.ts (2095 baris, 74 route) menjadi modul per domain.

Pendekatan: potong per RENTANG BARIS persis dari berkas asli, bukan tulis ulang
dari pemahaman. Badan kode tidak mungkin berubah — yang berubah hanya deklarasi
impor dan indentasi. server.ts tidak punya template literal multi-baris, jadi
re-indentasi tidak menyentuh isi string.

Jalankan dari ~/projects/wa-api/backend:
    cp /tmp/server.ts.asli src/server.ts && rm -rf src/routes
    python3 scripts-pecah/pecah-server.py
"""
import re
import subprocess
from pathlib import Path

AKAR = Path(__file__).resolve().parent.parent
SUMBER = AKAR / 'src' / 'server.ts'
TUJUAN = AKAR / 'src' / 'routes'

baris = SUMBER.read_text().split('\n')


def potong(a, b):
    """Ambil baris a..b (1-indexed, inklusif)."""
    return '\n'.join(baris[a - 1:b])


# (modul, [nama], dalam_routes)
IMPOR_ASAL = [
    ('fastify', ['Fastify'], False),
    ('@fastify/cors', ['cors'], False),
    ('@fastify/jwt', ['jwt'], False),
    ('zod', ['z'], False),
    ('node:fs', ['createReadStream'], False),
    ('node:fs/promises', ['mkdir', 'writeFile', 'unlink', 'stat', 'readFile'], False),
    ('node:path', ['join', 'resolve', 'extname'], False),
    ('./config.js', ['config'], False),
    ('./session-manager.js', ['SessionManager', 'validatePhoneFormat'], False),
    ('./engine/BaileysEngine.js', ['BaileysEngine'], False),
    ('./auth.js', ['requireApiKey', 'requireJwt', 'requireAdmin', 'requireAuth'], False),
    ('./security.js', ['hashPassword', 'verifyPassword', 'generateApiKey', 'rateLimitHook',
                       'checkLoginBruteForce', 'recordLoginFailure', 'recordLoginSuccess',
                       'verifyTurnstileToken', 'getClientIp'], False),
    ('./db.js', ['getUserByEmail', 'getUserByPhone', 'getUserById', 'listUsers', 'createUser',
                 'upsertWebhook', 'listWebhooks', 'listMessages', 'listMessagesPaged', 'updateUser',
                 'deleteUser', 'setUserPassword', 'setUserApiKey', 'setUserBlastPin',
                 'clearUserBlastPin', 'getUserBlastAccessToken', 'createBlastLaunchToken',
                 'verifyAndBurnBlastLaunchToken', 'getOrCreateUserBlastAccessToken',
                 'rotateUserBlastAccessToken', 'getUserByBlastAccessToken', 'getMessageById', 'db',
                 'getSetting', 'getAllSettings', 'setSettings', 'getAllUserSettings',
                 'setUserSettings', 'upsertGoogleUser', 'checkAndIncrementWeeklyQuota',
                 'checkAndIncrementQuota', 'refundQuota', 'getUserLogs', 'insertApiLog',
                 'listApiLogs', 'deleteApiLogs', 'clearApiLogs'], False),
    ('./phone.js', ['normalisasiNomor'], False),
    ('./password-reset.js', ['ajukanResetPassword', 'verifikasiTokenReset', 'pakaiTokenReset'], False),
    ('./notifikasi-email.js', ['kirimEmailRegistrasi'], False),
    ('./mailer.js', ['ambilKonfigurasiMail', 'simpanKonfigurasiMail', 'ujiKoneksiMail', 'kirimEmail',
                     'konfigurasiUntukKlien', 'PRESET_PROVIDER'], False),
    ('./mail-templates.js', ['templateEmailUji', 'templateEmailUjiTeks', 'BRAND'], False),
    # Modul hasil pemecahan ini (hidup di src/routes/)
    ('./schemas.js', ['sendTextSchema', 'sendMediaSchema', 'sendLocationSchema', 'phoneDigits',
                      'bulkItemSchema', 'bulkItemsSchema', 'sendBulkSchema', 'loginSchema',
                      'registerSchema', 'webhookSchema', 'createUserSchema', 'forgotPasswordSchema',
                      'resetPasswordSchema', 'parseBody'], True),
    ('./konteks.js', ['app', 'engine', 'manager'], True),
    ('./media.js', ['MEDIA_DIR', 'MEDIA_TTL_MS', 'MEDIA_EXT_BY_MIME', 'MEDIA_MIME_BY_EXT',
                    'MEDIA_ID_PATTERN', 'resolveMediaMime', 'resolveMediaExtension',
                    'mediaAbsoluteUrl'], True),
]

DEFAULT_IMPOR = {'fastify', '@fastify/cors', '@fastify/jwt'}

# Berkas yang seluruh deklarasinya di level modul (tanpa pembungkus fungsi).
# Deklarasinya perlu diberi `export` supaya bisa dipakai berkas rute.
MODUL_MURNI = {'schemas.ts', 'media.ts'}


def impor_untuk(teks, abaikan=(), nama_fungsi=None):
    keluaran = []
    for modul, nama, dalam_routes in IMPOR_ASAL:
        if modul in abaikan:
            continue
        # `app` adalah PARAMETER fungsi di berkas rute, bukan nilai yang diimpor.
        # Mengimpornya menghasilkan impor yang menutupi parameter — membingungkan
        # pembaca walau build tetap hijau.
        if modul == './konteks.js' and nama_fungsi:
            nama = [n for n in nama if n != 'app']
        # (?<!\.) menolak kecocokan yang sebenarnya nama properti: `config.jwtExpiresIn`
        # bukan pemakaian `jwt`, `daftar.join()` bukan pemakaian `join`.
        dipakai = [n for n in nama if re.search(r'(?<!\.)\b' + re.escape(n) + r'\b', teks)]
        if not dipakai:
            continue
        jalur = modul if dalam_routes else ('.' + modul if modul.startswith('./') else modul)
        if modul in DEFAULT_IMPOR:
            keluaran.append(f"import {dipakai[0]} from '{jalur}';")
        else:
            keluaran.append(f"import {{ {', '.join(dipakai)} }} from '{jalur}';")
    return keluaran


# nama berkas -> (judul, [rentang baris], impor wajib)
RENCANA = [
    ('konteks.ts', (
        'Konteks bersama: instance Fastify, hook lintas-rute, engine WhatsApp,\n'
        'dan SessionManager. Modul lain mengimpor `app`, `engine`, dan `manager`\n'
        'dari sini supaya hanya ada satu instance.',
        [(39, 90), (1613, 1616)],
        [],
    )),
    ('schemas.ts', (
        'Skema validasi zod untuk seluruh endpoint.\n'
        'Dipisah dari rutenya supaya berkas rute hanya berisi alur, bukan bentuk data.',
        [(92, 246)],
        [],
    )),
    ('media.ts', (
        'Helper berkas media: lokasi penyimpanan, peta MIME, penentuan tipe saat\n'
        'berkas dilayani, dan penyusunan URL absolut. Berisi murni fungsi dan\n'
        'konstanta — tidak ada rute di sini.',
        [(1541, 1611)],
        [],
    )),
    ('auth.ts', (
        'Autentikasi: login, profil sendiri, pendaftaran, Google OAuth,\n'
        'PIN & tautan Blast Dashboard, serta pemulihan password mandiri.',
        [(248, 382), (384, 672), (737, 776)],
        [],
    )),
    ('users.ts', (
        'Manajemen pengguna (khusus admin): daftar, buat, ubah, hapus,\n'
        'reset password, reset PIN, dan tautan Blast milik user lain.',
        [(674, 735), (778, 900)],
        [],
    )),
    ('sessions.ts', (
        'Sesi WhatsApp dan kendali antrean: pasangkan, putuskan, anti-ban,\n'
        'whitelist penerima kampanye, serta jeda/lanjut/batal per sesi dan per batch.',
        [(902, 1261)],
        [],
    )),
    ('pesan.ts', (
        'Pengiriman pesan (teks, media, lokasi, massal), status & retry, webhook,\n'
        'serta unggah dan penyajian berkas media.',
        [(1263, 1486), (1618, 1749)],
        [],
    )),
    ('pengaturan.ts', (
        'Pengaturan sistem: profil pemakaian, konfigurasi umum, konfigurasi email,\n'
        'dan auto-rotate sesi.',
        [(1488, 1539), (1769, 2003)],
        [],
    )),
    ('operasional.ts', (
        'Endpoint operasional: kesehatan layanan, log aktivitas API,\n'
        'dan log aktivitas per pengguna.',
        [(1751, 1765), (2006, 2085)],
        [],
    )),
]

TANDA_TANGAN = {
    'auth.ts': 'daftarkanRuteAuth',
    'users.ts': 'daftarkanRuteUsers',
    'sessions.ts': 'daftarkanRuteSessions',
    'pesan.ts': 'daftarkanRutePesan',
    'pengaturan.ts': 'daftarkanRutePengaturan',
    'operasional.ts': 'daftarkanRuteOperasional',
}


def doc(judul):
    return '/**\n' + '\n'.join(' * ' + ln if ln else ' *' for ln in judul.split('\n')) + '\n */'


POLA_TAK_TERPAKAI = re.compile(
    r"^src/routes/([\w.]+)\.ts\(\d+,\d+\): error TS6133: '([^']+)' is declared but its value is never read\."
)


def buang_nama_dari_impor(teks, nama_buang):
    """Buang satu nama dari daftar impor bernama. Baris impor yang jadi kosong dihapus."""
    berubah = [False]

    def ganti(m):
        isi = [x.strip() for x in m.group(1).split(',') if x.strip()]
        sisa = [x for x in isi if x != nama_buang]
        if len(sisa) == len(isi):
            return m.group(0)  # nama ini tidak ada di daftar impor ini
        berubah[0] = True
        if not sisa:
            return ''  # seluruh isi terbuang: hapus baris impornya
        return f"import {{ {', '.join(sisa)} }} from {m.group(2)};"

    hasil = re.sub(r"import \{ ([^}]+) \} from ('[^']+');", ganti, teks)
    # Rapikan baris kosong sisa penghapusan.
    hasil = re.sub(r'\n\n\n+', '\n\n', hasil)
    return hasil, berubah[0]


def bersihkan_impor_tak_terpakai(maks_putaran=8):
    """Buang impor yang tidak dipakai, memakai compiler sebagai hakim.

    Pencocokan teks tidak bisa dipercaya di sini. Sebuah nama bisa muncul di
    dalam string ('/api/v1/auth/config'), komentar, anggota tipe
    ({ config?: any }), atau kelas karakter regex (/^[a-z]+\\//) — semuanya
    tampak seperti pemakaian padahal bukan. Compiler tahu yang sebenarnya, jadi
    compiler yang menentukan, bukan tebakan regex.
    """
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
        if not temuan:
            return putaran, 0

        ada_perubahan = False
        for nama_berkas, nama_buang in temuan.items():
            jalur = TUJUAN / (nama_berkas + '.ts')
            if not jalur.exists():
                continue
            teks = jalur.read_text()
            for nm in nama_buang:
                teks, berubah = buang_nama_dari_impor(teks, nm)
                ada_perubahan = ada_perubahan or berubah
            jalur.write_text(teks)

        if not ada_perubahan:
            return putaran, len(temuan)

    return maks_putaran, -1


def indentasi(blok, n=2):
    return '\n'.join((' ' * n + ln) if ln.strip() else '' for ln in blok.split('\n'))


def beri_ekspor(blok):
    """Beri `export` pada deklarasi level modul (const/function tanpa indentasi)."""
    keluaran = []
    for ln in blok.split('\n'):
        if re.match(r'^(const|function|async function) ', ln):
            ln = 'export ' + ln
        keluaran.append(ln)
    return '\n'.join(keluaran)


def tulis(nama, judul, rentang, impor_wajib):
    bagian = [potong(a, b) for a, b in rentang]

    if nama == 'konteks.ts':
        # Ekspor instance bersama; jangan impor dari dirinya sendiri.
        bagian = [
            b.replace('const app = Fastify(', 'export const app = Fastify(', 1)
             .replace('const engine = new BaileysEngine', 'export const engine = new BaileysEngine', 1)
             .replace('const manager = new SessionManager', 'export const manager = new SessionManager', 1)
            for b in bagian
        ]

    if nama in MODUL_MURNI:
        bagian = [beri_ekspor(b) for b in bagian]

    badan = '\n'.join(bagian)

    abaikan = ()
    nama_fungsi = None
    if nama == 'konteks.ts':
        abaikan = ('./konteks.js',)
    elif nama in MODUL_MURNI:
        abaikan = (f'./{nama[:-3]}.js',)
    else:
        nama_fungsi = TANDA_TANGAN[nama]

    impor = impor_untuk(badan, abaikan=abaikan, nama_fungsi=nama_fungsi) + list(impor_wajib)

    if nama in MODUL_MURNI or nama == 'konteks.ts':
        isi = doc(judul) + '\n' + '\n'.join(impor) + '\n\n' + badan + '\n'
    else:
        fn = TANDA_TANGAN[nama]
        isi = (
            doc(judul + f"\n\nBerkas ini tidak dijalankan sendiri: server.ts memanggil\n{fn}() saat menyusun aplikasi.")
            + '\n'
            + '\n'.join(impor)
            + "\nimport type { FastifyInstance } from 'fastify';\n\n"
            + f"export function {fn}(app: FastifyInstance): void {{\n"
            + '\n\n'.join(indentasi(b) for b in bagian)
            + '\n}\n'
        )

    (TUJUAN / nama).write_text(isi)
    return isi


TUJUAN.mkdir(parents=True, exist_ok=True)

hasil = {}
for nama, (judul, rentang, wajib) in RENCANA:
    hasil[nama] = tulis(nama, judul, rentang, wajib)

# ------------------------------------------------------- server.ts (bootstrap)
URUTAN = ['auth.ts', 'users.ts', 'sessions.ts', 'pesan.ts', 'pengaturan.ts', 'operasional.ts']
impor_rute = '\n'.join(
    f"import {{ {TANDA_TANGAN[n]} }} from './routes/{n[:-3]}.js';" for n in URUTAN
)
panggil = '\n'.join(f"{TANDA_TANGAN[n]}(app);" for n in URUTAN)

bootstrap = f"""/**
 * Titik masuk wa-api.
 *
 * Berkas ini sengaja tipis: ia menyusun aplikasi lalu menyerahkan pendaftaran
 * rute ke modul per domain di `routes/`. Isi rutenya TIDAK berubah saat dipecah
 * — hanya dipindahkan, sehingga perilaku yang sudah teruji tetap sama.
 *
 * Urutan pendaftaran tidak memengaruhi hasil: setiap rute punya pola dan metode
 * yang berbeda, tidak ada dua rute yang bertabrakan.
 */
import {{ config }} from './config.js';
import {{ app, manager }} from './routes/konteks.js';
{impor_rute}

{panggil}

{potong(2087, 2095)}
"""
SUMBER.write_text(bootstrap)

# ------------------------------------------------------------------ laporan
print('=== pembersihan impor tak terpakai (compiler sebagai hakim) ===')
putaran, sisa = bersihkan_impor_tak_terpakai()
if sisa == 0:
    print(f'  bersih setelah {putaran} putaran')
else:
    print(f'  PERHATIAN: {sisa} nama masih tak terpakai setelah {putaran} putaran')
    print('  (kemungkinan dipakai di tempat yang tidak bisa dibuang otomatis)')

print()
print('=== berkas yang dihasilkan ===')
total = 0
for nama in list(hasil) + ['server.ts']:
    p = (TUJUAN / nama) if nama != 'server.ts' else SUMBER
    t = p.read_text()
    n = len(re.findall(r"app\.(?:get|post|patch|put|delete)\(", t))
    total += n
    print(f'  {nama:<18} {len(t.splitlines()):>5} baris   route: {n}')
print(f'\n  TOTAL route terdaftar: {total}  (server.ts asli: 74)')
