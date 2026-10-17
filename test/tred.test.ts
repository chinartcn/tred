import { describe, it, beforeEach, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeFingerprint, replace, normalizeContent } from '../src/index.js';

const ORIGINAL = [
  'export class GraphEngine {',
  '  loadUnlocked(): void {',
  "    console.log('old');",
  '  }',
  '}',
  '',
].join('\n');

const METHOD_NEW = [
  'loadUnlocked(): void {',
  "  console.log('new');",
  '}',
].join('\n');

// 故意写成"绝对缩进"（body 4 空格、} 2 空格），验证 #6 归一化
const METHOD_ABS_INDENT = [
  'loadUnlocked(): void {',
  "    console.log('new');",
  '  }',
].join('\n');

describe('tred', function () {
  let dir: string;
  let file: string;

  beforeEach(function () {
    dir = mkdtempSync(join(tmpdir(), 'tred-'));
    file = join(dir, 'main.ts');
    writeFileSync(file, ORIGINAL);
  });

  after(function () {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  const selector = {
    kind: 'method' as const,
    className: 'GraphEngine',
    methodName: 'loadUnlocked',
  };

  it('AST 首插：无锚点时注入 START/END + fp', async function () {
    const fingerprint = makeFingerprint({ anchor: 'GraphEngine#load', source: 'unit-test', version: '1' });
    const r = await replace({
      file,
      anchor: 'GraphEngine#load',
      content: METHOD_NEW,
      fingerprint,
      autoInjectAnchor: true,
      astSelector: selector,
    });
    assert.equal(r.status, 'injected');
    const src = readFileSync(file, 'utf-8');
    assert.match(src, /@TRED_START: GraphEngine#load/);
    assert.ok(src.includes('fp=' + fingerprint));
    assert.match(src, /@TRED_END: GraphEngine#load/);
    assert.match(src, /console\.log\('new'\)/);
    assert.doesNotMatch(src, /console\.log\('old'\)/);
  });

  it('AST 首插：START / END / 方法行缩进一致，不翻倍', async function () {
    const fingerprint = makeFingerprint({ anchor: 'GraphEngine#load', source: 'indent-test', version: '1' });
    await replace({
      file,
      anchor: 'GraphEngine#load',
      content: METHOD_NEW,
      fingerprint,
      autoInjectAnchor: true,
      astSelector: selector,
    });
    const src = readFileSync(file, 'utf-8');
    const lines = src.split('\n');
    const lead = function (s: string) {
      const m = s.match(/^[\t ]*/);
      return m ? m[0] : '';
    };
    const startLine = lines.find(function (l) { return l.includes('@TRED_START'); });
    const endLine = lines.find(function (l) { return l.includes('@TRED_END'); });
    const methodLine = lines.find(function (l) { return l.includes('loadUnlocked(): void'); });
    assert.ok(startLine && endLine && methodLine);
    assert.equal(lead(startLine), '  ');
    assert.equal(lead(endLine), '  ');
    assert.equal(lead(methodLine), '  ');
  });

  it('锚点替换：已有锚点时直接替换内部内容', async function () {
    writeFileSync(file, [
      'export class GraphEngine {',
      '  // @TRED_START: GraphEngine#load | fp=00000000',
      '  loadUnlocked(): void {',
      "    console.log('old');",
      '  }',
      '  // @TRED_END: GraphEngine#load',
      '}',
      '',
    ].join('\n'));
    const fingerprint = makeFingerprint({ anchor: 'GraphEngine#load', source: 'unit-test', version: '2' });
    const r = await replace({
      file,
      anchor: 'GraphEngine#load',
      content: METHOD_NEW,
      fingerprint,
    });
    assert.equal(r.status, 'replaced');
    const src = readFileSync(file, 'utf-8');
    assert.ok(src.includes('fp=' + fingerprint));
    assert.match(src, /console\.log\('new'\)/);
    assert.doesNotMatch(src, /console\.log\('old'\)/);
  });

  it('幂等：指纹一致时跳过，不重复注入', async function () {
    const fingerprint = makeFingerprint({ anchor: 'GraphEngine#load', source: 'unit-test', version: '3' });
    const opts = {
      file,
      anchor: 'GraphEngine#load',
      content: METHOD_NEW,
      fingerprint,
      autoInjectAnchor: true,
      astSelector: selector,
    };
    const first = await replace(opts);
    assert.equal(first.status, 'injected');
    const afterFirst = readFileSync(file, 'utf-8');
    const second = await replace(opts);
    assert.equal(second.status, 'skipped');
    assert.equal(readFileSync(file, 'utf-8'), afterFirst);
  });

  it('语法错误：parseDiagnostics 非空则拒绝写入，原文件保持不变', async function () {
    const fingerprint = makeFingerprint({ anchor: 'GraphEngine#load', source: 'unit-test', version: '4' });
    const before = readFileSync(file, 'utf-8');
    const r = await replace({
      file,
      anchor: 'GraphEngine#load',
      content: [
        'loadUnlocked(): void {',
        "  console.log('boom')",
      ].join('\n'),
      fingerprint,
      autoInjectAnchor: true,
      astSelector: selector,
    });
    assert.equal(r.status, 'failed');
    assert.ok(r.syntaxErrors && r.syntaxErrors.length > 0);
    assert.equal(readFileSync(file, 'utf-8'), before);
  });

  // ────────────── v0.2 新增 ──────────────

  it('#6 缩进归一化：绝对缩进 content 自动转相对缩进', async function () {
    const fingerprint = makeFingerprint({ anchor: 'GraphEngine#load', source: 'normalize', version: '1' });
    await replace({
      file,
      anchor: 'GraphEngine#load',
      content: METHOD_ABS_INDENT,
      fingerprint,
      autoInjectAnchor: true,
      astSelector: selector,
    });
    const src = readFileSync(file, 'utf-8');
    // 类内方法体缩进 = 2 (class) + 2 (body) = 4 空格；6 空格才是归一化失败的翻倍
    assert.match(src, /^ {4}console\.log\('new'\);$/m);
    assert.doesNotMatch(src, /^ {6}console\.log\('new'\);$/m);
  });

  it('#3 重复锚点：同名 START 出现两次时拒绝处理', async function () {
    writeFileSync(file, [
      'export class A {',
      '  // @TRED_START: X | fp=11111111',
      '  foo() {}',
      '  // @TRED_END: X',
      '}',
      'export class B {',
      '  // @TRED_START: X | fp=22222222',
      '  bar() {}',
      '  // @TRED_END: X',
      '}',
      '',
    ].join('\n'));
    const before = readFileSync(file, 'utf-8');
    const r = await replace({
      file,
      anchor: 'X',
      content: 'baz() {}',
      fingerprint: 'deadbeef',
    });
    assert.equal(r.status, 'failed');
    assert.match(r.message || '', /出现 2 次/);
    assert.equal(readFileSync(file, 'utf-8'), before);
  });

  it('#2 dry-run：不写盘且返回 diff', async function () {
    const fingerprint = makeFingerprint({ anchor: 'GraphEngine#load', source: 'dry', version: '1' });
    const before = readFileSync(file, 'utf-8');
    const r = await replace({
      file,
      anchor: 'GraphEngine#load',
      content: METHOD_NEW,
      fingerprint,
      autoInjectAnchor: true,
      astSelector: selector,
      dryRun: true,
    });
    assert.equal(r.status, 'injected');
    assert.equal(readFileSync(file, 'utf-8'), before);
    assert.ok(r.diff && r.diff.includes('@TRED_START'));
    assert.ok(r.diff.includes('+') && r.diff.includes('-'));
  });

  it('#4 format：formatter 在语法门禁前执行', async function () {
    const fingerprint = makeFingerprint({ anchor: 'GraphEngine#load', source: 'fmt', version: '1' });
    const r = await replace({
      file,
      anchor: 'GraphEngine#load',
      content: METHOD_NEW,
      fingerprint,
      autoInjectAnchor: true,
      astSelector: selector,
      format: function (s) {
        return s.replace("console.log('new')", "console.log('formatted')");
      },
    });
    assert.equal(r.status, 'injected');
    const src = readFileSync(file, 'utf-8');
    assert.match(src, /console\.log\('formatted'\)/);
    assert.doesNotMatch(src, /console\.log\('new'\)/);
  });
});

describe('normalizeContent', function () {
  it('绝对缩进 → 相对首行', function () {
    const input = [
      'foo() {',
      "    console.log('x');",
      '  }',
    ].join('\n');
    const expected = [
      'foo() {',
      "  console.log('x');",
      '}',
    ].join('\n');
    assert.equal(normalizeContent(input), expected);
  });

  it('已经相对缩进 → 原样返回', function () {
    const input = [
      'foo() {',
      "  console.log('x');",
      '}',
    ].join('\n');
    assert.equal(normalizeContent(input), input);
  });
});


describe('buildBlock trailing newline', function () {
  it('content 末尾多余换行：END 前不产生空行', async function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-trim-'));
    const file = join(dir, 'main.ts');
    writeFileSync(
      file,
      [
        'export class GraphEngine {',
        '  loadUnlocked(): void {',
        "    console.log('old');",
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    try {
      const fingerprint = makeFingerprint({ anchor: 'GraphEngine#load', source: 'trim', version: '1' });
      await replace({
        file,
        anchor: 'GraphEngine#load',
        content: [
          'loadUnlocked(): void {',
          "  console.log('new');",
          '}',
          '',
          '',
        ].join('\n'),
        fingerprint,
        autoInjectAnchor: true,
        astSelector: { kind: 'method', className: 'GraphEngine', methodName: 'loadUnlocked' },
      });
      const src = readFileSync(file, 'utf-8');
      assert.doesNotMatch(src, /\n[ \t]*\n[ \t]*\/\/ @TRED_END/);
      assert.match(src, /\n  \/\/ @TRED_END: GraphEngine#load\n/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
