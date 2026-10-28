#!/usr/bin/env bash
# Uji end-to-end: apakah hook `onResponse` benar-benar mengisi kolom audit.
#
# Yang dibuktikan, dan kenapa masing-masing penting:
#
#   1. GET sukses TANPA `X-MCP-Actor` tetap tidak dicatat (perilaku lama
#      dipertahankan, supaya polling panel tidak membanjiri log).
#   2. GET sukses DENGAN `X-MCP-Actor` dicatat (ini yang berubah; tanpa ini
#      seluruh tool baca MCP tidak berjejak).
#   3. `actor`, `target_type`, `target_id` terisi dari permintaan.
#   4. `params` terisi untuk aksi tulis, dan nomor telepon di dalamnya menjadi
#      hash — bukan tersimpan mentah.
#   5. `user_id` berasal dari kunci API, bukan dari header.
#
# DB kosong di /tmp dan port cadangan, BUKAN salinan produksi: salinan wa.db
# membawa kredensial sesi WA hidup dan bisa ikut menyambung ke sesi yang sama.
set -u

PORT=3996
TMPDIR_TEST=$(mktemp -d /tmp/wa-audit-XXXXXX)
DB="$TMPDIR_TEST/audit.db"
LOG="$TMPDIR_TEST/server.log"

export DATABASE_PATH="$DB"
export PORT="$PORT"
export HOST=127.0.0.1
export JWT_SECRET="e2e-audit-secret"

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
echo "kunci admin: [REDACTED, panjang ${#ADMIN_KEY}]"

PASS=0; FAIL=0
check() { if [ "$2" = "1" ]; then PASS=$((PASS+1)); echo "  OK   $1"; else FAIL=$((FAIL+1)); echo "  FAIL $1${3:+ -> $3}"; fi; }

# query() menjalankan SQL ke DB uji dan mencetak nilainya.
# Memakai node:sqlite (bawaan Node 22+), sama seperti db/client.ts — bukan
# better-sqlite3 yang tidak ada di dependensi proyek.
query() { node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DB_P);
const r=db.prepare(process.argv[1]).all();
console.log(r.map(x=>Object.values(x).join('|')).join('\n'));
" "$1"; }
export DB_P="$DB"

echo
echo "=== 1. GET sukses TANPA header -> TIDAK dicatat (perilaku lama) ==="
BEFORE=$(query "SELECT COUNT(*) as n FROM api_logs" | head -1)
curl -s -o /dev/null --max-time 5 -H "X-API-Key: $ADMIN_KEY" \
  "http://127.0.0.1:$PORT/api/v1/sessions"
sleep 1.2
AFTER=$(query "SELECT COUNT(*) as n FROM api_logs" | head -1)
check "GET panel tidak menambah baris" "$([ "$BEFORE" = "$AFTER" ] && echo 1 || echo 0)" "$BEFORE -> $AFTER"

echo
echo "=== 2. GET sukses DENGAN header -> dicatat ==="
curl -s -o /dev/null --max-time 5 -H "X-API-Key: $ADMIN_KEY" -H "X-MCP-Actor: hermes-uji" \
  "http://127.0.0.1:$PORT/api/v1/sessions"
sleep 1.2
N_ACTOR=$(query "SELECT COUNT(*) as n FROM api_logs WHERE actor='hermes-uji'" | head -1)
check "GET agen tercatat" "$([ "$N_ACTOR" -ge 1 ] && echo 1 || echo 0)" "baris=$N_ACTOR"

ROW=$(query "SELECT method||' '||endpoint||' | actor='||actor||' | status='||status_code FROM api_logs WHERE actor='hermes-uji' ORDER BY created_at DESC LIMIT 1")
echo "  baris: $ROW"
check "method & endpoint benar" "$(echo "$ROW" | grep -q 'GET /api/v1/sessions' && echo 1 || echo 0)" "$ROW"

echo
echo "=== 3. Sasaran (target_type / target_id) terisi ==="
# Pakai sesi yang pasti ada di DB kosong: dibuat lewat endpoint, bukan ditebak.
SESS=$(curl -s --max-time 5 -X POST -H "X-API-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"name":"uji-audit"}' "http://127.0.0.1:$PORT/api/v1/sessions" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.id||j.session?.id||'')}catch(e){console.log('')}})")
echo "  sesi uji: ${SESS:-<gagal dibuat>}"

if [ -n "$SESS" ]; then
  curl -s -o /dev/null --max-time 5 -H "X-API-Key: $ADMIN_KEY" -H "X-MCP-Actor: hermes-uji" \
    "http://127.0.0.1:$PORT/api/v1/sessions/$SESS/antiban"
  sleep 1.2
  T=$(query "SELECT target_type||'|'||target_id FROM api_logs WHERE actor='hermes-uji' AND endpoint LIKE '%/antiban' ORDER BY created_at DESC LIMIT 1")
  echo "  target: $T"
  check "target_type=session" "$(echo "$T" | grep -q '^session|' && echo 1 || echo 0)" "$T"
  check "target_id = id sesi" "$(echo "$T" | grep -q "|$SESS$" && echo 1 || echo 0)" "$T"
else
  check "sasaran terisi" 0 "sesi uji gagal dibuat"
fi

echo
echo "=== 4. Aksi tulis: params terisi & nomor jadi hash ==="
curl -s -o /dev/null --max-time 5 -X PUT \
  -H "X-API-Key: $ADMIN_KEY" -H "X-MCP-Actor: hermes-uji" -H "Content-Type: application/json" \
  -d '{"preset":"broadcast","nomorUji":"081234567890"}' \
  "http://127.0.0.1:${PORT}/api/v1/sessions/${SESS:-x}/antiban"
sleep 1.2

P=$(query "SELECT params FROM api_logs WHERE method='PUT' AND actor='hermes-uji' ORDER BY created_at DESC LIMIT 1")
echo "  params: $P"
check "params terisi" "$([ -n "$P" ] && [ "$P" != "" ] && echo 1 || echo 0)" "$P"
check "params memuat nilai baru (broadcast)" "$(echo "$P" | grep -q 'broadcast' && echo 1 || echo 0)" "$P"
check "nomor TIDAK tersimpan mentah" "$(echo "$P" | grep -q '081234567890' && echo 0 || echo 1)" "$P"
check "nomor diganti hash" "$(echo "$P" | grep -q 'hash:' && echo 1 || echo 0)" "$P"

echo
echo "=== 5. Pelaku dari kunci, bukan dari header ==="
# Kirim header actor palsu bersama kunci admin; user_id harus tetap milik kunci.
curl -s -o /dev/null --max-time 5 -H "X-API-Key: $ADMIN_KEY" -H "X-MCP-Actor: agen-palsu" \
  "http://127.0.0.1:$PORT/api/v1/sessions"
sleep 1.2
UID_ROW=$(query "SELECT user_id FROM api_logs WHERE actor='agen-palsu' ORDER BY created_at DESC LIMIT 1")
REAL=$(query "SELECT id FROM users WHERE api_key LIKE 'wa_live_%' ORDER BY id LIMIT 1")
echo "  user_id tercatat: ${UID_ROW:0:12}... | pemilik kunci: ${REAL:0:12}..."
check "user_id dari kunci, bukan dari header" "$([ "$UID_ROW" = "$REAL" ] && echo 1 || echo 0)" "tercatat=$UID_ROW pemilik=$REAL"

echo
echo "=== 6. GET tanpa header tetap tidak tercatat meski ada baris lain ==="
BEFORE2=$(query "SELECT COUNT(*) as n FROM api_logs WHERE actor IS NULL" | head -1)
for i in 1 2 3; do
  curl -s -o /dev/null --max-time 5 -H "X-API-Key: $ADMIN_KEY" "http://127.0.0.1:$PORT/api/v1/sessions"
done
sleep 1.2
AFTER2=$(query "SELECT COUNT(*) as n FROM api_logs WHERE actor IS NULL" | head -1)
check "3x GET panel tidak menambah baris actor IS NULL" "$([ "$BEFORE2" = "$AFTER2" ] && echo 1 || echo 0)" "$BEFORE2 -> $AFTER2"

echo
echo "=== 7. Ringkasan isi api_logs ==="
query "SELECT actor, method, COUNT(*) as n FROM api_logs GROUP BY actor, method ORDER BY n DESC"

echo
echo "=== HASIL: $PASS lulus, $FAIL gagal ==="
[ "$FAIL" -eq 0 ] || exit 1
