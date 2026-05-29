#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

STEP=0
bail() { echo "FAIL: $1"; exit 1; }
ok()   { echo "OK: $1"; }

run() {
  STEP=$((STEP + 1))
  local label="$1"; shift
  echo ""
  echo "=== Step $STEP: $label ==="
  "$@" || bail "$label failed"
  ok "$label"
}

run "Sync sources"          npm run jobs:sync-sources
run "Sync pending sources"  npm run jobs:sync-targeted-pending-sources
run "Apply admin actions"   npm run jobs:apply-admin-actions
run "Freshness audit"       npm run jobs:freshness-audit -- --write
run "Promote public ready"  npm run jobs:promote-public-ready
run "Refresh public"        npm run jobs:refresh-public
run "Validate public data"  npm run jobs:validate-public-data
run "Build pages"           npm run jobs:build-pages
run "Repair overlap"        npm run jobs:repair-overlap

echo ""
echo "=== Pipeline complete ==="
echo "Steps: $STEP"
echo ""
echo "Generated reports:"
ls -1 reports/*.json 2>/dev/null | head -10
