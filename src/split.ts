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

// P2_private_shell: private/protected 方法拆分为"薄壳 + Impl"
function generatePrivateShell(node: ts.MethodDeclaration, sf: ts.SourceFile, implName: string, indent: string): string {
  const name = (node.name as ts.Identifier).text;
  const mods = (node.modifiers ?? []).map(m => m.getText(sf)).join(' ');
  const params = node.parameters.map(p => p.getText(sf)).join(', ');

  const argNames: string[] = [];
  for (const p of node.parameters) {
    if (!ts.isIdentifier(p.name)) {
      // 解构参数：用 ...args 兜底
      return [
        indent + (mods ? mods + ' ' : '') + name + '(...args: any[]) {',
        indent + '  return ' + implName + '.apply(this, args);',
        indent + '}',
      ].join('\n');
    }
    argNames.push(p.name.text);
  }

  const typeParams = node.typeParameters ? '<' + node.typeParameters.map(t => t.getText(sf)).join(', ') + '>' : '';
  const returnType = node.type ? ': ' + node.type.getText(sf) : '';
  const isVoid = !!(node.type && node.type.kind === ts.SyntaxKind.VoidKeyword);

  const callArgs = argNames.length > 0 ? ', ' + argNames.join(', ') : '';
  const callExpr = implName + '.call(this' + callArgs + ')';
  const bodyLine = isVoid ? indent + '  ' + callExpr + ';' : indent + '  return ' + callExpr + ';';

  return [
    indent + (mods ? mods + ' ' : '') + name + typeParams + '(' + params + ')' + returnType + ' {',
    bodyLine,
    indent + '}',
  ].join('\n');
}

function getIndentAt(source: string, pos: number): string {
  let lineStart = pos;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  let i = lineStart;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
  return source.slice(lineStart, i);
}

export function splitFile(filePath: string, targets: string[], newFileName: string, targetClass?: string) {
  // P0_1_P0_2_P1_3_P1_4
  const original = readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, original, ts.ScriptTarget.Latest, true);

  const extractedNodes: ts.Node[] = [];
  const extractedMethodNames = new Set<string>();
  const foundNames = new Set<string>();
  let classDecl: ts.ClassDeclaration | undefined;

  // ── 识别目标成员 ──
  if (targetClass) {
    classDecl = sf.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === targetClass);
    if (!classDecl) return { ok: false, message: '找不到目标类: ' + targetClass };

    for (const member of classDecl.members) {
      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && targets.includes(member.name.text)) {
        const mods = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
        if (mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.StaticKeyword)) {
          return { ok: false, message: '暂不支持拆分 static 方法: ' + targetClass + '#' + member.name.text };
        }
        extractedNodes.push(member);
        extractedMethodNames.add(member.name.text);
        foundNames.add(member.name.text);
      } else if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && targets.includes(member.name.text)) {
        const mods = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
        if (mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.StaticKeyword)) {
          return { ok: false, message: '暂不支持拆分 static 属性: ' + targetClass + '#' + member.name.text };
        }
        if (mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
          return { ok: false, message: '暂不支持拆分非 public 属性: ' + targetClass + '#' + member.name.text };
        }
        extractedNodes.push(member);
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
        foundNames.add(stmt.name.text);
      }
    }

    const stillMissing = targets.filter(t => !foundNames.has(t));
    if (stillMissing.length > 0) {
      const candidates = new Map<string, ts.ClassDeclaration>();
      for (const stmt of sf.statements) {
        if (ts.isClassDeclaration(stmt) && stmt.name) {
          for (const member of stmt.members) {
            const hit =
              (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) &&
              !!member.name && ts.isIdentifier(member.name) &&
              stillMissing.includes(member.name.text);
            if (hit) {
              const cn = stmt.name.text;
              if (!candidates.has(cn)) candidates.set(cn, stmt);
            }
          }
        }
      }

      if (candidates.size === 1) {
        const entry = Array.from(candidates.entries())[0];
        classDecl = entry[1];
        targetClass = entry[0];
        for (const member of classDecl.members) {
          if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && stillMissing.includes(member.name.text)) {
            const mods = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
            if (mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.StaticKeyword)) {
              return { ok: false, message: '暂不支持拆分 static 方法: ' + targetClass + '#' + member.name.text };
            }
            extractedNodes.push(member);
            extractedMethodNames.add(member.name.text);
            foundNames.add(member.name.text);
          } else if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && stillMissing.includes(member.name.text)) {
            const mods = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
            if (mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.StaticKeyword)) {
              return { ok: false, message: '暂不支持拆分 static 属性: ' + targetClass + '#' + member.name.text };
            }
            if (mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {
              return { ok: false, message: '暂不支持拆分非 public 属性: ' + targetClass + '#' + member.name.text };
            }
            extractedNodes.push(member);
            foundNames.add(member.name.text);
          }
        }
      } else if (candidates.size > 1) {
        return { ok: false, message: '多个类含同名成员 ' + stillMissing.join(', ') + '，请用 --class <name> 指定。候选: ' + Array.from(candidates.keys()).join(', ') };
      } else {
        const topFns: string[] = [];
        const classMethods: string[] = [];
        for (const stmt of sf.statements) {
          if (ts.isFunctionDeclaration(stmt) && stmt.name) topFns.push(stmt.name.text);
          if (ts.isClassDeclaration(stmt) && stmt.name) {
            for (const member of stmt.members) {
              if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) classMethods.push(stmt.name.text + '#' + member.name.text);
            }
          }
        }
        return {
          ok: false,
          message: '未找到: ' + stillMissing.join(', ') + '\n可用节点:\n  顶层函数: ' + (topFns.join(', ') || '(无)') + '\n  类方法: ' + (classMethods.join(', ') || '(无)'),
        };
      }
    }
  }

  if (extractedNodes.length === 0) {
    return { ok: false, message: '未找到任何指定的节点' };
  }

  // ═══════════════════════════════════════════════════════════
  // P1-3: 收集 impl 里的 this.xxx，检查是否访问了未拆的 private member
  // ═══════════════════════════════════════════════════════════
  const thisAccesses = new Set<string>();
  function walkForThisAccesses(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
      thisAccesses.add(node.name.text);
    }
    ts.forEachChild(node, walkForThisAccesses);
  }
  for (const n of extractedNodes) walkForThisAccesses(n);

  const warnings: string[] = [];
  if (classDecl) {
    const privateMethods = new Set<string>();
    const privateFields = new Set<string>();
    for (const member of classDecl.members) {
      const mods = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
      const isPrivate = mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword);
      if (!isPrivate) continue;
      if ((ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) && member.name && ts.isIdentifier(member.name)) {
        if (!extractedMethodNames.has(member.name.text)) privateMethods.add(member.name.text);
      } else if (ts.isPropertyDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
        if (!extractedMethodNames.has(member.name.text)) privateFields.add(member.name.text);
      }
    }

    const badMethodAccess: string[] = [];
    for (const name of thisAccesses) {
      if (privateMethods.has(name)) badMethodAccess.push(name);
    }
    if (badMethodAccess.length > 0) {
      return {
        ok: false,
        message: '以下 private/protected 方法被拆分方法的 impl 调用，但未一起拆分（impl 是模块级函数，TS 无法访问 private）：\n'
          + badMethodAccess.map(n => '  - ' + n + ' (private method)').join('\n') + '\n'
          + '💡 请用 --name 一并指定这些方法，或将其改为 public',
      };
    }

    for (const name of thisAccesses) {
      if (privateFields.has(name)) {
        warnings.push('impl 访问了 private 属性 this.' + name + '，TS 可能报 TS2341，请在 impl 里用 (this as any).' + name + ' 或加 @ts-expect-error');
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // P0-1: 收集 impl 里引用的自由标识符
  // ═══════════════════════════════════════════════════════════
  function collectFreeIdentifiers(nodes: ts.Node[]): Set<string> {
  // P0_1_visit_signature: 访问参数类型 / 返回类型 / 类型参数，不只看 body
  const free = new Set<string>();

  function collectPatternNames(name: ts.BindingName, into: Set<string>): void {
    if (ts.isIdentifier(name)) { into.add(name.text); return; }
    for (const el of name.elements) {
      if (ts.isBindingElement(el)) collectPatternNames(el.name, into);
    }
  }

  function collectLocalDecls(node: ts.Node, into: Set<string>): void {
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        collectPatternNames(d.name, into);
      }
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      into.add(node.name.text);
    } else if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause) {
        if (clause.name) into.add(clause.name.text);
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) into.add(clause.namedBindings.name.text);
          else if (ts.isNamedImports(clause.namedBindings)) {
            for (const el of clause.namedBindings.elements) into.add(el.name.text);
          }
        }
      }
    } else if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) {
      into.add(node.name.text);
    }
  }

  function visit(node: ts.Node, scope: Set<string>): void {
    if (ts.isImportDeclaration(node) || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) return;

    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isConstructorDeclaration(node)) {
      const newScope = new Set(scope);
      if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) newScope.add(node.name.text);
      if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) newScope.add(node.name.text);
      for (const p of node.parameters) collectPatternNames(p.name, newScope);

      if (node.body && ts.isBlock(node.body)) {
        for (const stmt of node.body.statements) collectLocalDecls(stmt, newScope);
      }

      for (const p of node.parameters) {
        if (p.type) visit(p.type, newScope);
        if (p.initializer) visit(p.initializer, newScope);
      }
      if (node.type) visit(node.type, newScope);
      if (node.typeParameters) {
        for (const tp of node.typeParameters) visit(tp, newScope);
      }

      if (node.body) visit(node.body, newScope);
      return;
    }

    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (scope.has(name)) return;
      const p = node.parent;
      if (p && ts.isPropertyAccessExpression(p) && p.name === node) return;
      if (p && ts.isPropertyAssignment(p) && p.name === node) return;
      if (p && ts.isMethodDeclaration(p) && p.name === node) return;
      if (p && ts.isPropertyDeclaration(p) && p.name === node) return;
      if (p && ts.isVariableDeclaration(p) && p.name === node) return;
      if (p && ts.isParameter(p)) return;
      if (p && ts.isTypeReferenceNode(p) && (p.typeName === node)) { free.add(name); return; }
      if (p && ts.isTypeParameterDeclaration(p) && p.name === node) return;
      if (p && ts.isInterfaceDeclaration(p) && p.name === node) return;
      if (p && ts.isTypeAliasDeclaration(p) && p.name === node) return;
      if (p && ts.isEnumDeclaration(p) && p.name === node) return;
      if (p && ts.isBindingElement(p)) return;
      if (p && ts.isQualifiedName(p) && p.left === node) return;
      free.add(name);
      return;
    }
    ts.forEachChild(node, (c) => visit(c, scope));
  }
  for (const n of nodes) visit(n, new Set());
  return free;
}

  const freeIdentifiers = collectFreeIdentifiers(extractedNodes);

  // 从原文件挑出匹配的 import
  function collectImportsFor(sf: ts.SourceFile, names: Set<string>): string[] {
  // P0_1_preserve_type_only: 保留 import type 语义
  const result: string[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    const moduleSpec = stmt.moduleSpecifier.getText(sf);
    const isTypeOnlyClause = clause.isTypeOnly === true;

    const defaultName: string | null = clause.name && names.has(clause.name.text) ? clause.name.text : null;
    let namespaceName: string | null = null;
    const named: { imported: string; local: string; isTypeOnly: boolean }[] = [];

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        if (names.has(clause.namedBindings.name.text)) namespaceName = clause.namedBindings.name.text;
      } else if (ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          const localName = el.name.text;
          if (names.has(localName)) {
            const importedName = (el.propertyName || el.name).text;
            named.push({ imported: importedName, local: localName, isTypeOnly: el.isTypeOnly === true });
          }
        }
      }
    }

    if (!defaultName && !namespaceName && named.length === 0) continue;

    // 生成 import 前缀
    const parts: string[] = [];
    if (defaultName) parts.push(defaultName);
    if (namespaceName) parts.push('* as ' + namespaceName);
    if (named.length > 0) {
      // 每个 specifier 可能独立 type
      const anyNonType = named.some(x => !x.isTypeOnly);
      // 若 clause 是 type-only，所有 specifier 都是 type（不需要 per-specifier type）
      // 否则 per-specifier type 保留
      const specStr = named.map(x => {
        const prefix = (!isTypeOnlyClause && x.isTypeOnly) ? 'type ' : '';
        return prefix + (x.imported === x.local ? x.imported : x.imported + ' as ' + x.local);
      }).join(', ');
      parts.push('{ ' + specStr + ' }');
    }

    const typeKw = isTypeOnlyClause ? 'type ' : '';
    const importStmt = 'import ' + typeKw + parts.join(', ') + ' from ' + moduleSpec + ';';
    result.push(importStmt);
  }
  return result;
}

  const copiedImports = collectImportsFor(sf, freeIdentifiers);

  // P1-4: 未定义标识符检测（warnings）
  const fileLocalNames = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name) fileLocalNames.add(clause.name.text);
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) fileLocalNames.add(clause.namedBindings.name.text);
        else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) fileLocalNames.add(el.name.text);
        }
      }
    } else if ((ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
      fileLocalNames.add(stmt.name.text);
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      fileLocalNames.add(stmt.name.text);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) fileLocalNames.add(d.name.text);
      }
    }
  }

  if (targetClass) fileLocalNames.add(targetClass);
  const GLOBALS = new Set([
    'window', 'document', 'console', 'globalThis', 'self', 'navigator', 'location',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask',
    'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Math', 'Date', 'JSON',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'RegExp', 'Error', 'Symbol', 'BigInt',
    'Function', 'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array',
    'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array',
    'Infinity', 'NaN', 'undefined', 'null', 'this', 'void',
    'Event', 'EventTarget', 'CustomEvent', 'HTMLElement', 'Element', 'Node',
    'Request', 'Response', 'fetch', 'URL', 'URLSearchParams',
  ]);

  // 把原 import 声明里出现的模块相关标识符（如 React）也算进来
  for (const n of copiedImports) {
    // 粗略：从 import 语句里抽出 local names
    const m = n.match(/import\s+(?:(\w+)\s*,?\s*)?(?:\*\s+as\s+(\w+))?(?:\s*\{\s*([^}]+)\})?/);
    if (m) {
      if (m[1]) fileLocalNames.add(m[1]);
      if (m[2]) fileLocalNames.add(m[2]);
      if (m[3]) {
        for (const part of m[3].split(',')) {
          const asMatch = part.trim().match(/(\w+)\s+as\s+(\w+)/);
          if (asMatch) fileLocalNames.add(asMatch[2]);
          else if (part.trim()) fileLocalNames.add(part.trim());
        }
      }
    }
  }

  for (const name of freeIdentifiers) {
    if (fileLocalNames.has(name)) continue;
    if (GLOBALS.has(name)) continue;
    warnings.push('impl 引用了未定义标识符: ' + name + '（可能来自 .d.ts 或全局声明，请确认新文件能访问到）');
  }

  // ═══════════════════════════════════════════════════════════
  // P0-2: 生成新文件（所有方法都走薄壳 + Impl 后缀）
  // ═══════════════════════════════════════════════════════════
  const newFileLines: string[] = [];
  const importNames: string[] = [];

  if (targetClass) {
    newFileLines.push("import type { " + targetClass + " } from './" + basename(filePath).replace(/\.ts$/, '.js') + "';");
    for (const imp of copiedImports) newFileLines.push(imp);
    newFileLines.push('');
  } else {
    for (const imp of copiedImports) newFileLines.push(imp);
    if (copiedImports.length > 0) newFileLines.push('');
  }

  const removedRanges: { start: number, end: number, text?: string }[] = [];

  for (const node of extractedNodes) {
    let name = '';
    let exportName = '';
    let isMethod = false;

    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      name = node.name.text;
      exportName = name + 'Impl';
      isMethod = true;
    } else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      name = node.name.text;
      exportName = name;
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      name = node.name.text;
      exportName = name;
    } else {
      continue;
    }

    let text = original.slice(node.getFullStart(), node.getEnd()).trim();
    const comments = (() => {
      const m = text.match(/^(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)+/);
      return m ? m[0] : '';
    })();

    if (targetClass && ts.isMethodDeclaration(node)) {
      const params = node.parameters.map(p => p.getText(sf)).join(', ');
      const typeParams = node.typeParameters ? '<' + node.typeParameters.map(t => t.getText(sf)).join(', ') + '>' : '';
      const returnType = node.type ? ': ' + node.type.getText(sf) : '';
      const mods = node.modifiers ?? [];
      const isAsync = mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword);
      const isGenerator = node.asteriskToken !== undefined;
      const fnKeyword = (isAsync ? 'async function' : 'function') + (isGenerator ? '*' : '');

      let bodyStr = '{}';
      if (node.body && ts.isBlock(node.body)) {
        const inner = node.body.statements.map(st => st.getText(sf)).join('\n');
        const dedented = dedent(inner).trim();
        bodyStr = '{\n  ' + dedented.replace(/\n/g, '\n  ') + '\n}';
      }

      const allParams = 'this: ' + targetClass + (params ? ', ' + params : '');
      text = comments + 'export ' + fnKeyword + ' ' + exportName + typeParams + '(' + allParams + ')' + returnType + ' ' + bodyStr;

      importNames.push(exportName);

      // 生成薄壳（所有方法，不管修饰符）
      const indent = getIndentAt(original, node.getStart(sf));
      const shell = generateMethodShell(node, sf, exportName, indent);
      removedRanges.push({ start: node.getFullStart(), end: node.getEnd(), text: '\n' + shell });
    } else if (targetClass && ts.isPropertyDeclaration(node)) {
      const mods = node.modifiers ?? [];
      const isAsync = mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.AsyncKeyword);
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
        const fnKw = isAsync ? 'async function' : 'function';
        text = comments + 'export const ' + exportName + ' = ' + fnKw + '(this: ' + targetClass + (params ? ', ' + params : '') + ')' + returnType + ' ' + bodyStr + ';';
      } else {
        text = comments + 'export const ' + exportName + ' = ' + node.initializer?.getText(sf) + ';';
      }
      importNames.push(exportName);
      removedRanges.push({ start: node.getFullStart(), end: node.getEnd() });

      // 属性薄壳：以 class field 转发
      const indent = getIndentAt(original, node.getStart(sf));
      const isPublic = !mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword);
      const modsText = isPublic ? '' : (mods.find(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)?.getText(sf) ?? '');
      const typeAnn = node.type ? ': ' + node.type.getText(sf) : '';
      const fieldShell = indent + (modsText ? modsText + ' ' : '') + name + typeAnn + ' = ' + exportName + '.bind(this);';
      removedRanges.push({ start: node.getStart(sf), end: node.getStart(sf), text: '' }); // 占位，实际字段在下面 merged
      // 简化：字段也走 shell
      removedRanges[removedRanges.length - 2].text = '\n' + fieldShell;
    } else if (!targetClass) {
      // 顶层函数：仍保持 export
      if (!text.startsWith('export ')) text = 'export ' + text;
      importNames.push(exportName);
      removedRanges.push({ start: node.getFullStart(), end: node.getEnd() });
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

  removedRanges.sort((a, b) => b.start - a.start);
  let origText = original;
  for (const r of removedRanges) {
    const replacement = r.text !== undefined ? r.text : '';
    origText = origText.slice(0, r.start) + replacement + origText.slice(r.end);
  }

  const newBaseName = basename(newFileName).replace(/\.ts$/, '.js');
  if (targetClass) {
    // P0-2: 全薄壳，无 Object.assign
    const importStmt = 'import { ' + importNames.join(', ') + " } from './" + newBaseName + "';";
    origText = importStmt + '\n' + origText;
  } else {
    const hasExport = extractedNodes.some(n => {
      if (!ts.canHaveModifiers(n)) return false;
      const mods = ts.getModifiers(n);
      return mods ? mods.some((m: ts.ModifierLike) => m.kind === ts.SyntaxKind.ExportKeyword) : false;
    });
    const importStmt = 'import { ' + importNames.join(', ') + " } from './" + newBaseName + "';";
    const reExport = hasExport ? '\nexport { ' + importNames.join(', ') + ' };\n' : '';
    origText = importStmt + '\n' + origText + reExport;
  }

  origText = origText.replace(/\n\s*\n\s*\n/g, '\n\n');

  const origSyntaxErrors = checkSyntax(filePath, origText);
  if (origSyntaxErrors.length > 0) {
    writeFileSync(fullNewPath, '', 'utf-8');
    return { ok: false, message: '原文件移除代码后语法错误: ' + origSyntaxErrors.join('; ') };
  }
  writeFileSync(filePath, origText, 'utf-8');

  const warnMsg = warnings.length > 0 ? '\n⚠ 注意:\n' + warnings.map(w => '  - ' + w).join('\n') : '';
  return {
    ok: true,
    message: '已拆分 ' + extractedNodes.length + ' 个成员到 ' + newFileName + '（全部走薄壳）' + warnMsg,
  };
}



function generateMethodShell(node: ts.MethodDeclaration, sf: ts.SourceFile, implName: string, indent: string): string {
  const name = (node.name as ts.Identifier).text;
  const mods = (node.modifiers ?? []).map(m => m.getText(sf)).join(' ');
  const params = node.parameters.map(p => p.getText(sf)).join(', ');

  const argNames: string[] = [];
  for (const p of node.parameters) {
    if (!ts.isIdentifier(p.name)) {
      return [
        indent + (mods ? mods + ' ' : '') + name + '(...args: any[]) {',
        indent + '  return ' + implName + '.apply(this, args);',
        indent + '}',
      ].join('\n');
    }
    argNames.push(p.name.text);
  }

  const typeParams = node.typeParameters ? '<' + node.typeParameters.map(t => t.getText(sf)).join(', ') + '>' : '';
  const returnType = node.type ? ': ' + node.type.getText(sf) : '';
  const isVoid = !!(node.type && node.type.kind === ts.SyntaxKind.VoidKeyword);

  const callArgs = argNames.length > 0 ? ', ' + argNames.join(', ') : '';
  const callExpr = implName + '.call(this' + callArgs + ')';
  const bodyLine = isVoid ? indent + '  ' + callExpr + ';' : indent + '  return ' + callExpr + ';';

  return [
    indent + (mods ? mods + ' ' : '') + name + typeParams + '(' + params + ')' + returnType + ' {',
    bodyLine,
    indent + '}',
  ].join('\n');
}

