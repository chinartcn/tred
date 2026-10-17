#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TMP_DIR="${TMPDIR:-.tred-tmp}"
mkdir -p "$TMP_DIR"

# 重置 demo 目录（幂等）
reset_demo() {
  cat > examples/_fix_demo/src/healthy.ts <<'EOF'
export class GraphEngine {
  // @TRED_START: GraphEngine#loadUnlocked | fp=a1b2c3d4
  loadUnlocked(): void {}
  // @TRED_END: GraphEngine#loadUnlocked
}
EOF

  cat > examples/_fix_demo/src/orphan-end.ts <<'EOF'
export class Foo {
  // @TRED_START: Foo#a | fp=11111111
  a(): void {}
  // @TRED_END: Foo#a
  // @TRED_END: Foo#never-existed
  b(): void {}
}
EOF

  cat > examples/_fix_demo/src/orphan-start-fixable.ts <<'EOF'
export class Baz {
  // @TRED_START: Baz#z | fp=44444444
  z(): void {}
  w(): void {}
}
EOF

  cat > examples/_fix_demo/src/mixed.ts <<'EOF'
export class Bar {
  // @TRED_START: Bar#x | fp=22222222
  x(): void {}
  // @TRED_START: Bar#y | fp=33333333
  y(): void {}
  // @TRED_END: Bar#zzz
}
EOF
}

reset_demo

echo "=== 1/3 verify（前后对照） ==="
node bin/tred.mjs verify --dir examples/_fix_demo || true

echo
echo "=== 2/3 verify --fix（dry-run，看 diff） ==="
node bin/tred.mjs verify --fix --dir examples/_fix_demo || true

echo
echo "=== 3/3 verify --fix --apply（写盘后复查） ==="
node bin/tred.mjs verify --fix --apply --dir examples/_fix_demo || true
echo
echo "--- 修复后 verify 剩余问题 ---"
node bin/tred.mjs verify --dir examples/_fix_demo || true

reset_demo

# 追加：孤儿 START 自动修复
echo
echo "=== 4/4 verify --fix --fix-orphan-start --apply ==="
node bin/tred.mjs verify --fix --fix-orphan-start --apply --dir examples/_fix_demo || true
echo
echo "--- 修复后 verify ---"
node bin/tred.mjs verify --dir examples/_fix_demo || true

reset_demo