#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1. 新增 src/graph.ts (Mermaid 架构图生成器) ==="
cat > src/graph.ts <<'TS_EOF'
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import ts from 'typescript';

export function generateMermaidGraph(dir: string): string {
  const ignore = new Set(['node_modules', '.git', 'dist', '.tred', '.tred-tmp']);
  const edges: string[] = [];
  const files: string[] = [];

  function walk(d: string) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) walk(join(d, e.name));
      } else if (e.isFile() && /\.(ts|tsx|js|jsx)$/.test(e.name)) {
        const full = join(d, e.name);
        const rel = relative(dir, full).replace(/\\/g, '/');
        files.push(rel);
        
        const source = readFileSync(full, 'utf-8');
        const sf = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true);
        
        sf.forEachChild(node => {
          if (ts.isImportDeclaration(node)) {
            const spec = node.moduleSpecifier.getText(sf).replace(/['"]/g, '');
            if (spec.startsWith('.')) {
              // 粗略解析相对路径依赖
              const target = relative(dir, join(dirname(full), spec)).replace(/\\/g, '/');
              const targetWithExt = files.find(f => f.startsWith(target)) || target + '.ts';
              edges.push(`  "${rel}" --> "${targetWithExt}"`);
            }
          }
        });
      }
    }
  }
  walk(dir);

  const nodes = files.map(f => `  "${f}"["${f.split('/').pop()}"]`).join('\n');
  return `\`\`\`mermaid\ngraph TD\n${nodes}\n${edges.join('\n')}\n\`\`\``;
}
TS_EOF

echo "=== 2. 升级 cli.ts (增加 graph 命令 和 undo --preview) ==="
cat > .up-cli.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cli.ts';
let text = readFileSync(F, 'utf8');

// 引入 generateMermaidGraph 和 unifiedDiff
if (!text.includes("import { generateMermaidGraph }")) {
  text = text.replace(
    "import { runCst } from './cst.js';",
    "import { runCst } from './cst.js';\nimport { generateMermaidGraph } from './graph.js';\nimport { unifiedDiff } from './diff.js';"
  );
}

// 注入 cmdGraph
const GRAPH_FUNC = `
async function cmdGraph(flags: Record<string, string | true>): Promise<number> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const graph = generateMermaidGraph(dir);
  if (flags.json) {
    console.log(JSON.stringify({ mermaid: graph }));
  } else {
    console.log(graph);
  }
  return 0;
}
`;

if (!text.includes('cmdGraph')) {
  text = text.replace('async function cmdCreate(', GRAPH_FUNC + '\nasync function cmdCreate(');
  text = text.replace(
    "  if (cmd === 'create')       { process.exit(await cmdCreate(flags)); }",
    "  if (cmd === 'graph')        { process.exit(await cmdGraph(flags)); }\n  if (cmd === 'create')       { process.exit(await cmdCreate(flags)); }"
  );
}

// 升级 cmdUndo 支持 --preview 和 --list
const OLD_UNDO = `  const latest = snapshots[snapshots.length - 1];
  const latestPath = join(snapshotDir, latest);`;

const NEW_UNDO = `  if (flags.list) {
    console.log('[tred] 所有历史快照:');
    snapshots.forEach(s => console.log('  - ' + s));
    return 0;
  }

  const targetSnapshot = typeof flags.snapshot === 'string' ? flags.snapshot : snapshots[snapshots.length - 1];
  const latestPath = join(snapshotDir, targetSnapshot);
  if (!existsSync(latestPath)) die('快照不存在: ' + targetSnapshot);

  const isPreview = Boolean(flags.preview);
  if (isPreview) {
    console.log('[tred] 预览回滚 (Dry-run): ' + targetSnapshot);
    // 简单实现：直接对比目标文件和快照文件
    if (typeof flags.file === 'string') {
      const snapFile = join(latestPath, flags.file);
      if (existsSync(snapFile)) {
        const a = readFileSync(flags.file, 'utf-8');
        const b = readFileSync(snapFile, 'utf-8');
        console.log(unifiedDiff(a, b, 'current/' + flags.file, 'snapshot/' + flags.file));
      }
    }
    return 0;
  }
  
  const latest = targetSnapshot; // 保持下面逻辑兼容`;

if (text.includes(OLD_UNDO) && !text.includes('flags.list')) {
  text = text.replace(OLD_UNDO, NEW_UNDO);
}

writeFileSync(F, text);
console.log('  ✓ cli.ts 已接入 graph 与 undo --preview');
MJS_EOF
node .up-cli.mjs && rm .up-cli.mjs

echo "=== 3. 追加 CI 测试 ==="
cat > test/graph.test.ts <<'TS_EOF'
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMermaidGraph } from '../src/graph.js';

describe('generateMermaidGraph', function () {
  it('生成合法的 Mermaid 语法', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-graph-'));
    writeFileSync(join(dir, 'a.ts'), "import { b } from './b';");
    writeFileSync(join(dir, 'b.ts'), "export const b = 1;");
    try {
      const graph = generateMermaidGraph(dir);
      assert.match(graph, /```mermaid/);
      assert.match(graph, /graph TD/);
      assert.match(graph, /"a.ts" --> "b.ts"/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
TS_EOF

node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  if (!pkg.scripts["test:fast"].includes("test/graph.test.ts")) {
    pkg.scripts["test:fast"] += " test/graph.test.ts";
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  }
'

echo "=== 4. 提交并让 CI 跑 ==="
git add -A
git commit -m "feat(cli): v4.6.0 新增依赖图谱生成与快照预览

- 新增 \`tred graph\`，扫描 import 关系输出 Mermaid 依赖架构图
- 升级 \`tred undo\`，支持 \`--list\` 和 \`--preview\` 及 \`--snapshot\` 指定版本
- 补充 graph.test.ts 纳入 CI 覆盖"

git push origin main
