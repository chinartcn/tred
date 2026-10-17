import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffDir } from '../src/index.js';

const FILE_A = [
  'export class A {',
  '  // @TRED_START: A#x | fp=11111111',
  '  x(): void { return 1; }',
  '  // @TRED_END: A#x',
  '}',
  '',
].join('\n');

const FILE_A_CHANGED = [
  'export class A {',
  '  // @TRED_START: A#x | fp=22222222',
  '  x(): void { return 2; }',
  '  // @TRED_END: A#x',
  '}',
  '',
].join('\n');

function setup(left: Record<string, string>, right: Record<string, string>): { leftDir: string; rightDir: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tred-dd-'));
  const leftDir = join(dir, 'left');
  const rightDir = join(dir, 'right');
  for (const [rel, content] of Object.entries(left)) {
    const full = join(leftDir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  for (const [rel, content] of Object.entries(right)) {
    const full = join(rightDir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return { leftDir, rightDir, dir };
}

describe('diffDir', function () {
  it('两侧相同 → ok，0 changed', function () {
    const { leftDir, rightDir, dir } = setup({ 'a.ts': FILE_A }, { 'a.ts': FILE_A });
    try {
      const r = diffDir({ leftDir, rightDir });
      assert.equal(r.ok, true);
      assert.equal(r.stats.compared, 1);
      assert.equal(r.stats.changed, 0);
      assert.equal(r.stats.unchanged, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('内容变化 → changed > 0，diff 非空', function () {
    const { leftDir, rightDir, dir } = setup({ 'a.ts': FILE_A }, { 'a.ts': FILE_A_CHANGED });
    try {
      const r = diffDir({ leftDir, rightDir });
      assert.equal(r.ok, false);
      assert.equal(r.stats.changed, 1);
      assert.equal(r.files.length, 1);
      assert.match(r.files[0].anchors[0].diff, /return 2/);
      assert.match(r.files[0].anchors[0].diff, /return 1/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('右侧文件缺失 → missing', function () {
    const { leftDir, rightDir, dir } = setup({ 'a.ts': FILE_A }, {});
    try {
      const r = diffDir({ leftDir, rightDir });
      assert.equal(r.ok, false);
      assert.equal(r.stats.missing, 1);
      assert.match(r.files[0].anchors[0].message || '', /右侧文件缺失/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('anchorFilter 只对比匹配的锚点', function () {
    const FILE_2 = [
      'export class A {',
      '  // @TRED_START: A#x | fp=11111111',
      '  x(): void {}',
      '  // @TRED_END: A#x',
      '  // @TRED_START: A#y | fp=11111111',
      '  y(): void {}',
      '  // @TRED_END: A#y',
      '}',
      '',
    ].join('\n');
    const { leftDir, rightDir, dir } = setup({ 'a.ts': FILE_2 }, { 'a.ts': FILE_2 });
    try {
      const r = diffDir({ leftDir, rightDir, anchorFilter: 'A#x' });
      assert.equal(r.stats.compared, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('忽略 node_modules', function () {
    const { leftDir, rightDir, dir } = setup(
      { 'a.ts': FILE_A, 'node_modules/x.ts': FILE_A },
      { 'a.ts': FILE_A },
    );
    try {
      const r = diffDir({ leftDir, rightDir });
      assert.equal(r.stats.compared, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
