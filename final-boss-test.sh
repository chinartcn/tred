#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

rm -rf .test-whole .test-chopped
mkdir -p .test-whole

# 1. 把整个 src 复制到隔离环境
cp -r src .test-whole/
cp tsconfig.json .test-whole/
cp package.json .test-whole/

echo "══════════════════════════════════════════════"
echo "1. 对 tred 的核心枢纽 cli.ts 进行智能拆分"
echo "══════════════════════════════════════════════"
node dist/cli.js chop --file .test-whole/src/cli.ts --dir .test-whole/src/cli-chopped

echo
echo "══════════════════════════════════════════════"
echo "2. 查看拆分结果概览"
echo "══════════════════════════════════════════════"
ls -l .test-whole/src/cli-chopped/ | head -10

echo
echo "══════════════════════════════════════════════"
echo "3. 检查生成的 index.ts 是否保留了路由逻辑"
echo "══════════════════════════════════════════════"
head -n 20 .test-whole/src/cli-chopped/index.ts

echo
echo "══════════════════════════════════════════════"
echo "4. 终极运行测试：直接执行拆分后的 CLI"
echo "══════════════════════════════════════════════"
cd .test-whole
# 直接跑拆分后的 cli-chopped/index.ts 试试
npx tsx src/cli-chopped/index.ts --help > output.txt 2>&1 || true
echo "输出前 15 行："
head -n 15 output.txt
cd ..

rm -rf .test-whole .test-chopped
