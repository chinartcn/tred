#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ==========================================
# 1. 重写 src/grep.ts (接入 v4.0 混合引擎)
# ==========================================
cat > src/grep.ts <<'TS_EOF'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { buildOutline } from './ast-outline.js';
import { tokenize, calcBM25 } from './bm25.js';
import { getAstShape, lcsRatio } from './ast-shape.js';
import { minHashJaccard } from './minhash.js';

interface SearchResult {
  file: string;
  line: number;
  context: string;
  text: string;
  score: number;
}

export function grepDir(dir: string, pattern: string, useAst: boolean, useHtml: boolean, fuzzy: boolean = false): void {
  if (fuzzy) {
    console.log(`🔍 [tred grep] 正在使用 v4.0 混合算法进行语义搜索: "${pattern}"\n`);
    const results = performFuzzySearch(dir, pattern);
    
    if (results.length === 0) {
      console.log("未找到高度相关的代码块。");
      return;
    }

    for (const r of results) {
      console.log(`${r.file}:${r.line} [Score: ${(r.score * 100).toFixed(1)}%] ${r.context}`);
      console.log(r.text.split('\n').map(l => '  ' + l).join('\n'));
      console.log('---');
    }
    return;
  }

  // --- 传统正则 Grep ---
  const re = new RegExp(pattern, 'gi');
  const ignore = new Set(['node_modules', '.git', 'dist', '.tred-tmp', '.tred-cache', 'chunks']);
  const htmlResults: { file: string, context: string, line: number, text: string }[] = [];

  function walk(d: string) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) walk(join(d, e.name));
      } else if (e.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) {
        const full = join(d, e.name);
        const source = readFileSync(full, 'utf-8');
        const lines = source.split('\n');
        let outline: any[] = [];
        if (useAst) { try { outline = buildOutline(full, source); } catch {} }

        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            let contextStr = '';
            if (useAst && outline.length > 0) {
              let bestNode: any = null;
              function findNode(nodes: any[]) {
                for (const n of nodes) {
                  if (n.line <= i + 1) {
                    if (!bestNode || n.line > bestNode.line) bestNode = n;
                    if (n.children) findNode(n.children);
                  }
                }
              }
              findNode(outline);
              if (bestNode) contextStr = `[in ${bestNode.kind}: ${bestNode.name}]`;
            }
            const relPath = relative(process.cwd(), full);
            re.lastIndex = 0;
            if (useHtml) htmlResults.push({ file: relPath, context: contextStr, line: i + 1, text: lines[i].trim() });
            else console.log(`${relPath}:${i + 1}:${contextStr} ${lines[i].trim()}`);
          }
        }
      }
    }
  }
  walk(dir);

  if (useHtml) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>tred grep</title><style>body{font-family:sans-serif;padding:2em;background:#f6f8fa;} .card{background:#fff;border:1px solid #d0d7de;margin-bottom:1em;padding:1em;border-radius:6px;} .ctx{color:#0969da;font-weight:bold;} .line{font-family:monospace;margin-top:0.5em;}</style></head><body><h1>🔍 tred grep: ${pattern}</h1><p>找到 ${htmlResults.length} 处匹配</p>${htmlResults.map(r => `<div class="card"><strong>${r.file}:${r.line}</strong> <span class="ctx">${r.context}</span><div class="line">${r.text.replace(/</g,'&lt;')}</div></div>`).join('')}</body></html>`;
    writeFileSync('tred-grep-report.html', html);
    console.log('  ✓ HTML 报告已生成: tred-grep-report.html');
  }
}

// ==========================================
// v4.0 模糊语义搜索核心实现
// ==========================================
function performFuzzySearch(dir: string, query: string): SearchResult[] {
  const ignore = new Set(['node_modules', '.git', 'dist', '.tred-tmp', '.tred-cache', 'chunks']);
  const queryTokens = tokenize(query);
  const results: SearchResult[] = [];

  function walk(d: string) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) walk(join(d, e.name));
      } else if (e.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) {
        const full = join(d, e.name);
        const source = readFileSync(full, 'utf-8');
        const relPath = relative(process.cwd(), full);
        
        // 提取代码块 (函数/方法/类)
        try {
          const sf = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true);
          const visit = (node: ts.Node) => {
            let blockText = '';
            let context = '';
            let line = 0;

            if (ts.isFunctionDeclaration(node) && node.name) {
              blockText = node.getText(sf); context = `function: ${node.name.text}`; line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
              blockText = node.getText(sf); context = `method: ${node.name.text}`; line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            } else if (ts.isClassDeclaration(node) && node.name) {
              blockText = node.getText(sf); context = `class: ${node.name.text}`; line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            }

            if (blockText) {
              const blockTokens = tokenize(blockText);
              // 1. BM25
              const bm25Raw = calcBM25(queryTokens, blockTokens, 100);
              const bm25Score = Math.min(1, bm25Raw / (queryTokens.length || 1));
              // 2. MinHash
              const hashScore = minHashJaccard(queryTokens, blockTokens);
              
              // 粗筛：只要 BM25 或 MinHash 有一个超过阈值，就进入精排
              if (bm25Score > 0.1 || hashScore > 0.1) {
                // 3. AST Shape (如果查询本身是一段代码)
                let shapeScore = 0;
                try {
                  const queryShape = getAstShape(query);
                  const blockShape = getAstShape(blockText);
                  shapeScore = lcsRatio(queryShape, blockShape);
                } catch { /* ignore */ }

                // 融合 (若 query 是自然语言，AST shape 一般得分为0，主要靠 BM25 + MinHash)
                const finalScore = bm25Score * 0.6 + hashScore * 0.4 + shapeScore * 0.2;
                
                if (finalScore > 0.3) { // 过滤低分噪音
                  results.push({ file: relPath, line, context, text: blockText, score: finalScore });
                }
              }
            }
            ts.forEachChild(node, visit);
          };
          visit(sf);
        } catch {
          // 解析失败的忽略
        }
      }
    }
  }
  walk(dir);

  // 按得分降序排序，取前 10 个
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}
TS_EOF

# ==========================================
# 2. 接入 CLI (增加 --fuzzy)
# ==========================================
cat > .fix-cli-grep.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cli.ts';
let text = readFileSync(F, 'utf8');

// 找到 grep 命令的参数解析
const OLD_GREP = `  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const useAst = Boolean(flags.ast);
  const useHtml = Boolean(flags.html);
  grepDir(dir, pattern, useAst, useHtml);`;

const NEW_GREP = `  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const useAst = Boolean(flags.ast);
  const useHtml = Boolean(flags.html);
  const useFuzzy = Boolean(flags.fuzzy);
  grepDir(dir, pattern, useAst, useHtml, useFuzzy);`;

if (!text.includes(OLD_GREP)) {
  console.error('❌ 找不到 grepDir 调用逻辑');
  process.exit(1);
}
text = text.replace(OLD_GREP, NEW_GREP);
writeFileSync(F, text);
console.log('  ✓ cli.ts 接入 --fuzzy 参数');
MJS_EOF
node .fix-cli-grep.mjs && rm .fix-cli-grep.mjs

echo
echo "=== 重新 build ==="
npm run build
