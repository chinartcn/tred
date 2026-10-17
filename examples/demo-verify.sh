#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== tred verify --dir examples/_verify_demo （人类可读） ==="
node bin/tred.mjs verify --dir examples/_verify_demo || true

echo
echo "=== tred verify --dir examples/_verify_demo --strict （warning 也升 error） ==="
node bin/tred.mjs verify --dir examples/_verify_demo --strict || true

echo
echo "=== tred verify --dir examples/_verify_demo --json（截断到前 50 行） ==="
node bin/tred.mjs verify --dir examples/_verify_demo --json | head -50
