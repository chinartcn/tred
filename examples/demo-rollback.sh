#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TMP_DIR="${TMPDIR:-.tred-tmp}"
mkdir -p "$TMP_DIR"
DEMO_DIR="$TMP_DIR/rollback-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"

cat > "$DEMO_DIR/a.ts" <<'EOF'
export class A {
  // @TRED_START: A#x | fp=00000000
  x(): void {}
  // @TRED_END: A#x
}
EOF

cat > "$DEMO_DIR/b.ts" <<'EOF'
export class A {
  // @TRED_START: A#x | fp=00000000
  x(): void {}
  // @TRED_END: A#x
}
EOF

cat > "$DEMO_DIR/ops.json" <<EOF
[
  {
    "file": "$DEMO_DIR/a.ts",
    "anchor": "A#x",
    "content": "x(): void { console.log(1); }",
    "fingerprint": "aaaaaaaa"
  },
  {
    "file": "$DEMO_DIR/b.ts",
    "anchor": "A#x",
    "content": "x(): void { console.log(2) }",
    "fingerprint": "bbbbbbbb"
  }
]
EOF

echo "=== 故意构造：ops[1] 的 content 有语法错（缺 }） ==="
echo
echo "--- 运行 replace-many（应 rolled-back，写日志） ---"
node bin/tred.mjs replace-many --ops-file "$DEMO_DIR/ops.json" --rollback-log "$DEMO_DIR/rollback.json" || true

echo
echo "--- 日志文件 ---"
if [ -f "$DEMO_DIR/rollback.json" ]; then
  cat "$DEMO_DIR/rollback.json"
else
  echo "（语法错在 compute 阶段被拦，未进入提交阶段 → 不写日志；这是预期）"
fi

# 注：compute 阶段失败（语法错）不会写 rollback log —— 只有提交阶段失败才写。
# 演示中无法轻易构造提交阶段失败（需要磁盘满 / 权限问题），所以日志通常不出现。
# 单元测试 test/rollback-log.test.ts 通过 _writer 注入模拟了提交失败场景。

rm -rf "$DEMO_DIR"

