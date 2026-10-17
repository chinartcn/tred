import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { renderHtml } from '../src/index.js';
import type { VerifyReport } from '../src/index.js';

function emptyReport(): VerifyReport {
  return {
    ok: true, dir: 'src', scannedFiles: 3, files: [],
    issues: [], duplicatesWithin: [], duplicatesAcross: [], fingerprintMismatches: [],
  };
}

describe('renderHtml', function () {
  it('空 report：合法 HTML 结构', function () {
    const html = renderHtml(emptyReport(), { version: '1.1.0' });
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<title>tred verify report<\/title>/);
    assert.match(html, /tred v1\.1\.0/);
    assert.match(html, /✅ All checks passed/);
  });

  it('有 error：显示红色状态', function () {
    const r = emptyReport();
    r.ok = false;
    r.issues = [{ level: 'error', code: 'ORPHAN_START', file: 'a.ts', line: 5, message: '有 START 无 END' }];
    const html = renderHtml(r);
    assert.match(html, /❌ 1 error/);
    assert.match(html, /ORPHAN_START/);
    assert.match(html, /a\.ts:5/);
  });

  it('XSS 防护：message 含 <script> 被转义', function () {
    const r = emptyReport();
    r.issues = [{ level: 'error', code: 'X', file: 'a.ts', line: 1, message: '<script>alert(1)</script>' }];
    const html = renderHtml(r);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert/);
  });

  it('file 路径转义', function () {
    const r = emptyReport();
    r.files = [{
      file: 'a<b>.ts',
      anchors: [{ name: 'X', line: 1, endLine: 2, fp: null }],
      orphans: [],
    }];
    const html = renderHtml(r);
    assert.match(html, /a&lt;b&gt;\.ts/);
    assert.doesNotMatch(html, /a<b>\.ts/);
  });

  it('含 filter 脚本', function () {
    const r = emptyReport();
    r.issues = [{ level: 'error', code: 'X', file: 'a.ts', line: 1, message: 'x' }];
    const html = renderHtml(r);
    assert.match(html, /id="filter"/);
    assert.match(html, /getElementById\("filter"\)/);
  });

  it('无锚点：显示 empty 提示', function () {
    const html = renderHtml(emptyReport());
    assert.match(html, /No anchors found/);
  });

  it('含 details 折叠 + stats 卡片', function () {
    const r = emptyReport();
    r.files = [{
      file: 'a.ts',
      anchors: [{ name: 'A#x', line: 2, endLine: 4, fp: 'abcdef12' }],
      orphans: [],
    }];
    const html = renderHtml(r);
    assert.match(html, /<details>/);
    assert.match(html, /Scanned Files/);
    assert.match(html, /A#x/);
    assert.match(html, /fp=abcdef12/);
  });
});
