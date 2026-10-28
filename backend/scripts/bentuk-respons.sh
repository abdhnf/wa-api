#!/usr/bin/env bash
# Cetak bentuk JSON nyata dari endpoint yang akan menjadi tool MCP.
# Dipakai untuk menulis formatter tool berdasarkan data sungguhan.
set -u
PORT=3997
T=$(mktemp -d /tmp/wa-bentuk-XXXXXX)
export DATABASE_PATH="$T/t.db" PORT="$PORT" HOST=127.0.0.1 JWT_SECRET="bentuk"
cd "$(dirname "$0")/.."
setsid node dist/server.js > "$T/log" 2>&1 &
PID=$!
trap 'kill -TERM -$PID 2>/dev/null; sleep 1; kill -KILL -$PID 2>/dev/null; rm -rf "$T"' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/v1/health" && break; sleep 0.5; done
KEY=$(grep -oE 'wa_live_[a-f0-9]{40,}' "$T/log" | head -1)
SESS=$(node --no-warnings scripts/seed-ukur.mjs 2>/dev/null | grep -oE 'SESS:[^ ]+' | sed 's/^SESS://')

ambil() {
  echo "########## $1"
  curl -s --max-time 10 -H "X-API-Key: $KEY" "http://127.0.0.1:$PORT$2" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
        try{ console.log(JSON.stringify(JSON.parse(d),null,1).slice(0,2200)) }catch(e){ console.log('(bukan JSON) '+d.slice(0,300)) }
      })"
  echo
}

ambil "GET /sessions/:id/antiban" "/api/v1/sessions/$SESS/antiban"
ambil "GET /sessions/:id/metrics" "/api/v1/sessions/$SESS/metrics"
ambil "GET /sessions/:id/queue/status" "/api/v1/sessions/$SESS/queue/status"
ambil "GET /sessions" "/api/v1/sessions"
