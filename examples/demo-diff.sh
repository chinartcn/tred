#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== tred diff --anchor GraphEngine#loadUnlocked --file _diff_demo/a.ts --against _diff_demo/b.ts ==="
node bin/tred.mjs diff \
  --anchor "GraphEngine#loadUnlocked" \
  --file examples/_diff_demo/a.ts \
  --against examples/_diff_demo/b.ts \
  || true

echo
echo "=== --exit-code（有差异 → 退出码 1） ==="
set +e
node bin/tred.mjs diff \
  --anchor "GraphEngine#loadUnlocked" \
  --file examples/_diff_demo/a.ts \
  --against examples/_diff_demo/b.ts \
  --exit-code > /dev/null
echo "退出码: $?"
set -e

echo
echo "=== --json ==="
node bin/tred.mjs diff \
  --anchor "GraphEngine#loadUnlocked" \
  --file examples/_diff_demo/a.ts \
  --against examples/_diff_demo/b.ts \
  --json || true

