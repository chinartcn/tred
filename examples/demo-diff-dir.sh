#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== tred diff --dir v1 --against-dir v2 ==="
node bin/tred.mjs diff \
  --dir examples/_diff_dir_demo/v1 \
  --against-dir examples/_diff_dir_demo/v2 \
  || true

echo
echo "=== 只看 GraphEngine#loadUnlocked 的差异（--exit-code，有差异应退出 1） ==="
set +e
node bin/tred.mjs diff \
  --dir examples/_diff_dir_demo/v1 \
  --against-dir examples/_diff_dir_demo/v2 \
  --anchor "GraphEngine#loadUnlocked" \
  --exit-code
RC=$?
set -e
echo "退出码: $RC（期望 1，因为 --exit-code 检测到差异）"
if [ "$RC" -ne 1 ]; then
  echo "❌ 预期退出码 1，实际 $RC"
  exit 1
fi

