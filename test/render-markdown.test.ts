import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { renderFixMarkdown, renderVerifyMarkdown } from '../src/index.js';
import type { FixReport, VerifyReport } from '../src/index.js';

function emptyVerifyReport(): VerifyReport {
  return {
    ok: true, dir: 'src', scannedFiles: 3, files: [],
    issues: [], duplicatesWithin: [], duplicatesAcross: [], fingerprintMismatches: [],
  };
}

describe('renderVerifyMarkdown', function () {
  it('空报告：含标题、✅ 无问题', function () {
    const md = renderVerifyMarkdown(emptyVerifyReport());
    assert.match(md, /^<!-- tred:verify -->/);
    assert.match(md, /## 🔍 tred verify/);
    assert.match(md, /### ✅ 无问题/);
  });

  it('有 error：❌ 未通过 + 表格行', function () {
    const r = emptyVerifyReport();
    r.ok = false;
    r.files = [{
      file: 'a.ts',
      anchors: [{ name: 'A#x', line: 2, endLine: 4, fp: 'a1b2c3d4' }],
      orphans: [{ name: 'A#ghost', line: 5, kind: 'end' }],
    }];
    r.issues = [{
      level: 'error', code: 'ORPHAN_END', file: 'a.ts', line: 5,
      message: '锚点 "A#ghost" 有 END 无 START',
    }];
    const md = renderVerifyMarkdown(r);
    assert.match(md, /### ❌ 未通过（1 个 error，0 个 warning）/);
    assert.match(md, /ORPHAN_END/);
    assert.match(md, /<details><summary>❌/);
  });

  it('| 转义', function () {
    const r = emptyVerifyReport();
    r.ok = false;
    r.issues = [{ level: 'warning', code: 'X', message: 'a | b' }];
    const md = renderVerifyMarkdown(r);
    assert.match(md, /a \\\| b/);
  });
});

describe('renderFixMarkdown', function () {
  function emptyFixReport(): FixReport {
    return {
      ok: true, dryRun: true, dir: 'src', scannedFiles: 2,
      files: [], totalActions: 0, remainingOrphanStarts: [],
    };
  }

  it('dry-run 无修复：✅ 无需修复', function () {
    const md = renderFixMarkdown(emptyFixReport());
    assert.match(md, /^<!-- tred:verify-fix -->/);
    assert.match(md, /\(dry-run\)/);
    assert.match(md, /### ✅ 无需修复/);
  });

  it('apply 有修复', function () {
    const r = emptyFixReport();
    r.dryRun = false;
    r.totalActions = 1;
    r.files = [{
      file: 'a.ts',
      actions: [{ kind: 'delete-orphan-end', line: 5, anchorName: 'ghost', description: '删除孤儿 END: "ghost" @ L5' }],
      diff: '', applied: true,
    }];
    const md = renderFixMarkdown(r);
    assert.match(md, /\(--apply\)/);
    assert.match(md, /### 修复结果 \(1 处\)/);
    assert.match(md, /- L5 — 删除孤儿 END/);
  });

  it('remainingOrphanStarts 警告', function () {
    const r = emptyFixReport();
    r.totalActions = 1;
    r.files = [{
      file: 'a.ts',
      actions: [{ kind: 'delete-orphan-end', line: 5, anchorName: 'g', description: '删 g' }],
      diff: '', applied: true,
    }];
    r.remainingOrphanStarts = [{ file: 'b.ts', line: 3, anchorName: 'Bar#y', kind: 'start' }];
    const md = renderFixMarkdown(r);
    assert.match(md, /### ⚠ 需手动处理 \(1 处孤儿 START\)/);
    assert.match(md, /tred replace --auto-inject --selector/);
  });
});
