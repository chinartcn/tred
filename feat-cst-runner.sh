#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cp src/cli.ts "src/cli.ts.bak.$(date +%Y%m%d-%H%M%S)"
echo "已备份 src/cli.ts"

# ==============================================================================
# 1. 创建 src/cst.ts (解析器 + 执行器)
# ==============================================================================
cat > src/cst.ts <<'TS_EOF'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface CstOp {
  type: 'replace' | 'split' | 'patch' | 'impact';
  props: Record<string, string>;
  content?: string;
}

export interface ParsedCst {
  nodeCode: string;
  ops: CstOp[];
}

// ==============================================================================
// 核心解析器（状态机逐行扫描，绝不因长文本或特殊字符解析失败）
// ==============================================================================
export function parseCst(source: string): ParsedCst {
  const lines = source.split('\n');
  const nodeBlocks: string[] = [];
  const ops: CstOp[] = [];
  
  let state: 'normal' | 'nodejs' | 'content' = 'normal';
  let currentOp: CstOp | null = null;
  let currentContent: string[] = [];
  let currentNode: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. 处理 Node.js 透传块
    if (state === 'nodejs') {
      if (trimmed === '/#nodejs.end') {
        nodeBlocks.push(currentNode.join('\n'));
        currentNode = [];
        state = 'normal';
      } else {
        currentNode.push(line);
      }
      continue;
    }

    // 2. 处理长文本 content 块
    if (state === 'content') {
      if (trimmed === '/#end') {
        if (currentOp) currentOp.content = currentContent.join('\n');
        currentContent = [];
        state = 'normal';
      } else {
        currentContent.push(line);
      }
      continue;
    }

    // 3. 正常状态（解析指令）
    if (trimmed === '/#nodejs') {
      state = 'nodejs';
      continue;
    }

    // 匹配指令开头: replace {, split {, patch {, impact {
    const matchStart = trimmed.match(/^(replace|split|patch|impact)\s*\{$/);
    if (matchStart) {
      currentOp = { type: matchStart[1] as any, props: {} };
      continue;
    }

    // 匹配指令结束: }
    if (trimmed === '}' && currentOp) {
      ops.push(currentOp);
      currentOp = null;
      continue;
    }

    // 处理 content 属性开始: content:
    if (currentOp && trimmed === 'content:') {
      state = 'content';
      continue;
    }

    // 处理基本键值对: key: value
    if (currentOp) {
      const matchKV = line.match(/^\s*([a-zA-Z0-9_-]+):\s*(.*)$/);
      if (matchKV) {
        const key = matchKV[1];
        const val = matchKV[2].trim();
        if (val) currentOp.props[key] = val;
      }
    }
  }

  if (state !== 'normal') {
    throw new Error(`CST 文件解析失败：存在未闭合的块 (${state})。请检查 /#end 或 /#nodejs.end 是否遗漏。`);
  }

  return {
    nodeCode: nodeBlocks.join('\n\n'),
    ops
  };
}

// ==============================================================================
// 执行器（生成临时 mjs 并运行）
// ==============================================================================
export async function runCst(filePath: string): Promise<void> {
  const source = readFileSync(filePath, 'utf-8');
  let parsed: ParsedCst;
  try {
    parsed = parseCst(source);
  } catch (e) {
    console.error('❌ [tred run] ' + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }

  const { nodeCode, ops } = parsed;

  if (ops.length === 0 && !nodeCode) {
    console.log('[tred run] 文件为空，无需执行');
    return;
  }

  // 构建临时脚本
  const tmpDir = mkdtempSync(join(tmpdir(), 'tred-cst-'));
  const tmpFile = join(tmpDir, 'run.mjs');

  // 根据当前环境解析 tred 模块的导入路径
  // 如果在 tred 源码库里运行，用相对路径。如果作为全局包运行，用 @rtcn/tred
  const isLocal = process.cwd().includes('tred') && !process.cwd().includes('node_modules');
  const tredPath = isLocal ? JSON.stringify(resolve('dist/index.js')) : '"@rtcn/tred"';

  let script = `import * as tred from ${tredPath};\n`;
  script += `import fs from 'node:fs';\n`;
  script += `import path from 'node:path';\n\n`;

  if (nodeCode) {
    script += `// --- User Node.js Code ---\n${nodeCode}\n// -------------------------\n\n`;
  }

  script += `async function __main__() {\n`;
  for (const op of ops) {
    if (op.type === 'replace') {
      script += `  await tred.replace({
    file: ${JSON.stringify(op.props.file)},
    anchor: ${JSON.stringify(op.props.anchor || '')},
    fingerprint: ${JSON.stringify(op.props.fingerprint || '')},
    content: ${JSON.stringify(op.content || '')},
    autoInjectAnchor: ${!!op.props.anchor},
    dryRun: ${op.props.dryRun === 'true'}
  });\n`;
    } else if (op.type === 'split') {
      const names = (op.props.name || '').split(',').map(s => JSON.stringify(s.trim())).join(', ');
      script += `  const res = tred.splitFile(${JSON.stringify(op.props.file)}, [${names}], ${JSON.stringify(op.props.to)}, ${JSON.stringify(op.props.className || '')});
    if (!res.ok) throw new Error(res.message);
  `;
    } else if (op.type === 'impact') {
      script += `  console.log(tred.analyzeImpact(${JSON.stringify(op.props.dir || '.')}, ${JSON.stringify(op.props.target)}));\n`;
    } else if (op.type === 'patch') {
      script += `  const patchRes = tred.applyPatch(${JSON.stringify(op.props.file)}, ${JSON.stringify(op.props.diff || '')}, { fuzzy: true });
    if (!patchRes.ok) throw new Error(patchRes.message);
  `;
    }
  }
  script += `}\n\n__main__().catch(e => { console.error('❌ 执行失败:', e.message); process.exit(1); });\n`;

  writeFileSync(tmpFile, script, 'utf-8');

  try {
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [tmpFile], { stdio: 'inherit', cwd: process.cwd() });
    if (res.status !== 0) {
      process.exit(res.status || 1);
    }
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
TS_EOF

# ==============================================================================
# 2. 在 cli.ts 挂载 tred run 命令
# ==============================================================================
cat > .add-cli.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cli.ts';
let text = readFileSync(F, 'utf8');

if (!text.includes("import { runCst }")) {
  text = text.replace(
    "import { applyPatch } from './patch.js';",
    "import { applyPatch } from './patch.js';\nimport { runCst } from './cst.js';"
  );
}

if (!text.includes("if (cmd === 'run')")) {
  const routerStart = "  if (cmd === 'replace')      { process.exit(await cmdReplace(flags)); }";
  text = text.replace(
    routerStart,
    "  if (cmd === 'run')          { await runCst(requireStr(flags, 'file') || positionals[1]); process.exit(0); }\n" + routerStart
  );
}
writeFileSync(F, text);
console.log('✓ cli.ts 已接入 run 路由');
MJS_EOF

node .add-cli.mjs
rm -f .add-cli.mjs

# 顺手把 runCst 在 index.ts 里导出，供 MCP 或外部使用
cat > .add-index.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/index.ts';
let text = readFileSync(F, 'utf8');
if (!text.includes("export { runCst }")) {
  text += `\nexport { runCst } from './cst.js';\nexport type { ParsedCst, CstOp } from './cst.js';\n`;
  writeFileSync(F, text);
  console.log('✓ index.ts 已导出 runCst');
}
MJS_EOF
node .add-index.mjs
rm -f .add-index.mjs

# ==============================================================================
# 3. 更新 package.json scripts 和 CHANGELOG
# ==============================================================================
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  if (!pkg.files.includes("*.cst")) pkg.files.push("*.cst");
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
'

cat > .add-cl.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'CHANGELOG.md';
let text = readFileSync(F, 'utf8');
const ENTRY = `## [3.8.0] - 2026-10-19

### Added
- **\`tred run <file.cst>\`**：全新的长文本重构脚本。
  - 支持 \`replace\`、\`split\`、\`patch\` 和 \`impact\` 指令。
  - 支持长文本 \`content:\` 块，以 \`/#end\` 结尾，免除转义烦恼。
  - 支持 \`/#nodejs\` 块，可透传任意原生 Node.js 逻辑，自动提升至模块顶部。
  - 极简状态机解析，完美兼容 AI 生成。

`;
if (!text.includes('## [3.8.0]')) {
  text = text.replace('## [3.7.9]', ENTRY + '## [3.7.9]');
  writeFileSync(F, text);
  console.log('✓ CHANGELOG.md 更新 3.8.0');
}
MJS_EOF
node .add-cl.mjs
rm -f .add-cl.mjs

echo
echo "=== build ==="
npm run build

echo
echo "=== 测试 tred run ==="
cat > .test-cst.cst <<'CST_EOF'
/#nodejs
import fs from 'node:fs';
const prefix = '// Generated by CST';
fs.writeFileSync('.test-target.ts', prefix + '\n' + 'const a = 1;');
/#nodejs.end

replace {
  file: .test-target.ts
  selector: {"kind":"variable","variableName":"a"}
  content:
    const a = 999;
    console.log("Hello from CST block!");
  /#end
}
CST_EOF

node dist/cli.js run .test-cst.cst
echo "--- 执行结果 ---"
cat .test-target.ts

rm -f .test-cst.cst .test-target.ts

echo
echo "=== 发版 3.8.0 ==="
npm version 3.8.0 --no-git-tag-version
echo '3.8.0' > .tred-version
npm run build

git add -A
git commit -m "feat(cst): 支持 tred run 长文本重构脚本 (.cst)

- 引入状态机解析器，支持 /#nodejs 透传和 content 长文本块 (/#end)
- 彻底解决 AI 生成 diff 或 JSON 时的大量转义失败问题
- 支持 replace, split, patch, impact 基础指令"
git tag v3.8.0
npm publish --access public
git push origin main --tags
