import ts from 'typescript';
import type { AstSelector } from './types.js';

export interface NodeRange {
  start: number;
  end: number;
}

export function findNodeRange(
  fileName: string,
  source: string,
  sel: AstSelector,
): NodeRange | null {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const matches: ts.Node[] = [];
  const occurrence = sel.occurrence ?? 1;

  // 核心匹配函数：如果匹配成功，返回需要替换的完整节点（可能向上提级）
  function getTargetNode(node: ts.Node): ts.Node | null {
    // 1. class
    if (sel.kind === 'class' && ts.isClassDeclaration(node) && node.name?.text === sel.className) {
      return node;
    }

    // 2. method
    if (sel.kind === 'method' && ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === sel.methodName) {
      if (!sel.className) return node;
      if (ts.isClassDeclaration(node.parent) && node.parent.name?.text === sel.className) return node;
      return null;
    }

    // 3. function / arrow-function
    if (sel.kind === 'function' || sel.kind === 'arrow-function') {
      const isArrow = ts.isArrowFunction(node);
      const isFuncExpr = ts.isFunctionExpression(node);
      const isFuncDecl = ts.isFunctionDeclaration(node);

      if (sel.kind === 'function' && !isFuncDecl && !isArrow && !isFuncExpr) return null;
      if (sel.kind === 'arrow-function' && !isArrow && !isFuncExpr) return null;

      if (isFuncDecl && node.name?.text === sel.functionName) return node;

      // 处理 const foo = () => {}
      if ((isArrow || isFuncExpr) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        if (node.parent.name.text === sel.functionName) {
          // 向上提级到 VariableStatement，包含 const 关键字
          let p = node.parent.parent; // VariableDeclarationList
          if (p && ts.isVariableDeclarationList(p) && p.parent && ts.isVariableStatement(p.parent)) {
            return p.parent;
          }
          return node.parent;
        }
      }
      return null;
    }

    // 4. property（支持 TECHS.铁矿机.cost 嵌套路径）
    if (sel.kind === 'property' && sel.path && ts.isPropertyAssignment(node)) {
      let current: ts.Node | undefined = node;
      const parts = sel.path.split('.').reverse(); 
      let partIdx = 0;
      
      while (current && partIdx < parts.length) {
        if (ts.isPropertyAssignment(current) || ts.isVariableDeclaration(current) || ts.isPropertyDeclaration(current)) {
          const name = current.name;
          if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
            if (name.text === parts[partIdx]) {
              partIdx++;
            }
          }
        }
        current = current.parent;
      }
      if (partIdx === parts.length) {
        // 如果目标是 PropertyAssignment，我们默认只替换它的值，这样用户传 '200' 就能直接生效
        if (ts.isPropertyAssignment(node) && node.initializer) {
          return node.initializer;
        }
        return node;
      }
      return null;
    }

    // 5. variable / statement
    if (sel.kind === 'variable' && ts.isVariableStatement(node)) {
      const hasVar = node.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === sel.variableName);
      if (hasVar) return node;
    }
    if (sel.kind === 'statement' && ts.isStatement(node) && node.parent === sf) return node;

    return null;
  }

  // 遍历所有节点
  const visit = (node: ts.Node): void => {
    const target = getTargetNode(node);
    if (target) matches.push(target);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (matches.length < occurrence) return null;
  const found = matches[occurrence - 1];

  // 💡 关键优化：getStart() 会保留注释（JSDoc），只从 token 本身开始
  return { start: found.getStart(sf), end: found.getEnd() };
}