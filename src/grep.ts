import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildOutline } from './ast-outline.js';

export function grepDir(dir: string, pattern: string, useAst: boolean): void {
  const re = new RegExp(pattern, 'gi');
  const ignore = new Set(['node_modules', '.git', 'dist', '.tred-tmp']);

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
        if (useAst) {
          try { outline = buildOutline(full, source); } catch {}
        }

        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            let contextStr = '';
            if (useAst && outline.length > 0) {
              // 简单寻找包含该行的最近节点
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
              if (bestNode) contextStr = ` [in ${bestNode.kind}: ${bestNode.name}]`;
            }
            const relPath = relative(process.cwd(), full);
            // 重置正则游标
            re.lastIndex = 0;
            console.log(`${relPath}:${i + 1}:${contextStr} ${lines[i].trim()}`);
          }
        }
      }
    }
  }
  walk(dir);
}