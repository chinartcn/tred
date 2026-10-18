import ts from 'typescript';
import type { AstSelector, OutlineNode } from './types.js';

function pos(sf: ts.SourceFile, node: ts.Node): { line: number; column: number; start: number; end: number } {
  const start = node.getStart(sf);
  const end = node.getEnd();
  const lc = sf.getLineAndCharacterOfPosition(start);
  return { line: lc.line + 1, column: lc.character + 1, start: start, end: end };
}

function visitMember(member: ts.ClassElement, className: string, sf: ts.SourceFile): OutlineNode | null {
  const p = pos(sf, member);
  if (ts.isConstructorDeclaration(member)) {
    return { kind: 'constructor', name: 'constructor', line: p.line, column: p.column, start: p.start, end: p.end };
  }
  if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
    const name = member.name.text;
    const sel: AstSelector = { kind: 'method', className: className, methodName: name };
    return { kind: 'method', name: name, line: p.line, column: p.column, start: p.start, end: p.end, selector: sel };
  }
  if (ts.isGetAccessorDeclaration(member) && ts.isIdentifier(member.name)) {
    return { kind: 'getter', name: member.name.text, line: p.line, column: p.column, start: p.start, end: p.end };
  }
  if (ts.isSetAccessorDeclaration(member) && ts.isIdentifier(member.name)) {
    return { kind: 'setter', name: member.name.text, line: p.line, column: p.column, start: p.start, end: p.end };
  }
  if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
    return { kind: 'property', name: member.name.text, line: p.line, column: p.column, start: p.start, end: p.end };
  }
  return null;
}

export function buildOutline(fileName: string, source: string): OutlineNode[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const roots: OutlineNode[] = [];
  for (const stmt of sf.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name) {
      const p = pos(sf, stmt);
      const cls: OutlineNode = {
        kind: 'class',
        name: stmt.name.text,
        line: p.line,
        column: p.column,
        start: p.start,
        end: p.end,
        selector: { kind: 'class', className: stmt.name.text },
        children: [],
      };
      for (const member of stmt.members) {
        const child = visitMember(member, stmt.name.text, sf);
        if (child) cls.children!.push(child);
      }
      roots.push(cls);
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const p = pos(sf, stmt);
      roots.push({
        kind: 'function',
        name: stmt.name.text,
        line: p.line,
        column: p.column,
        start: p.start,
        end: p.end,
        selector: { kind: 'function', functionName: stmt.name.text },
      });
    } else if (ts.isExpressionStatement(stmt) && ts.isBinaryExpression(stmt.expression) && stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = stmt.expression.left;
      const right = stmt.expression.right;
      if ((ts.isFunctionExpression(right) || ts.isArrowFunction(right)) && (ts.isIdentifier(left) || ts.isPropertyAccessExpression(left))) {
        const p = pos(sf, stmt);
        const name = left.getText(sf);
        roots.push({
          kind: 'function',
          name: name,
          line: p.line,
          column: p.column,
          start: p.start,
          end: p.end,
          selector: { kind: 'function', functionName: name },
        });
      }
    }
  }
  return roots;
}
