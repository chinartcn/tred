#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cp CHANGELOG.md "CHANGELOG.md.bak.$(date +%Y%m%d-%H%M%S)"

cat > .add-cl.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'CHANGELOG.md';
let text = readFileSync(F, 'utf8');

if (text.includes('## [3.6.7]')) {
  console.log('· 3.6.7 已存在，跳过');
  process.exit(0);
}

const ENTRY = `## [3.6.7] - 2026-10-19

### Added
- **\`tred split\` 全薄壳与自动依赖分析 (P0)**：
  - 废弃原 \`Object.assign\` mixin 方案，全面改为 \`xxxImpl.call(this)\` 薄壳，TS 类型层完全可见。
  - 自动分析并复制被拆方法依赖的 \`import\` / \`import type\`。
  - 自动识别目标类（免 \`--class\`），多类冲突自动提示。
  - \`--to\` 支持完整相对路径与绝对路径解析。
- **\`tred patch\` 多候选仲裁与解释 (P0-2 / P1-3)**：
  - 当 top1 / top2 相似度差距 < 5% 时拒绝应用（防静默误伤）。
  - 新增 \`--explain\` 输出结构化分数分解（charSim / tokenSim / keyLines）。
  - 新增 \`--force\` 强制忽略并列警告和阈值。
  - 新增 \`--fuzzy-min-margin\` 调整仲裁阈值。

### Fixed
- \`split\`：修复 \`bodyStr\` 生成时因 \`\\n\` 丢失导致 \`{ try {\` 挤在同一行的 bug。
- \`split\`：修复 \`collectFreeIdentifiers\` 作用域感知太浅，解决局部变量（\`container\`/\`i\`/\`e\`）误报未定义标识符的噪音。
- \`split\`：修复 \`dedent\` 对 Tab/Space 混合缩进切除错误的问题。
- \`patch\`：修复解析 diff 时末尾多余换行导致假空行、拉低匹配分数的问题。
- \`index\`：修复重复锚点报错文本不匹配测试断言的问题。
- \`ci\`：修复 Ubuntu 环境下 \`TMPDIR\` 幽灵目录问题，统一改用 \`pnpm\` 与 \`pnpm/action-setup\`。
- \`docs\`：同步更新 \`README.md\` / \`skill.md\` / \`api.md\` 全薄壳与 \`--explain\` 说明。

`;

// 找 3.6.6 插入到它上面
const marker = '## [3.6.6]';
if (text.includes(marker)) {
  text = text.replace(marker, ENTRY + marker);
} else {
  // 兜底插在头部
  const h1Match = text.match(/^# Changelog\n+/);
  if (h1Match) {
    text = text.replace(h1Match[0], h1Match[0] + ENTRY);
  } else {
    text = ENTRY + text;
  }
}

writeFileSync(F, text);
console.log('✓ 已插入 3.6.7 条目');
MJS_EOF

node .add-cl.mjs
rm -f .add-cl.mjs
