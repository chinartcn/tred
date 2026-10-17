#!/usr/bin/env bash
# 不用 set -e：verify 有 error 时退出 1 属正常
set -uo pipefail
cd "$(dirname "$0")/.."

DEMO_DIR=".tred-tmp/baseline-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR/src"

cat > "$DEMO_DIR/src/a.ts" <<'EOF'
// @TRED_START: X
body
EOF

echo "=== 1/4 verify（无基线，有 error） ==="
node bin/tred.mjs verify --dir "$DEMO_DIR" --json > "$DEMO_DIR/v1.json" || true
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("ok="+j.ok+", issues="+j.issues.length)' "$DEMO_DIR/v1.json"

echo
echo "=== 2/4 保存基线 ==="
node bin/tred.mjs verify --dir "$DEMO_DIR" --save-baseline "$DEMO_DIR/.tred-baseline.json" --json > /dev/null || true
echo "  基线已生成: " && cat "$DEMO_DIR/.tred-baseline.json" | head -20

echo
echo "=== 3/4 有基线时 verify（应 ok=true，issues 被过滤） ==="
node bin/tred.mjs verify --dir "$DEMO_DIR" --baseline "$DEMO_DIR/.tred-baseline.json" --json > "$DEMO_DIR/v2.json" || true
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("ok="+j.ok+", issues="+j.issues.length)' "$DEMO_DIR/v2.json"

echo
echo "=== 4/4 新增一个问题后，基线比较只报新增 ==="
cat > "$DEMO_DIR/src/b.ts" <<'EOF'
// @TRED_END: never-started
EOF
node bin/tred.mjs verify --dir "$DEMO_DIR" --baseline "$DEMO_DIR/.tred-baseline.json" --json > "$DEMO_DIR/v3.json" || true
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8"));console.log("ok="+j.ok+", issues="+j.issues.length+", 新问题文件="+(j.issues[0]||{}).file)' "$DEMO_DIR/v3.json"

rm -rf "$DEMO_DIR"

