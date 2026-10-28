#!/usr/bin/env bash
# Uji end-to-end: autentikasi -> catat keputusan -> baca lewat endpoint audit.
#
# Kredensial admin bawaan dicetak saat bootstrap pada DB kosong. Kunci itu
# ditangkap ke variabel dan SENGAJA tidak pernah di-echo: yang dibuktikan di
# sini adalah perilaku endpoint, bukan nilainya.
set -u

PORT=3997
TMPDIR_TEST=$(mktemp -d /tmp/wa-e2e-XXXXXX)
DB="$TMPDIR_TEST/e2e.db"
LOG="$TMPDIR_TEST/server.log"

export DATABASE_PATH="$DB"
export PORT="$PORT"
export HOST=127.0.0.1
export JWT_SECRET="e2e-test-secret"

# Skrip ini tinggal di backend/scripts; jalankan dari backend/ supaya
# path dist/ dan node_modules/ tetap benar.
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

echo
echo "=== 1. Siapkan data: 2 sesi milik user berbeda + keputusan ==="
USER_KEY=$(node scripts/seed-decision-log-e2e.mjs 2>/dev/null | grep -oE 'USERKEY:wa_live_[a-f0-9]+' | sed 's/^USERKEY://' | head -1)
echo "  kunci non-admin: [REDACTED, panjang ${#USER_KEY}]"

echo
echo "=== 2. GET summary (auth admin) ==="
curl -s --max-time 5 -H "X-API-Key: $ADMIN_KEY" \
  "http://127.0.0.1:$PORT/api/v1/antiban/decisions/summary?sessionId=sess-milik-biasa&sinceHours=24" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('  '+JSON.stringify(j.summary));})"

echo
echo "=== 3. GET daftar keputusan: bentuk & PII ==="
curl -s --max-time 5 -H "X-API-Key: $ADMIN_KEY" \
  "http://127.0.0.1:$PORT/api/v1/antiban/decisions?sessionId=sess-milik-biasa&limit=3" \
  | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d);
  console.log('  total:', j.total, '| dikembalikan:', j.decisions.length);
  const r=j.decisions[0];
  console.log('  guard='+r.guard, 'decision='+r.decision, 'preset='+r.preset);
  console.log('  metrics terurai:', r.metrics && typeof r.metrics==='object' ? JSON.stringify(r.metrics) : 'BUKAN OBJEK: '+r.metrics);
  console.log('  threshold terurai:', r.threshold && typeof r.threshold==='object' ? JSON.stringify(r.threshold) : 'BUKAN OBJEK: '+r.threshold);
  console.log('  recipient_hash:', r.recipient_hash);
  console.log('  PII: ' + (/6281234/.test(d) ? 'BOCOR!' : 'tidak ada nomor mentah (OK)'));
  const allow = j.decisions.find(x=>x.guard==='contactGraph');
  if (allow) console.log('  alasan allow terlihat:', allow.reason);
});"

echo
echo "=== 4. Filter ==="
for f in "guard=contactGraph" "decision=block" "batchId=cmp-e2e"; do
  T=$(curl -s --max-time 5 -H "X-API-Key: $ADMIN_KEY" \
    "http://127.0.0.1:$PORT/api/v1/antiban/decisions?sessionId=sess-milik-biasa&$f" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).total))")
  echo "  $f -> total $T"
done

echo
echo "=== 5. Isolasi tenant (kunci NON-ADMIN) ==="
C1=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "X-API-Key: $USER_KEY" \
  "http://127.0.0.1:$PORT/api/v1/antiban/decisions?sessionId=sess-milik-biasa")
echo "  sesi miliknya sendiri   -> $C1 (harap 200)"

C2=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "X-API-Key: $USER_KEY" \
  "http://127.0.0.1:$PORT/api/v1/antiban/decisions?sessionId=sess-milik-admin")
echo "  sesi milik orang lain   -> $C2 (harap 403)"

C3=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H "X-API-Key: $USER_KEY" \
  "http://127.0.0.1:$PORT/api/v1/antiban/decisions")
echo "  non-admin tanpa sesi    -> $C3 (harap 400)"

C4=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
  "http://127.0.0.1:$PORT/api/v1/antiban/decisions")
echo "  tanpa kunci sama sekali -> $C4 (harap 401)"

echo
echo "=== 6. Read-only: tidak ada route tulis di /antiban/decisions ==="
for m in POST PUT DELETE PATCH; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X $m -H "X-API-Key: $ADMIN_KEY" \
    "http://127.0.0.1:$PORT/api/v1/antiban/decisions")
  echo "  $m -> $CODE (harap 404 = tidak ada jalur tulis)"
done

echo
echo "=== E2E SELESAI ==="
