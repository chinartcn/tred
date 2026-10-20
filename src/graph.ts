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
