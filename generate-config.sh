#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1. 生成 .tred/config.json ==="
mkdir -p .tred
cat > .tred/config.json <<'EOF'
{
  "allowNodejs": false,
  "fuzzyThreshold": 0.9,
  "fuzzyMinMargin": 0.05,
  "minRareTokens": 2,
  "exclude": [
    "**/*.test.ts",
    "**/*.spec.ts",
    "dist/**",
    "node_modules/**"
  ],
  "snapshot": {
    "enabled": true,
    "maxKeep": 20
  },
  "chop": {
    "maxDepth": 8,
    "autoExport": true
  },
  "patch": {
    "autoHeal": false,
    "htmlOnFail": false
  }
}
EOF

echo "=== 2. 更新 SPEC.md，加入配置说明 ==="
cat > .update-spec.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'SPEC.md';
let text = readFileSync(F, 'utf8');

const CONFIG_DOC = `## 六、 全局配置文件 (.tred/config.json)

\`tred\` 会自动读取项目根目录下的 \`.tred/config.json\`，你可以通过它全局控制引擎的行为：

\`\`\`json
{
  "allowNodejs": false,
  "fuzzyThreshold": 0.9,
  "fuzzyMinMargin": 0.05,
  "minRareTokens": 2,
  "exclude": ["**/*.test.ts", "dist/**"],
  "snapshot": {
    "enabled": true,
    "maxKeep": 20
  },
  "chop": {
    "maxDepth": 8,
    "autoExport": true
  },
  "patch": {
    "autoHeal": false,
    "htmlOnFail": false
  }
}
\`\`\`

### 配置项详解：

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| \`allowNodejs\` | boolean | \`false\` | 是否允许 \`.cst\` 脚本执行 \`/#nodejs\` 代码块（防 RCE 注入）。 |
| \`fuzzyThreshold\` | number | \`0.9\` | 补丁模糊匹配的最低阈值。 |
| \`fuzzyMinMargin\` | number | \`0.05\` | 多候选仲裁的分差阈值，低于此值拒绝应用防误伤。 |
| \`minRareTokens\` | number | \`2\` | 模糊匹配要求的最少稀有标识符数量。 |
| \`exclude\` | string[] | \`[]\` | 全局忽略扫描的文件（支持 glob 语法）。 |
| \`snapshot.enabled\` | boolean | \`true\` | 是否开启 \`v4.4.0\` 的事务快照。 |
| \`snapshot.maxKeep\` | number | \`20\` | 最多保留多少个历史快照（超出后自动清理最旧的）。 |
| \`chop.maxDepth\` | number | \`8\` | CodeChopper 图聚类时的最大递归深度。 |
| \`patch.autoHeal\` | boolean | \`false\` | 是否默认在补丁失败时启用 \`--auto-heal\`。 |
| \`patch.htmlOnFail\`| boolean | \`false\` | 是否默认在补丁失败时生成可视化 HTML 冲突报告。 |

### 优先级
命令行参数 > 配置文件 > 内置默认值。
`;

if (!text.includes('## 六、 全局配置文件')) {
  text += '\n\n' + CONFIG_DOC;
  writeFileSync(F, text);
  console.log('  ✓ SPEC.md 已追加配置说明');
}
MJS_EOF
node .update-spec.mjs && rm .update-spec.mjs

echo "=== 3. 提交并发布 4.4.1 ==="
npm version 4.4.1 --no-git-tag-version
echo '4.4.1' > .tred-version
npm run build

git add -A
git commit -m "docs(config): v4.4.1 提供完整的全量默认配置文件与 SPEC 说明

- 新增 .tred/config.json 默认模板
- 涵盖安全沙箱、模糊匹配阈值、快照保留策略等核心配置
- SPEC.md 补充所有配置项的详细文档"

git tag v4.4.1
npm publish --access public
git push origin main --tags
