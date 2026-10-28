#!/usr/bin/env bash
# Uji tiga celah audit yang ditutup:
#
#   1. `params_before` — audit bisa menjawab "diubah DARI apa", bukan hanya "ke apa".
#   2. Retensi otomatis — baris audit menyusut sendiri, tanpa endpoint manual.
#   3. Baris audit tidak bisa dihapus yang diaudit, sementara catatan galat biasa
#      tetap bisa dibersihkan pemiliknya (supaya tombol di panel tidak jadi 403).
#
# Yang dibuktikan lewat HTTP sungguhan pada DB kosong di /tmp dan port cadangan.
set -u

PORT=3999
T=$(mktemp -d /tmp/wa-celah-XXXXXX)
DB="$T/t.db"
LOG="$T/log"
export DATABASE_PATH="$DB" PORT="$PORT" HOST=127.0.0.1 JWT_SECRET="celah-uji"
cd "$(dirname "$0")/.."

setsid node dist/server.js > "$LOG" 2>&1 &
PID=$!
cleanup() { kill -TERM -"$PID" 2>/dev/null; sleep 1; kill -KILL -"$PID" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

for i in $(seq 1 40); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/v1/health" && break; sleep 0.5; done
ADMIN=$(grep -oE 'wa_live_[a-f0-9]{40,}' "$LOG" | head -1)
[ -n "$ADMIN" ] || { echo "GAGAL: kunci admin tidak ditemukan"; exit 1; }

FIX=$(node --no-warnings scripts/seed-celah-uji.mjs 2>/dev/null)
KEY_A=$(echo "$FIX" | grep -oE 'KEYA:[^ ]+' | sed 's/^KEYA://')
KEY_B=$(echo "$FIX" | grep -oE 'KEYB:[^ ]+' | sed 's/^KEYB://')
SESS_A=$(echo "$FIX" | grep -oE 'SESSA:[^ ]+' | sed 's/^SESSA://')
[ -n "$KEY_A" ] && [ -n "$KEY_B" ] && [ -n "$SESS_A" ] || { echo "GAGAL fixture: $FIX"; exit 1; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  OK   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1 -> $2"; }

# --- query langsung ke DB uji (bukan DB produksi) ---
q() {
  DB_P="$DB" node --no-warnings -e "
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(process.env.DB_P);
    const r=db.prepare(process.argv[1]).all();
    console.log(JSON.stringify(r));
  " "$1"
}

echo "=== 1. params_before: audit menjawab 'dari apa' ==="
# Ubah preset dua kali dengan actor, lalu periksa baris audit terakhir.
curl -s -o /dev/null -X PUT -H "X-API-Key: $KEY_A" -H "X-MCP-Actor: agen-uji" \
  -H "Content-Type: application/json" -d '{"preset":"strict"}' \
  "http://127.0.0.1:$PORT/api/v1/sessions/$SESS_A/antiban"
sleep 0.6
curl -s -o /dev/null -X PUT -H "X-API-Key: $KEY_A" -H "X-MCP-Actor: agen-uji" \
  -H "Content-Type: application/json" -d '{"preset":"broadcast"}' \
  "http://127.0.0.1:$PORT/api/v1/sessions/$SESS_A/antiban"
sleep 0.8

BARIS=$(q "SELECT params, params_before, audit FROM api_logs WHERE endpoint LIKE '%/antiban' AND method='PUT' ORDER BY created_at DESC, rowid DESC LIMIT 1")
echo "  baris terakhir: $BARIS"
PARAM=$(echo "$BARIS" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d)[0]||{};try{console.log(JSON.parse(j.params).preset||'')}catch(e){console.log('')}})")
SEBELUM=$(echo "$BARIS" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d)[0]||{};try{console.log(JSON.parse(j.params_before).preset||'')}catch(e){console.log('')}})")
echo "  params.preset=$PARAM · params_before.preset=$SEBELUM"
if [ "$PARAM" = "broadcast" ]; then ok "params menyimpan nilai baru (broadcast)"; else bad "params" "dapat '$PARAM'"; fi
if [ "$SEBELUM" = "strict" ]; then ok "params_before menyimpan nilai lama (strict) — 'dari apa' terjawab"; else bad "params_before" "dapat '$SEBELUM' (harap 'strict')"; fi

echo
echo "=== 2. Baris audit tidak bisa dihapus non-admin ==="
AUDIT_ID=$(q "SELECT id FROM api_logs WHERE audit=1 LIMIT 1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j[0]?j[0].id:'')})")
if [ -z "$AUDIT_ID" ]; then bad "fixture audit" "tidak ada baris audit=1"; else
  echo "  id baris audit: $AUDIT_ID"
  R=$(curl -s -X DELETE -H "X-API-Key: $KEY_A" -H "Content-Type: application/json" \
      -d "{\"ids\":[\"$AUDIT_ID\"]}" "http://127.0.0.1:$PORT/api/v1/api-logs")
  echo "  respons: $R"
  SISA=$(q "SELECT COUNT(*) as n FROM api_logs WHERE id='$AUDIT_ID'" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].n)})")
  if [ "$SISA" = "1" ]; then ok "non-admin TIDAK bisa menghapus baris audit"; else bad "hapus audit" "baris hilang (n=$SISA)"; fi
  if echo "$R" | grep -q "bukti audit"; then ok "respons menjelaskan baris dilewati, bukan diam-diam"; else bad "pesan" "$R"; fi

  # Admin HARUS tetap bisa menghapusnya.
  R2=$(curl -s -X DELETE -H "X-API-Key: $ADMIN" -H "Content-Type: application/json" \
      -d "{\"ids\":[\"$AUDIT_ID\"]}" "http://127.0.0.1:$PORT/api/v1/api-logs")
  SISA2=$(q "SELECT COUNT(*) as n FROM api_logs WHERE id='$AUDIT_ID'" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].n)})")
  if [ "$SISA2" = "0" ]; then ok "admin TETAP bisa menghapus baris audit"; else bad "hapus audit (admin)" "masih ada: $R2"; fi
fi

echo
echo "=== 3. Catatan galat biasa tetap bisa dibersihkan pemiliknya (panel tidak 403) ==="
# Buat baris galat non-audit milik user A: permintaan gagal tanpa actor.
curl -s -o /dev/null -X PUT -H "X-API-Key: $KEY_A" -H "Content-Type: application/json" \
  -d '{"preset":"strict"}' "http://127.0.0.1:$PORT/api/v1/sessions/sess-tidak-ada-xyz/antiban"
sleep 0.8
GALAT_ID=$(q "SELECT id FROM api_logs WHERE audit=0 AND status_code>=400 AND user_id IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j[0]?j[0].id:'')})")
if [ -z "$GALAT_ID" ]; then bad "fixture galat" "tidak ada baris galat audit=0"; else
  R3=$(curl -s -X DELETE -H "X-API-Key: $KEY_A" -H "Content-Type: application/json" \
      -d "{\"ids\":[\"$GALAT_ID\"]}" "http://127.0.0.1:$PORT/api/v1/api-logs")
  SISA3=$(q "SELECT COUNT(*) as n FROM api_logs WHERE id='$GALAT_ID'" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].n)})")
  if [ "$SISA3" = "0" ]; then ok "baris galat biasa tetap bisa dihapus pemiliknya"; else bad "hapus galat" "masih ada: $R3"; fi
fi

echo
echo "=== 4. clear tidak menyentuh baris audit ==="
BEFORE_AUDIT=$(q "SELECT COUNT(*) as n FROM api_logs WHERE audit=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].n)})")
curl -s -o /dev/null -X POST -H "X-API-Key: $KEY_A" -H "Content-Type: application/json" \
  -d '{"olderThanDays":0}' "http://127.0.0.1:$PORT/api/v1/api-logs/clear"
sleep 0.6
AFTER_AUDIT=$(q "SELECT COUNT(*) as n FROM api_logs WHERE audit=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].n)})")
if [ "$BEFORE_AUDIT" = "$AFTER_AUDIT" ]; then ok "clear non-admin tidak mengurangi baris audit ($AFTER_AUDIT tetap)"; else bad "clear" "$BEFORE_AUDIT -> $AFTER_AUDIT"; fi

echo
echo "=== 5. Retensi otomatis menyusutkan baris lama, menyisakan yang baru ==="
# Sisipkan baris tua langsung ke DB: 100 hari (>90 untuk audit, >30 untuk galat).
node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DB_P);
db.prepare(\"INSERT INTO api_logs (id,user_id,method,endpoint,status_code,ip,duration_ms,audit,created_at) VALUES ('log_tua_audit','usr_x','GET','/x',200,'127.0.0.1',1,1,datetime('now','-100 days'))\").run();
db.prepare(\"INSERT INTO api_logs (id,user_id,method,endpoint,status_code,ip,duration_ms,audit,created_at) VALUES ('log_tua_galat','usr_x','GET','/y',500,'127.0.0.1',1,0,datetime('now','-100 days'))\").run();
db.prepare(\"INSERT INTO api_logs (id,user_id,method,endpoint,status_code,ip,duration_ms,audit,created_at) VALUES ('log_baru_audit','usr_x','GET','/z',200,'127.0.0.1',1,1,datetime('now'))\").run();
" DB_P="$DB" 2>/dev/null || DB_P="$DB" node --no-warnings -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(process.env.DB_P);
db.prepare(\"INSERT INTO api_logs (id,user_id,method,endpoint,status_code,ip,duration_ms,audit,created_at) VALUES ('log_tua_audit','usr_x','GET','/x',200,'127.0.0.1',1,1,datetime('now','-100 days'))\").run();
db.prepare(\"INSERT INTO api_logs (id,user_id,method,endpoint,status_code,ip,duration_ms,audit,created_at) VALUES ('log_tua_galat','usr_x','GET','/y',500,'127.0.0.1',1,0,datetime('now','-100 days'))\").run();
db.prepare(\"INSERT INTO api_logs (id,user_id,method,endpoint,status_code,ip,duration_ms,audit,created_at) VALUES ('log_baru_audit','usr_x','GET','/z',200,'127.0.0.1',1,1,datetime('now'))\").run();
"

# Jalankan retensi lewat fungsi yang dipakai penjadwal server.
DB_P="$DB" node --no-warnings -e "
const m = await import('./dist/db/api-logs.js');
const hasil = m.jalankanRetensi();
console.log('  hasil retensi:', JSON.stringify(hasil));
" --input-type=module
TUA_A=$(q "SELECT COUNT(*) as n FROM api_logs WHERE id='log_tua_audit'" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].n)})")
TUA_G=$(q "SELECT COUNT(*) as n FROM api_logs WHERE id='log_tua_galat'" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].n)})")
BARU_A=$(q "SELECT COUNT(*) as n FROM api_logs WHERE id='log_baru_audit'" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d)[0].n)})")
if [ "$TUA_A" = "0" ]; then ok "baris audit >90 hari terhapus otomatis"; else bad "retensi audit" "masih ada (n=$TUA_A)"; fi
if [ "$TUA_G" = "0" ]; then ok "catatan galat >30 hari terhapus otomatis"; else bad "retensi galat" "masih ada (n=$TUA_G)"; fi
if [ "$BARU_A" = "1" ]; then ok "baris audit baru TIDAK ikut terhapus"; else bad "retensi agresif" "baris baru hilang"; fi

echo
echo "=== 6. Penjadwal benar-benar terpasang di server ==="
if grep -q "jadwalkanRetensiApiLogs" dist/server.js 2>/dev/null || grep -q "retensi" "$LOG" 2>/dev/null; then
  ok "server memanggil penjadwal retensi"
else
  bad "penjadwal" "tidak ditemukan di dist/server.js"
fi

echo
echo "=== HASIL: $PASS lulus, $FAIL gagal ==="
[ "$FAIL" -eq 0 ] || exit 1
