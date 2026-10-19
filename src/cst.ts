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

  let script = `import * as tred from ${tredPath};\n\n`;

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
