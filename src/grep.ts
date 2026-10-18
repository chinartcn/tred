import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildOutline } from './ast-outline.js';

export function grepDir(dir: string, pattern: string, useAst: boolean, useHtml: boolean): void {
  const re = new RegExp(pattern, 'gi');
  const ignore = new Set(['node_modules', '.git', 'dist', '.tred-tmp']);
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