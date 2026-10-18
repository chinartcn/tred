import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import ts from 'typescript';
import { checkSyntax } from './safety.js';

function dedent(str: string): string {
  const lines = str.split('\n');
  const minIndent = lines
    .filter(l => l.trim().length > 0)
    .reduce((min, l) => Math.min(min, l.match(/^\s*/)![0].length), Infinity);
  return lines.map(l => l.slice(minIndent)).join('\n');
}

export function splitFile(filePath: string, targets: string[], newFileName: string, targetClass?: string) {
  const original = readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, original, ts.ScriptTarget.Latest, true);

  const extractedNodes: ts.Node[] = [];
  const removedRanges: { start: number, end: number }[] = [];
  const foundNames = new Set<string>();
  let classDecl: ts.ClassDeclaration | undefined;

  if (targetClass) {
    classDecl = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === targetClass);
    if (!classDecl) return { ok: false, message: '找不到目标类: ' + targetClass };

    for (const member of classDecl.members) {
      // 1. 标准方法: renderNode() {}
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && targets.includes(member.name.text)) {
        extractedNodes.push(member);
        removedRanges.push({ start: member.getFullStart(), end: member.getEnd() });
        foundNames.add(member.name.text);
      }
      // 2. 箭头函数属性: renderNode = () => {}
      else if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && targets.includes(member.name.text)) {
        extractedNodes.push(member);
        removedRanges.push({ start: member.getStart(sf), end: member.getEnd() });
        foundNames.add(member.name.text);
      }
    }

    const missing = targets.filter(t => !foundNames.has(t));
    if (missing.length > 0) {
      const available = classDecl.members
        .filter(m => ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m))
        .map(m => (m.name && ts.isIdentifier(m.name) ? m.name.text : ''))
        .filter(Boolean).join(', ');
      return { ok: false, message: '在类 ' + targetClass + ' 中找不到: ' + missing.join(', ') + '。该类实际拥有的成员: ' + available };
    }
  } else {
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && targets.includes(stmt.name.text)) {
        extractedNodes.push(stmt);
        removedRanges.push({ start: stmt.getFullStart(), end: stmt.getEnd() });
        foundNames.add(stmt.name.text);
      }
    }
  }

  if (extractedNodes.length === 0) {
    return { ok: false, message: '未找到任何指定的节点' };
  }

  // ── 构建新文件 ──
  const newFileLines: string[] = [];
  if (targetClass) {
    newFileLines.push('import type { ' + targetClass + ' } from \'./' + basename(filePath).replace(/\.ts$/, '.js') + '\';');
    newFileLines.push('');
  }

  for (const node of extractedNodes) {
    let text = original.slice(node.getFullStart(), node.getEnd()).trim();
    if (targetClass) {
      if (ts.isMethodDeclaration(node)) {
        const name = (node.name as ts.Identifier).text;
        const params = node.parameters.map(p => p.getText(sf)).join(', ');
        const typeParams = node.typeParameters ? '<' + node.typeParameters.map(t => t.getText(sf)).join(', ') + '>' : '';
        const returnType = node.type ? ': ' + node.type.getText(sf) : '';
        let bodyStr = '{}';
        if (node.body && ts.isBlock(node.body)) {
          const inner = node.body.statements.map(st => st.getText(sf)).join('\n');
          const dedented = dedent(inner).trim();
          bodyStr = '{\n  ' + dedented.replace(/\n/g, '\n  ') + '\n}';
        }
        // 剥离原本方法声明部分的文本，用标准 function 替换
        const fullText = original.slice(node.getFullStart(), node.getEnd()).trim();
        const bodyStartIdx = fullText.lastIndexOf('{');
        const headStr = bodyStartIdx !== -1 ? fullText.slice(0, bodyStartIdx).trim() : '';
        // 如果 headStr 包含原来方法的声明，我们拆掉它
        const prefix = headStr.replace(/^(?:public|private|protected|static|async|\s)*/g, '').replace(name + '[^{]*$/', '').trim();
        // 重新构建，保留注释
        let comments = '';
        const commentMatch = fullText.match(/^(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)+/);
        if (commentMatch) comments = commentMatch[0];
        text = comments + 'export function ' + name + typeParams + '(this: ' + targetClass + (params ? ', ' + params : '') + ')' + returnType + ' ' + bodyStr;
      } else if (ts.isPropertyDeclaration(node)) {
        const name = (node.name as ts.Identifier).text;
        // 提取箭头函数体
        if (node.initializer && ts.isArrowFunction(node.initializer)) {
          const arrow = node.initializer;
          const params = arrow.parameters.map(p => p.getText(sf)).join(', ');
          const returnType = arrow.type ? ': ' + arrow.type.getText(sf) : '';
          let bodyStr = arrow.body.getText(sf);
          if (ts.isBlock(arrow.body)) {
            const inner = arrow.body.statements.map(st => st.getText(sf)).join('\n');
            const dedented = dedent(inner).trim();
            bodyStr = '{\n  ' + dedented.replace(/\n/g, '\n  ') + '\n}';
          }
          text = 'export const ' + name + ' = function(this: ' + targetClass + (params ? ', ' + params : '') + ')' + returnType + ' ' + bodyStr;
        } else {
          text = 'export const ' + name + ' = ' + node.initializer?.getText(sf) + ';';
        }
      }
    } else {
      if (!text.startsWith('export ')) text = 'export ' + text;
    }
    newFileLines.push(text);
    newFileLines.push('');
  }

  const newContent = newFileLines.join('\n');
  const fullNewPath = resolve(filePath, '..', newFileName);

  const newSyntaxErrors = checkSyntax(fullNewPath, newContent);
  if (newSyntaxErrors.length > 0) {
    return { ok: false, message: '新文件语法错误: ' + newSyntaxErrors.join('; ') };
  }
  writeFileSync(fullNewPath, newContent, 'utf-8');

  // ── 处理原文件：移除代码，增加 import 与 Mixin ──
  removedRanges.sort((a, b) => b.start - a.start);
  let origText = original;
  for (const r of removedRanges) {
    origText = origText.slice(0, r.start) + origText.slice(r.end);
  }

  const newBaseName = basename(newFileName).replace(/\.ts$/, '.js');
  const imports = Array.from(foundNames);
  if (targetClass) {
    const importStmt = 'import { ' + imports.join(', ') + ' } from \'./' + newBaseName + '\';';
    const mixinStmt = '\nObject.assign(' + targetClass + '.prototype, { ' + imports.join(', ') + ' });\n';
    origText = importStmt + '\n' + origText + mixinStmt;
  } else {
    const hasExport = extractedNodes.some(n => {
      if (!ts.canHaveModifiers(n)) return false;
      const mods = ts.getModifiers(n);
      return mods ? mods.some(m => m.kind === ts.SyntaxKind.ExportKeyword) : false;
    });
    const importStmt = 'import { ' + imports.join(', ') + ' } from \'./' + newBaseName + '\';';
    const reExport = hasExport ? '\nexport { ' + imports.join(', ') + ' };\n' : '';
    origText = importStmt + '\n' + origText + reExport;
  }

  origText = origText.replace(/\n\s*\n\s*\n/g, '\n\n');

  const origSyntaxErrors = checkSyntax(filePath, origText);
  if (origSyntaxErrors.length > 0) {
    writeFileSync(fullNewPath, '', 'utf-8');
    return { ok: false, message: '原文件移除代码后语法错误: ' + origSyntaxErrors.join('; ') };
  }
  writeFileSync(filePath, origText, 'utf-8');
  return { ok: true, message: '已拆分 ' + extractedNodes.length + ' 个成员到 ' + newFileName };
}