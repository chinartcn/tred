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
  let found: ts.Node | null = null;

  const visit = (node: ts.Node): void => {
    if (found) return;

    if (sel.kind === 'class' && ts.isClassDeclaration(node)) {
      if (node.name?.text === sel.className) {
        found = node;
        return;
      }
    } else if (sel.kind === 'function' && ts.isFunctionDeclaration(node)) {
      if (node.name?.text === sel.functionName) {
        found = node;
        return;
      }
    } else if (
      sel.kind === 'method' &&
      ts.isMethodDeclaration(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === sel.methodName &&
      ts.isClassDeclaration(node.parent) &&
      node.parent.name?.text === sel.className
    ) {
      found = node;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  if (!found) return null;
  const node: ts.Node = found;
  return { start: node.getStart(sf), end: node.getEnd() };
}
