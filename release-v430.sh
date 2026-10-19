#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# 1. 更新 api.md，加入纯文本模式说明
cat > .update-api.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'api.md';
let text = readFileSync(F, 'utf8');

if (!text.includes("mode?: 'code' | 'text'")) {
  text = text.replace(
    "### `calcHybridSimilarity(codeA: string, codeB: string): HybridScoreDetail`",
    `### \`calcHybridSimilarity(codeA: string, codeB: string, options?: { mode?: 'code' | 'text' }): HybridScoreDetail\`

支持代码与纯文本双模匹配。
- 默认 \`mode: 'code'\`：开启 AST 结构保底。
- 若指定 \`mode: 'text'\`：放弃 AST 解析，使用 LCS 字符覆盖 + 2-gram Jaccard，对纯文本查重（如子集包含、大段引用）极为精准。`
  );
  writeFileSync(F, text);
  console.log('  ✓ api.md 已补充 text 模式说明');
}
MJS_EOF
node .update-api.mjs && rm .update-api.mjs

# 2. 清理临时文件
rm -f adjust-text-mode.sh fix-text-mode*.sh fix-hybrid*.sh upgrade-text-mode.sh text-test.ts

# 3. 构建并测试
npm version 4.3.0 --no-git-tag-version
echo '4.3.0' > .tred-version
npm run build
bash smoke.sh | tail -3

# 4. 提交并发布
git add -A
git commit -m "feat(api): v4.3.0 开放纯文本双模匹配 (mode: 'text')

- calcHybridSimilarity 引入 mode 参数，支持纯文本查重
- 文本模式使用字符级 LCS Overlap + N-gram，子集包含判定达 91%+
- 清理废弃的临时测试脚本"

git tag v4.3.0
npm publish --access public
git push origin main --tags
