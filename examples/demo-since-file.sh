#!/usr/bin/env bash
# 不用 set -e：verify 有 error 时退出 1 属正常
set -uo pipefail
cd "$(dirname "$0")/.."

DEMO_DIR=".tred-tmp/since-file-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR/src"

cat > "$DEMO_DIR/src/a.ts" <<'EOF'
// @TRED_START: A | fp=11111111
export class Foo {}
// @TRED_END: A
EOF

cat > "$DEMO_DIR/src/b.ts" <<'EOF'
// @TRED_START: B | fp=22222222
export class Bar {}
// @TRED_END: B
EOF

cat > "$DEMO_DIR/changed.txt" <<'EOF'
src/a.ts
EOF

echo "=== 1/2 verify --since-file changed.txt（应只扫 1 个文件） ==="
node bin/tred.mjs verify --dir "$DEMO_DIR" --since-file "$DEMO_DIR/changed.txt" --json > "$DEMO_DIR/out1.json"
RC1=$?
if [ "$RC1" -ne 0 ] && [ "$RC1" -ne 1 ]; then
  echo "❌ verify 意外退出码: $RC1" >&2
  rm -rf "$DEMO_DIR"
  exit 1
fi
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("files="+j.files.length+", scanned="+j.scannedFiles)' "$DEMO_DIR/out1.json"

echo
echo "=== 2/2 全量对照（应扫 2 个文件） ==="
node bin/tred.mjs verify --dir "$DEMO_DIR" --json > "$DEMO_DIR/out2.json"
RC2=$?
if [ "$RC2" -ne 0 ] && [ "$RC2" -ne 1 ]; then
  echo "❌ verify 意外退出码: $RC2" >&2
  rm -rf "$DEMO_DIR"
  exit 1
fi
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("files="+j.files.length+", scanned="+j.scannedFiles)' "$DEMO_DIR/out2.json"

rm -rf "$DEMO_DIR"

