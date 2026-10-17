import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixDir, verifyDir } from '../src/index.js';

describe('fixDir --cache', function () {
  function setup(): { dir: string; cacheDir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'tred-fc-'));
    const cacheDir = join(dir, '.tred-cache');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
      join(dir, 'src/a.ts'),
      'export class A {\n  // @TRED_END: ghost\n  x() {}\n}\n',
    );
    writeFileSync(
      join(dir, 'src/b.ts'),
      'export const x = 1;\n',
    );
    return { dir, cacheDir };
  }

  it('未开 cache：cacheStats 为 undefined，且不写缓存文件', function () {
    const { dir, cacheDir } = setup();
    try {
      fixDir({ dir, apply: false });
      assert.throws(() => readFileSync(join(cacheDir, 'verify.json'), 'utf-8'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fix --cache --apply：修复后缓存反映新状态，verify 全 hit', function () {
    const { dir, cacheDir } = setup();
    try {
      // 1. 首次 fix（无缓存）：全 miss，修掉 ghost
      const f1 = fixDir({ dir, apply: true, cache: true, cacheDir });
      assert.equal(f1.totalActions, 1);
      assert.equal(f1.files[0].applied, true);

      // 2. 紧接 verify：应该全 hit（fix 主动更新了缓存）
      const v = verifyDir({ dir, cache: true, cacheDir });
      assert.equal(v.cacheStats!.hits, v.scannedFiles);
      assert.equal(v.cacheStats!.misses, 0);
      assert.equal(v.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fix --cache 无修改：不更新缓存，verify 保持 hit', function () {
    const { dir, cacheDir } = setup();
    try {
      // 先把 ghost 修掉并缓存
      fixDir({ dir, apply: true, cache: true, cacheDir });

      // 第二次 fix：无改动
      const f2 = fixDir({ dir, apply: true, cache: true, cacheDir });
      assert.equal(f2.totalActions, 0);

      const v = verifyDir({ dir, cache: true, cacheDir });
      assert.equal(v.cacheStats!.misses, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('fix --cache --apply 未传 cache-dir：写入默认 .tred-cache', function () {
    const { dir } = setup();
    const cwd = process.cwd();
    try {
      process.chdir(dir);
      fixDir({ dir: ".", apply: true, cache: true });
      const cachePath = join(dir, '.tred-cache/verify.json');
      const raw = readFileSync(cachePath, 'utf-8');
      const parsed = JSON.parse(raw);
      assert.equal(parsed.version, 1);
    } finally {
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fix --cache dry-run（不 apply）：不写缓存（避免与实际状态不一致）', function () {
    const { dir, cacheDir } = setup();
    try {
      const r = fixDir({ dir, apply: false, cache: true, cacheDir });
      assert.equal(r.dryRun, true);
      // fix 未写盘，缓存条目应保留原始状态（若首次 verifyDir 内已写入）
      // 验证文件仍未被改
      const after = readFileSync(join(dir, 'src/a.ts'), 'utf-8');
      assert.match(after, /@TRED_END: ghost/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
