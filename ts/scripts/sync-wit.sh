#!/usr/bin/env bash
# Re-fetch the perfscale WIT contracts — the single source of truth lives in
# the main perfscale repo at wit/library.wit, wit/reporter/reporter.wit and
# wit/step/ (step.wit plus its pinned deps/perfscale-library/library.wit).
#
#   scripts/sync-wit.sh              # fetch the pinned tag (PERFSCALE_TAG below)
#   PERFSCALE_TAG=v0.22.0 scripts/sync-wit.sh
#
# The engine dispatches bindings by ABI major version — 0.1 components keep
# working, 0.2 adds `settings-json` to the call context. Bump the pin (and
# the SDK's exports if the ABI changed) deliberately, never float on main.
# reporter.wit exists since the WASM-reporter release (issue #9); syncing
# from an older tag leaves the local copy untouched.
set -euo pipefail
cd "$(dirname "$0")/.."

PERFSCALE_TAG="${PERFSCALE_TAG:-v0.24.0}"

fetch() {
  local src="$1" dst="$2" pkg="$3"
  local url="https://raw.githubusercontent.com/Perfscale/perfscale/${PERFSCALE_TAG}/${src}"
  echo "fetching ${url}"
  if ! curl -fsSL "$url" -o "$dst.tmp"; then
    echo "warning: ${src} not in ${PERFSCALE_TAG} — keeping the local ${dst}" >&2
    rm -f "$dst.tmp"
    return 0
  fi
  # Sanity: must be the expected package.
  grep -q "^package ${pkg}" "$dst.tmp" || {
    echo "error: fetched file does not look like ${src}" >&2
    rm -f "$dst.tmp"
    exit 1
  }
  mv "$dst.tmp" "$dst"
  grep '^package ' "$dst"
}

fetch "wit/library.wit" "wit/library.wit" "perfscale:library@"
fetch "wit/reporter/reporter.wit" "wit/reporter/reporter.wit" "perfscale:reporter@"
# The step ABI (RFC 009) lives in its own package dir; its `deps/` pins the
# exact `perfscale:library` revision the step worlds re-export, so it is
# synced with the step file, from the same tag — never mixed across tags.
fetch "wit/step/step.wit" "wit/step/step.wit" "perfscale:step@"
fetch "wit/step/deps/perfscale-library/library.wit" \
  "wit/step/deps/perfscale-library/library.wit" "perfscale:library@"
