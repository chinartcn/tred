#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TMP_DIR="${TMPDIR:-.tred-tmp}"
mkdir -p "$TMP_DIR"
CACHE_DIR="$TMP_DIR/cache-demo"
rm -rf "$CACHE_DIR"

show() {
  node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf-8"));console.log(JSON.stringify(j.cacheStats))'
}

echo "=== 1/3 首次 verify --cache（全 miss） ==="
node bin/tred.mjs verify --dir examples/_verify_demo --cache --cache-dir "$CACHE_DIR" --json | show || true

echo
echo "=== 2/3 再次 verify --cache（全 hit） ==="
node bin/tred.mjs verify --dir examples/_verify_demo --cache --cache-dir "$CACHE_DIR" --json | show || true

echo
echo "=== 3/3 修改一个文件 → 该文件 miss ==="
echo "// touched" >> examples/_verify_demo/src/healthy.ts
node bin/tred.mjs verify --dir examples/_verify_demo --cache --cache-dir "$CACHE_DIR" --json | show || true

rm -rf "$CACHE_DIR"

