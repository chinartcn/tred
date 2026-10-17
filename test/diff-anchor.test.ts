import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffAnchor } from '../src/index.js';

function setup(contents: { a?: string; b?: string }): { dir: string; a: string; b: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tred-da-'));
  const a = join(dir, 'a.ts');
  const b = join(dir, 'b.ts');
  if (contents.a !== undefined) writeFileSync(a, contents.a);
  if (contents.b !== undefined) writeFileSync(b, contents.b);
  return { dir, a, b };
}

describe('diffAnchor', function () {
  it('两侧找到且内容相同 → diff 空，ok=true', function () {
    const src = [
      'export class A {',
      '  // @TRED_START: X | fp=11111111',
      '  foo() { return 1; }',
      '  // @TRED_END: X',
      '}',
      '',
    ].join('\n');
    const { dir, a, b } = setup({ a: src, b: src });
    try {
      const r = diffAnchor({ anchor: 'X', left: a, right: b });
      assert.equal(r.ok, true);
      assert.equal(r.diff, '');
      assert.equal(r.left.found, true);
      assert.equal(r.right.found, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('内容不同 → diff 有 +/- 行', function () {
    const a = [
      '// @TRED_START: X | fp=11111111',
      'foo() { return 1; }',
      '// @TRED_END: X',
      '',
    ].join('\n');
    const b = [
      '// @TRED_START: X | fp=22222222',
      'foo() { return 2; }',
      '// @TRED_END: X',
      '',
    ].join('\n');
    const { dir, a: pa, b: pb } = setup({ a: a, b: b });
    try {
      const r = diffAnchor({ anchor: 'X', left: pa, right: pb });
      assert.equal(r.ok, true);
      assert.match(r.diff, /^--- /m);
      assert.match(r.diff, /\+foo\(\) \{ return 2; \}/);
      assert.match(r.diff, /-foo\(\) \{ return 1; \}/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('左侧缺锚点 → ok=false', function () {
    const b = [
      '// @TRED_START: X | fp=11111111',
      'foo() {}',
      '// @TRED_END: X',
      '',
    ].join('\n');
    const { dir, a, b: pb } = setup({ a: 'export const x = 1;\n', b: b });
    try {
      const r = diffAnchor({ anchor: 'X', left: a, right: pb });
      assert.equal(r.ok, false);
      assert.match(r.message || '', /左侧/);
      assert.equal(r.left.found, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('右侧缺锚点 → ok=false', function () {
    const a = [
      '// @TRED_START: X | fp=11111111',
      'foo() {}',
      '// @TRED_END: X',
      '',
    ].join('\n');
    const { dir, a: pa, b } = setup({ a: a, b: 'export const y = 2;\n' });
    try {
      const r = diffAnchor({ anchor: 'X', left: pa, right: b });
      assert.equal(r.ok, false);
      assert.match(r.message || '', /右侧/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('两侧都缺锚点 → ok=false，message 说明双侧', function () {
    const { dir, a, b } = setup({ a: 'x\n', b: 'y\n' });
    try {
      const r = diffAnchor({ anchor: 'X', left: a, right: b });
      assert.equal(r.ok, false);
      assert.match(r.message || '', /两侧/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('文件不存在 → 该侧 found=false', function () {
    const { dir, a } = setup({ a: '// @TRED_START: X\nfoo\n// @TRED_END: X\n' });
    try {
      const r = diffAnchor({ anchor: 'X', left: a, right: '/no/such/file.ts' });
      assert.equal(r.ok, false);
      assert.equal(r.right.found, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('只对比锚点内部，两侧 START/END 位置偏移不影响', function () {
    const a = [
      'export class A {',
      '  // @TRED_START: X | fp=11111111',
      '  foo() {}',
      '  // @TRED_END: X',
      '}',
      '',
    ].join('\n');
    const b = [
      '// 完全不同的文件头',
      'const x = 1;',
      'export class A {',
      '  // @TRED_START: X | fp=11111111',
      '  foo() {}',
      '  // @TRED_END: X',
      '}',
      '',
    ].join('\n');
    const { dir, a: pa, b: pb } = setup({ a: a, b: b });
    try {
      const r = diffAnchor({ anchor: 'X', left: pa, right: pb });
      assert.equal(r.ok, true);
      assert.equal(r.diff, '', '锚点内内容相同，忽略外部差异');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
