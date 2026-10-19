import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { buildOutline } from './ast-outline.js';
import { tokenize, calcBM25 } from './bm25.js';
import { getAstShape, lcsRatio } from './ast-shape.js';
import { minHashJaccard } from './minhash.js';
import { getSimilarity } from './fuzzy.js';

interface SearchResult {
  file: string;
  line: number;
  context: string;
  text: string;
  score: number;
}

// 🚀 完全解耦的底层检索 API，可直接供开发者调用
export interface GrepResult {
  file: string;
  line: number;
  context: string;
  text: string;
  score: number;
}

export interface FuzzySearchOptions {
  ignoreDirs?: Set<string>;
  extensions?: RegExp;
  maxResults?: number;
}

export function searchFuzzy(dir: string, query: string, options?: FuzzySearchOptions): GrepResult[] {
  const ignore = options?.ignoreDirs || new Set(['node_modules', '.git', 'dist', '.tred-tmp', '.tred-cache', 'chunks']);
  const extRegex = options?.extensions || /\.(ts|tsx|js|jsx|mjs|cjs)$/;
  const maxResults = options?.maxResults || 10;

  const queryTokens = tokenize(query);
  const results: GrepResult[] = [];

  function walk(d: string) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) walk(join(d, e.name));
      } else if (e.isFile() && extRegex.test(e.name)) {
        const full = join(d, e.name);
        const source = readFileSync(full, 'utf-8');
        const relPath = relative(process.cwd(), full);
        
        try {
          const sf = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true);
          const visit = (node: ts.Node) => {
            let blockText = '';
            let context = '';
            let nodeName = '';
            let line = 0;

            let comments = '';
            const ranges = ts.getLeadingCommentRanges(source, node.pos) || [];
            for (const r of ranges) {
              comments += source.substring(r.pos, r.end) + '\n';
            }

            if (ts.isFunctionDeclaration(node) && node.name) {
              nodeName = node.name.text; blockText = comments + node.getText(sf); context = `function: ${nodeName}`; line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
              nodeName = node.name.text; blockText = comments + node.getText(sf); context = `method: ${nodeName}`; line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            } else if (ts.isClassDeclaration(node) && node.name) {
              nodeName = node.name.text; blockText = comments + node.getText(sf); context = `class: ${nodeName}`; line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            }

            if (blockText) {
              const nameScore = nodeName ? getSimilarity(query, nodeName) : 0;
              const blockTokens = tokenize(blockText);
              const bm25Raw = calcBM25(queryTokens, blockTokens, 100);
              const bm25Score = Math.min(1, bm25Raw / (queryTokens.length || 1));
              const hashScore = minHashJaccard(queryTokens, blockTokens);
              
              if (nameScore > 0.6 || bm25Score > 0.1 || hashScore > 0.1) {
                let shapeScore = 0;
                try {
                  const queryShape = getAstShape(query);
                  const blockShape = getAstShape(blockText);
                  shapeScore = lcsRatio(queryShape, blockShape);
                } catch { /* ignore */ }

                let finalScore = 0;
                if (nameScore > 0.6) finalScore = nameScore * 0.9 + bm25Score * 0.1;
                else finalScore = bm25Score * 0.5 + hashScore * 0.3 + shapeScore * 0.2;

                if (finalScore > 0.25) {
                  results.push({ file: relPath, line, context, text: blockText, score: finalScore });
                }
              }
            }
            ts.forEachChild(node, visit);
          };
          visit(sf);
        } catch { /* ignore */ }
      }
    }
  }
  walk(dir);

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

// 保留 CLI 调用的 wrapper
export function grepDir(dir: string, pattern: string, useAst: boolean, useHtml: boolean, fuzzy: boolean = false): void {
  if (fuzzy) {
    console.log(`🔍 [tred grep] 正在使用 v4.0 混合算法进行语义搜索: "${pattern}"\n`);
    const results = searchFuzzy(dir, pattern);
    
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

