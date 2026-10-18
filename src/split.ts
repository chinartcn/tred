import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import ts from 'typescript';
import { checkSyntax } from './safety.js';

function dedent(str: string): string {
  const lines = str.split("\n");
  const minIndent = lines
    .filter(l => l.trim().length > 0)
    .reduce((min, l) => Math.min(min, l.match(/^\s*/)![0].length), Infinity);
  return lines.map(l => l.slice(minIndent)).join("\n");
}

export function splitFile(filePath: string, targets: string[], newFileName: string, targetClass?: string) {
  const original = readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, original, ts.ScriptTarget.Latest, true);

  const extractedNodes: ts.Node[] = [];
  const removedRanges: { start: number, end: number }[] = [];
  let className = targetClass || '';

  // ── 场景 A：提取类方法 ──
  if (targetClass) {
    const classDecl = sf.statements.find(
      (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === targetClass
    );
    if (!classDecl) {
      return { ok: false, message: '找不到目标类: ' + targetClass };
    }

    for (const member of classDecl.members) {
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && targets.includes(member.name.text)) {
        extractedNodes.push(member);
        removedRanges.push({ start: member.getStart(sf), end: member.getEnd() });
      }
    }
  } else {
    // ── 场景 B：提取顶层函数 ──
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && targets.includes(stmt.name.text)) {
        extractedNodes.push(stmt);
        removedRanges.push({ start: stmt.getStart(sf), end: stmt.getEnd() });
      }
    }
  }

  if (extractedNodes.length === 0) {
    return { ok: false, message: '未找到指定名称的节点' };
  }

  // ── 1. 构建新文件 ──
  const newFileLines: string[] = [];
  if (targetClass) {
    newFileLines.push('import type { ' + targetClass + ' } from \'./' + basename(filePath).replace(/\.ts$/, '.js') + '\';');
    newFileLines.push('');
  }

  for (const node of extractedNodes) {
    let text = node.getText(sf);
    if (targetClass) {
      // 提取类方法 -> 转换为带 this 参数的独立函数
      const method = node as ts.MethodDeclaration;
      const name = (method.name as ts.Identifier).text;
      const params = method.parameters.map(p => p.getText(sf)).join(', ');
      const typeParams = method.typeParameters ? '<' + method.typeParameters.map(t => t.getText(sf)).join(', ') + '>' : '';
      const returnType = method.type ? ': ' + method.type.getText(sf) : '';

      if (method.body && ts.isBlock(method.body)) {
        // 提取大括号内的所有语句文本，再运行 dedent
        const inner = method.body.statements.map(st => st.getText(sf)).join('\n');
        const dedented = dedent(inner).trim();
        // 按 2 个空格的标准缩进重新排版
        const bodyStr = '{\n  ' + dedented.replace(/\n/g, '\n  ') + '\n}';
        text = 'export function ' + name + typeParams + '(this: ' + targetClass + (params ? ', ' + params : '') + ')' + returnType + ' ' + bodyStr;
      } else {
        text = 'export function ' + name + typeParams + '(this: ' + targetClass + (params ? ', ' + params : '') + ')' + returnType + ';';
      }
    } else {
      // 顶层函数直接加 export
      if (!text.startsWith('export ')) text = 'export ' + text;
    }
    newFileLines.push(text);
    newFileLines.push('');
  }

  const newContent = newFileLines.join('\n');
  const fullNewPath = resolve(filePath, '..', newFileName);

  const newSyntaxErrors = checkSyntax(fullNewPath, newContent);
  if (newSyntaxErrors.length > 0) {
    return { ok: false, message: '拆分后的新文件语法错误: ' + newSyntaxErrors.join('; ') };
  }
  writeFileSync(fullNewPath, newContent, 'utf-8');

  // ── 2. 处理原文件：移除代码，增加 import 与 Mixin ──
  removedRanges.sort((a, b) => b.start - a.start);
  let origText = original;
  for (const r of removedRanges) {
    origText = origText.slice(0, r.start) + origText.slice(r.end);
  }

  const newBaseName = basename(newFileName).replace(/\.ts$/, '.js');
  if (targetClass) {
    // 类方法：注入 import 和 Object.assign
    const importStmt = 'import { ' + targets.join(', ') + ' } from \'./' + newBaseName + '\';';
    const mixinStmt = '\nObject.assign(' + targetClass + '.prototype, { ' + targets.join(', ') + ' });\n';
    origText = importStmt + '\n' + origText + mixinStmt;
  } else {
    // 顶层函数：注入 import 和 export 转发（如果原来是 export 的）
    const hasExport = extractedNodes.some(n => {
      if (!ts.canHaveModifiers(n)) return false;
      const mods = ts.getModifiers(n);
      return mods ? mods.some(m => m.kind === ts.SyntaxKind.ExportKeyword) : false;
    });
    const importStmt = 'import { ' + targets.join(', ') + ' } from \'./' + newBaseName + '\';';
    const reExport = hasExport ? '\nexport { ' + targets.join(', ') + ' };\n' : '';
    origText = importStmt + '\n' + origText + reExport;
  }

  const origSyntaxErrors = checkSyntax(filePath, origText);
  if (origSyntaxErrors.length > 0) {
    writeFileSync(fullNewPath, '', 'utf-8'); // 回滚
    return { ok: false, message: '原文件移除代码后语法错误: ' + origSyntaxErrors.join('; ') };
  }
  // 清理多余的连续空行
origText = origText.replace(/\n\s*\n\s*\n/g, '\n\n');
writeFileSync(filePath, origText, 'utf-8');
  return { ok: true, message: '已拆分 ' + extractedNodes.length + ' 个' + (targetClass ? '类方法' : '函数') + '到 ' + newFileName };
}