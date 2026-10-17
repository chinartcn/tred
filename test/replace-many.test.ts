import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFingerprint, replaceMany } from '../src/index.js';

const CLASS_SRC = [
  'export class A {',
  '  foo(): void {}',
  '}',
  '',
].join('\n');

describe('replaceMany', function () {
  let dir: string;
  let f1: string;
  let f2: string;

  function setup(): void {
    dir = mkdtempSync(join(tmpdir(), 'tred-batch-'));
    f1 = join(dir, 'a.ts');
    f2 = join(dir, 'b.ts');
    writeFileSync(f1, CLASS_SRC);
    writeFileSync(f2, CLASS_SRC);
  }

  function cleanup(): void { rmSync(dir, { recursive: true, force: true }); }

  const sel = { kind: 'method' as const, className: 'A', methodName: 'foo' };

  it('全部成功 → committed，两个文件都更新', async function () {
    setup();
    try {
      const fp1 = makeFingerprint({ anchor: 'A#foo', source: 'b', version: '1' });
      const fp2 = makeFingerprint({ anchor: 'A#foo', source: 'b', version: '2' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#foo', content: 'foo(): void { console.log(1); }', fingerprint: fp1, autoInjectAnchor: true, astSelector: sel },
        { file: f2, anchor: 'A#foo', content: 'foo(): void { console.log(2); }', fingerprint: fp2, autoInjectAnchor: true, astSelector: sel },
      ]);
      assert.equal(r.status, 'committed');
      assert.equal(r.committedFiles.length, 2);
      assert.match(readFileSync(f1, 'utf-8'), /console\.log\(1\)/);
      assert.match(readFileSync(f2, 'utf-8'), /console\.log\(2\)/);
    } finally { cleanup(); }
  });

  it('中途语法错 → rolled-back，所有文件不变', async function () {
    setup();
    try {
      const before1 = readFileSync(f1, 'utf-8');
      const before2 = readFileSync(f2, 'utf-8');
      const fp1 = makeFingerprint({ anchor: 'A#foo', source: 'b', version: '1' });
      const fp2 = makeFingerprint({ anchor: 'A#foo', source: 'b', version: '2' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#foo', content: 'foo(): void { console.log(1); }', fingerprint: fp1, autoInjectAnchor: true, astSelector: sel },
        { file: f2, anchor: 'A#foo', content: 'foo(): void { console.log(2)', fingerprint: fp2, autoInjectAnchor: true, astSelector: sel },
      ]);
      assert.equal(r.status, 'rolled-back');
      assert.equal(readFileSync(f1, 'utf-8'), before1);
      assert.equal(readFileSync(f2, 'utf-8'), before2);
    } finally { cleanup(); }
  });

  it('同一文件多个锚点 → 串行计算', async function () {
    setup();
    try {
      const fp1 = makeFingerprint({ anchor: 'X1', source: 'b', version: '1' });
      const fp2 = makeFingerprint({ anchor: 'X2', source: 'b', version: '1' });
      writeFileSync(f1, [
        'export class A {',
        '  // @TRED_START: X1 | fp=00000000',
        '  foo(): void {}',
        '  // @TRED_END: X1',
        '  // @TRED_START: X2 | fp=00000000',
        '  bar(): void {}',
        '  // @TRED_END: X2',
        '}',
        '',
      ].join('\n'));
      const r = await replaceMany([
        { file: f1, anchor: 'X1', content: 'foo(): void { console.log(1); }', fingerprint: fp1 },
        { file: f1, anchor: 'X2', content: 'bar(): void { console.log(2); }', fingerprint: fp2 },
      ]);
      assert.equal(r.status, 'committed');
      const after = readFileSync(f1, 'utf-8');
      assert.match(after, /console\.log\(1\)/);
      assert.match(after, /console\.log\(2\)/);
    } finally { cleanup(); }
  });

  it('空数组 → committed', async function () {
    const r = await replaceMany([]);
    assert.equal(r.status, 'committed');
  });

  it('文件不存在 → rolled-back', async function () {
    setup();
    try {
      const r = await replaceMany([
        { file: f1, anchor: 'X', content: 'y', fingerprint: '00000000' },
        { file: join(dir, 'missing.ts'), anchor: 'X', content: 'y', fingerprint: '00000000' },
      ]);
      assert.equal(r.status, 'rolled-back');
      assert.match(r.results[1].message || '', /文件不存在/);
    } finally { cleanup(); }
  });

  it('dryRun → 不写盘，status = dry-run', async function () {
    setup();
    try {
      const before = readFileSync(f1, 'utf-8');
      const fp1 = makeFingerprint({ anchor: 'A#foo', source: 'b', version: '1' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#foo', content: 'foo(): void { console.log(1); }', fingerprint: fp1, autoInjectAnchor: true, astSelector: sel, dryRun: true },
      ]);
      assert.equal(r.status, 'dry-run');
      assert.equal(readFileSync(f1, 'utf-8'), before);
      assert.ok(r.results[0].diff && r.results[0].diff.includes('+'));
    } finally { cleanup(); }
  });
});


describe('replaceMany continueOnError', function () {
  let dir: string;
  let f1: string;
  let f2: string;

  function setup(): void {
    dir = mkdtempSync(join(tmpdir(), 'tred-partial-'));
    f1 = join(dir, 'a.ts');
    f2 = join(dir, 'b.ts');
    const src = [
      'export class A {',
      '  // @TRED_START: A#x | fp=00000000',
      '  x(): void {}',
      '  // @TRED_END: A#x',
      '}',
      '',
    ].join('\n');
    writeFileSync(f1, src);
    writeFileSync(f2, src);
  }

  function cleanup(): void { rmSync(dir, { recursive: true, force: true }); }

  const GOOD = 'x(): void { console.log(1); }';
  const BAD = 'x(): void { console.log(1)';  // 缺 }

  it('单文件失败，其余文件正常提交 → partial', async function () {
    setup();
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'p', version: '1' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#x', content: GOOD, fingerprint: fp },
        { file: f2, anchor: 'A#x', content: BAD, fingerprint: fp },
      ], { continueOnError: true });
      assert.equal(r.status, 'partial');
      assert.equal(r.committedFiles.length, 1);
      assert.equal(r.committedFiles[0], f1);
      assert.match(readFileSync(f1, 'utf-8'), /console\.log\(1\)/);
      // f2 未写
      assert.match(readFileSync(f2, 'utf-8'), /fp=00000000/);
    } finally { cleanup(); }
  });

  it('全部成功 → committed', async function () {
    setup();
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'p', version: '1' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#x', content: GOOD, fingerprint: fp },
        { file: f2, anchor: 'A#x', content: GOOD, fingerprint: fp },
      ], { continueOnError: true });
      assert.equal(r.status, 'committed');
      assert.equal(r.committedFiles.length, 2);
    } finally { cleanup(); }
  });

  it('全部失败 → rolled-back', async function () {
    setup();
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'p', version: '1' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#x', content: BAD, fingerprint: fp },
        { file: f2, anchor: 'A#x', content: BAD, fingerprint: fp },
      ], { continueOnError: true });
      assert.equal(r.status, 'rolled-back');
      assert.equal(r.committedFiles.length, 0);
      // 两文件原样
      assert.match(readFileSync(f1, 'utf-8'), /fp=00000000/);
      assert.match(readFileSync(f2, 'utf-8'), /fp=00000000/);
    } finally { cleanup(); }
  });

  it('同文件多 op 第 2 个失败 → 该文件 skip，第 1 op 改 failed', async function () {
    setup();
    try {
      // 给 f1 塞两个锚点
      writeFileSync(f1, [
        'export class A {',
        '  // @TRED_START: A#x | fp=00000000',
        '  x(): void {}',
        '  // @TRED_END: A#x',
        '  // @TRED_START: A#y | fp=00000000',
        '  y(): void {}',
        '  // @TRED_END: A#y',
        '}',
        '',
      ].join('\n'));
      const fp1 = makeFingerprint({ anchor: 'A#x', source: 'p', version: '1' });
      const fp2 = makeFingerprint({ anchor: 'A#y', source: 'p', version: '1' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#x', content: 'x(): void { console.log(1); }', fingerprint: fp1 },
        { file: f1, anchor: 'A#y', content: BAD, fingerprint: fp2 },
      ], { continueOnError: true });
      assert.equal(r.status, 'rolled-back');  // 只有这一个文件且失败
      // 第 1 个 op 应被改 failed（因为文件最终没写）
      assert.equal(r.results[0].status, 'failed');
      assert.equal(r.results[1].status, 'failed');
      // 文件原样
      assert.match(readFileSync(f1, 'utf-8'), /fp=00000000/);
    } finally { cleanup(); }
  });

  it('提交阶段失败不影响其他文件 → partial', async function () {
    setup();
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'p', version: '1' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#x', content: GOOD, fingerprint: fp },
        { file: f2, anchor: 'A#x', content: GOOD, fingerprint: fp },
      ], {
        continueOnError: true,
        _writer: function (file, content) {
          if (file === f2) throw new Error('disk full on f2');
          writeFileSync(file, content, 'utf-8');
        },
      });
      assert.equal(r.status, 'partial');
      assert.equal(r.committedFiles.length, 1);
      assert.equal(r.committedFiles[0], f1);
      // f1 写了，f2 没写
      assert.match(readFileSync(f1, 'utf-8'), /console\.log\(1\)/);
      assert.match(readFileSync(f2, 'utf-8'), /fp=00000000/);
      // f2 的 op 在 results 里标 failed
      const f2Result = r.results.find((x) => x.file === f2);
      assert.equal(f2Result?.status, 'failed');
      assert.match(f2Result?.message || '', /提交失败/);
    } finally { cleanup(); }
  });

  it('missing 文件不阻塞其他文件 → partial', async function () {
    setup();
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'p', version: '1' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#x', content: GOOD, fingerprint: fp },
        { file: join(dir, 'missing.ts'), anchor: 'A#x', content: GOOD, fingerprint: fp },
      ], { continueOnError: true });
      assert.equal(r.status, 'partial');
      assert.equal(r.committedFiles.length, 1);
      assert.match(readFileSync(f1, 'utf-8'), /console\.log\(1\)/);
    } finally { cleanup(); }
  });

  it('continueOnError + dryRun → dry-run，不写盘', async function () {
    setup();
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'p', version: '1' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#x', content: GOOD, fingerprint: fp, dryRun: true },
        { file: f2, anchor: 'A#x', content: BAD, fingerprint: fp, dryRun: true },
      ], { continueOnError: true });
      assert.equal(r.status, 'dry-run');
      assert.match(readFileSync(f1, 'utf-8'), /fp=00000000/);
    } finally { cleanup(); }
  });

  it('未传 continueOnError → 保持原有全事务回滚', async function () {
    setup();
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'p', version: '1' });
      const r = await replaceMany([
        { file: f1, anchor: 'A#x', content: GOOD, fingerprint: fp },
        { file: f2, anchor: 'A#x', content: BAD, fingerprint: fp },
      ]);
      assert.equal(r.status, 'rolled-back');
      assert.equal(r.committedFiles.length, 0);
      assert.match(readFileSync(f1, 'utf-8'), /fp=00000000/);
    } finally { cleanup(); }
  });
});
