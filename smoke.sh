#!/usr/bin/env bash
# smoke.sh — tred 冒烟测试（Termux 友好，11 条关键路径）
set -uo pipefail
cd "$(dirname "$0")"

export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
mkdir -p "$TMPDIR" 2>/dev/null || true

SMOKE=".tred-smoke.mts"
trap 'rm -f "$SMOKE"' EXIT

cat > "$SMOKE" <<'SMOKE_EOF'
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitFile } from './src/split.ts';
import { applyPatch } from './src/patch.ts';

let pass = 0, fail = 0;
function t(name: string, fn: () => void) {
  try { fn(); pass++; process.stdout.write('  \x1b[32m✓\x1b[0m ' + name + '\n'); }
  catch (e: any) { fail++; process.stdout.write('  \x1b[31m✗\x1b[0m ' + name + '\n      ' + String(e?.message).replace(/\n/g, '\n      ') + '\n'); }
}
function mk(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'tred-smoke-'));
  for (const [rel, c] of Object.entries(files)) writeFileSync(join(dir, rel), c);
  return dir;
}

// ── 1. split 属性：JSDoc 跟随属性 ──
t('split 属性：JSDoc 跟随属性', () => {
  const dir = mk({ 'x.ts': [
    'export class A {',
    '  /** 这是 value 的说明 */',
    '  value: number = 1;',
    '  other: string = "x";',
    '}',
    '',
  ].join('\n') });
  const src = join(dir, 'x.ts'), out = join(dir, 'v.ts');
  const r = splitFile(src, ['value'], 'v.ts', 'A');
  assert.equal(r.ok, true, r.message);
  assert.doesNotMatch(readFileSync(src, 'utf-8'), /这是 value 的说明/);
  assert.match(readFileSync(out, 'utf-8'), /这是 value 的说明/);
  rmSync(dir, { recursive: true });
});

// ── 2. split async：保留 async ──
t('split async：保留 async', () => {
  const dir = mk({ 'x.ts': 'export class A {\n  async fetchData() { return 1; }\n}\n' });
  const r = splitFile(join(dir, 'x.ts'), ['fetchData'], 'v.ts', 'A');
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(join(dir, 'v.ts'), 'utf-8'), /export async function fetchData/);
  rmSync(dir, { recursive: true });
});

// ── 3. split generator：export function* gen ──
t('split generator：export function* gen', () => {
  const dir = mk({ 'x.ts': 'export class A {\n  *gen() { yield 1; }\n}\n' });
  const r = splitFile(join(dir, 'x.ts'), ['gen'], 'v.ts', 'A');
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(join(dir, 'v.ts'), 'utf-8'), /export function\* gen/);
  rmSync(dir, { recursive: true });
});

// ── 4. split 顶层函数 ──
t('split 顶层函数：正常提取', () => {
  const dir = mk({ 'x.ts': 'export function foo() { return 1; }\nexport function bar() { return 2; }\n' });
  const r = splitFile(join(dir, 'x.ts'), ['foo'], 'v.ts');
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(join(dir, 'v.ts'), 'utf-8'), /export function foo/);
  rmSync(dir, { recursive: true });
});

// ── 5. patch 正常应用 ──
t('patch：正常应用', () => {
  const dir = mk({ 'a.ts': 'const a = 1;\nconst b = 2;\n' });
  const f = join(dir, 'a.ts');
  const diff = '@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n';
  const r = applyPatch(f, diff, {});
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(f, 'utf-8'), /const b = 3/);
  rmSync(dir, { recursive: true });
});

// ── 6. patch oldStart 超界 ──
t('patch：oldStart 超界不崩', () => {
  const dir = mk({ 'a.ts': 'const a = 1;\n' });
  const f = join(dir, 'a.ts');
  const diff = '@@ -999,1 +999,1 @@\n-const a = 1;\n+const a = 2;\n';
  assert.doesNotThrow(() => applyPatch(f, diff, { fuzzy: true, fuzzyThreshold: 0.5 }));
  rmSync(dir, { recursive: true });
});

// ── 7. split 无 --class：自动识别类方法 ──
t('split 无 --class：自动识别类方法', () => {
  const dir = mk({ 'x.ts': 'export class Engine {\n  pasteBlueprint(bp: any) { return bp; }\n  other() {}\n}\n' });
  const r = splitFile(join(dir, 'x.ts'), ['pasteBlueprint'], 'macros.ts');
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(join(dir, 'macros.ts'), 'utf-8'), /export function pasteBlueprint\(this: Engine/);
  rmSync(dir, { recursive: true });
});

// ── 8. split 无 --class：多类冲突 ──
t('split 无 --class：多类冲突提示 --class', () => {
  const dir = mk({ 'x.ts': 'export class A { foo() {} }\nexport class B { foo() {} }\n' });
  const r = splitFile(join(dir, 'x.ts'), ['foo'], 'out.ts');
  assert.equal(r.ok, false);
  assert.match(String(r.message), /请用 --class/);
  rmSync(dir, { recursive: true });
});

// ── 9. split 无 --class：错误列可用节点 ──
t('split 无 --class：错误列可用节点', () => {
  const dir = mk({ 'x.ts': 'export function topFn() {}\nexport class Engine { pasteBlueprint() {} }\n' });
  const r = splitFile(join(dir, 'x.ts'), ['nope'], 'out.ts');
  assert.equal(r.ok, false);
  assert.match(String(r.message), /顶层函数:.*topFn/);
  assert.match(String(r.message), /类方法:.*Engine#pasteBlueprint/);
  rmSync(dir, { recursive: true });
});

// ── 10. split static 拒绝 ──
t('split static 拒绝', () => {
  const dir = mk({ 'x.ts': 'export class T {\n  static foo() {}\n}\n' });
  const r = splitFile(join(dir, 'x.ts'), ['foo'], 'out.ts');
  assert.equal(r.ok, false);
  assert.match(String(r.message), /static/);
  rmSync(dir, { recursive: true });
});

// ── 11. split private 拒绝 ──
t('split private 拒绝', () => {
  const dir = mk({ 'x.ts': 'export class T {\n  private bar() {}\n}\n' });
  const r = splitFile(join(dir, 'x.ts'), ['bar'], 'out.ts');
  assert.equal(r.ok, false);
  assert.match(String(r.message), /非 public/);
  rmSync(dir, { recursive: true });
});

// ── 12. P1 改进：稀有词行全命中提升总分
t('P1 改进：稀有词行全命中提升到 93%', () => {
  const dir = mk({
    'a.ts': [
      'import { other2 } from "./other2";',
      'const specialUniqueTokenXYZ = 1;',
      'import { other2 } from "./other2";',
      '',
    ].join('\n'),
  });
  const f = join(dir, 'a.ts');
  const diff = [
    '@@ -1,3 +1,3 @@',
    '-import { other1 } from "./other1";',
    '-const specialUniqueTokenXYZ = 1;',
    '-import { other1 } from "./other1";',
    '+import { changed1 } from "./changed1";',
    '+const specialUniqueTokenXYZ = 99;',
    '+import { changed1 } from "./changed1";',
  ].join('\n');
  const r = applyPatch(f, diff, { fuzzy: true, fuzzyThreshold: 0.9 });
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(f, 'utf-8'), /specialUniqueTokenXYZ = 99/);
  rmSync(dir, { recursive: true });
});

// ── 13. P1：token 集相同给 0.97
t('P1：token 集相同给高分', () => {
  const dir = mk({
    'a.ts': 'const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n',
  });
  const f = join(dir, 'a.ts');
  const diff = [
    '@@ -1,3 +1,3 @@',
    '-const alpha = 1 ;',
    '-const beta = 2 ;',
    '-const gamma = 3 ;',
    '+const alpha = 10;',
    '+const beta = 20;',
    '+const gamma = 30;',
  ].join('\n');
  const r = applyPatch(f, diff, { fuzzy: true, fuzzyThreshold: 0.9 });
  assert.equal(r.ok, true, r.message);
  rmSync(dir, { recursive: true });
});

// ── 14. P0-2 多候选仲裁：拒绝 ──
t('P0-2 多候选：并列时拒绝', () => {
  const dir = mk({ 'a.ts': [
    'function dupAlpha() {',
    '  const appleCount = 1;',
    '  const bananaCount = 2;',
    '}',
    '',
    'function dupBravo() {',
    '  const appleCount = 1;',
    '  const bananaCount = 2;',
    '}',
    '',
  ].join('\n') });
  const f = join(dir, 'a.ts');
  const before = readFileSync(f, 'utf-8');
  // 值只差 1，结构完全一致 → 两处候选分数极近
  const diff = '@@ -2,2 +2,2 @@\n-const appleCount = 100;\n-const bananaCount = 200;\n+const appleCount = 101;\n+const bananaCount = 201;\n';
  const r = applyPatch(f, diff, { fuzzy: true, fuzzyThreshold: 0.8 });
  assert.equal(r.ok, false, '应拒绝并列候选: ' + (r.message || ''));
  assert.match(String(r.message), /多个近似候选|并列|ambig|margin/i, '错误信息应说明并列：' + r.message);
  assert.equal(readFileSync(f, 'utf-8'), before, '不应修改文件');
  rmSync(dir, { recursive: true });
});

// ── 15. P0-2 多候选仲裁：--force 强制接受 ──
t('P0-2 多候选：--force 强制接受', () => {
  const dir = mk({ 'a.ts': [
    'function dupAlpha() {',
    '  const appleCount = 1;',
    '  const bananaCount = 2;',
    '}',
    '',
    'function dupBravo() {',
    '  const appleCount = 1;',
    '  const bananaCount = 2;',
    '}',
    '',
  ].join('\n') });
  const f = join(dir, 'a.ts');
  const diff = '@@ -2,2 +2,2 @@\n-const appleCount = 100;\n-const bananaCount = 200;\n+const appleCount = 101;\n+const bananaCount = 201;\n';
  const r = applyPatch(f, diff, { fuzzy: true, fuzzyThreshold: 0.8, force: true });
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(f, 'utf-8'), /appleCount = 101/);
  rmSync(dir, { recursive: true });
});

process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
SMOKE_EOF

node --import tsx "$SMOKE"
