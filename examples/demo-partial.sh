#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TMP_DIR="${TMPDIR:-.tred-tmp}"
mkdir -p "$TMP_DIR"
DEMO_DIR="$TMP_DIR/partial-demo"
rm -rf "$DEMO_DIR"
mkdir -p "$DEMO_DIR"

for n in a b c; do
  cat > "$DEMO_DIR/$n.ts" <<'EOF'
export class A {
  // @TRED_START: A#x | fp=00000000
  x(): void {}
  // @TRED_END: A#x
}
EOF
done

cat > "$DEMO_DIR/ops.json" <<EOF
[
  {"file":"$DEMO_DIR/a.ts","anchor":"A#x","content":"x(): void { console.log(1); }","fingerprint":"aaaaaaaa"},
  {"file":"$DEMO_DIR/b.ts","anchor":"A#x","content":"x(): void { console.log(2)","fingerprint":"bbbbbbbb"},
  {"file":"$DEMO_DIR/c.ts","anchor":"A#x","content":"x(): void { console.log(3); }","fingerprint":"cccccccc"}
]
EOF

echo "=== 默认（任一失败全量回滚） ==="
node bin/tred.mjs replace-many --ops-file "$DEMO_DIR/ops.json" || true

echo
echo "--- 三文件内容（应都还是 fp=00000000） ---"
grep -H "fp=" "$DEMO_DIR"/a.ts "$DEMO_DIR"/b.ts "$DEMO_DIR"/c.ts

echo
echo "=== --continue-on-error（尽力而为） ==="
node bin/tred.mjs replace-many --ops-file "$DEMO_DIR/ops.json" --continue-on-error || true

echo
echo "--- 三文件内容（a/c 已改，b 保留） ---"
grep -H "fp=\|console.log" "$DEMO_DIR"/a.ts "$DEMO_DIR"/b.ts "$DEMO_DIR"/c.ts

rm -rf "$DEMO_DIR"

