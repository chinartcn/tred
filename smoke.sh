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

process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
SMOKE_EOF

node --import tsx "$SMOKE"
