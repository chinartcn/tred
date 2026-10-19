#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

[ -f src/patch.ts ] || { echo "❌ 缺少 src/patch.ts"; exit 1; }
[ -f src/cli.ts ]   || { echo "❌ 缺少 src/cli.ts"; exit 1; }

cp src/patch.ts "src/patch.ts.bak.$(date +%Y%m%d-%H%M%S)"
cp src/cli.ts   "src/cli.ts.bak.$(date +%Y%m%d-%H%M%S)"
echo "已备份 src/patch.ts, src/cli.ts"

cat > .p0-2.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';

// ═══════════════════════════════════════════════════════════════
// patch.ts
// ═══════════════════════════════════════════════════════════════
{
  const F = 'src/patch.ts';
  let text = readFileSync(F, 'utf8');

  if (text.includes('P0_2_arbitration')) {
    console.log('· patch.ts P0-2 已应用，跳过');
  } else {
    // A: options 签名加 fuzzyMinMargin + force
    const A_OLD = `  options: { fuzzy?: boolean, fuzzyThreshold?: number, minRareTokens?: number, autoHeal?: boolean, html?: boolean } = {},`;
    const A_NEW = `  options: { fuzzy?: boolean, fuzzyThreshold?: number, minRareTokens?: number, autoHeal?: boolean, html?: boolean, fuzzyMinMargin?: number, force?: boolean } = {}, // P0_2_arbitration`;
    if (!text.includes(A_OLD)) { console.error('❌ patch.ts A 锚点未找到'); process.exit(1); }
    text = text.replace(A_OLD, A_NEW);
    console.log('  ✓ A: options 加 fuzzyMinMargin + force');

    // B: 收集 top 候选
    const B_OLD = `      let best: { score: number, rareHits: number, idx: number } | null = null;

      for (let i = startSearch; i <= endSearch; i++) {`;
    const B_NEW = `      // P0_2_arbitration: 收集所有候选用于仲裁
      const candidates: { score: number, rareHits: number, idx: number }[] = [];

      for (let i = startSearch; i <= endSearch; i++) {`;
    if (!text.includes(B_OLD)) { console.error('❌ patch.ts B 锚点未找到'); process.exit(1); }
    text = text.replace(B_OLD, B_NEW);
    console.log('  ✓ B: 收集候选池');

    // C: 循环内 push
    const C_OLD = `        if (!best || finalScore > best.score) best = { score: finalScore, rareHits, idx: i };
      }

      if (best) {`;
    const C_NEW = `        if (finalScore > 0) candidates.push({ score: finalScore, rareHits, idx: i });
      }

      // P0_2_arbitration: 排序 + 取 top2
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0] || null;
      const second = candidates[1] || null;

      if (best) {`;
    if (!text.includes(C_OLD)) { console.error('❌ patch.ts C 锚点未找到'); process.exit(1); }
    text = text.replace(C_OLD, C_NEW);
    console.log('  ✓ C: 排序取 top2');

    // D: 仲裁逻辑（在 best 判定后插入）
    const D_OLD = `        if (foundIdx === -1 && best.score >= fuzzyThreshold) {
          foundIdx = best.idx;
          console.log('  [tred patch] 模糊命中 (相似度 ' + (best.score * 100).toFixed(1) + '%, 行 ' + (foundIdx + 1) + ')');
        } else if (foundIdx === -1) {`;
    const D_NEW = `        // P0_2_arbitration: top1/top2 差距过小时拒绝（避免并列静默误伤）
        const minMargin = options.fuzzyMinMargin ?? 0.05;
        const force = options.force ?? false;
        let ambiguous = false;
        if (!force && second && best.score >= fuzzyThreshold) {
          const margin = best.score - second.score;
          if (margin < minMargin) ambiguous = true;
        }

        if (ambiguous) {
          const margin = best.score - second!.score;
          return {
            ok: false,
            message:
              '模糊匹配存在 ' + candidates.length + ' 个近似候选，可能"打错位置"。\\n'
              + '  top1: ' + (best.score * 100).toFixed(1) + '% @ L' + (best.idx + 1) + '\\n'
              + '  top2: ' + (second!.score * 100).toFixed(1) + '% @ L' + (second!.idx + 1) + '\\n'
              + '  margin: ' + (margin * 100).toFixed(1) + '% < ' + (minMargin * 100).toFixed(0) + '%\\n'
              + '  💡 缩小 hunk 上下文、提高 --fuzzy-threshold，或加 --force 强制接受 top1',
            suggestion: {
              line: best.idx + 1,
              score: best.score,
              context: currentLines.slice(Math.max(0, best.idx - 2), Math.min(currentLines.length, best.idx + oldBlock.length + 2)),
              reason: '存在并列候选，是否强制应用此处？（--force）',
            },
          };
        }

        if (foundIdx === -1 && best.score >= fuzzyThreshold) {
          foundIdx = best.idx;
          console.log('  [tred patch] 模糊命中 (相似度 ' + (best.score * 100).toFixed(1) + '%, 行 ' + (foundIdx + 1) + ', 候选 ' + candidates.length + ')');
        } else if (foundIdx === -1) {`;
    if (!text.includes(D_OLD)) { console.error('❌ patch.ts D 锚点未找到'); process.exit(1); }
    text = text.replace(D_OLD, D_NEW);
    console.log('  ✓ D: 仲裁逻辑');

    // E: autoHeal 也要 respect ambiguous（在 D 之前已加逻辑，但 autoHeal 判断要 skip ambiguous）
    const E_OLD = `        if (autoHeal && best.score >= fuzzyThreshold - 0.15) {`;
    const E_NEW = `        if (!ambiguous && autoHeal && best.score >= fuzzyThreshold - 0.15) {`;
    if (!text.includes(E_OLD)) { console.error('❌ patch.ts E 锚点未找到'); process.exit(1); }
    text = text.replace(E_OLD, E_NEW);
    console.log('  ✓ E: autoHeal 与仲裁兼容');

    writeFileSync(F, text);
    console.log('✓ patch.ts P0-2 完成');
  }
}

// ═══════════════════════════════════════════════════════════════
// cli.ts
// ═══════════════════════════════════════════════════════════════
{
  const F = 'src/cli.ts';
  let text = readFileSync(F, 'utf8');

  if (text.includes('P0_2_cli')) {
    console.log('· cli.ts P0-2 已应用，跳过');
    process.exit(0);
  }

  const OLD = `  const autoHeal = Boolean(flags['auto-heal']);
  const html = Boolean(flags.html);
  const res = applyPatch(file, patchText, { fuzzy, fuzzyThreshold, minRareTokens, autoHeal, html });`;

  const NEW = `  const autoHeal = Boolean(flags['auto-heal']);
  const html = Boolean(flags.html);
  // P0_2_cli: 多候选仲裁参数
  const fuzzyMinMargin = typeof flags['fuzzy-min-margin'] === 'string' ? parseFloat(flags['fuzzy-min-margin']) : undefined;
  const force = Boolean(flags.force);
  const res = applyPatch(file, patchText, { fuzzy, fuzzyThreshold, minRareTokens, autoHeal, html, fuzzyMinMargin, force });`;

  if (!text.includes(OLD)) { console.error('❌ cli.ts 锚点未找到'); process.exit(1); }
  text = text.replace(OLD, NEW);
  writeFileSync(F, text);
  console.log('✓ cli.ts P0-2 完成');
}
MJS_EOF

node --check .p0-2.mjs 2>/dev/null || { node --check .p0-2.mjs; rm -f .p0-2.mjs; exit 1; }
node .p0-2.mjs
rm -f .p0-2.mjs

# ═══════════════════════════════════════════════════════════════
# smoke.sh：追加用例 14-15
# ═══════════════════════════════════════════════════════════════
cat > .p0-2-smoke.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'smoke.sh';
let s = readFileSync(F, 'utf8');
if (s.includes('P0-2 多候选')) { console.log('· smoke 用例 14-15 已存在，跳过'); process.exit(0); }
const ANCHOR = 'process.stdout.write(`\\n${pass} passed, ${fail} failed\\n`);';
if (!s.includes(ANCHOR)) { console.error('❌ 汇总行锚点丢失'); process.exit(1); }
const ADD = [
  "// ── 14. P0-2 多候选仲裁：拒绝 ──",
  "t('P0-2 多候选：并列时拒绝', () => {",
  "  const dir = mk({ 'a.ts': [",
  "    'function dupA() {',",
  "    '  const FOO = 1;',",
  "    '  const BAR = 2;',",
  "    '}',",
  "    '',",
  "    'function dupB() {',",
  "    '  const FOO = 1;',",
  "    '  const BAR = 2;',",
  "    '}',",
  "    '',",
  "  ].join('\\n') });",
  "  const f = join(dir, 'a.ts');",
  "  const before = readFileSync(f, 'utf-8');",
  "  const diff = '@@ -2,2 +2,2 @@\\n-const FOO = 100;\\n-const BAR = 200;\\n+const FOO = 101;\\n+const BAR = 201;\\n';",
  "  const r = applyPatch(f, diff, { fuzzy: true, fuzzyThreshold: 0.8 });",
  "  assert.equal(r.ok, false, '应拒绝并列候选: ' + (r.message || ''));",
  "  assert.match(String(r.message), /多个近似候选|并列|ambig/i);",
  "  assert.equal(readFileSync(f, 'utf-8'), before, '不应修改文件');",
  "  rmSync(dir, { recursive: true });",
  "});",
  "",
  "// ── 15. P0-2 多候选仲裁：--force 强制接受 ──",
  "t('P0-2 多候选：--force 强制接受', () => {",
  "  const dir = mk({ 'a.ts': [",
  "    'function dupA() {',",
  "    '  const FOO = 1;',",
  "    '  const BAR = 2;',",
  "    '}',",
  "    '',",
  "    'function dupB() {',",
  "    '  const FOO = 1;',",
  "    '  const BAR = 2;',",
  "    '}',",
  "    '',",
  "  ].join('\\n') });",
  "  const f = join(dir, 'a.ts');",
  "  const diff = '@@ -2,2 +2,2 @@\\n-const FOO = 100;\\n-const BAR = 200;\\n+const FOO = 101;\\n+const BAR = 201;\\n';",
  "  const r = applyPatch(f, diff, { fuzzy: true, fuzzyThreshold: 0.8, force: true });",
  "  assert.equal(r.ok, true, r.message);",
  "  assert.match(readFileSync(f, 'utf-8'), /FOO = 101/);",
  "  rmSync(dir, { recursive: true });",
  "});",
  "",
  ANCHOR,
].join('\n');
s = s.replace(ANCHOR, ADD);
writeFileSync(F, s);
console.log('✓ smoke.sh 已追加用例 14-15');
MJS_EOF

node --check .p0-2-smoke.mjs 2>/dev/null || { node --check .p0-2-smoke.mjs; rm -f .p0-2-smoke.mjs; exit 1; }
node .p0-2-smoke.mjs
rm -f .p0-2-smoke.mjs

echo
echo "=== build ==="
npm run build

echo
echo "=== smoke（15 条）==="
bash smoke.sh
