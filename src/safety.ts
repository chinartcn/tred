import ts from 'typescript';
import type { ReplaceAssertions } from './types.js';

export function checkSyntax(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    if (d.file && typeof d.start === 'number') {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${d.file.fileName}:${line + 1}:${character + 1} - TS${d.code}: ${msg}`;
    }
    return `TS${d.code}: ${msg}`;
  });
}

export function checkAssertions(content: string, assertions: ReplaceAssertions): string[] {
  const errors: string[] = [];

  if (assertions.include) {
    for (const word of assertions.include) {
      if (!content.includes(word)) errors.push('断言失败：必须包含 "' + word + '"');
    }
  }
  if (assertions.exclude) {
    for (const word of assertions.exclude) {
      if (content.includes(word)) errors.push('断言失败：不能包含 "' + word + '"');
    }
  }
  if (assertions.regex) {
    for (const pattern of assertions.regex) {
      try {
        if (!new RegExp(pattern).test(content)) errors.push('断言失败：必须匹配 /' + pattern + '/');
      } catch {
        errors.push('断言失败：非法正则 "' + pattern + '"');
      }
    }
  }

  if (assertions.hasAst || assertions.noAst) {
    const findAll = (kind: string, name?: string) => {
      let count = 0;
      const checkNode = (node: ts.Node) => {
        if (kind === 'class' && ts.isClassDeclaration(node) && (!name || node.name?.text === name)) count++;
        else if (kind === 'function' && ts.isFunctionDeclaration(node) && (!name || node.name?.text === name)) count++;
        else if (kind === 'method' && ts.isMethodDeclaration(node) && (!name || (node.name && ts.isIdentifier(node.name) && node.name.text === name))) count++;
        ts.forEachChild(node, checkNode);
      };

      const tryParse = (code: string) => {
        const sf = ts.createSourceFile('check.ts', code, ts.ScriptTarget.Latest, true);
        count = 0;
        checkNode(sf);
        return count;
      };

      if (tryParse(content) > 0) return count;

      // Fallback 1: 当作类内部片段
      const classWrap = 'class __Dummy { ' + content + ' }';
      if (tryParse(classWrap) > 0) return count;

      // Fallback 2: 当作函数内部片段
      const funcWrap = 'function __dummy() { ' + content + ' }';
      if (tryParse(funcWrap) > 0) return count;

      return 0;
    };

    if (assertions.hasAst) {
      for (const rule of assertions.hasAst) {
        const parts = rule.split(':');
        const kind = parts[0];
        const name = parts[1];
        if (findAll(kind, name) === 0) errors.push('AST 断言失败：必须包含 ' + kind + (name ? ' ' + name : ''));
      }
    }
    if (assertions.noAst) {
      for (const rule of assertions.noAst) {
        const parts = rule.split(':');
        const kind = parts[0];
        const name = parts[1];
        if (findAll(kind, name) > 0) errors.push('AST 断言失败：不能包含 ' + kind + (name ? ' ' + name : ''));
      }
    }
  }

  return errors;
}