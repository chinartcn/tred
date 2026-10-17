import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotateDir } from '../src/index.js';

function setup(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tred-ad-'));
  for (const rel of Object.keys(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, files[rel]);
  }
  return dir;
}

describe('annotateDir', function () {
  it('多文件：class + method + function 全覆盖', function () {
    const dir = setup({
      'a.ts': 'export class Foo {\n  bar() {}\n}\nexport function h() {}\n',
      'b.ts': 'export class Baz {}\n',
    });
    try {
      const r = annotateDir({ dir, classes: true, methods: true, functions: true });
      assert.equal(r.ok, true);
      assert.equal(r.annotatedFiles, 2);
      assert.equal(r.totalActions, 8);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('dry-run 不写盘', function () {
    const dir = setup({ 'a.ts': 'export class Foo {}\n' });
    try {
      const before = readFileSync(join(dir, 'a.ts'), 'utf-8');
      const r = annotateDir({ dir, classes: true, apply: false });
      assert.equal(r.apply, false);
      assert.equal(readFileSync(join(dir, 'a.ts'), 'utf-8'), before);
      assert.equal(r.files[0].applied, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--apply 落盘', function () {
    const dir = setup({ 'a.ts': 'export class Foo {}\n' });
    try {
      const r = annotateDir({ dir, classes: true, apply: true });
      assert.equal(r.apply, true);
      assert.equal(r.files[0].applied, true);
      const after = readFileSync(join(dir, 'a.ts'), 'utf-8');
      assert.match(after, /@TRED_START: Foo/);
      assert.match(after, /@TRED_END: Foo/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('空目录 -> ok，0 文件', function () {
    const dir = setup({});
    try {
      const r = annotateDir({ dir, classes: true });
      assert.equal(r.ok, true);
      assert.equal(r.files.length, 0);
      assert.equal(r.annotatedFiles, 0);
      assert.equal(r.totalActions, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('忽略 node_modules / dist', function () {
    const dir = setup({
      'a.ts': 'export class Foo {}\n',
      'node_modules/x.ts': 'export class Lib {}\n',
      'dist/y.ts': 'export class Built {}\n',
    });
    try {
      const r = annotateDir({ dir, classes: true });
      assert.equal(r.annotatedFiles, 1);
      assert.equal(r.files.length, 1);
      assert.match(r.files[0].file, /a\.ts$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('幂等：二次跑 0 新增', function () {
    const dir = setup({ 'a.ts': 'export class Foo {}\n' });
    try {
      annotateDir({ dir, classes: true, apply: true });
      const r2 = annotateDir({ dir, classes: true, apply: true });
      assert.equal(r2.totalActions, 0);
      assert.equal(r2.annotatedFiles, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('语法错的文件标 failed，不影响其他文件', function () {
    const dir = setup({
      'good.ts': 'export class Foo {}\n',
      'bad.ts': 'export class Bar {}\nconst x = ;\n',
    });
    try {
      const r = annotateDir({ dir, classes: true, apply: false });
      assert.equal(r.ok, false);
      assert.equal(r.failedFiles, 1);
      const good = r.files.find((f) => f.file.endsWith('good.ts'));
      assert.ok(good);
      assert.equal(good!.ok, true);
      const bad = r.files.find((f) => f.file.endsWith('bad.ts'));
      assert.ok(bad);
      assert.equal(bad!.ok, false);
      assert.ok(bad!.syntaxErrors && bad!.syntaxErrors.length > 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('没有匹配节点时 files 为空', function () {
    const dir = setup({ 'a.ts': 'export const x = 1;\n' });
    try {
      const r = annotateDir({ dir, classes: true, methods: true, functions: true });
      assert.equal(r.ok, true);
      assert.equal(r.files.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('嵌套子目录递归扫描', function () {
    const dir = setup({
      'a.ts': 'export class Foo {}\n',
      'sub/b.ts': 'export class Bar {}\n',
      'sub/deep/c.ts': 'export class Baz {}\n',
    });
    try {
      const r = annotateDir({ dir, classes: true });
      assert.equal(r.annotatedFiles, 3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
