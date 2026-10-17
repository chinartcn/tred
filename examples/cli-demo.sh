#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET=examples/_cli_target.ts
TMP_DIR="${TMPDIR:-.tred-tmp}"
mkdir -p "$TMP_DIR"
BODY="$TMP_DIR/tred-cli-body.ts"

cat > "$TARGET" <<'EOF'
export class GraphEngine {
  loadUnlocked(): void {
    console.log('original');
  }
}
EOF

cat > "$BODY" <<'EOF'
loadUnlocked(): void {
  console.log('from cli');
}
EOF

SEL='{"kind":"method","className":"GraphEngine","methodName":"loadUnlocked"}'

run() {
  node bin/tred.mjs replace \
    --file "$TARGET" \
    --anchor "GraphEngine#loadUnlocked" \
    --content-file "$BODY" \
    --fp-source cli-demo --fp-version 1 \
    --auto-inject --selector "$SEL" \
    "$@"
}

echo "=== 1/3 dry-run ==="
run --dry-run

echo
echo "=== 2/3 apply ==="
run

echo
echo "=== 3/3 idempotent ==="
run

echo
echo "=== 最终文件 ==="
cat "$TARGET"
