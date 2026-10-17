import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor } from '../src/index.js';

describe('doctor', function () {
  it('空目录：基础字段存在，ok=true（无 error）', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-doc-'));
    try {
      const r = doctor({ dir });
      assert.equal(typeof r.ok, 'boolean');
      assert.equal(typeof r.tredVersion, 'string');
      assert.equal(typeof r.packageVersion, 'string');
      assert.equal(typeof r.nodeVersion, 'string');
      assert.equal(typeof r.platform, 'string');
      assert.ok(Array.isArray(r.suggestions));
      assert.ok(r.suggestions.length > 0);
      assert.equal(r.anchors.errors, 0);
      assert.equal(r.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('有 error 级锚点：ok=false，suggestions 提到问题', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-doc-'));
    try {
      writeFileSync(join(dir, 'broken.ts'), '// @TRED_START: X\nbody\n');
      const r = doctor({ dir });
      assert.equal(r.ok, false);
      assert.ok(r.anchors.errors > 0);
      const hasSuggestion = r.suggestions.some((s) => s.indexOf('error') >= 0);
      assert.equal(hasSuggestion, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('版本文件一致', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-doc-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '9.9.9' }));
      writeFileSync(join(dir, '.tred-version'), '9.9.9\n');
      const r = doctor({ dir });
      assert.equal(r.packageVersion, '9.9.9');
      assert.equal(r.tredVersion, '9.9.9');
      const mismatch = r.suggestions.some((s) => s.indexOf('版本不一致') >= 0);
      assert.equal(mismatch, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('版本不一致：suggestion 报告', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-doc-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      writeFileSync(join(dir, '.tred-version'), '2.0.0\n');
      const r = doctor({ dir });
      const mismatch = r.suggestions.some((s) => s.indexOf('版本不一致') >= 0);
      assert.equal(mismatch, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('缓存存在时报告 entries', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-doc-'));
    try {
      mkdirSync(join(dir, '.tred-cache'), { recursive: true });
      writeFileSync(
        join(dir, '.tred-cache', 'verify.json'),
        JSON.stringify({ version: 1, entries: { 'a.ts': { mtimeMs: 1, size: 10, file: null } } }),
      );
      const r = doctor({ dir });
      assert.equal(r.cache.exists, true);
      assert.equal(r.cache.entries, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('JSON 可序列化', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-doc-'));
    try {
      const r = doctor({ dir });
      const j = JSON.parse(JSON.stringify(r));
      assert.equal(typeof j.nodeVersion, 'string');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
