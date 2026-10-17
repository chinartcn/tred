#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

DEMO_DIR=".tred-tmp/init-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"

echo "=== 1/3 tred init ==="
node bin/tred.mjs init --dir "$DEMO_DIR"
echo
echo "--- .tred/config.json 内容 ---"
cat "$DEMO_DIR/.tred/config.json"

echo
echo "=== 2/3 tred init 二次（幂等） ==="
node bin/tred.mjs init --dir "$DEMO_DIR"

echo
echo "=== 3/3 tred init --with-hook ==="
node bin/tred.mjs init --dir "$DEMO_DIR" --with-hook
if [ -f "$DEMO_DIR/.git/hooks/pre-commit" ]; then
  echo "--- pre-commit hook 内容 ---"
  cat "$DEMO_DIR/.git/hooks/pre-commit"
fi

rm -rf "$DEMO_DIR"

