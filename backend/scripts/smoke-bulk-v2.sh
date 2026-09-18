#!/usr/bin/env bash
# Smoke test kontrak bulk v2 wa-api (Task 3) + guard kepemilikan batch (Task 4).
#
# CATATAN EKSPEKTASI — baca sebelum mengubah test:
#  - `isBatchPaused()` mengembalikan { isPaused, reason?, activeCount } TANPA batchId.
#  - `activeCount` menghitung pesan yang MASIH di antrean memori; worker langsung
#    mengambilnya sehingga angkanya cepat turun. Test men-jeda batch lebih dulu
#    agar hitungannya deterministik, dan tidak menganggap selisih sebagai kegagalan.
#  - Sebagai ADMIN, `resolveSession()` melewati guard kepemilikan sesi (isAdmin=true),
#    jadi sessionId yang tidak ada TIDAK melempar error. Jalur error per-item dan
#    guard IDOR karena itu diuji memakai user non-admin asli.
#  - Enqueue tidak memvalidasi nomor ke WhatsApp; nomor tidak terdaftar tetap masuk
#    antrean dan baru gagal saat pengiriman.
#  - POST /batches/:id/resume harus dikirim TANPA header Content-Type bila tanpa body;
#    Fastify menolak JSON body kosong dengan 400 (FST_ERR_CTP_EMPTY_JSON_BODY).
#
# Kredensial admin dibaca dari vault lokal, tidak pernah dicetak ke stdout.
# User uji dibuat lalu dihapus kembali di akhir.
# Pemakaian: bash smoke-bulk-v2.sh [base_url]

set -uo pipefail

BASE="${1:-http://172.30.30.229:3100/api/v1}"
VAULT="$HOME/.hermes/vault/wa-api-admin.json"
PASS=0
FAIL=0
SUFFIX="$$"

ok()   { echo "  PASS  $1"; PASS=$((PASS + 1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }
head() { echo; echo "== $1"; }
jq_()  { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

EMAIL=$(python3 -c "import json;print(json.load(open('$VAULT'))['email'])")
PASSWORD=$(python3 -c "import json;print(json.load(open('$VAULT'))['password'])")

TOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq_ "d.get('token','')")
if [ -z "$TOKEN" ]; then echo "GAGAL login ke $BASE"; exit 1; fi

ADMIN=(-H "Authorization: Bearer $TOKEN")
JSON=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

BATCH="camp_smoke_$SUFFIX"
BATCH2="camp_smoke_partial_$SUFFIX"
CREATED_USERS=()

cleanup() {
  for u in "${CREATED_USERS[@]:-}"; do
    [ -n "$u" ] && curl -s -o /dev/null -X DELETE "$BASE/users/$u" "${ADMIN[@]}"
  done
}
trap cleanup EXIT

# ================= Task 3: kontrak bulk v2 =================
echo "Auth OK -> $BASE"

head "1. bulk v2 messages[] dengan batchId kustom"
R1=$(curl -s -w '\n%{http_code}' -X POST "$BASE/messages/send-bulk" "${JSON[@]}" -d "{
  \"sessionId\":\"auto\",
  \"batchId\":\"$BATCH\",
  \"messages\":[
    {\"mode\":\"text\",\"to\":\"628111111001\",\"text\":\"uji v2 A\"},
    {\"mode\":\"text\",\"to\":\"628111111002\",\"text\":\"uji v2 B\"},
    {\"mode\":\"location\",\"to\":\"628111111003\",\"latitude\":-6.2,\"longitude\":106.8,\"name\":\"Kantor\"}
  ]}")
C1=$(echo "$R1" | tail -1); B1=$(echo "$R1" | sed '$d')
echo "  HTTP $C1"
echo "$B1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  batchId     :', d.get('batchId'))
print('  totalQueued :', d.get('totalQueued'))
print('  totalFailed :', d.get('totalFailed'))
print('  modes       :', [m.get('mode') for m in d.get('messages',[])])
" 2>/dev/null
[ "$C1" = "202" ] && ok "HTTP 202" || bad "harap 202, dapat $C1"
[ "$(echo "$B1" | jq_ "d.get('batchId')")" = "$BATCH" ] && ok "batchId klien dihormati" || bad "batchId tidak dihormati"
[ "$(echo "$B1" | jq_ "d.get('totalQueued')")" = "3" ] && ok "3 pesan masuk antrean (termasuk location)" || bad "totalQueued != 3"
[ "$(echo "$B1" | jq_ "all(m.get('id') and m.get('to') for m in d['messages'])")" = "True" ] \
  && ok "tiap entri punya id + to (pemetaan balik ke antrean dashboard)" || bad "entri tanpa id/to"

head "2. GET /batches/\$batchId/status setelah dijeda"
curl -s -o /dev/null -X POST "$BASE/batches/$BATCH/pause" "${JSON[@]}" -d '{"reason":"smoke:status"}'
S2=$(curl -s "$BASE/batches/$BATCH/status" "${ADMIN[@]}")
echo "  $S2"
[ "$(echo "$S2" | jq_ "d.get('isPaused')")" = "True" ] && ok "isPaused=true terbaca" || bad "isPaused tidak terbaca"
AC2=$(echo "$S2" | jq_ "d.get('activeCount')")
if [ "$AC2" -ge 1 ] 2>/dev/null && [ "$AC2" -le 3 ]; then
  ok "activeCount=$AC2 (dalam rentang 1..3; worker memproses sebagian)"
else
  bad "activeCount=$AC2 di luar rentang wajar"
fi
[ "$(echo "$S2" | jq_ "'batchId' in d")" = "False" ] \
  && ok "bentuk respons sesuai kontrak: {isPaused, reason?, activeCount}" \
  || echo "  INFO  respons kini menyertakan batchId"

head "3. resume batch (tanpa Content-Type karena tanpa body)"
R3=$(curl -s -w '\n%{http_code}' -X POST "$BASE/batches/$BATCH/resume" "${ADMIN[@]}")
C3=$(echo "$R3" | tail -1); B3=$(echo "$R3" | sed '$d')
echo "  HTTP $C3 -> $B3"
[ "$C3" = "200" ] && ok "resume berhasil" || bad "resume gagal (HTTP $C3)"
[ "$(echo "$B3" | jq_ "d.get('isPaused')")" = "False" ] && ok "isPaused kembali false" || bad "isPaused tidak kembali false"

head "4. bentuk v1 legacy (recipients[] + text) tetap diterima"
R5=$(curl -s -w '\n%{http_code}' -X POST "$BASE/messages/send-bulk" "${JSON[@]}" -d '{
  "sessionId":"auto","recipients":["628111111006","628111111007"],"text":"legacy v1"}')
C5=$(echo "$R5" | tail -1); B5=$(echo "$R5" | sed '$d')
echo "  HTTP $C5 -> batchId=$(echo "$B5" | jq_ "d.get('batchId')") totalQueued=$(echo "$B5" | jq_ "d.get('totalQueued')")"
[ "$C5" = "202" ] && ok "v1 legacy masih 202" || bad "v1 legacy rusak (HTTP $C5)"
[ "$(echo "$B5" | jq_ "str(d.get('batchId','')).startswith('batch_')")" = "True" ] \
  && ok "fallback batchId server saat klien tidak mengirim" || bad "fallback batchId gagal"
[ "$(echo "$B5" | jq_ "[m.get('mode') for m in d['messages']]")" = "['text', 'text']" ] \
  && ok "v1 dinormalisasi ke mode=text" || bad "normalisasi v1 gagal"

head "5. validasi: media tanpa mediaUrl/mediaBase64"
R6=$(curl -s -w '\n%{http_code}' -X POST "$BASE/messages/send-bulk" "${JSON[@]}" -d '{
  "sessionId":"auto","messages":[{"mode":"media","to":"628111111008","mediaType":"image","caption":"tanpa sumber"}]}')
C6=$(echo "$R6" | tail -1); echo "  HTTP $C6 -> $(echo "$R6" | sed '$d')"
[ "$C6" = "400" ] && ok "ditolak 400" || bad "harap 400, dapat $C6"

head "6. validasi: batchId karakter terlarang"
R7=$(curl -s -w '\n%{http_code}' -X POST "$BASE/messages/send-bulk" "${JSON[@]}" -d '{
  "sessionId":"auto","batchId":"../etc/passwd","recipients":["628111111009"],"text":"x"}')
C7=$(echo "$R7" | tail -1); echo "  HTTP $C7"
[ "$C7" = "400" ] && ok "ditolak 400" || bad "harap 400, dapat $C7"

head "7. validasi: body tanpa messages[] maupun recipients[]"
R8=$(curl -s -w '\n%{http_code}' -X POST "$BASE/messages/send-bulk" "${JSON[@]}" -d '{"sessionId":"auto"}')
C8=$(echo "$R8" | tail -1); echo "  HTTP $C8 -> $(echo "$R8" | sed '$d')"
[ "$C8" = "400" ] && ok "ditolak 400" || bad "harap 400, dapat $C8"

# ================= Task 4: guard kepemilikan batch =================
head "8. menyiapkan user non-admin uji"
mk_user() {
  local tag="$1"
  curl -s -X POST "$BASE/users" "${JSON[@]}" \
    -d "{\"name\":\"Smoke $tag\",\"email\":\"smoke-$tag-$SUFFIX@test.local\",\"password\":\"smoketest123\",\"role\":\"user\"}"
}
UA=$(mk_user a)
UA_KEY=$(echo "$UA" | jq_ "d['user']['apiKey']"); UA_ID=$(echo "$UA" | jq_ "d['user']['id']")
CREATED_USERS=("$UA_ID")
if [ -z "$UA_KEY" ]; then
  bad "gagal membuat user uji non-admin"
else
  ok "user A (${UA_ID}) dibuat"
  A_JSON=(-H "X-API-Key: $UA_KEY" -H 'Content-Type: application/json')
  A_KEYH=(-H "X-API-Key: $UA_KEY")

  # Batch korban dimiliki ADMIN: admin melewati guard kepemilikan sesi, sehingga
  # baris pesan benar-benar terbentuk dan kepemilikannya bisa diuji.
  VICTIM="camp_victim_$SUFFIX"
  head "9. admin menyerahkan batch korban"
  RV=$(curl -s -w '\n%{http_code}' -X POST "$BASE/messages/send-bulk" "${JSON[@]}" \
    -d "{\"sessionId\":\"auto\",\"batchId\":\"$VICTIM\",\"messages\":[{\"mode\":\"text\",\"to\":\"628111111010\",\"text\":\"punya admin\"}]}")
  CV=$(echo "$RV" | tail -1); BV=$(echo "$RV" | sed '$d')
  echo "  HTTP $CV -> batchId=$(echo "$BV" | jq_ "d.get('batchId')") totalQueued=$(echo "$BV" | jq_ "d.get('totalQueued')")"
  [ "$CV" = "202" ] && ok "batch korban terbuat" || bad "batch korban gagal (HTTP $CV)"

  head "10. IDOR: user non-admin mencoba MENJEDA batch milik admin"
  RB=$(curl -s -w '\n%{http_code}' -X POST "$BASE/batches/$VICTIM/pause" "${A_JSON[@]}" -d '{"reason":"serangan"}')
  CB=$(echo "$RB" | tail -1); BB=$(echo "$RB" | sed '$d')
  echo "  HTTP $CB -> $BB"
  [ "$CB" = "403" ] && ok "ditolak 403 (guard kepemilikan batch bekerja)" || bad "harap 403, dapat $CB — IDOR MASIH TERBUKA"

  head "11. IDOR: user non-admin mencoba STATUS & CLEAR batch milik admin"
  CB2=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/batches/$VICTIM/status" "${A_KEYH[@]}")
  CB3=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/batches/$VICTIM/clear" "${A_JSON[@]}" -d '{}')
  echo "  status -> HTTP $CB2 ; clear -> HTTP $CB3"
  [ "$CB2" = "403" ] && ok "status ditolak 403" || bad "status harap 403, dapat $CB2"
  [ "$CB3" = "403" ] && ok "clear ditolak 403" || bad "clear harap 403, dapat $CB3"

  head "12. admin tetap bisa mengendalikan batch-nya sendiri"
  CA2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/batches/$VICTIM/pause" "${JSON[@]}" -d '{"reason":"milik sendiri"}')
  echo "  pause sebagai admin -> HTTP $CA2"
  [ "$CA2" = "200" ] && ok "pemilik tetap bisa menjeda (guard tidak over-block)" || bad "harap 200, dapat $CA2"

  head "13. jalur error per-item untuk non-admin (sessionId tidak ada)"
  RE=$(curl -s -w '\n%{http_code}' -X POST "$BASE/messages/send-bulk" "${A_JSON[@]}" \
    -d "{\"sessionId\":\"sess_tidak_ada_$SUFFIX\",\"batchId\":\"camp_err_$SUFFIX\",\"messages\":[
        {\"mode\":\"text\",\"to\":\"628111111011\",\"text\":\"gagal\"},
        {\"mode\":\"text\",\"to\":\"628111111012\",\"text\":\"gagal\"}]}")
  CE=$(echo "$RE" | tail -1); BE=$(echo "$RE" | sed '$d')
  echo "  HTTP $CE"
  [ "$CE" = "400" ] && ok "semua item gagal -> 400" || bad "harap 400, dapat $CE"
  [ "$(echo "$BE" | jq_ "len(d.get('errors',[]))")" = "2" ] \
    && ok "errors[] memuat 2 entri (kegagalan dikumpulkan, bukan dilempar)" || bad "errors[] tidak memuat 2 entri"

  head "14. kuota non-admin naik sesuai JUMLAH PESAN (uji satuan: backend/scripts/quota-semantics.mjs)"
  U1=$(curl -s "$BASE/usage" "${A_KEYH[@]}" | jq_ "d.get('usedInPeriod')")
  echo "  usedInPeriod awal = $U1 (jalur bulk non-admin butuh sesi milik sendiri;"
  echo "  semantik penambahan kuota diuji satuan karena user uji tidak punya sesi WA)"
  [ -n "$U1" ] && ok "GET /usage dapat dibaca user non-admin" || bad "GET /usage gagal"
fi

# ---------- Bersih-bersih ----------
head "Bersih-bersih"
for b in "$BATCH" "camp_err_$SUFFIX"; do
  curl -s -o /dev/null -X POST "$BASE/batches/$b/clear" "${JSON[@]}" -d '{"reason":"smoke cleanup"}'
  echo "  cleared $b"
done

echo
echo "==================================="
echo "  PASS: $PASS    FAIL: $FAIL"
echo "==================================="
[ "$FAIL" -eq 0 ]
