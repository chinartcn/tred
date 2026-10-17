#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TMP_DIR=".tred-tmp"
mkdir -p "$TMP_DIR"
DEMO_DIR="$TMP_DIR/annotate-dir-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR/sub"

cat > "$DEMO_DIR/engine.ts" <<'EOF'
export class GraphEngine {
  loadUnlocked(): void {}
  save(): void {}
}
EOF

cat > "$DEMO_DIR/sub/helper.ts" <<'EOF'
export function helper(): number {
  return 42;
}
EOF

echo "=== 1/3 annotate --dir --all（dry-run） ==="
node bin/tred.mjs annotate --dir "$DEMO_DIR" --all

echo
echo "=== 2/3 annotate --dir --all --apply ==="
node bin/tred.mjs annotate --dir "$DEMO_DIR" --all --apply

echo
echo "--- engine.ts 内容 ---"
cat "$DEMO_DIR/engine.ts"
echo
echo "--- sub/helper.ts 内容 ---"
cat "$DEMO_DIR/sub/helper.ts"

echo
echo "=== 3/3 幂等：再跑一次，0 新增 ==="
node bin/tred.mjs annotate --dir "$DEMO_DIR" --all --json | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf-8"));console.log("totalActions="+j.totalActions+", annotatedFiles="+j.annotatedFiles)'

rm -rf "$DEMO_DIR"
