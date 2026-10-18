#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[ -f src/split.ts ] || { echo "❌ 缺少 src/split.ts"; exit 1; }
cp src/split.ts "src/split.ts.bak.$(date +%Y%m%d-%H%M%S)"
echo "已备份 src/split.ts"

cat > .fix-split-final.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/split.ts';
let text = readFileSync(F, 'utf8');

// ══════════════════════════════════════════════
// 1) 诊断
// ══════════════════════════════════════════════
console.log('\n=== 诊断 ===');

const A1_MARK = '暂不支持拆分 static 方法';
const a1Applied = text.includes(A1_MARK);
console.log('A1 拒绝逻辑:', a1Applied ? '✓ 已应用' : '✗ 未应用');

const A2_PARTIAL = 'stillMissing = targets.filter';
const A2_FULL = 'candidates = new Map<string, ts.ClassDeclaration>';
const a2Partial = text.includes(A2_PARTIAL);
const a2Full = text.includes(A2_FULL);
let a2Status = 'none';
if (a2Full) a2Status = 'full';
else if (a2Partial) a2Status = 'partial';
console.log('A2 自动识别:', a2Status === 'full' ? '✓ 完整应用'
            : a2Status === 'partial' ? '⚠ 部分残留'
            : '✗ 未应用');

let lines = text.split('\n');

function locateElse(ls) {
  let elseIdx = -1, endIdx = -1;
  for (let i = 0; i < ls.length; i++) if (ls[i].trim() === '} else {') { elseIdx = i; break; }
  for (let i = elseIdx + 1; i < ls.length; i++) if (ls[i].trim() === 'if (extractedNodes.length === 0) {') { endIdx = i; break; }
  return { elseIdx, endIdx };
}

{
  const pos = locateElse(lines);
  if (pos.elseIdx === -1 || pos.endIdx === -1) {
    console.log('else 块: ✗ 定位失败');
  } else {
    console.log('else 块: L' + (pos.elseIdx + 1) + ' → L' + (pos.endIdx + 1));
    if (a2Status !== 'full') {
      console.log('  当前内容:');
      const stop = Math.min(pos.endIdx, pos.elseIdx + 20);
      for (let i = pos.elseIdx; i <= stop; i++) {
        console.log('    ' + (i + 1) + ': ' + lines[i]);
      }
      if (pos.endIdx - pos.elseIdx > 20) {
        console.log('    ... (共 ' + (pos.endIdx - pos.elseIdx - 20) + ' 行省略)');
      }
    }
  }
}

// ══════════════════════════════════════════════
// 2) 修 A1
// ══════════════════════════════════════════════
console.log('\n=== 修复 ===');

if (a1Applied) {
  console.log('· A1: 已应用，跳过');
} else {
  let a1Line = -1;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.includes('ts.isMethodDeclaration(member)') && L.includes('targets.includes(member.name.text)')) {
      a1Line = i; break;
    }
  }
  if (a1Line === -1) {
    console.error('❌ A1: 找不到 ts.isMethodDeclaration(member) + targets.includes 的行');
    process.exit(1);
  }
  console.log('A1 目标: L' + (a1Line + 1) + ': ' + lines[a1Line].trim());

  const nextLine = lines[a1Line + 1] ?? '';
  if (nextLine.includes('const mods = member.modifiers')) {
    console.log('· A1: mods 逻辑已在，跳过');
  } else {
    const A1_INSERT = [
      "        const mods = member.modifiers ?? [];",
      "        if (mods.some(m => m.kind === ts.SyntaxKind.StaticKeyword)) {",
      "          return { ok: false, message: '暂不支持拆分 static 方法: ' + targetClass + '#' + member.name.text };",
      "        }",
      "        if (mods.some(m => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword)) {",
      "          return { ok: false, message: '暂不支持拆分非 public 方法: ' + targetClass + '#' + member.name.text };",
      "        }",
    ];
    lines.splice(a1Line + 1, 0, ...A1_INSERT);
    console.log('✓ A1: 已在 L' + (a1Line + 2) + ' 插入拒绝逻辑');
  }
}

// ══════════════════════════════════════════════
// 3) 修 A2
// ══════════════════════════════════════════════
text = lines.join('\n');
const stillFullA2 = text.includes(A2_FULL);

if (stillFullA2) {
  console.log('· A2: 已完整应用，跳过');
} else {
  lines = text.split('\n');
  const pos = locateElse(lines);
  if (pos.elseIdx === -1 || pos.endIdx === -1) {
    console.error('❌ A2: 无法定位 else 块');
    process.exit(1);
  }
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
    "        const topFns = [];",
    "        const classMethods = [];",
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
    ...lines.slice(0, pos.elseIdx),
    ...A2_NEW,
    '',
    ...lines.slice(pos.endIdx),
  ];
  lines = newLines;
  console.log('✓ A2: else 块已整块替换');
}

// ══════════════════════════════════════════════
// 4) 写回 + 验证
// ══════════════════════════════════════════════
writeFileSync(F, lines.join('\n'));

console.log('\n=== 验证 ===');
const final = readFileSync(F, 'utf8');
const okA1 = final.includes(A1_MARK);
const okA2 = final.includes(A2_FULL);
console.log('A1 拒绝逻辑:', okA1 ? '✓' : '✗');
console.log('A2 自动识别:', okA2 ? '✓' : '✗');
if (!okA1 || !okA2) {
  console.error('❌ 未全部到位，请贴上方诊断给我');
  process.exit(1);
}
console.log('\n✓ src/split.ts 已完成全部修复');
MJS_EOF

# 语法预检：纯 JS 能过 node --check
if ! node --check .fix-split-final.mjs 2>/dev/null; then
  echo "❌ .mjs 语法错误："
  node --check .fix-split-final.mjs || true
  rm -f .fix-split-final.mjs
  exit 1
fi

node .fix-split-final.mjs
rm .fix-split-final.mjs
