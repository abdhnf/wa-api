#!/usr/bin/env bash
# Uji alur pairing panel (JWT) masih jalan setelah pemeriksaan kepemilikan
# ditambahkan ke GET /sessions/:id/qr.
#
# Rute QR memakai `requireJwt`, yang hanya memverifikasi token dan TIDAK mengisi
# `req.apiKeyUser`. Jadi pemeriksaan kepemilikan di sana harus mengambil identitas
# dari `req.user.id` — kalau salah, panel akan menampilkan 403 pada sesi miliknya
# sendiri, atau (lebih buruk) 200 pada sesi orang lain.
set -u

PORT=3995
TMPDIR_TEST=$(mktemp -d /tmp/wa-qr-XXXXXX)
DB="$TMPDIR_TEST/t.db"
LOG="$TMPDIR_TEST/server.log"

export DATABASE_PATH="$DB" PORT="$PORT" HOST=127.0.0.1 JWT_SECRET="e2e-qr-secret"
cd "$(dirname "$0")/.."

setsid node dist/server.js > "$LOG" 2>&1 &
SRV_PID=$!
cleanup() { kill -TERM -"$SRV_PID" 2>/dev/null || kill -TERM "$SRV_PID" 2>/dev/null; sleep 1; kill -KILL -"$SRV_PID" 2>/dev/null || true; rm -rf "$TMPDIR_TEST"; }
trap cleanup EXIT

for i in $(seq 1 40); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/v1/health" && break; sleep 0.5; done

# Dua user dengan password yang diketahui, supaya bisa login lewat JWT.
FIX=$(node --no-warnings scripts/seed-tenant-jwt.mjs 2>/dev/null)
A_EMAIL=$(echo "$FIX" | grep -oE 'AEMAIL:[^ ]+' | sed 's/^AEMAIL://')
B_EMAIL=$(echo "$FIX" | grep -oE 'BEMAIL:[^ ]+' | sed 's/^BEMAIL://')
A_PASS=$(echo "$FIX" | grep -oE 'APASS:[^ ]+' | sed 's/^APASS://')
SESS_A=$(echo "$FIX" | grep -oE 'SESSA:[^ ]+' | sed 's/^SESSA://')
SESS_B=$(echo "$FIX" | grep -oE 'SESSB:[^ ]+' | sed 's/^SESSB://')

login() {
  curl -s --max-time 6 -X POST -H "Content-Type: application/json" \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    "http://127.0.0.1:$PORT/api/v1/auth/login" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch(e){console.log('')}})"
}

TOK_A=$(login "$A_EMAIL" "$A_PASS")
echo "token A: $([ -n "$TOK_A" ] && echo "didapat (${#TOK_A} char)" || echo "GAGAL")"
[ -n "$TOK_A" ] || { echo "GAGAL login"; exit 1; }

PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  OK   $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL $1 -> $2"; }

# QR sesi milik sendiri: harus 404 ("QR belum muncul"), BUKAN 403/401.
# 404 di sini adalah jawaban yang benar karena tidak ada socket WA yang berjalan
# di lingkungan uji — yang diuji adalah lolosnya otorisasi, bukan isi QR.
CA=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 -H "Authorization: Bearer $TOK_A" "http://127.0.0.1:$PORT/api/v1/sessions/$SESS_A/qr")
if [ "$CA" = "404" ] || [ "$CA" = "200" ]; then ok "QR sesi sendiri lolos otorisasi ($CA)"; else bad "QR sesi sendiri" "dapat $CA (harap 404/200, bukan 403)"; fi

CB=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 -H "Authorization: Bearer $TOK_A" "http://127.0.0.1:$PORT/api/v1/sessions/$SESS_B/qr")
if [ "$CB" = "403" ]; then ok "QR sesi orang lain ditolak ($CB)"; else bad "QR sesi orang lain" "dapat $CB (harap 403)"; fi

# Tanpa token sama sekali: harus 401, bukan 403 — supaya jelas beda antara
# "belum login" dan "bukan milikmu".
CC=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 "http://127.0.0.1:$PORT/api/v1/sessions/$SESS_A/qr")
if [ "$CC" = "401" ]; then ok "tanpa token ditolak 401"; else bad "tanpa token" "dapat $CC"; fi

# Sesi yang tidak ada: 404, jangan 403 (jangan membocorkan bahwa id itu ada).
CD=$(curl -s -o /dev/null -w "%{http_code}" --max-time 6 -H "Authorization: Bearer $TOK_A" "http://127.0.0.1:$PORT/api/v1/sessions/sess-tidak-ada-xyz/qr")
if [ "$CD" = "404" ]; then ok "sesi tidak ada -> 404 (tidak membocorkan keberadaan)"; else bad "sesi tidak ada" "dapat $CD"; fi

echo
echo "=== HASIL: $PASS lulus, $FAIL gagal ==="
[ "$FAIL" -eq 0 ] || exit 1
