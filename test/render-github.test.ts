import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { renderGithubAnnotations, renderFixGithubAnnotations } from '../src/index.js';
import type { VerifyReport, FixReport } from '../src/index.js';

function emptyVerify(): VerifyReport {
  return {
    ok: true, dir: 'src', scannedFiles: 5, files: [],
    issues: [], duplicatesWithin: [], duplicatesAcross: [], fingerprintMismatches: [],
  };
}

describe('renderGithubAnnotations', function () {
  it('无 issue：输出 notice', function () {
    const out = renderGithubAnnotations(emptyVerify());
    assert.match(out, /^::notice title=tred::/);
    assert.match(out, /verify 通过/);
  });

  it('error 输出 ::error 前缀', function () {
    const r = emptyVerify();
    r.ok = false;
    r.issues = [{ level: 'error', code: 'ORPHAN_START', file: 'a.ts', line: 5, message: '有 START 无 END' }];
    const out = renderGithubAnnotations(r);
    assert.match(out, /^::error file=a\.ts,line=5,title=ORPHAN_START::有 START 无 END/m);
  });

  it('warning 输出 ::warning 前缀', function () {
    const r = emptyVerify();
    r.issues = [{ level: 'warning', code: 'DUP', file: 'b.ts', line: 3, message: '重复锚点' }];
    const out = renderGithubAnnotations(r);
    assert.match(out, /^::warning file=b\.ts,line=3,title=DUP::重复锚点/m);
  });

  it('% 转义为 %25', function () {
    const r = emptyVerify();
    r.issues = [{ level: 'error', code: 'X', file: 'a.ts', line: 1, message: '50% 的代码' }];
    const out = renderGithubAnnotations(r);
    assert.match(out, /50%25 的代码/);
    assert.doesNotMatch(out, /50% 的代码/);
  });

  it('文件路径的 : 和 , 转义', function () {
    const r = emptyVerify();
    r.issues = [{ level: 'error', code: 'X', file: 'a:b,c.ts', line: 1, message: 'x' }];
    const out = renderGithubAnnotations(r);
    assert.match(out, /file=a%3Ab%2Cc\.ts/);
  });

  it('message 里的换行转义为 %0A', function () {
    const r = emptyVerify();
    r.issues = [{ level: 'error', code: 'X', file: 'a.ts', line: 1, message: 'a\nb' }];
    const out = renderGithubAnnotations(r);
    assert.match(out, /a%0Ab/);
  });
});

describe('renderFixGithubAnnotations', function () {
  function emptyFix(): FixReport {
    return { ok: true, dryRun: true, dir: 'src', scannedFiles: 2, files: [], totalActions: 0, remainingOrphanStarts: [] };
  }

  it('无修复：notice', function () {
    const out = renderFixGithubAnnotations(emptyFix());
    assert.match(out, /^::notice title=tred-fix::/);
  });

  it('apply 成功：notice + 文件', function () {
    const r = emptyFix();
    r.dryRun = false;
    r.files = [{ file: 'a.ts', actions: [], diff: '', applied: true }];
    const out = renderFixGithubAnnotations(r);
    assert.match(out, /^::notice file=a\.ts,title=tred-fix::/m);
  });

  it('有 error：::error', function () {
    const r = emptyFix();
    r.files = [{ file: 'bad.ts', actions: [], diff: '', applied: false, error: '语法校验失败' }];
    const out = renderFixGithubAnnotations(r);
    assert.match(out, /^::error file=bad\.ts,title=tred-fix::语法校验失败/m);
  });
});
