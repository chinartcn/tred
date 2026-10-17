#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== verify --format markdown ==="
node bin/tred.mjs verify --format markdown --dir examples/_verify_demo || true

echo
echo "=== verify --fix --format markdown (dry-run) ==="
node bin/tred.mjs verify --fix --format markdown --dir examples/_fix_demo || true
