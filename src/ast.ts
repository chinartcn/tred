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

  function collectCandidates(): { name: string; node: ts.Node }[] {
    const list: { name: string; node: ts.Node }[] = [];
    const visit = (node: ts.Node) => {
      if (sel.kind === 'class' && ts.isClassDeclaration(node) && node.name) list.push({ name: node.name.text, node });
      if (sel.kind === 'method' && ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) list.push({ name: node.name.text, node });
      if ((sel.kind === 'function' || sel.kind === 'arrow-function') && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node))) {
        if (ts.isFunctionDeclaration(node) && node.name) list.push({ name: node.name.text, node });
        if (ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) list.push({ name: node.parent.name.text, node: node.parent.parent.parent });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return list;
  }

  // 1. 如果开了 fuzzy，直接走向量引擎打分
  if (sel.fuzzy) {
    const query = sel.className || sel.methodName || sel.functionName || '';
    const candidates = collectCandidates();
    let bestScore = 0;
    let bestNode: ts.Node | null = null;
    for (const c of candidates) {
      let score = getSimilarity(query, c.name);
      // 如果名字互相包含（比如搜 update 命中 updateStatsPanel），给个高分
      if (c.name.toLowerCase().includes(query.toLowerCase()) || query.toLowerCase().includes(c.name.toLowerCase())) {
        score = Math.max(score, 0.8);
      }
      if (score > bestScore) { bestScore = score; bestNode = c.node; }
    }
    // 因为用户显式开启了 fuzzy，只要得分大于 0 就返回最接近的
    if (bestScore > 0) return { start: bestNode!.getStart(sf), end: bestNode!.getEnd() };
    return null;
  }

  // 2. 以下是精确匹配逻辑（保留之前的边缘情况修复）
  function isTarget(node: ts.Node): boolean {
    if (sel.kind === 'class' && ts.isClassDeclaration(node) && node.name?.text === sel.className) return true;
    if (sel.kind === 'method' && ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === sel.methodName) {
      if (!sel.className) return true;
      if (ts.isClassDeclaration(node.parent) && node.parent.name?.text === sel.className) return true;
    }
    if (sel.kind === 'function' || sel.kind === 'arrow-function') {
      const isArrow = ts.isArrowFunction(node);
      const isFuncDecl = ts.isFunctionDeclaration(node);
      if (sel.kind === 'function' && !isFuncDecl && !isArrow) return false;
      if (sel.kind === 'arrow-function' && !isArrow) return false;
      if (isFuncDecl && node.name?.text === sel.functionName) return true;
      if (isArrow && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) && node.parent.name.text === sel.functionName) return true;
    }
    if (sel.kind === 'property' && sel.path && ts.isPropertyAssignment(node)) {
      let current: ts.Node = node;
      const parts = sel.path.split('.').reverse();
      for (let i = 0; i < parts.length; i++) {
        if (!current || !ts.isPropertyAssignment(current)) return false;
        const name = current.name;
        let key = '';
        if (ts.isIdentifier(name) || ts.isStringLiteral(name)) key = name.text;
        if (key !== parts[i]) return false;
        current = current.parent;
      }
      return true;
    }
    if (sel.kind === 'variable' && ts.isVariableStatement(node)) {
      if (node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === sel.variableName)) return true;
    }
    if (sel.kind === 'statement' && ts.isStatement(node) && node.parent === sf) return true;
    return false;
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