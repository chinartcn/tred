#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."

OUT=".tred-tmp/report.html"
mkdir -p .tred-tmp

echo "=== 生成 HTML 报告到 " + "$OUT" + " ==="
node bin/tred.mjs verify --dir examples/_verify_demo --format html > "$OUT" || true
echo "  文件大小: $(wc -c < "$OUT") 字节"

echo
echo "--- 前 15 行预览 ---"
head -15 "$OUT"

echo
echo "--- 检查关键标记 ---"
grep -c "<details>" "$OUT" | head -1 | xargs echo "  details 折叠数: "
grep -o "tred v[0-9.]*" "$OUT" | head -1 | xargs echo "  版本: "

echo
echo "用浏览器打开："
echo "  file://$(pwd)/$OUT"

