import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBaseline, filterIssuesByBaseline, loadBaseline, saveBaseline, verifyDir } from '../src/index.js';

describe('baseline save/load', function () {
  it('save 后 load 可读回', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-bl-'));
    try {
      const fp = join(dir, 'b.json');
      saveBaseline(fp, { version: 1, createdAt: '2026-01-01T00:00:00Z', dir: '.', issues: [] });
      const b = loadBaseline(fp);
      assert.ok(b);
      assert.equal(b!.version, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('文件缺失 → null', function () {
    assert.equal(loadBaseline('/no/such/baseline.json'), null);
  });
  it('损坏 JSON → null', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-bl-'));
    try {
      const fp = join(dir, 'bad.json');
      writeFileSync(fp, '{bad');
      assert.equal(loadBaseline(fp), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('版本不符 → null', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-bl-'));
    try {
      const fp = join(dir, 'v2.json');
      writeFileSync(fp, JSON.stringify({ version: 2, issues: [] }));
      assert.equal(loadBaseline(fp), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('buildBaseline + filterIssuesByBaseline', function () {
  function setup(): { dir: string; report: ReturnType<typeof verifyDir> } {
    const dir = mkdtempSync(join(tmpdir(), 'tred-bl2-'));
    writeFileSync(join(dir, 'a.ts'), '// @TRED_START: X\nbody\n');
    const report = verifyDir({ dir });
    return { dir, report };
  }

  it('buildBaseline 把 issues 拷贝过去', function () {
    const { dir, report } = setup();
    try {
      assert.ok(report.issues.length > 0);
      const bl = buildBaseline(report);
      assert.equal(bl.issues.length, report.issues.length);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('filterIssuesByBaseline 全部命中 → ok=true', function () {
    const { dir, report } = setup();
    try {
      const bl = buildBaseline(report);
      const filtered = filterIssuesByBaseline(report, bl, false);
      assert.equal(filtered.issues.length, 0);
      assert.equal(filtered.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('新增 issue 未命中基线 → ok=false', function () {
    const { dir, report } = setup();
    try {
      const bl = buildBaseline(report);
      // 加一个新 issue
      const r2 = verifyDir({ dir });
      const augmented = Object.assign({}, r2, {
        issues: r2.issues.concat([{ level: 'error', code: 'NEW', message: '新问题', file: 'b.ts', line: 1 }]),
        ok: false,
      });
      const filtered = filterIssuesByBaseline(augmented, bl, false);
      assert.equal(filtered.issues.length, 1);
      assert.equal(filtered.ok, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('strict 模式下 warning 也阻塞', function () {
    const { dir, report } = setup();
    try {
      const bl = buildBaseline(report);
      const augmented = Object.assign({}, report, {
        issues: [{ level: 'warning', code: 'W', message: 'warn', file: 'c.ts', line: 1 }],
        ok: true,
      });
      const filteredNonStrict = filterIssuesByBaseline(augmented, bl, false);
      assert.equal(filteredNonStrict.ok, true);
      const filteredStrict = filterIssuesByBaseline(augmented, bl, true);
      assert.equal(filteredStrict.ok, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
