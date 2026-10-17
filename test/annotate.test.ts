import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotateFile, annotateFileContent } from '../src/index.js';

describe('annotateFileContent', function () {
  it('classes: 顶层 class 加 START/END', function () {
    const src = 'export class Foo {\n  bar() {}\n}\n';
    const r = annotateFileContent(src, 'x.ts', { classes: true });
    assert.equal(r.actions.length, 2);
    assert.match(r.nextSource, /@TRED_START: Foo/);
    assert.match(r.nextSource, /@TRED_END: Foo/);
  });

  it('methods: 用 ClassName#methodName', function () {
    const src = 'export class Foo {\n  bar() {}\n  baz() {}\n}\n';
    const r = annotateFileContent(src, 'x.ts', { methods: true });
    assert.equal(r.actions.length, 4);
    assert.match(r.nextSource, /@TRED_START: Foo#bar/);
    assert.match(r.nextSource, /@TRED_START: Foo#baz/);
  });

  it('functions: 顶层 function 用函数名', function () {
    const src = 'export function helper() { return 1; }\n';
    const r = annotateFileContent(src, 'x.ts', { functions: true });
    assert.equal(r.actions.length, 2);
    assert.match(r.nextSource, /@TRED_START: helper/);
  });

  it('全部三类一起加：class + method + function', function () {
    const src = [
      'export class Foo {',
      '  bar() {}',
      '}',
      'export function helper() {}',
      '',
    ].join('\n');
    const r = annotateFileContent(src, 'x.ts', { classes: true, methods: true, functions: true });
    assert.equal(r.actions.length, 6);
    assert.match(r.nextSource, /@TRED_START: Foo\n/);
    assert.match(r.nextSource, /@TRED_START: Foo#bar/);
    assert.match(r.nextSource, /@TRED_START: helper/);
  });

  it('已存在锚点不重复加', function () {
    const src = [
      '// @TRED_START: Foo | fp=11111111',
      'export class Foo {',
      '  bar() {}',
      '}',
      '// @TRED_END: Foo',
      '',
    ].join('\n');
    const r = annotateFileContent(src, 'x.ts', { classes: true });
    assert.equal(r.actions.length, 0);
    assert.equal(r.nextSource, src);
  });

  it('嵌套 namespace 内 class 缩进保持', function () {
    const src = [
      'namespace NS {',
      '  export class Foo {}',
      '}',
      '',
    ].join('\n');
    const r = annotateFileContent(src, 'x.ts', { classes: true });
    assert.match(r.nextSource, /\n  \/\/ @TRED_START: Foo\n  export class Foo/);
  });

  it('无匹配节点 → actions 空', function () {
    const src = 'export const x = 1;\n';
    const r = annotateFileContent(src, 'x.ts', { classes: true, methods: true, functions: true });
    assert.equal(r.actions.length, 0);
    assert.equal(r.nextSource, src);
  });

  it('class 内嵌套 class：内外均加锚点且不重叠', function () {
    const src = [
      'export class Outer {',
      '  inner() {',
      '    return 1;',
      '  }',
      '}',
      '',
    ].join('\n');
    const r = annotateFileContent(src, 'x.ts', { classes: true, methods: true });
    // 2 (class Outer) + 2 (method inner) = 4
    assert.equal(r.actions.length, 4);
    assert.match(r.nextSource, /@TRED_START: Outer\n/);
    assert.match(r.nextSource, /@TRED_START: Outer#inner/);
  });
});

describe('annotateFile', function () {
  it('dry-run 不写盘，applied=false', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-an-'));
    const file = join(dir, 'x.ts');
    writeFileSync(file, 'export class Foo {}\n');
    try {
      const r = annotateFile({ file, classes: true });
      assert.equal(r.applied, false);
      assert.equal(r.actions.length, 2);
      assert.equal(readFileSync(file, 'utf-8'), 'export class Foo {}\n');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('apply 写盘，action 已落地', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-an-'));
    const file = join(dir, 'x.ts');
    writeFileSync(file, 'export class Foo {}\n');
    try {
      const r = annotateFile({ file, classes: true, apply: true });
      assert.equal(r.applied, true);
      const after = readFileSync(file, 'utf-8');
      assert.match(after, /@TRED_START: Foo/);
      assert.match(after, /@TRED_END: Foo/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('文件不存在 → ok=false', function () {
    const r = annotateFile({ file: '/no/such/file.ts', classes: true });
    assert.equal(r.ok, false);
    assert.match((r.syntaxErrors || []).join(' '), /读取失败/);
  });

  it('annotate 结果可直接 verify 校验通过', async function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-an-'));
    const file = join(dir, 'x.ts');
    writeFileSync(file, [
      'export class Foo {',
      '  bar() {}',
      '}',
      '',
    ].join('\n'));
    try {
      annotateFile({ file, classes: true, methods: true, apply: true });
      const { verifyDir } = await import('../src/index.js');
      const v = verifyDir({ dir });
      assert.equal(v.ok, true, JSON.stringify(v.issues));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
