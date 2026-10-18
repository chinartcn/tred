import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export function analyzeImpact(dir: string, target: string): string {
  const ignore = new Set(['node_modules', '.git', 'dist', '.tred-tmp', '.tred']);
  const impacts: string[] = [];
  let totalRefs = 0;

  function walk(d: string) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) walk(join(d, e.name));
      } else if (e.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) {
        const full = join(d, e.name);
        const source = readFileSync(full, 'utf-8');
        const sf = ts.createSourceFile(full, source, ts.ScriptTarget.Latest, true);
        const fileRefs: string[] = [];

        function visit(node: ts.Node, context: string) {
          let currentContext = context;
          if (ts.isFunctionDeclaration(node) && node.name) currentContext = `function ${node.name.text}`;
          else if (ts.isClassDeclaration(node) && node.name) currentContext = `class ${node.name.text}`;
          else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) currentContext = `method ${node.name.text}`;

          if (ts.isIdentifier(node) && node.text === target) {
            // 排除自身声明的行
            const isDecl = ts.isVariableDeclaration(node.parent) || ts.isFunctionDeclaration(node.parent) || ts.isClassDeclaration(node.parent);
            if (!isDecl) {
              fileRefs.push(currentContext || 'top-level');
            }
          }
          ts.forEachChild(node, (child) => visit(child, currentContext));
        }
        visit(sf, '');

        if (fileRefs.length > 0) {
          totalRefs += fileRefs.length;
          const uniqueCtx = Array.from(new Set(fileRefs));
          const rel = relative(dir, full);
          impacts.push(`  - ${rel}: 被引用于 [ ${uniqueCtx.join(', ')} ]`);
        }
      }
    }
  }
  walk(dir);

  if (totalRefs === 0) return `\n✅ 安全：没有找到任何对 "${target}" 的引用。`;
  return `\n🚨 影响分析: "${target}" 共计被引用 ${totalRefs} 次，涉及 ${impacts.length} 个文件：\n${impacts.join('\n')}`;
}