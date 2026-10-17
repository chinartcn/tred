#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

echo "=== 1/2 verify --format github-annotations（有 error，应输出 ::error） ==="
node bin/tred.mjs verify --dir examples/_verify_demo --format github-annotations
echo "退出码: $?"

echo
echo "=== 2/2 verify --format github-annotations（健康，应输出 ::notice） ==="
node bin/tred.mjs verify --dir examples/_diff_dir_demo/v1 --format github-annotations
echo "退出码: $?"

