#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== tred ast --file examples/_target.ts ==="
node bin/tred.mjs ast --file examples/_target.ts

echo
echo "=== tred ast --file examples/_target.ts --json ==="
node bin/tred.mjs ast --file examples/_target.ts --json

echo
echo "=== tred replace-many --ops-file examples/ops-demo.json --dry-run ==="
node bin/tred.mjs replace-many --ops-file examples/ops-demo.json --dry-run
