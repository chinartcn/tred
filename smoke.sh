#!/usr/bin/env bash
# smoke.sh — tred 冒烟测试（Termux 友好）
set -uo pipefail
cd "$(dirname "$0")"
# Termux 上 /tmp 可能不存在，显式指定
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

t('split async：保留 async', () => {
  const dir = mk({ 'x.ts': 'export class A {\n  async fetchData() { return 1; }\n}\n' });
  const r = splitFile(join(dir, 'x.ts'), ['fetchData'], 'v.ts', 'A');
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(join(dir, 'v.ts'), 'utf-8'), /export async function fetchData/);
  rmSync(dir, { recursive: true });
});

t('split generator：export function* gen', () => {
  const dir = mk({ 'x.ts': 'export class A {\n  *gen() { yield 1; }\n}\n' });
  const r = splitFile(join(dir, 'x.ts'), ['gen'], 'v.ts', 'A');
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(join(dir, 'v.ts'), 'utf-8'), /export function\* gen/);
  rmSync(dir, { recursive: true });
});

t('split 顶层函数：正常提取', () => {
  const dir = mk({ 'x.ts': 'export function foo() { return 1; }\nexport function bar() { return 2; }\n' });
  const r = splitFile(join(dir, 'x.ts'), ['foo'], 'v.ts');
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(join(dir, 'v.ts'), 'utf-8'), /export function foo/);
  rmSync(dir, { recursive: true });
});

t('patch：正常应用', () => {
  const dir = mk({ 'a.ts': 'const a = 1;\nconst b = 2;\n' });
  const f = join(dir, 'a.ts');
  const diff = '@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n';
  const r = applyPatch(f, diff, {});
  assert.equal(r.ok, true, r.message);
  assert.match(readFileSync(f, 'utf-8'), /const b = 3/);
  rmSync(dir, { recursive: true });
});

t('patch：oldStart 超界不崩', () => {
  const dir = mk({ 'a.ts': 'const a = 1;\n' });
  const f = join(dir, 'a.ts');
  const diff = '@@ -999,1 +999,1 @@\n-const a = 1;\n+const a = 2;\n';
  assert.doesNotThrow(() => applyPatch(f, diff, { fuzzy: true, fuzzyThreshold: 0.5 }));
  rmSync(dir, { recursive: true });
});

process.stdout.write(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
SMOKE_EOF

node --import tsx "$SMOKE"
