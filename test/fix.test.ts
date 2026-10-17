import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSyntax, fixDir, fixFileContent, verifyDir } from '../src/index.js';

describe('fixFileContent', function () {
  it('删孤儿 END，保留健康锚点', function () {
    const src = [
      'class A {',
      '  // @TRED_START: A#x | fp=11111111',
      '  x() {}',
      '  // @TRED_END: A#x',
      '  // @TRED_END: A#ghost',
      '  y() {}',
      '}',
      '',
    ].join('\n');
    const r = fixFileContent(src);
    assert.equal(r.actions.length, 1);
    assert.equal(r.actions[0].kind, 'delete-orphan-end');
    assert.equal(r.actions[0].anchorName, 'A#ghost');
    assert.equal(r.actions[0].line, 5);
    assert.doesNotMatch(r.nextSource, /A#ghost/);
    assert.match(r.nextSource, /A#x/);
    assert.match(r.nextSource, /x\(\) \{\}/);
    assert.match(r.nextSource, /y\(\) \{\}/);
  });

  it('无孤儿 END → no-op', function () {
    const src = [
      'class A {',
      '  // @TRED_START: A#x | fp=11111111',
      '  x() {}',
      '  // @TRED_END: A#x',
      '}',
      '',
    ].join('\n');
    const r = fixFileContent(src);
    assert.equal(r.actions.length, 0);
    assert.equal(r.nextSource, src);
  });

  it('多处孤儿 END 一次全删', function () {
    const src = [
      '// @TRED_END: ghost1',
      'const a = 1;',
      '// @TRED_END: ghost2',
      'const b = 2;',
      '// @TRED_END: ghost3',
      '',
    ].join('\n');
    const r = fixFileContent(src);
    assert.equal(r.actions.length, 3);
    assert.doesNotMatch(r.nextSource, /ghost/);
    assert.match(r.nextSource, /const a = 1;/);
    assert.match(r.nextSource, /const b = 2;/);
  });

  it('孤儿 START 只报告，不修复', function () {
    const src = [
      'class A {',
      '  // @TRED_START: A#x | fp=11111111',
      '  x() {}',
      '  // @TRED_START: A#y | fp=22222222',
      '  y() {}',
      '}',
      '',
    ].join('\n');
    const r = fixFileContent(src);
    assert.equal(r.actions.length, 0);
    assert.equal(r.nextSource, src);
    assert.ok(r.remainingOrphanStarts.some(function (o) { return o.anchorName === 'A#x'; }));
    assert.ok(r.remainingOrphanStarts.some(function (o) { return o.anchorName === 'A#y'; }));
  });

  it('孤儿 END 在文件末尾（无尾换行）', function () {
    const src = 'const a = 1;\n// @TRED_END: ghost';
    const r = fixFileContent(src);
    assert.equal(r.actions.length, 1);
    assert.equal(r.nextSource, 'const a = 1;');
  });
});

describe('fixDir', function () {
  function setup(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'tred-fix-'));
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
    return dir;
  }

  it('dry-run 不写盘，applied=false，有 diff', function () {
    const dir = setup({
      'a.ts': 'class A {\n  // @TRED_END: ghost\n  x() {}\n}\n',
    });
    try {
      const before = readFileSync(join(dir, 'a.ts'), 'utf-8');
      const r = fixDir({ dir: dir });
      assert.equal(r.dryRun, true);
      assert.equal(r.totalActions, 1);
      assert.equal(r.files[0].applied, false);
      assert.match(r.files[0].diff, /@TRED_END: ghost/);
      assert.equal(readFileSync(join(dir, 'a.ts'), 'utf-8'), before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--apply 写盘，fix 后 verify 通过', function () {
    const dir = setup({
      'a.ts': 'class A {\n  // @TRED_END: ghost\n  x() {}\n}\n',
    });
    try {
      const r = fixDir({ dir: dir, apply: true });
      assert.equal(r.dryRun, false);
      assert.equal(r.totalActions, 1);
      assert.equal(r.files[0].applied, true);
      const after = readFileSync(join(dir, 'a.ts'), 'utf-8');
      assert.doesNotMatch(after, /@TRED_END: ghost/);
      const v = verifyDir({ dir: dir });
      assert.equal(v.ok, true);
      assert.equal(v.issues.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('多文件混合修复', function () {
    const dir = setup({
      'a.ts': 'class A {\n  // @TRED_END: g1\n  x() {}\n}\n',
      'b.ts': 'class B {\n  // @TRED_END: g2\n  y() {}\n}\n',
      'c.ts': 'class C {\n  // @TRED_START: C#z | fp=33333333\n  z() {}\n}\n',
    });
    try {
      const r = fixDir({ dir: dir, apply: true });
      assert.equal(r.totalActions, 2);
      assert.equal(r.remainingOrphanStarts.length, 1);
      assert.equal(r.remainingOrphanStarts[0].file, 'c.ts');
      const v = verifyDir({ dir: dir });
      assert.equal(v.duplicatesWithin.length, 0);
      // c.ts 孤儿 START 还在 → 有 error
      assert.equal(v.ok, false);
      assert.ok(v.issues.some(function (i) { return i.code === 'ORPHAN_START'; }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('健康项目 → no-op', function () {
    const dir = setup({
      'a.ts': 'class A {\n  // @TRED_START: A#x | fp=11111111\n  x() {}\n  // @TRED_END: A#x\n}\n',
    });
    try {
      const r = fixDir({ dir: dir, apply: true });
      assert.equal(r.totalActions, 0);
      assert.equal(r.files.length, 0);
      assert.equal(r.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('修复后文件语法合法', function () {
    const dir = setup({
      'a.ts': [
        'export class A {',
        '  // @TRED_END: ghost',
        '  x(): number { return 1; }',
        '}',
        '',
      ].join('\n'),
    });
    try {
      const r = fixDir({ dir: dir, apply: true });
      assert.equal(r.ok, true);
      assert.equal(r.files[0].applied, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('fixOrphanStart', function () {
  function setupFile(content: string): { dir: string; file: string } {
    const dir = mkdtempSync(join(tmpdir(), 'tred-fixos-'));
    const file = join(dir, 'a.ts');
    writeFileSync(file, content);
    return { dir, file };
  }

  it('START 后紧跟 method → 补 END 到 method } 之后', function () {
    const src = [
      'export class A {',
      '  // @TRED_START: A#x | fp=11111111',
      '  x(): void {}',
      '  y(): void {}',
      '}',
      '',
    ].join('\n');
    const r = fixFileContent(src, { fixOrphanStart: true });
    assert.equal(r.actions.length, 1);
    assert.equal(r.actions[0].kind, 'add-orphan-end');
    assert.equal(r.actions[0].anchorName, 'A#x');
    const lines = r.nextSource.split("\n");
    const endIdx = lines.findIndex((l) => l.includes("@TRED_END: A#x"));
    assert.ok(endIdx > 0, 'END 行应存在');
    assert.ok(lines[endIdx - 1].includes('}'), 'END 应紧跟在 method } 之后');
    assert.ok(lines[endIdx].trim().startsWith('// @TRED_END'), 'END 行缩进正确');
  });

  it('START 后紧跟顶层 statement → 补 END 到 statement 后', function () {
    const src = [
      '// @TRED_START: X',
      'const a = 1;',
      'const b = 2;',
      '',
    ].join('\n');
    const r = fixFileContent(src, { fixOrphanStart: true });
    assert.equal(r.actions.length, 1);
    const lines = r.nextSource.split("\n");
    const endIdx = lines.findIndex((l) => l.includes("@TRED_END: X"));
    assert.equal(lines[endIdx - 1].trim(), 'const a = 1;');
  });

  it('START 单独在顶层 EOF → 补到文件末尾', function () {
    const src = [
      'const a = 1;',
      '// @TRED_START: X',
      '',
    ].join('\n');
    const r = fixFileContent(src, { fixOrphanStart: true });
    assert.equal(r.actions.length, 1);
    assert.match(r.nextSource, /@TRED_END: X\n$/);
  });

  it('START 在 class body 内无后续成员 → 不修（保守）', function () {
    const src = [
      'export class A {',
      '  // @TRED_START: X | fp=11111111',
      '}',
      '',
    ].join('\n');
    const r = fixFileContent(src, { fixOrphanStart: true });
    assert.equal(r.actions.length, 0);
    assert.equal(r.nextSource, src);
    assert.equal(r.remainingOrphanStarts.length, 1);
  });

  it('跨锚点：target 范围内出现另一 START → 不修', function () {
    const src = [
      '// @TRED_START: A',
      'if (true) {',
      '  // @TRED_START: B',
      '  foo();',
      '}',
      '',
    ].join('\n');
    const r = fixFileContent(src, { fixOrphanStart: true });
    const aAdded = r.actions.filter((x) => x.anchorName === "A" && x.kind === "add-orphan-end");
    assert.equal(aAdded.length, 0);
    assert.ok(r.remainingOrphanStarts.some((o) => o.anchorName === "A"));
  });

  it('不跨锚点：A 后紧跟语句、B 在之后 → A 仍可修', function () {
    const src = [
      '// @TRED_START: A',
      'const a = 1;',
      '// @TRED_START: B',
      'function foo() {}',
      '',
    ].join('\n');
    const r = fixFileContent(src, { fixOrphanStart: true });
    const aAdded = r.actions.filter((x) => x.anchorName === "A" && x.kind === "add-orphan-end");
    assert.equal(aAdded.length, 1, "A 应被补 END（B 不在 A 到 target 范围内）");
  });

  it('默认不开时不补 START', function () {
    const src = [
      '// @TRED_START: X',
      'const a = 1;',
      '',
    ].join('\n');
    const r = fixFileContent(src);
    assert.equal(r.actions.length, 0);
    assert.equal(r.nextSource, src);
    assert.equal(r.remainingOrphanStarts.length, 1);
  });

  it('fixDir --apply + fixOrphanStart → verify 通过', function () {
    const src = [
      'export class A {',
      '  // @TRED_START: A#x | fp=11111111',
      '  x(): void {}',
      '}',
      '',
    ].join('\n');
    const { dir } = setupFile(src);
    try {
      const r = fixDir({ dir, apply: true, fixOrphanStart: true });
      assert.equal(r.totalActions, 1);
      assert.equal(r.remainingOrphanStarts.length, 0);
      const v = verifyDir({ dir });
      assert.equal(v.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('补后语法合法（checkSyntax 通过）', function () {
    const src = [
      'export class A {',
      '  // @TRED_START: A#x | fp=11111111',
      '  x(): number { return 1; }',
      '}',
      '',
    ].join('\n');
    const r = fixFileContent(src, { fixOrphanStart: true });
    const errors = checkSyntax("a.ts", r.nextSource);
    assert.equal(errors.length, 0);
  });
});
