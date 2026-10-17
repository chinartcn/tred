#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TMP_DIR="${TMPDIR:-.tred-tmp}"
mkdir -p "$TMP_DIR"
DEMO_DIR="$TMP_DIR/fix-cache-demo"
CACHE_DIR="$TMP_DIR/fix-cache-demo/.tred-cache"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR/src"

cat > "$DEMO_DIR/src/a.ts" <<'EOF'
export class A {
  // @TRED_END: ghost-a
  x(): void {}
}
EOF

cat > "$DEMO_DIR/src/b.ts" <<'EOF'
export class B {
  // @TRED_START: B#y | fp=11111111
  y(): void {}
  // @TRED_END: B#y
}
EOF

echo "=== 1. fix --cache --apply（首次，全 miss + 修 + 更新缓存） ==="
node bin/tred.mjs verify --fix --apply --cache --cache-dir "$CACHE_DIR" --dir "$DEMO_DIR" || true

echo
echo "=== 2. 紧接着 verify --cache（期望：全 hit，0 miss） ==="
node bin/tred.mjs verify --cache --cache-dir "$CACHE_DIR" --dir "$DEMO_DIR" --json \
  | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf-8"));console.log(JSON.stringify(j.cacheStats))'

rm -rf "$DEMO_DIR"

