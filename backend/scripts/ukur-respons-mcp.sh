#!/usr/bin/env bash
# Ukur ukuran respons endpoint yang akan menjadi tool MCP.
#
# Rancangan (Bagian 3.9) mengklaim `GET /sessions/:id/antiban` "berukuran besar
# karena memuat semua definisi preset". Klaim itu belum pernah diukur. Kalau
# salah, alasan MCP meringkas respons tidak berdiri — dan tool baca bisa saja
# meneruskan JSON mentah tanpa masalah.
set -u
PORT=3996
T=$(mktemp -d /tmp/wa-ukur-XXXXXX)
export DATABASE_PATH="$T/t.db" PORT="$PORT" HOST=127.0.0.1 JWT_SECRET="ukur"
cd "$(dirname "$0")/.."
setsid node dist/server.js > "$T/log" 2>&1 &
PID=$!
trap 'kill -TERM -$PID 2>/dev/null; sleep 1; kill -KILL -$PID 2>/dev/null; rm -rf "$T"' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/v1/health" && break; sleep 0.5; done
KEY=$(grep -oE 'wa_live_[a-f0-9]{40,}' "$T/log" | head -1)
SESS=$(node --no-warnings scripts/seed-ukur.mjs 2>/dev/null | grep -oE 'SESS:[^ ]+' | sed 's/^SESS://')
[ -n "$KEY" ] && [ -n "$SESS" ] || { echo "fixture gagal"; exit 1; }

ukur() {
  local label="$1" path="$2"
  local body
  body=$(curl -s --max-time 10 -H "X-API-Key: $KEY" "http://127.0.0.1:$PORT$path")
  local n=${#body}
  # Perkiraan token: ~4 karakter/token untuk JSON Inggris/Indonesia.
  local tok=$((n / 4))
  printf "%-42s %7s byte  ~%5s token\n" "$label" "$n" "$tok"
}

echo "=== Ukuran respons nyata (satu sesi) ==="
ukur "GET /sessions"                    "/api/v1/sessions"
ukur "GET /sessions/:id"                "/api/v1/sessions/$SESS"
ukur "GET /sessions/:id/antiban"        "/api/v1/sessions/$SESS/antiban"
ukur "GET /sessions/:id/metrics"        "/api/v1/sessions/$SESS/metrics"
ukur "GET /sessions/:id/queue/status"   "/api/v1/sessions/$SESS/queue/status"
ukur "GET /messages/:sessionId"         "/api/v1/messages/$SESS"
ukur "GET /antiban/decisions/summary"   "/api/v1/antiban/decisions/summary?sessionId=$SESS"
ukur "GET /metrics"                     "/api/v1/metrics"

echo
echo "=== Apa saja kunci tingkat atas pada respons antiban? ==="
curl -s --max-time 10 -H "X-API-Key: $KEY" "http://127.0.0.1:$PORT/api/v1/sessions/$SESS/antiban" \
 | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
   const j=JSON.parse(d);
   for(const k of Object.keys(j)) {
     const v=j[k]; const s=JSON.stringify(v);
     console.log('  '+k.padEnd(18)+(typeof v).padEnd(8)+String(s.length).padStart(6)+' byte');
   }
   if(j.antiBan) for(const k of Object.keys(j.antiBan)) {
     const s=JSON.stringify(j.antiBan[k]);
     console.log('    antiBan.'+k.padEnd(16)+String(s.length).padStart(6)+' byte');
   }
 })"
