#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

DEMO_DIR=".tred-tmp/diff-from-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR/src"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "（当前目录不是 git 仓库，改为展示 --diff-from 逻辑说明）"
  echo "  --diff-from <ref>：只保留 git diff <ref> HEAD 命中行上的 issues"
  echo "  适合 PR 场景：只校验改动的行有没有引入新问题"
  exit 0
fi

echo "=== 1/2 verify 全量（不区分改动行） ==="
node bin/tred.mjs verify --dir examples/_verify_demo --json > "$DEMO_DIR/all.json" || true
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("issues="+j.issues.length)' "$DEMO_DIR/all.json"

echo
echo "=== 2/2 verify --diff-from HEAD~1（只看改动行） ==="
node bin/tred.mjs verify --dir examples/_verify_demo --diff-from HEAD~1 --json > "$DEMO_DIR/diff.json" || true
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("issues="+j.issues.length)' "$DEMO_DIR/diff.json"

rm -rf "$DEMO_DIR"

