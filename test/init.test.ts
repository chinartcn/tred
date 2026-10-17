import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init } from '../src/index.js';

describe('init', function () {
  it('空目录 → 生成 .tred/config.json', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-init-'));
    try {
      const r = init({ dir });
      assert.equal(r.ok, true);
      assert.ok(r.created.indexOf('.tred/config.json') >= 0 || r.created.some((c) => c.indexOf('config.json') >= 0));
      assert.ok(existsSync(join(dir, '.tred/config.json')));
      const cfg = JSON.parse(readFileSync(join(dir, '.tred/config.json'), 'utf-8'));
      assert.equal(cfg.dir, 'src');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('二次调用 → config 被跳过', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-init-'));
    try {
      init({ dir });
      const r2 = init({ dir });
      assert.equal(r2.ok, true);
      assert.equal(r2.created.length, 0);
      assert.ok(r2.skipped.some((s) => s.indexOf('config.json') >= 0));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--with-hook 生成 pre-commit', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-init-'));
    try {
      mkdirSync(join(dir, '.git/hooks'), { recursive: true });
      const r = init({ dir, withHook: true });
      assert.equal(r.ok, true);
      assert.ok(r.hookPath);
      assert.ok(existsSync(join(dir, '.git/hooks/pre-commit')));
      const hook = readFileSync(join(dir, '.git/hooks/pre-commit'), 'utf-8');
      assert.match(hook, /tred verify/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('--with-hook 但目录不存在 → 自动创建 .git/hooks', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-init-'));
    try {
      const r = init({ dir, withHook: true });
      assert.equal(r.ok, true);
      assert.ok(existsSync(join(dir, '.git/hooks/pre-commit')));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
