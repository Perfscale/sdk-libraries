#!/usr/bin/env bash
# Re-fetch the perfscale library WIT contract — the single source of truth
# lives in the main perfscale repo at wit/library.wit.
#
#   scripts/sync-wit.sh              # fetch the pinned tag (PERFSCALE_TAG below)
#   PERFSCALE_TAG=v0.22.0 scripts/sync-wit.sh
#
# The engine accepts perfscale:library/library@0.1.x; bump the pin (and the
# SDK's exports if the ABI changed) deliberately, never float on main.
set -euo pipefail
cd "$(dirname "$0")/.."

PERFSCALE_TAG="${PERFSCALE_TAG:-v0.21.0}"
URL="https://raw.githubusercontent.com/Perfscale/perfscale/${PERFSCALE_TAG}/wit/library.wit"
OUT="wit/library.wit"

echo "fetching ${URL}"
curl -fsSL "$URL" -o "$OUT.tmp"
# Sanity: must be the expected package.
grep -q '^package perfscale:library@' "$OUT.tmp" || {
  echo "error: fetched file does not look like wit/library.wit" >&2
  rm -f "$OUT.tmp"
  exit 1
}
mv "$OUT.tmp" "$OUT"
echo "updated $OUT to ${PERFSCALE_TAG}:"
grep '^package ' "$OUT"
