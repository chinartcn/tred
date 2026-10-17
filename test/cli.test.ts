import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const NODE = process.execPath;
const WORKER = resolve(ROOT, 'test/cli-worker.ts');

const ORIGINAL = [
  'export class GraphEngine {',
  '  loadUnlocked(): void {',
  "    console.log('old');",
  '  }',
  '}',
  '',
].join('\n');

const BODY = [
  'loadUnlocked(): void {',
  "  console.log('new');",
  '}',
  '',
].join('\n');

const SEL = '{"kind":"method","className":"GraphEngine","methodName":"loadUnlocked"}';

interface Case { id: string; args: string[]; stdin?: string; }
interface Result { id: string; status: number; stdout: string; stderr: string; }

describe('cli (single spawn)', function () {
  let dir: string;
  let results: Record<string, Result> = {};
  const filePaths: Record<string, string> = {};

  before(function () {
    dir = mkdtempSync(join(tmpdir(), 'tred-cli-batch-'));
    filePaths.inject = join(dir, 'inject.ts');
    filePaths.dryrun = join(dir, 'dryrun.ts');
    filePaths.stdin = join(dir, 'stdin.ts');
    filePaths.syntax = join(dir, 'syntax.ts');
    filePaths.json = join(dir, 'json.ts');
    for (const p of Object.values(filePaths)) writeFileSync(p, ORIGINAL);

    const bodyFile = join(dir, 'body.ts');
    const badFile = join(dir, 'bad.ts');
    writeFileSync(bodyFile, BODY);
    writeFileSync(badFile, [
      'loadUnlocked(): void {',
      "  console.log('oops')",
      '',
    ].join('\n'));

    function baseArgs(target: string, extra: string[]): string[] {
      return [
        'replace',
        '--file', target,
        '--anchor', 'GraphEngine#loadUnlocked',
        '--content-file', bodyFile,
        '--fp-source', 'cli-test',
        '--fp-version', '1',
        '--auto-inject',
        '--selector', SEL,
      ].concat(extra);
    }

    const cases: Case[] = [
      { id: 'help', args: ['--help'] },
      { id: 'version', args: ['--version'] },
      { id: 'inject1', args: baseArgs(filePaths.inject, []) },
      { id: 'inject2', args: baseArgs(filePaths.inject, []) },
      { id: 'dryrun', args: baseArgs(filePaths.dryrun, ['--dry-run']) },
      {
        id: 'stdin',
        args: [
          'replace',
          '--file', filePaths.stdin,
          '--anchor', 'GraphEngine#loadUnlocked',
          '--content-stdin',
          '--fp', 'abcdef12',
          '--auto-inject',
          '--selector', SEL,
        ],
        stdin: "loadUnlocked(): void {\n  console.log('stdin');\n}\n",
      },
      {
        id: 'syntax',
        args: [
          'replace',
          '--file', filePaths.syntax,
          '--anchor', 'GraphEngine#loadUnlocked',
          '--content-file', badFile,
          '--fp-source', 's', '--fp-version', '1',
          '--auto-inject',
          '--selector', SEL,
        ],
      },
      { id: 'missing-file', args: ['replace', '--anchor', 'X', '--content', 'y', '--fp', '00000000'] },
      { id: 'json', args: baseArgs(filePaths.json, ['--json']) },
      { id: 'bad-fp', args: ['replace', '--file', filePaths.json, '--anchor', 'X', '--content', 'y', '--fp', 'xyz'] },
      { id: 'fp-conflict', args: ['replace', '--file', filePaths.json, '--anchor', 'X', '--content', 'y', '--fp', '00000000', '--fp-source', 's', '--fp-version', '1'] },
    ];

    const casesFile = join(dir, '_cases.json');
    writeFileSync(casesFile, JSON.stringify(cases));

    const start = Date.now();
    const r = spawnSync(NODE, ['--import', 'tsx', WORKER, casesFile], { encoding: 'utf-8' });
    const elapsed = Date.now() - start;
    if (r.status !== 0) {
      throw new Error('cli-worker failed (status=' + r.status + '): ' + r.stderr);
    }
    const parsed = JSON.parse(r.stdout) as Result[];
    for (const res of parsed) results[res.id] = res;
    console.log('[bench] ' + cases.length + ' cases via 1 spawn in ' + elapsed + 'ms');
  });

  after(function () {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('--help 退出 0 且包含用法', function () {
    assert.equal(results.help.status, 0);
    assert.match(results.help.stdout, /用法/);
    assert.match(results.help.stdout, /--content-file/);
  });

  it('--version 与 package.json 一致', function () {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as { version: string };
    assert.equal(results.version.status, 0);
    assert.equal(results.version.stdout.trim(), 'tred v' + pkg.version);
  });

  it('inject 首次成功，二次幂等 skipped', function () {
    assert.equal(results.inject1.status, 0);
    assert.match(results.inject1.stdout, /INJECTED/);
    assert.equal(results.inject2.status, 0);
    assert.match(results.inject2.stdout, /SKIPPED/);
    const after = readFileSync(filePaths.inject, 'utf-8');
    assert.match(after, /@TRED_START/);
    assert.match(after, /console\.log\('new'\)/);
  });

  it('--dry-run 不写盘且输出 diff', function () {
    assert.equal(results.dryrun.status, 0);
    assert.match(results.dryrun.stdout, /--- /);
    assert.equal(readFileSync(filePaths.dryrun, 'utf-8'), ORIGINAL);
  });

  it('--content-stdin 从管道读内容', function () {
    assert.equal(results.stdin.status, 0);
    assert.match(readFileSync(filePaths.stdin, 'utf-8'), /console\.log\('stdin'\)/);
  });

  it('语法错误退出码 1，文件不变', function () {
    assert.equal(results.syntax.status, 1);
    assert.match(results.syntax.stdout, /FAILED/);
    assert.equal(readFileSync(filePaths.syntax, 'utf-8'), ORIGINAL);
  });

  it('缺 --file 退出码 1', function () {
    assert.equal(results['missing-file'].status, 1);
    assert.match(results['missing-file'].stderr, /--file/);
  });

  it('--json 输出可解析且状态正确', function () {
    assert.equal(results.json.status, 0);
    const parsed = JSON.parse(results.json.stdout);
    assert.equal(parsed.status, 'injected');
    assert.equal(parsed.anchor, 'GraphEngine#loadUnlocked');
  });

  it('--fp 非法格式退出码 1', function () {
    assert.equal(results['bad-fp'].status, 1);
    assert.match(results['bad-fp'].stderr, /8 位/);
  });

  it('--fp 与 --fp-source/--fp-version 互斥', function () {
    assert.equal(results['fp-conflict'].status, 1);
    assert.match(results['fp-conflict'].stderr, /不能同时使用/);
  });
});
