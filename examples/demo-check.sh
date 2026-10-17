#!/usr/bin/env bash
# 不用 set -e：check 有 error 时退出 1 属正常
set -uo pipefail
cd "$(dirname "$0")/.."

DEMO_DIR=".tred-tmp/check-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"

cat > "$DEMO_DIR/ok.ts" <<'EOF'
// @TRED_START: X | fp=11111111
// @TRED_END: X
EOF

echo "=== 1/2 check（健康项目，应退出 0） ==="
node bin/tred.mjs check --dir "$DEMO_DIR" --json > "$DEMO_DIR/r1.json"
RC1=$?
if [ "$RC1" -ne 0 ]; then
  echo "❌ 健康项目 check 应退出 0，实际 $RC1" >&2
  rm -rf "$DEMO_DIR"
  exit 1
fi
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("ok="+j.ok+", issues="+j.issues.length)' "$DEMO_DIR/r1.json"

echo
echo "=== 2/2 加一个 error 后 check（应退出 1） ==="
cat > "$DEMO_DIR/broken.ts" <<'EOF'
// @TRED_START: Y
body
EOF
node bin/tred.mjs check --dir "$DEMO_DIR" --json > "$DEMO_DIR/r2.json"
RC2=$?
if [ "$RC2" -ne 1 ]; then
  echo "❌ 有 error 时 check 应退出 1，实际 $RC2" >&2
  rm -rf "$DEMO_DIR"
  exit 1
fi
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("ok="+j.ok+", issues="+j.issues.length)' "$DEMO_DIR/r2.json"

rm -rf "$DEMO_DIR"

