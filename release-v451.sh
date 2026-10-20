#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1. 清理临时测试文件 ==="
rm -f fix-undo-anchor.sh test-v450-features.sh test-v440-features-fixed.sh fix-imports-final.sh
rm -rf .test-tred-v450

echo "=== 2. 重新构建（确保 dist 是最新的） ==="
npm run build

echo "=== 3. 发版 4.5.1 ==="
npm version 4.5.1 --no-git-tag-version
echo '4.5.1' > .tred-version
npm run build

git add -A
git commit -m "fix(cli): v4.5.1 修复局部回滚残留脏数据与锚点重复嵌套

- index.ts: AST 替换时自动剥离用户提供的冗余 @TRED 注释，防止嵌套污染
- cli.ts: undo --anchor 增加尾部脏数据清洗与空行折叠，保证回滚后格式完美
- 验证通过：局部回滚精准恢复指定锚点，无关代码 100% 保留"

git tag v4.5.1
npm publish --access public
git push origin main --tags
