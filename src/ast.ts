import ts from 'typescript';
import type { AstSelector } from './types.js';

export interface NodeRange {
  start: number;
  end: number;
}

/**
 * 用 TS 官方 AST 定位目标节点。
 * 关键：用 node.getStart(sf) 而不是 node.pos——
 * node.pos 会包含前导注释/空行，切出来会带孤儿注释。
 */
export function findNodeRange(
  fileName: string,
  source: string,
  sel: AstSelector,
): NodeRange | null {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const matches: ts.Node[] = [];
  const occurrence = sel.occurrence ?? 1;

  const visit = (node: ts.Node): void => {
    if (sel.kind === 'class' && ts.isClassDeclaration(node) && node.name?.text === sel.className) {
      matches.push(node);
    } else if (sel.kind === 'function' && ts.isFunctionDeclaration(node) && node.name?.text === sel.functionName) {
      matches.push(node);
    } else if (sel.kind === 'method' && ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === sel.methodName && ts.isClassDeclaration(node.parent) && node.parent.name?.text === sel.className) {
      matches.push(node);
    } else if (sel.kind === 'variable' && ts.isVariableStatement(node)) {
      const hasVar = node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === sel.variableName);
      if (hasVar) matches.push(node);
    } else if (sel.kind === 'statement') {
      if (ts.isStatement(node) && node.parent === sf) matches.push(node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  if (matches.length === 0 || matches.length < occurrence) return null;
  
  const found = matches[occurrence - 1];
  return { start: found.getStart(sf), end: found.getEnd() };
}
