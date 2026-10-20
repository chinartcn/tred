import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdtempSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getPlugins } from './plugin.js';

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
        if (currentOp) {
          const raw = currentContent.join('\n');
          const cLines = raw.split('\n');
          // 寻找第一行非空行的缩进作为基准
          let baseIndent = '';
          for (const l of cLines) {
            if (l.trim()) {
              const m = l.match(/^[ \t]*/);
              if (m) baseIndent = m[0];
              break;
            }
          }
          if (baseIndent) {
            currentOp.content = cLines.map(l => l.startsWith(baseIndent) ? l.slice(baseIndent.length) : l).join('\n');
          } else {
            currentOp.content = raw;
          }
        }
        currentContent = [];
        state = 'normal';
      } else if (trimmed === '\\/#end') {
        // 处理转义：/#end -> /#end
        currentContent.push(line.replace('\\/#end', '/#end'));
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

  let parsed = {
    nodeCode: nodeBlocks.join('\n\n'),
    ops
  };

  // 触发插件钩子
  for (const plugin of getPlugins()) {
    if (plugin.onCstParsed) {
      const modified = plugin.onCstParsed(parsed);
      if (modified) parsed = modified;
    }
  }

  return parsed;
}

// ==============================================================================
// 执行器（生成临时 mjs 并运行）
// ==============================================================================

function readConfigAllowNodejs(): boolean {
  try {
    const p = '.tred/config.json';
    if (existsSync(p)) {
      const cfg = JSON.parse(readFileSync(p, 'utf-8'));
      return cfg.allowNodejs === true;
    }
  } catch { /* ignore */ }
  return false;
}

export async function runCst(filePath: string, options?: { allowNodejs?: boolean }): Promise<void> {
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
  // 🚀 修复：将临时脚本生成在项目根目录的 .tred-tmp 下，确保能解析到项目的 node_modules
  const tmpBase = join(process.cwd(), '.tred-tmp');
  if (!existsSync(tmpBase)) mkdirSync(tmpBase, { recursive: true });
  const tmpDir = mkdtempSync(join(tmpBase, 'cst-'));
  const tmpFile = join(tmpDir, 'run.mjs');

  // 🚀 v4.4.0 安全快照机制
  const snapshotDir = join(process.cwd(), '.tred', 'snapshots');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const currentSnapshotDir = join(snapshotDir, runId);
  const fileBackups = new Map<string, string | null>(); // 路径 -> 原内容(null表示原本不存在)

  // 收集所有涉及的文件
  const filesToSnapshot = new Set<string>();
  for (const op of ops) {
    if (op.props.file) filesToSnapshot.add(resolve(process.cwd(), op.props.file));
    if (op.props.to) filesToSnapshot.add(resolve(process.cwd(), op.props.to));
  }

  mkdirSync(currentSnapshotDir, { recursive: true });
  for (const filePath of filesToSnapshot) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      fileBackups.set(filePath, content);
      const rel = relative(process.cwd(), filePath).replace(/\\/g, '/').replace(/\.\.\//g, '_');
      writeFileSync(join(currentSnapshotDir, rel), content, 'utf-8');
    } else {
      fileBackups.set(filePath, null);
    }
  }

  // 根据当前文件（dist/cst.js）的物理位置，直接推导同级的 dist/index.js
  let tredPath = '"@rtcn/tred"';
  try {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    tredPath = JSON.stringify(join(currentDir, 'index.js'));
  } catch {
    // 极少数运行环境不支持 import.meta.url 时的兜底
  }

  // 🚀 修复：在生成的 ESM 脚本中注入 require 垫片，允许使用 CommonJS 语法
  let script = `import * as tred from ${tredPath};\n`;
  script += `import { createRequire } from 'node:module';\n`;
  script += `const require = createRequire(import.meta.url);\n\n`;

  if (nodeCode) {
    const isAllowed = options?.allowNodejs || readConfigAllowNodejs();
    if (!isAllowed) {
      console.error('❌ [安全拦截] 检测到 /#nodejs 块。为防止 RCE，默认禁止执行。请加 --allow-nodejs 或在 .tred/config.json 中设置 { "allowNodejs": true }。');
      process.exit(1);
    }
    script += `// --- User Node.js Code ---\n${nodeCode}\n// -------------------------\n\n`;
  }

  script += `async function __main__() {\n`;
  for (const op of ops) {
    if (op.type === 'replace') {
      let selStr = 'undefined';
      if (op.props.selector) {
        try { JSON.parse(op.props.selector); selStr = op.props.selector; } catch { throw new Error('replace 的 selector 不是合法 JSON'); }
      }
      script += `  {
    const r = await tred.replace({
      file: ${JSON.stringify(op.props.file)},
      anchor: ${JSON.stringify(op.props.anchor || '')},
      fingerprint: ${JSON.stringify(op.props.fingerprint || '')},
      content: ${JSON.stringify(op.content || '')},
      autoInjectAnchor: ${!!op.props.anchor},
      dryRun: ${op.props.dryRun === 'true'},
      selector: ${selStr}
    });
    if (r.status === 'failed') { console.error('❌ replace 失败:', r.message); process.exit(1); }
  }\n`;
    } else if (op.type === 'split') {
      const names = (op.props.name || '').split(',').map(s => JSON.stringify(s.trim())).join(', ');
      script += `  {
    const res = tred.splitFile(${JSON.stringify(op.props.file)}, [${names}], ${JSON.stringify(op.props.to)}, ${JSON.stringify(op.props.className || '')});
    if (!res.ok) { console.error('❌ split 失败:', res.message); process.exit(1); }
  }\n`;
    } else if (op.type === 'impact') {
      script += `  console.log(tred.analyzeImpact(${JSON.stringify(op.props.dir || '.')}, ${JSON.stringify(op.props.target)}));\n`;
    } else if (op.type === 'patch') {
      script += `  {
    const patchRes = tred.applyPatch(${JSON.stringify(op.props.file)}, ${JSON.stringify(op.content || '')}, { fuzzy: true });
    if (!patchRes.ok) { console.error('❌ patch 失败:', patchRes.message); process.exit(1); }
  }\n`;
    }
  }
  script += `}\n\n__main__().catch(e => { console.error('❌ 执行失败:', e.message); process.exit(1); });\n`;

  writeFileSync(tmpFile, script, 'utf-8');

  try {
    const { spawnSync } = await import('node:child_process');
    const res = spawnSync(process.execPath, [tmpFile], { stdio: 'inherit', cwd: process.cwd() });
    if (res.status !== 0) {
      console.error('\n⚠️ [tred] 脚本执行失败，正在触发事务回滚...');
      for (const [filePath, origContent] of fileBackups.entries()) {
        if (origContent === null) {
          if (existsSync(filePath)) rmSync(filePath, { force: true });
          console.error('  🧹 删除新建文件: ' + relative(process.cwd(), filePath));
        } else {
          writeFileSync(filePath, origContent, 'utf-8');
          console.error('  ♻️  恢复文件: ' + relative(process.cwd(), filePath));
        }
      }
      console.error('✅ 回滚完成，代码库已恢复至执行前状态。');
      process.exit(res.status || 1);
    }
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      if (existsSync(tmpBase) && readdirSync(tmpBase).length === 0) {
        rmSync(tmpBase, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }
  console.log('\n💾 [tred] 成功执行！本次操作快照已保存至 .tred/snapshots/' + runId);
}
