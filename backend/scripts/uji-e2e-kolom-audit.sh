#!/usr/bin/env bash
# Uji ujung-ke-ujung: apakah kolom audit benar-benar SAMPAI ke panel?
#
# Uji unit (`uji-perubahan-audit-panel.mjs`) membuktikan formatter benar untuk
# input yang saya karang sendiri. Itu belum membuktikan bahwa server benar-benar
# MENGIRIM params_before/actor/audit ke panel — kalau satu nama kolom salah tulis
# di `listApiLogs`, formatter tetap lulus uji dan tabelnya tetap kosong.
#
# Jadi di sini: server sungguhan, DB kosong, request sungguhan, lalu periksa JSON
# yang benar-benar dikirim ke panel.
set -u

PORT=3998
T=$(mktemp -d /tmp/wa-e2e-audit-XXXXXX)
export DATABASE_PATH="$T/t.db" PORT="$PORT" HOST=127.0.0.1 JWT_SECRET="e2e-uji"
cd "$(dirname "$0")/.."

setsid node dist/server.js > "$T/log" 2>&1 &
PID=$!
cleanup() { kill -TERM -"$PID" 2>/dev/null; sleep 1; kill -KILL -"$PID" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT

for i in $(seq 1 40); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/v1/health" && break; sleep 0.5; done
ADMIN=$(grep -oE 'wa_live_[a-f0-9]{40,}' "$T/log" | head -1)
[ -n "$ADMIN" ] || { echo "GAGAL: kunci admin tidak ditemukan"; exit 1; }

FIX=$(node --no-warnings scripts/seed-celah-uji.mjs 2>/dev/null)
KEY_A=$(echo "$FIX" | grep -oE 'KEYA:[^ ]+' | sed 's/^KEYA://')
SESS_A=$(echo "$FIX" | grep -oE 'SESSA:[^ ]+' | sed 's/^SESSA://')

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  OK   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1 -> $2"; }

# Dua perubahan preset dengan actor: baris kedua punya params_before.
curl -s -o /dev/null -X PUT -H "X-API-Key: $KEY_A" -H "X-MCP-Actor: agen-e2e" \
  -H "Content-Type: application/json" -d '{"preset":"strict"}' \
  "http://127.0.0.1:$PORT/api/v1/sessions/$SESS_A/antiban"
sleep 0.5
curl -s -o /dev/null -X PUT -H "X-API-Key: $KEY_A" -H "X-MCP-Actor: agen-e2e" \
  -H "Content-Type: application/json" -d '{"preset":"broadcast"}' \
  "http://127.0.0.1:$PORT/api/v1/sessions/$SESS_A/antiban"
sleep 0.5
# Baris tanpa actor: log galat biasa (harus audit=false).
curl -s -o /dev/null -X PUT -H "X-API-Key: $KEY_A" -H "Content-Type: application/json" \
  -d '{"preset":"strict"}' "http://127.0.0.1:$PORT/api/v1/sessions/sess-tidak-ada/antiban"
sleep 0.8

echo "=== 1. Respons GET /api-logs memuat kolom audit ==="
RESP=$(curl -s -H "X-API-Key: $ADMIN" "http://127.0.0.1:$PORT/api/v1/api-logs?limit=50")

# Periksa bentuk respons. Cetak satu baris per asersi supaya bash bisa
# MENGHITUNGNYA — blok yang mencetak "OK" tetapi tidak dihitung membuat ringkasan
# akhir berbohong ("2 lulus" padahal 12 asersi berjalan).
PERIKSA=$(echo "$RESP" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d); const rows=j.logs||[];
  const out=(ok,nama,ekstra)=>console.log((ok?'OK|':'FAIL|')+nama+(ekstra?'|'+ekstra:''));
  for (const k of ['actor','targetType','targetId','params','paramsBefore','audit']) {
    out(rows.length>0 && rows.every(r=>k in r), 'field '+k+' ada di setiap baris');
  }
  const r=rows.find(x=>x.paramsBefore);
  out(!!r, 'ada baris dengan paramsBefore terisi');
  if (!r) return;
  const baru=JSON.parse(r.params||'{}'), lama=JSON.parse(r.paramsBefore||'{}');
  out(baru.preset==='broadcast', 'params.preset = broadcast', 'dapat: '+baru.preset);
  out(lama.preset==='strict', 'params_before.preset = strict', 'dapat: '+lama.preset);
  out(r.actor==='agen-e2e', 'actor = agen-e2e', 'dapat: '+r.actor);
  out(r.audit===true, 'audit = true untuk baris ber-actor');
  const tanpaActor=rows.filter(x=>!x.actor);
  out(tanpaActor.length>0, 'ada baris tanpa actor untuk dibandingkan');
  out(tanpaActor.every(x=>x.audit===false), 'baris tanpa actor -> audit=false ('+tanpaActor.length+' baris)');
});
")

while IFS='|' read -r status nama ekstra; do
  [ -z "$status" ] && continue
  if [ "$status" = "OK" ]; then ok "$nama"; else bad "$nama" "${ekstra:-tidak cocok}"; fi
done <<< "$PERIKSA"

echo
echo "=== 4. Nomor telepon di params tidak terkirim mentah ==="
# Kirim body yang memuat nomor; penyaring harus menggantinya dengan hash.
curl -s -o /dev/null -X POST -H "X-API-Key: $KEY_A" -H "X-MCP-Actor: agen-e2e" \
  -H "Content-Type: application/json" -d '{"to":"6281234567890@s.whatsapp.net","text":"uji"}' \
  "http://127.0.0.1:$PORT/api/v1/sessions/$SESS_A/messages/send"
sleep 0.8
RESP2=$(curl -s -H "X-API-Key: $ADMIN" "http://127.0.0.1:$PORT/api/v1/api-logs?limit=50")
if echo "$RESP2" | grep -q "6281234567890"; then
  bad "nomor mentah bocor ke respons" "6281234567890 ditemukan"
else
  ok "nomor mentah TIDAK ada di respons panel"
fi
if echo "$RESP2" | grep -q 'hash:'; then ok "nomor tersimpan sebagai hash"; else bad "hash" "tidak ditemukan"; fi

echo
echo "=== HASIL: $PASS lulus, $FAIL gagal ==="
[ "$FAIL" -eq 0 ] || exit 1
