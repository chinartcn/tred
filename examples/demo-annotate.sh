#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# 重置 demo
cat > examples/_annotate_demo.ts <<'EOF'
export class GraphEngine {
  loadUnlocked(): void {
    console.log('original');
  }
  save(): void {}
}

export function helper(): number {
  return 42;
}
EOF

echo "=== 1/2 annotate --all （dry-run，看 diff） ==="
node bin/tred.mjs annotate --file examples/_annotate_demo.ts --all

echo
echo "=== 2/2 annotate --all --apply （写盘后文件内容） ==="
node bin/tred.mjs annotate --file examples/_annotate_demo.ts --all --apply
echo
cat examples/_annotate_demo.ts

echo
echo "=== 复查：verify 应通过 ==="
node bin/tred.mjs verify --dir examples/_annotate_demo.ts 2>/dev/null || node bin/tred.mjs verify --dir examples --json | head -40 || true

# 重置
cat > examples/_annotate_demo.ts <<'EOF'
export class GraphEngine {
  loadUnlocked(): void {
    console.log('original');
  }
  save(): void {}
}

export function helper(): number {
  return 42;
}
EOF

