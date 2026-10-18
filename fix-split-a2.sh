#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[ -f src/split.ts ] || { echo "❌ 缺少 src/split.ts"; exit 1; }
cp src/split.ts "src/split.ts.bak.$(date +%Y%m%d-%H%M%S)"

cat > .fix-split-a2.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/split.ts';
let s = readFileSync(F, 'utf8');

// ── 幂等：A1 已应用？
if (s.includes('暂不支持拆分 static 方法')) {
  console.log('  · A1：已应用，跳过');
} else {
  console.log('  ⚠ A1 未检测到，请先跑 fix-split-v2.sh 或检查 split.ts');
}

// ── 幂等：A2 已应用？
if (s.includes('stillMissing = targets.filter')) {
  console.log('  · A2：已应用，跳过');
  process.exit(0);
}

const lines = s.split('\n');

// 定位起点：唯一的 "} else {"
let elseIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '} else {') { elseIdx = i; break; }
}
if (elseIdx === -1) {
  console.error('❌ 找不到 "} else {"，split.ts 结构异常。请贴：sed -n "25,60p" src/split.ts');
  process.exit(1);
}

// 定位终点：else 块之后的 "if (extractedNodes.length === 0) {"
let endIdx = -1;
for (let i = elseIdx + 1; i < lines.length; i++) {
  if (lines[i].trim() === 'if (extractedNodes.length === 0) {') { endIdx = i; break; }
}
if (endIdx === -1) {
  console.error('❌ 找不到 "if (extractedNodes.length === 0) {"，split.ts 结构异常。');
  console.error('   当前 else 块内容：');
  console.error(lines.slice(elseIdx, elseIdx + 15).map((l, i) => `   ${elseIdx + i + 1}: ${l}`).join('\n'));
  process.exit(1);
}

// 内容校验：else 块必须包含 FunctionDeclaration 扫描
const elseBlock = lines.slice(elseIdx, endIdx).join('\n');
if (!elseBlock.includes('ts.isFunctionDeclaration(stmt)')) {
  console.error('❌ else 块内容不符合预期（找不到 ts.isFunctionDeclaration(stmt)）：');
  console.error(elseBlock);
  process.exit(1);
}

console.log(`  定位: elseIdx=${elseIdx + 1} (${lines[elseIdx].trim()}), endIdx=${endIdx + 1} (${lines[endIdx].trim()})`);

// ── 新 else 块 ──
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
];

const newLines = [
  ...lines.slice(0, elseIdx),
  ...A2_NEW,
  '',
  ...lines.slice(endIdx),
];

writeFileSync(F, newLines.join('\n'));
console.log('  ✓ A2：else 分支已升级为自动识别类方法');
console.log('✓ src/split.ts 更新完成');
MJS_EOF

node .fix-split-a2.mjs
rm .fix-split-a2.mjs
