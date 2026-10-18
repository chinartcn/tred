#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[ -f src/split.ts ] || { echo "❌ 缺少 src/split.ts"; exit 1; }
cp src/split.ts "src/split.ts.bak.$(date +%Y%m%d-%H%M%S)"

cat > .fix-split-v2.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/split.ts';
let s = readFileSync(F, 'utf8');

// ── A1: --class 路径加 static/private/protected 拒绝 ──
const A1_OLD = [
  "      // 1. 标准方法: renderNode() {}",
  "      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && targets.includes(member.name.text)) {",
  "        extractedNodes.push(member);",
  "        removedRanges.push({ start: member.getFullStart(), end: member.getEnd() });",
  "        foundNames.add(member.name.text);",
  "      }",
].join('\n');

const A1_NEW = [
  "      // 1. 标准方法: renderNode() {}",
  "      if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && targets.includes(member.name.text)) {",
  "        const mods = member.modifiers ?? [];",
  "        if (mods.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) {",
  "          return { ok: false, message: '暂不支持拆分 static 方法: ' + targetClass + '#' + member.name.text };",
  "        }",
  "        if (mods.some(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {",
  "          return { ok: false, message: '暂不支持拆分非 public 方法: ' + targetClass + '#' + member.name.text };",
  "        }",
  "        extractedNodes.push(member);",
  "        removedRanges.push({ start: member.getFullStart(), end: member.getEnd() });",
  "        foundNames.add(member.name.text);",
  "      }",
].join('\n');

if (s.includes(A1_OLD)) {
  s = s.replace(A1_OLD, A1_NEW);
  console.log('  ✓ A1：--class 路径已加修饰符拒绝');
} else if (s.includes(A1_NEW)) {
  console.log('  · A1：已存在，跳过');
} else {
  console.error('  ❌ A1 锚点未找到，split.ts 可能已被其它改动影响');
  process.exit(1);
}

// ── A2: else 分支：自动识别类方法 ──
const A2_OLD = [
  "  } else {",
  "    for (const stmt of sf.statements) {",
  "      if (ts.isFunctionDeclaration(stmt) && stmt.name && targets.includes(stmt.name.text)) {",
  "        extractedNodes.push(stmt);",
  "        removedRanges.push({ start: stmt.getFullStart(), end: stmt.getEnd() });",
  "        foundNames.add(stmt.name.text);",
  "      }",
  "    }",
  "  }",
].join('\n');

const A2_NEW = [
  "  } else {",
  "    // 1. 先扫顶层 FunctionDeclaration",
  "    for (const stmt of sf.statements) {",
  "      if (ts.isFunctionDeclaration(stmt) && stmt.name && targets.includes(stmt.name.text)) {",
  "        extractedNodes.push(stmt);",
  "        removedRanges.push({ start: stmt.getFullStart(), end: stmt.getEnd() });",
  "        foundNames.add(stmt.name.text);",
  "      }",
  "    }",
  "",
  "    // 2. 未全部找到 → 扫所有类 members，自动识别类方法",
  "    const stillMissing = targets.filter(t => !foundNames.has(t));",
  "    if (stillMissing.length > 0) {",
  "      const candidates = new Map<string, ts.ClassDeclaration>();",
  "      for (const stmt of sf.statements) {",
  "        if (ts.isClassDeclaration(stmt) && stmt.name) {",
  "          for (const member of stmt.members) {",
  "            const hit =",
  "              (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) &&",
  "              !!member.name && ts.isIdentifier(member.name) &&",
  "              stillMissing.includes(member.name.text);",
  "            if (hit) {",
  "              const cn = stmt.name.text;",
  "              if (!candidates.has(cn)) candidates.set(cn, stmt);",
  "            }",
  "          }",
  "        }",
  "      }",
  "",
  "      if (candidates.size === 1) {",
  "        const entry = Array.from(candidates.entries())[0];",
  "        classDecl = entry[1];",
  "        targetClass = entry[0];",
  "        for (const member of classDecl.members) {",
  "          if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && stillMissing.includes(member.name.text)) {",
  "            const mods = member.modifiers ?? [];",
  "            if (mods.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) {",
  "              return { ok: false, message: '暂不支持拆分 static 方法: ' + targetClass + '#' + member.name.text };",
  "            }",
  "            if (mods.some(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {",
  "              return { ok: false, message: '暂不支持拆分非 public 方法: ' + targetClass + '#' + member.name.text };",
  "            }",
  "            extractedNodes.push(member);",
  "            removedRanges.push({ start: member.getFullStart(), end: member.getEnd() });",
  "            foundNames.add(member.name.text);",
  "          } else if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && stillMissing.includes(member.name.text)) {",
  "            extractedNodes.push(member);",
  "            removedRanges.push({ start: member.getFullStart(), end: member.getEnd() });",
  "            foundNames.add(member.name.text);",
  "          }",
  "        }",
  "      } else if (candidates.size > 1) {",
  "        return { ok: false, message: '多个类含同名成员 ' + stillMissing.join(', ') + '，请用 --class <name> 指定。候选: ' + Array.from(candidates.keys()).join(', ') };",
  "      } else {",
  "        const topFns: string[] = [];",
  "        const classMethods: string[] = [];",
  "        for (const stmt of sf.statements) {",
  "          if (ts.isFunctionDeclaration(stmt) && stmt.name) topFns.push(stmt.name.text);",
  "          if (ts.isClassDeclaration(stmt) && stmt.name) {",
  "            for (const member of stmt.members) {",
  "              if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) classMethods.push(stmt.name.text + '#' + member.name.text);",
  "            }",
  "          }",
  "        }",
  "        return {",
  "          ok: false,",
  "          message: '未找到: ' + stillMissing.join(', ') + '\\n可用节点:\\n  顶层函数: ' + (topFns.join(', ') || '(无)') + '\\n  类方法: ' + (classMethods.join(', ') || '(无)'),",
  "        };",
  "      }",
  "    }",
  "  }",
].join('\n');

if (s.includes(A2_OLD)) {
  s = s.replace(A2_OLD, A2_NEW);
  console.log('  ✓ A2：else 分支已升级为自动识别类方法');
} else if (s.includes(A2_NEW)) {
  console.log('  · A2：已存在，跳过');
} else {
  console.error('  ❌ A2 锚点未找到，split.ts 可能已被其它改动影响');
  process.exit(1);
}

writeFileSync(F, s);
console.log('✓ src/split.ts 更新完成');
MJS_EOF

node .fix-split-v2.mjs
rm .fix-split-v2.mjs
