#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "非 git 仓库，跳过 since 演示"
  exit 0
fi

echo "=== 1. verify --since HEAD~1（只扫最近改动文件） ==="
node bin/tred.mjs verify --dir . --since HEAD~1 --json 2>/dev/null | head -20 || echo "（无 git 历史或错误）"

echo
echo "=== 2. annotate --dir examples --since HEAD~1 --all --json（dry-run） ==="
node bin/tred.mjs annotate --dir examples --all --since HEAD~1 --json 2>/dev/null | head -20 || echo "（无改动或错误）"

echo
echo "=== 3. diff --dir examples --against-dir examples --since HEAD~1 --format markdown ==="
node bin/tred.mjs diff --dir examples --against-dir examples --since HEAD~1 --format markdown 2>/dev/null | head -30 || echo "（无改动或错误）"
