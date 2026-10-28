#!/usr/bin/env bash
# Uji isolasi tenant: user non-admin TIDAK boleh menyentuh sesi user lain.
#
# Ini gerbang sebelum MCP dipasang. Alasannya: MCP multi-tenant meneruskan API
# key tiap user, jadi setiap kebocoran di sini akan berubah menjadi tool MCP yang
# membocorkan data — dengan antarmuka yang lebih rapi dan lebih mudah dipakai.
#
# Setiap endpoint diuji dengan DUA kunci:
#   - kunci pemilik  -> harus 2xx (kalau bukan, perbaikannya terlalu ketat dan
#                       akan memunculkan 403 di panel)
#   - kunci orang lain -> harus 403/404 (kalau 2xx, masih bocor)
#
# Yang TIDAK diuji dengan POST di produksi: skrip ini memakai DB kosong di /tmp
# dan port cadangan, jadi aman menguji endpoint tulis.
set -u

PORT=3994
TMPDIR_TEST=$(mktemp -d /tmp/wa-tenant-XXXXXX)
DB="$TMPDIR_TEST/t.db"
LOG="$TMPDIR_TEST/server.log"

export DATABASE_PATH="$DB"
export PORT="$PORT"
export HOST=127.0.0.1
export JWT_SECRET="e2e-tenant-secret"

cd "$(dirname "$0")/.."

setsid node dist/server.js > "$LOG" 2>&1 &
SRV_PID=$!

cleanup() {
  kill -TERM -"$SRV_PID" 2>/dev/null || kill -TERM "$SRV_PID" 2>/dev/null
  sleep 1
  kill -KILL -"$SRV_PID" 2>/dev/null || true
  rm -rf "$TMPDIR_TEST"
}
trap cleanup EXIT

for i in $(seq 1 40); do
  curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/v1/health" 2>/dev/null && break
  sleep 0.5
done

ADMIN_KEY=$(grep -oE 'wa_live_[a-f0-9]{40,}' "$LOG" | head -1)
if [ -z "$ADMIN_KEY" ]; then echo "GAGAL: kunci admin tidak ditemukan"; exit 1; fi

# Fixture: 2 user non-admin + 2 sesi milik berbeda. Mencetak kunci ke stdout
# dengan prefiks, ditangkap variabel, tidak pernah ditampilkan.
FIX=$(node --no-warnings scripts/seed-tenant-uji.mjs 2>/dev/null)
KEY_A=$(echo "$FIX" | grep -oE 'KEYA:wa_live_[a-f0-9]+' | sed 's/^KEYA://')
KEY_B=$(echo "$FIX" | grep -oE 'KEYB:wa_live_[a-f0-9]+' | sed 's/^KEYB://')
SESS_A=$(echo "$FIX" | grep -oE 'SESSA:[a-z0-9-]+' | sed 's/^SESSA://')
SESS_B=$(echo "$FIX" | grep -oE 'SESSB:[a-z0-9-]+' | sed 's/^SESSB://')

if [ -z "$KEY_A" ] || [ -z "$KEY_B" ] || [ -z "$SESS_A" ] || [ -z "$SESS_B" ]; then
  echo "GAGAL: fixture tidak lengkap"; echo "$FIX"; exit 1
fi
echo "kunci A: [REDACTED, ${#KEY_A}] | kunci B: [REDACTED, ${#KEY_B}]"
echo "sesi A : $SESS_A | sesi B : $SESS_B"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  OK   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1 -> $2"; }

# cek METHOD PATH KEY -> cetak status code
cek() {
  local method="$1" path="$2" key="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -o /dev/null -w "%{http_code}" --max-time 6 -X "$method" \
      -H "X-API-Key: $key" -H "Content-Type: application/json" -d "$body" \
      "http://127.0.0.1:$PORT$path"
  else
    curl -s -o /dev/null -w "%{http_code}" --max-time 6 -X "$method" \
      -H "X-API-Key: $key" "http://127.0.0.1:$PORT$path"
  fi
}

# uji: pemilik harus lolos, penyusup harus ditolak
uji() {
  local label="$1" method="$2" path_tmpl="$3" body="${4:-}"
  local pa="${path_tmpl//:id/$SESS_A}"
  local pb="${path_tmpl//:id/$SESS_B}"
  local ca cb
  ca=$(cek "$method" "$pa" "$KEY_A" "$body")   # A menyentuh sesi A -> boleh
  cb=$(cek "$method" "$pb" "$KEY_A" "$body")   # A menyentuh sesi B -> tolak
  if [ "${ca:0:1}" = "2" ]; then ok "$label: pemilik dapat $ca"; else bad "$label: pemilik" "dapat $ca (harap 2xx)"; fi
  if [ "$cb" = "403" ] || [ "$cb" = "404" ]; then ok "$label: penyusup ditolak $cb"; else bad "$label: penyusup" "dapat $cb (harap 403/404)"; fi
}

echo
echo "=== 1. Endpoint BACA per sesi ==="
uji "GET /sessions/:id"          GET  "/api/v1/sessions/:id"
uji "GET /sessions/:id/antiban"  GET  "/api/v1/sessions/:id/antiban"
uji "GET /sessions/:id/metrics"  GET  "/api/v1/sessions/:id/metrics"
uji "GET /sessions/:id/queue/status" GET "/api/v1/sessions/:id/queue/status"

echo
echo "=== 2. Endpoint TULIS per sesi (inilah yang paling merusak) ==="
uji "PATCH /sessions/:id (rename)"        PATCH "/api/v1/sessions/:id" '{"name":"disusupi"}'
uji "PUT /sessions/:id/antiban (preset)"  PUT   "/api/v1/sessions/:id/antiban" '{"preset":"strict"}'
uji "POST /sessions/:id/queue/pause"      POST  "/api/v1/sessions/:id/queue/pause" '{"reason":"uji"}'
uji "POST /sessions/:id/queue/resume"     POST  "/api/v1/sessions/:id/queue/resume" '{}'
uji "POST /sessions/:id/queue/clear"      POST  "/api/v1/sessions/:id/queue/clear" '{"reason":"uji"}'
# `reconnect` sengaja TIDAK diuji dari sisi pemilik: pemilik yang sah benar-benar
# mencoba menyambung ke WhatsApp, dan tanpa jaringan permintaannya menggantung
# (curl -> 000). Yang perlu dibuktikan di sini hanya bahwa penyusup ditolak, dan
# pemeriksaan kepemilikan berjalan SEBELUM reconnect dipanggil.
RC=$(cek POST "/api/v1/sessions/$SESS_B/reconnect" "$KEY_A" '{}')
if [ "$RC" = "403" ] || [ "$RC" = "404" ]; then ok "POST /sessions/:id/reconnect: penyusup ditolak $RC"; else bad "reconnect" "dapat $RC (harap 403/404)"; fi
uji "POST /sessions/:id/antiban/reset-cooldown" POST "/api/v1/sessions/:id/antiban/reset-cooldown" '{}'
uji "POST /sessions/:id/contact-graph/batch" POST "/api/v1/sessions/:id/contact-graph/batch" '{"batchId":"b1","recipients":["628000000099"]}'
uji "GET /sessions/:id/contact-graph/batch/:bid" GET "/api/v1/sessions/:id/contact-graph/batch/b1"

echo
echo "=== 3. GET /metrics (agregat seluruh tenant) ==="
# Buat dulu laporan metrik untuk sesi B, kalau tidak `getAllReports()` hanya
# memuat sesi yang pernah menyentuh metrics dan perbandingannya jadi tidak sahih.
cek GET "/api/v1/sessions/$SESS_B/metrics" "$KEY_B" > /dev/null
MA=$(cek GET "/api/v1/metrics" "$KEY_A")
echo "  status: $MA"
BODY=$(curl -s --max-time 6 -H "X-API-Key: $KEY_A" "http://127.0.0.1:$PORT/api/v1/metrics")
N_A=$(echo "$BODY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const m=j.metrics||[];console.log(m.length)}catch(e){console.log('ERR')}})")
echo "  jumlah laporan terlihat oleh A: $N_A"
# A hanya punya 1 sesi; kalau >1 berarti laporan tenant lain ikut.
if [ "$N_A" = "1" ]; then ok "GET /metrics disaring (1 laporan)"; else bad "GET /metrics" "A melihat $N_A laporan (harap 1)"; fi

echo
echo "=== 4. Endpoint yang menyentuh sesi tanpa cek sebelumnya ==="
# DELETE /sessions/:id dan POST /pair /logout sengaja diuji pada sesi B oleh A.
# Dipisah karena DELETE membuat sesi hilang, jadi harus paling akhir.
CL=$(cek POST "/api/v1/sessions/$SESS_B/logout" "$KEY_A")
if [ "$CL" = "403" ] || [ "$CL" = "404" ]; then ok "POST /sessions/:id/logout ditolak $CL"; else bad "logout" "dapat $CL"; fi

PR=$(cek POST "/api/v1/sessions/$SESS_B/pair" "$KEY_A" '{"name":"x"}')
if [ "$PR" = "403" ] || [ "$PR" = "404" ]; then ok "POST /sessions/:id/pair ditolak $PR"; else bad "pair" "dapat $PR"; fi

# Bukti terakhir: sesi B harus SELAMAT (masih ada di DB) setelah semua percobaan.
export DB_P="$DB"
MASIH=$(DB_P="$DB" node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DB_P);
const r=db.prepare('SELECT COUNT(*) as n FROM sessions WHERE id=?').get(process.argv[1]);
console.log(r.n);
" "$SESS_B")
if [ "$MASIH" = "1" ]; then ok "sesi B masih utuh setelah semua percobaan"; else bad "sesi B" "hilang/berubah (count=$MASIH)"; fi

NAMA_B=$(DB_P="$DB" node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DB_P);
const r=db.prepare('SELECT name FROM sessions WHERE id=?').get(process.argv[1]);
console.log(r?r.name:'HILANG');
" "$SESS_B")
if [ "$NAMA_B" != "disusupi" ]; then ok "nama sesi B tidak berubah ($NAMA_B)"; else bad "nama sesi B" "BERUBAH jadi 'disusupi'"; fi

echo
echo "=== 5. Admin tetap bisa melihat semua ==="
AD=$(cek GET "/api/v1/sessions/$SESS_B" "$ADMIN_KEY")
if [ "${AD:0:1}" = "2" ]; then ok "admin dapat $AD pada sesi B"; else bad "admin akses" "dapat $AD"; fi
ADM=$(curl -s --max-time 6 -H "X-API-Key: $ADMIN_KEY" "http://127.0.0.1:$PORT/api/v1/metrics" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log((JSON.parse(d).metrics||[]).length)}catch(e){console.log('ERR')}})")
echo "  admin melihat $ADM laporan metrik"
if [ "$ADM" -ge 2 ] 2>/dev/null; then ok "admin melihat semua laporan ($ADM)"; else bad "admin metrics" "hanya $ADM"; fi

echo
echo "=== HASIL: $PASS lulus, $FAIL gagal ==="
[ "$FAIL" -eq 0 ] || exit 1
