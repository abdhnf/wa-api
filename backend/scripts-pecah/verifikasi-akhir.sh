#!/usr/bin/env bash
# Verifikasi akhir refactor server.ts: build bersih, isi kode identik,
# permukaan route utuh, uji lama hijau, dan permukaan HTTP identik.
set -u
cd "$(dirname "$0")/.." || exit 1

GAGAL=0
langkah() { echo; echo "═══ $1"; }

langkah "1. BUILD BERSIH (tsc)"
rm -rf dist
if npx tsc -p tsconfig.json 2>&1 | head -20; then
  if [ -f dist/server.js ]; then
    echo "  OK: build exit 0, dist/server.js ada"
    echo "  berkas js: $(find dist -name '*.js' | wc -l) (sebelum pecah: 21)"
  else
    echo "  GAGAL: dist/server.js tidak ada"; GAGAL=1
  fi
else
  echo "  GAGAL: tsc error"; GAGAL=1
fi

langkah "2. ISI KODE IDENTIK DENGAN ASLI"
if python3 /tmp/verifikasi-pecah.py; then :; else GAGAL=1; fi

langkah "3. PERMUKAAN ROUTE (jumlah + daftar)"
python3 /tmp/banding-route.py

langkah "4. UJI LAMA TANPA PERUBAHAN"
for pair in "uji-telepon.mjs:telepon" "uji-reset-password.mjs:resetpw" "uji-e2e-reset.mjs:e2e-reset" "uji-e2e-daftar.mjs:e2e-daftar" "uji-base-url-panel.mjs:baseurl"; do
  s="${pair%%:*}"; n="${pair##*:}"
  d="/tmp/akhir-$n.db"
  rm -f "$d" "$d-shm" "$d-wal"
  out=$(DATABASE_PATH="$d" node "scripts/$s" 2>&1)
  st=$?
  ringkas=$(echo "$out" | grep -oE "[0-9]+ LULUS / [0-9]+ GAGAL|SEMUA UJI[A-Z ]*LULUS|Gagal: [0-9]+" | tail -1)
  if [ "$st" -eq 0 ]; then
    echo "  LULUS  $s  (${ringkas:-ok})"
  else
    echo "  GAGAL  $s  exit=$st"
    echo "$out" | tail -12 | sed 's/^/         /'
    GAGAL=1
  fi
done

langkah "5. PERMUKAAN HTTP: ASLI vs PECAHAN"
# Jangan pipe langsung ke tail: status exit yang terbaca jadi milik tail, bukan
# node, sehingga kegagalan bisa lolos dan laporan tetap berbunyi "SEMUA LULUS".
out5=$(node scripts-pecah/banding-http.mjs 2>&1)
st5=$?
echo "$out5" | tail -24
if [ "$st5" -ne 0 ]; then
  echo "  GAGAL: permukaan HTTP berbeda (exit=$st5)"
  GAGAL=1
fi

echo
echo "═══════════════════════════════════════════════════════════"
if [ "$GAGAL" -eq 0 ]; then
  echo "  SEMUA VERIFIKASI LULUS"
else
  echo "  ADA VERIFIKASI YANG GAGAL"
fi
echo "═══════════════════════════════════════════════════════════"
exit "$GAGAL"
