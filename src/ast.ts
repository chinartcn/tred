import ts from 'typescript';
import type { AstSelector } from './types.js';
import { getSimilarity } from './fuzzy.js';

export interface NodeRange { start: number; end: number; }

export function findNodeRange(
  fileName: string,
  source: string,
  sel: AstSelector,
): NodeRange | null {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let matches: ts.Node[] = [];
  const occurrence = sel.occurrence ?? 1;

  // 检查节点是否在指定的上下文中
  function isInContext(node: ts.Node, contextStr?: string): boolean {
    if (!contextStr) return true;
    let current: ts.Node | undefined = node.parent;
    while (current) {
      // 如果父节点是一个 CallExpression，提取它的调用表达式文本（比如 worker.onmessage）
      if (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) {
        if (current.getText(sf).includes(contextStr)) return true;
      }
      current = current.parent;
    }
    return false;
  }

  function collectCandidates(): { name: string; node: ts.Node }[] {
    const list: { name: string; node: ts.Node }[] = [];
    const visit = (node: ts.Node) => {
      let name = '';
      let isTargetKind = false;
      if (sel.kind === 'class' && ts.isClassDeclaration(node) && node.name) { name = node.name.text; isTargetKind = true; }
      if (sel.kind === 'method' && ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) { name = node.name.text; isTargetKind = true; }
      if (sel.kind === 'function' || sel.kind === 'arrow-function') {
        if (ts.isFunctionDeclaration(node) && node.name) { name = node.name.text; isTargetKind = true; }
        if (ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) { name = node.parent.name.text; isTargetKind = true; }
      }
      
      if (isTargetKind && isInContext(node, sel.context)) {
        list.push({ name, node });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return list;
  }

  if (sel.fuzzy) {
    const query = sel.className || sel.methodName || sel.functionName || '';
    const candidates = collectCandidates();
    let bestScore = 0;
    let bestNode: ts.Node | null = null;
    for (const c of candidates) {
      let score = getSimilarity(query, c.name);
      if (c.name.toLowerCase().includes(query.toLowerCase()) || query.toLowerCase().includes(c.name.toLowerCase())) {
        score = Math.max(score, 0.9);
      }
      if (score > bestScore) { bestScore = score; bestNode = c.node; }
    }
    if (bestScore > 0) {
       if (ts.isArrowFunction(bestNode!) && ts.isVariableDeclaration(bestNode!.parent) && bestNode!.parent.parent && ts.isVariableDeclarationList(bestNode!.parent.parent) && bestNode!.parent.parent.parent && ts.isVariableStatement(bestNode!.parent.parent.parent)) {
           return { start: bestNode!.parent.parent.parent.getStart(sf), end: bestNode!.parent.parent.parent.getEnd() };
       }
       return { start: bestNode!.getStart(sf), end: bestNode!.getEnd() };
    }
    return null;
  }

  function isTarget(node: ts.Node): boolean {
    let match = false;
    if (sel.kind === 'class' && ts.isClassDeclaration(node) && node.name?.text === sel.className) match = true;
    if (sel.kind === 'method' && ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === sel.methodName) {
      if (!sel.className || (ts.isClassDeclaration(node.parent) && node.parent.name?.text === sel.className)) match = true;
    }
    if (sel.kind === 'function' || sel.kind === 'arrow-function') {
      const isArrow = ts.isArrowFunction(node);
      const isFuncDecl = ts.isFunctionDeclaration(node);
      if (sel.kind === 'function' && !isFuncDecl && !isArrow) match = false;
      else if (sel.kind === 'arrow-function' && !isArrow) match = false;
      else if (isFuncDecl && node.name?.text === sel.functionName) match = true;
      else if (isArrow && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) && node.parent.name.text === sel.functionName) match = true;
    }
    if (sel.kind === 'property' && sel.path && ts.isPropertyAssignment(node)) {
      let current: ts.Node = node;
      const parts = sel.path.split('.').reverse();
      let idx = 0;
      while (current && idx < parts.length) {
        if (ts.isPropertyAssignment(current) || ts.isVariableDeclaration(current)) {
          const name = current.name;
          if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === parts[idx]) idx++;
        }
        current = current.parent;
      }
      if (idx === parts.length) match = true;
    }
    if (sel.kind === 'variable' && ts.isVariableStatement(node)) {
      if (node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === sel.variableName)) match = true;
    }
    if (sel.kind === 'statement' && ts.isStatement(node) && node.parent === sf) match = true;
    
    return match && isInContext(node, sel.context);
  }

  const visit = (node: ts.Node): void => {
    if (isTarget(node)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (matches.length < occurrence) return null;
  const found = matches[occurrence - 1];

  if (sel.kind === 'property' && ts.isPropertyAssignment(found) && found.initializer) {
    return { start: found.initializer.getStart(sf), end: found.initializer.getEnd() };
  }
  if ((sel.kind === 'arrow-function' || sel.kind === 'function') && ts.isArrowFunction(found)) {
     let p = found.parent;
     if (ts.isVariableDeclaration(p) && p.parent && ts.isVariableDeclarationList(p.parent) && p.parent.parent && ts.isVariableStatement(p.parent.parent)) {
         return { start: p.parent.parent.getStart(sf), end: p.parent.parent.getEnd() };
     }
  }
  return { start: found.getStart(sf), end: found.getEnd() };
}