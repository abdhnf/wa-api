#!/usr/bin/env bash
# Jalankan seluruh uji backend terhadap dist/server.js hasil build saat ini.
# Tiap uji memakai DB /tmp sendiri dan port sendiri — DB kerja tidak tersentuh.
set -u
cd "$(dirname "$0")/.." || exit 1

lulus=0
gagal=0
gagal_nama=()

jalankan() {
  local skrip="$1" db="$2"
  echo "───────────────────────────────────────────────────────────"
  echo "  $skrip"
  echo "───────────────────────────────────────────────────────────"
  rm -f "$db" "$db-shm" "$db-wal"
  if DATABASE_PATH="$db" node "scripts/$skrip" 2>&1 | tail -25; then
    :
  fi
  # Status sebenarnya diambil dari PIPESTATUS, bukan dari tail.
  local st=${PIPESTATUS[0]}
  if [ "$st" -eq 0 ]; then
    echo "  >> LULUS ($skrip)"
    lulus=$((lulus + 1))
  else
    echo "  >> GAGAL ($skrip) exit=$st"
    gagal=$((gagal + 1))
    gagal_nama+=("$skrip")
  fi
  echo
}

jalankan uji-telepon.mjs       /tmp/refactor-telepon.db
jalankan uji-reset-password.mjs /tmp/refactor-resetpw.db
jalankan uji-e2e-reset.mjs     /tmp/refactor-e2e-reset.db
jalankan uji-e2e-daftar.mjs    /tmp/refactor-e2e-daftar.db
jalankan uji-base-url-panel.mjs /tmp/refactor-baseurl.db

echo "═══════════════════════════════════════════════════════════"
echo "  RINGKASAN: $lulus lulus, $gagal gagal"
if [ "$gagal" -gt 0 ]; then
  echo "  Gagal: ${gagal_nama[*]}"
fi
echo "═══════════════════════════════════════════════════════════"
exit "$gagal"
