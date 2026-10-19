import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative, resolve, basename } from 'node:path';

interface DeclNode {
  id: string;
  name: string;
  text: string;
  isExported: boolean;
  refs: Set<string>; // 立即引用的标识符
}

export function chopFile(filePath: string, outDir: string): { ok: boolean; message: string } {
  const source = ts.createSourceFile(filePath, readFileSync(filePath, 'utf-8'), ts.ScriptTarget.Latest, true);
  
  // 1. 解析与收集
  const originalExports = new Set<string>();
  const nodes = new Map<string, DeclNode>();
  const allRefsCount = new Map<string, number>();
  const rootStatements: string[] = []; // 存放入口代码

  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt)) continue; // 暂时跳过 import 处理，实际应复用到每个文件
    let name = '';
    let isExported = false;
    
    const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : [];
    if (mods?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) isExported = true;

    if (ts.isFunctionDeclaration(stmt) && stmt.name) name = stmt.name.text;
    else if (ts.isVariableStatement(stmt)) {
      const decl = stmt.declarationList.declarations[0];
      if (ts.isIdentifier(decl.name)) name = decl.name.text;
    } else if (ts.isClassDeclaration(stmt) && stmt.name) name = stmt.name.text;
    else if (ts.isExpressionStatement(stmt) && ts.isBinaryExpression(stmt.expression) && ts.isPropertyAccessExpression(stmt.expression.left)) {
      name = 'global_' + stmt.expression.left.name.text; // 如 window.foo = ...
      isExported = true; // 全局注入默认视为对外导出
    }

    if (!name) {
      // 无名的顶层语句（如事件绑定、函数调用、IIFE），作为入口代码保留在 index.ts
      rootStatements.push(stmt.getText(source));
      continue;
    }
    // 记录原文件中真正导出的符号
    if (isExported) {
      originalExports.add(name);
    }

    const refs = new Set<string>();
    // 2. 区分立即引用与延迟引用
    // 🚀 修复：静态分析时，模块间的所有内部引用都需要 import，不能再区分延迟/立即
    function visit(node: ts.Node) {
      if (ts.isIdentifier(node) && node.text !== name) {
        refs.add(node.text);
        allRefsCount.set(node.text, (allRefsCount.get(node.text) || 0) + 1);
      }
      ts.forEachChild(node, visit);
    }
    visit(stmt);

    nodes.set(name, { id: name, name, text: stmt.getText(source), isExported, refs });
  }

  // 3. 聚类与拓扑排序（改进版图连通分量 + 提取枢纽常量）
  // 枢纽变量规则：如果是 VariableStatement（常量/配置），或者引用数 >= 2 的，强制留在 index.ts
  const hubs = new Set<string>();
  for (const [id, node] of nodes.entries()) {
    if (id.startsWith('global_') || node.text.startsWith('const ') || node.text.startsWith('let ')) {
      hubs.add(id); // 所有顶层变量统统不拆走
    } else if ((allRefsCount.get(id) || 0) >= 2) {
      hubs.add(id);
    }
  }

  // 简单聚类：把有相互引用（无论立即还是延迟）的节点聚合成无向连通图
  const groups: DeclNode[][] = [];
  const visited = new Set<string>();

  for (const [id, node] of nodes.entries()) {
    if (visited.has(id) || hubs.has(id)) continue;
    
    const group: DeclNode[] = [];
    const queue = [node];
    visited.add(id);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      group.push(cur);
      
      // 正向依赖
      for (const ref of cur.refs) {
        const target = nodes.get(ref);
        if (target && !visited.has(ref) && !hubs.has(ref)) {
          visited.add(ref);
          queue.push(target);
        }
      }
      
      // 反向依赖（谁引用了当前节点，也拉进来）
      for (const [otherId, otherNode] of nodes.entries()) {
        if (!visited.has(otherId) && !hubs.has(otherId) && otherNode.refs.has(cur.id)) {
          visited.add(otherId);
          queue.push(otherNode);
        }
      }
    }
    if (group.length > 0) groups.push(group);
  }

  // 4. 生成文件与引导器 (bootstrap)
  mkdirSync(outDir, { recursive: true });
  const indexImports: string[] = [];
  const indexExports: string[] = [];

  // 预先解析所有 import，区分 index.ts 用（保持原样）和 chunk 用（重算路径）
  const importMapIndex = new Map<string, string>();
  const importMapChunk = new Map<string, string>();
  const origDir = dirname(filePath);
  const outDirAbs = resolve(outDir);

  const originalImports = source.statements.filter(ts.isImportDeclaration).map(s => {
    const stmtStrIndex = s.getText(source); // 原封不动，给 index.ts 用
    let stmtStrChunk = stmtStrIndex;
    
    const clause = s.importClause;
    const moduleSpec = s.moduleSpecifier;
    
    // 专门给 chunk 生成重算路径的 import
    if (moduleSpec && ts.isStringLiteral(moduleSpec) && moduleSpec.text.startsWith('.')) {
      const absImportPath = resolve(origDir, moduleSpec.text);
      let newRelPath = relative(outDirAbs, absImportPath).replace(/\\/g, '/');
      if (!newRelPath.startsWith('.')) newRelPath = './' + newRelPath;
      stmtStrChunk = stmtStrIndex.replace(moduleSpec.getText(source), JSON.stringify(newRelPath));
    }

    if (clause) {
      if (clause.name) { importMapIndex.set(clause.name.text, stmtStrIndex); importMapChunk.set(clause.name.text, stmtStrChunk); }
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) { importMapIndex.set(clause.namedBindings.name.text, stmtStrIndex); importMapChunk.set(clause.namedBindings.name.text, stmtStrChunk); }
        else if (ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) { importMapIndex.set(el.name.text, stmtStrIndex); importMapChunk.set(el.name.text, stmtStrChunk); }
        }
      }
    }
    return stmtStrIndex;
  });

  // 辅助函数：提取代码中用到的 import（传入对应的 map）
  function getUsedImports(codeText: string, map: Map<string, string>): string {
    const used = new Set<string>();
    for (const [localName, stmtStr] of map.entries()) {
      // 🚀 核心修复：用 includes 代替正则，避免下划线开头的标识符（如 _dirname）被  误判
      if (codeText.includes(localName)) used.add(stmtStr);
    }
    return Array.from(used).join('\n') + (used.size > 0 ? '\n\n' : '');
  }

  // 🚀 v3.10.1 核心修复：建立符号到文件的依赖映射，解决 Chunk 相互引用问题
  const symbolToFile = new Map<string, string>();
  const symbolToNode = new Map<string, DeclNode>();

  // 先把所有节点登记
  groups.forEach((group, i) => {
    const fileName = `chunk_${i}.ts`;
    for (const node of group) {
      symbolToFile.set(node.name, fileName);
      symbolToNode.set(node.name, node);
    }
  });

  groups.forEach((group, i) => {
    const fileName = `chunk_${i}.ts`;
    const filePathOut = join(outDir, fileName);
    
    const chunkImports = new Set<string>();
    let bodyContent = '';

    for (const node of group) {
      // 🚨 只要被拆分走，一律强制加 export，否则别的 chunk 或原文件调用不到！
      let finalText = node.text;
      if (!finalText.startsWith('export ') && !finalText.startsWith('export default ')) {
        finalText = 'export ' + finalText;
      }
      bodyContent += finalText + '\n\n';
      
      // 检查该节点用到了哪些别的 chunk 里的符号，生成 import
      for (const ref of node.refs) {
        const targetFile = symbolToFile.get(ref);
        if (targetFile && targetFile !== fileName) {
          // 找到了跨 chunk 依赖，生成 import
          chunkImports.add(`import { ${ref} } from './${targetFile.replace('.ts', '.js')}';`);
        } else if (hubs.has(ref)) {
          // 依赖了留在 index 里的枢纽变量
          // 动态计算 chunk 目录到主入口文件所在目录的相对路径
          const entryName = basename(filePath);
          const relIndexPath = relative(outDirAbs, join(origDir, entryName)).replace(/\\/g, '/');
          const finalIndexPath = relIndexPath.startsWith('.') ? relIndexPath : './' + relIndexPath;
          chunkImports.add(`import { ${ref} } from '${finalIndexPath.replace('.ts', '.js')}';`);
        }
      }

      // 同时，主文件必须 import 它。注意这里要计算 chunk 目录相对于原文件的路径
      const relChunkPath = relative(dirname(filePath), join(outDir, fileName)).replace(/\\/g, '/');
      const finalRelPath = relChunkPath.startsWith('.') ? relChunkPath : './' + relChunkPath;
      indexImports.push(`import { ${node.name} } from '${finalRelPath.replace('.ts', '.js')}';`);
      // 只有原本就是导出的，才重新导出保持 API 兼容
      if (originalExports.has(node.name)) {
        indexExports.push(node.name);
      }
    }
    
    // 合并：原有的外部 import + 跨 chunk 的内部 import + 代码体
    const extImports = getUsedImports(bodyContent + Array.from(chunkImports).join('\n'), importMapChunk);
    const fileContent = extImports + Array.from(chunkImports).join('\n') + (chunkImports.size > 0 ? '\n\n' : '') + bodyContent;
    writeFileSync(filePathOut, fileContent, 'utf-8');
  });

  // 收集所有被拆出去的子模块的依赖，看看它们有没有引用留在 index.ts 的节点
  const usedByChunks = new Set<string>();
  groups.forEach(group => {
    group.forEach(node => {
      node.refs.forEach(ref => {
        if (hubs.has(ref) || rootStatements.some(s => s.includes(ref))) {
          usedByChunks.add(ref);
        }
      });
    });
  });

  // 处理枢纽变量与入口代码，留在 index.ts
  let hubContent = '';
  for (const hub of hubs) {
    const node = nodes.get(hub);
    if (node) {
      // 🚀 修复：只要被拆出去的 chunk 用到了，就必须加 export
      const mustExport = node.isExported || usedByChunks.has(node.name);
      let finalText = node.text;
      if (mustExport && !finalText.match(/^export\s/)) {
        finalText = 'export ' + finalText;
      }
      
      hubContent += finalText + '\n\n';
      // 只有原本就是导出的，才进入末尾的 export {} 列表
      if (originalExports.has(node.name)) {
        indexExports.push(node.name);
      }
    }
  }

  // 组装 index.ts
  const rootCode = rootStatements.join('\n\n');
  let indexContent = getUsedImports(hubContent + rootCode + indexImports.join('\n'), importMapIndex);
  indexContent += indexImports.join('\n') + '\n\n';
  indexContent += hubContent;
  
  if (rootStatements.length > 0) {
    indexContent += rootCode + '\n\n';
  }
  
  if (indexExports.length > 0) {
    indexContent += `export { ${indexExports.join(', ')} };\n`;
  }
  // 🚀 核心修复：把生成的入口直接覆盖原文件，千万别叫 index.ts，否则会误杀原有的 index.ts
  const targetIndexPath = join(dirname(filePath), basename(filePath));
  writeFileSync(targetIndexPath, indexContent, 'utf-8');
  // 覆盖原文件（或者输出到新文件，这里我们直接生成到 index.ts，并提示用户）

  return { ok: true, message: `已切割为 ${groups.length} 个模块，共提取 ${hubs.size} 个枢纽变量到 index.ts` };
}
