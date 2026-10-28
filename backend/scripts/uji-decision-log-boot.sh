#!/usr/bin/env bash
# Uji boot server pada DB KOSONG di port cadangan.
#
# Aturan produksi: JANGAN memakai salinan wa.db di sini. Salinan itu membawa
# kredensial sesi WA hidup dan instance kedua bisa ikut menyambung ke sesi yang
# sama. DB kosong membuktikan hal yang sama untuk keperluan ini: server start,
# route terdaftar, skema terbentuk dari nol.
set -u

PORT=3999
TMPDIR_TEST=$(mktemp -d /tmp/wa-boot-XXXXXX)
DB="$TMPDIR_TEST/boot.db"
LOG="$TMPDIR_TEST/server.log"

export DATABASE_PATH="$DB"
export PORT="$PORT"
export HOST=127.0.0.1
export JWT_SECRET="boot-test-secret"

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

# Tunggu sampai port benar-benar menerima koneksi (maks ~20s)
for i in $(seq 1 40); do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/v1/health" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

echo "=== 1. Server hidup? ==="
HEALTH=$(curl -s --max-time 5 "http://127.0.0.1:$PORT/api/v1/health" || echo "")
echo "  /api/v1/health -> $HEALTH"
echo "$HEALTH" | grep -q '"status":"ok"' && echo "  OK   server merespons" || echo "  FAIL server tidak merespons"

echo
echo "=== 2. Route audit terdaftar? (tanpa auth harus 401, bukan 404) ==="
for ep in "/api/v1/antiban/decisions" "/api/v1/antiban/decisions/summary"; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$PORT$ep")
  echo "  $ep -> $CODE"
  if [ "$CODE" = "404" ]; then echo "     FAIL handler belum terdaftar"; else echo "     OK   handler ada"; fi
done

echo
echo "=== 3. Tabel terbentuk dari nol? ==="
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$DB', { readOnly: true });
const t = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='antiban_decisions'\").all();
const i = db.prepare(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='antiban_decisions'\").all();
console.log('  tabel antiban_decisions:', t.length === 1 ? 'ADA' : 'TIDAK ADA');
console.log('  index:', i.length, i.map(x => x.name).join(', '));
" 2>&1 | grep -v Experimental | grep -v trace-warnings

echo
echo "=== 4. Log server: error tak terduga? ==="
ERRN=$(grep -icE "unhandled|TypeError|ReferenceError|Cannot read|is not a function" "$LOG" 2>/dev/null | head -1)
ERRN=${ERRN:-0}
echo "  error fatal: $ERRN"
[ "$ERRN" = "0" ] && echo "  OK   tidak ada error fatal" || { echo "  FAIL:"; grep -iE "unhandled|TypeError|ReferenceError|Cannot read" "$LOG" | head -5; }

echo
echo "=== 5. Peringatan decision log? (harus nol) ==="
WARN=$(grep -c "antiban:decision-log" "$LOG" 2>/dev/null | head -1)
WARN=${WARN:-0}
echo "  baris peringatan: $WARN"
[ "$WARN" = "0" ] && echo "  OK   tidak ada peringatan" || grep "antiban:decision-log" "$LOG" | head -3

echo
echo "=== BOOT TEST SELESAI ==="
