import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import ts from 'typescript';
import { checkSyntax } from './safety.js';

export function splitFile(filePath: string, targets: string[], newFileName: string) {
  const original = readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, original, ts.ScriptTarget.Latest, true);

  const exportedNodes: ts.Node[] = [];
  const keptNodes: ts.Node[] = [];

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && targets.includes(stmt.name.text)) {
      exportedNodes.push(stmt);
    } else {
      keptNodes.push(stmt);
    }
  }

  if (exportedNodes.length === 0) {
    return { ok: false, message: '未在该文件中找到指定的函数' };
  }

  // 1. 构建新文件
  const newFileLines: string[] = [];
  for (const node of exportedNodes) {
    let text = node.getText(sf);
    // 如果原来没有 export，自动加上
    if (!text.startsWith('export ')) text = 'export ' + text;
    newFileLines.push(text);
    newFileLines.push('');
  }
  const newContent = newFileLines.join('\n');

  const fullNewPath = resolve(filePath, '..', newFileName);
  if (checkSyntax(fullNewPath, newContent).length > 0) {
    return { ok: false, message: '拆分后的新文件语法错误' };
  }
  writeFileSync(fullNewPath, newContent, 'utf-8');

  // 2. 处理原文件：移除代码，增加 import
  let finalOriginal = '';
  const removedRanges: { start: number, end: number }[] = [];
  for (const node of exportedNodes) {
    removedRanges.push({ start: node.getStart(sf), end: node.getEnd() });
  }
  removedRanges.sort((a, b) => b.start - a.start);
  let origText = original;
  for (const r of removedRanges) {
    origText = origText.slice(0, r.start) + origText.slice(r.end);
  }

  // 检查原文件是否需要 export 导出这些函数（如果是原文件里本来就 export 的话）
  const hasExport = exportedNodes.some(n => {
    if (!ts.canHaveModifiers(n)) return false;
    const mods = ts.getModifiers(n);
    return mods ? mods.some(m => m.kind === ts.SyntaxKind.ExportKeyword) : false;
  });
  const exportKw = hasExport ? 'export ' : '';
  const importStmt = `import { ${targets.join(', ')} } from './${basename(newFileName).replace(/\.ts$/, '.js')}';\n`;

  // 如果原文件里本来就 export 这些函数，那拆分后原文件也需要再 export 出来
  const reExport = hasExport ? `\nexport { ${targets.join(', ')} };\n` : '';
  finalOriginal = importStmt + origText + reExport;

  if (checkSyntax(filePath, finalOriginal).length > 0) {
    // 回滚新文件
    writeFileSync(fullNewPath, '', 'utf-8');
    return { ok: false, message: '原文件移除代码后语法错误' };
  }
  writeFileSync(filePath, finalOriginal, 'utf-8');
  return { ok: true, message: `已拆分 ${exportedNodes.length} 个函数到 ${newFileName}` };
}