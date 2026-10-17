import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCachePath, isCacheHit, loadCache, saveCache, statFile, verifyDir } from '../src/index.js';

describe('cache 原子读写', function () {
  function setup(): { dir: string; cacheDir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'tred-cache-'));
    const cacheDir = join(dir, '.tred-cache');
    return { dir, cacheDir };
  }

  it('saveCache 后 loadCache 可读回', function () {
    const { cacheDir } = setup();
    try {
      saveCache(cacheDir, { version: 1, entries: {} });
      const c = loadCache(cacheDir);
      assert.ok(c);
      assert.equal(c!.version, 1);
    } finally { rmSync(cacheDir, { recursive: true, force: true }); }
  });

  it('loadCache 缺失文件 → null', function () {
    const { cacheDir } = setup();
    assert.equal(loadCache(cacheDir), null);
  });

  it('loadCache 版本不符 → null', function () {
    const { cacheDir } = setup();
    try {
      const p = getCachePath(cacheDir);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(p, JSON.stringify({ version: 999, entries: {} }));
      assert.equal(loadCache(cacheDir), null);
    } finally { rmSync(cacheDir, { recursive: true, force: true }); }
  });

  it('loadCache 损坏 JSON → null', function () {
    const { cacheDir } = setup();
    try {
      const p = getCachePath(cacheDir);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(p, '{bad json');
      assert.equal(loadCache(cacheDir), null);
    } finally { rmSync(cacheDir, { recursive: true, force: true }); }
  });

  it('statFile 不存在 → null', function () {
    assert.equal(statFile('/definitely/not/exist.ts'), null);
  });

  it('isCacheHit 双条件都匹配才 true', function () {
    const sig = { mtimeMs: 100, size: 50 };
    assert.equal(isCacheHit(undefined, sig), false);
    assert.equal(isCacheHit({ mtimeMs: 100, size: 50, file: null }, sig), true);
    assert.equal(isCacheHit({ mtimeMs: 101, size: 50, file: null }, sig), false);
    assert.equal(isCacheHit({ mtimeMs: 100, size: 51, file: null }, sig), false);
  });
});

describe('verifyDir 缓存集成', function () {
  function setup(): { dir: string; cacheDir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'tred-vc-'));
    const cacheDir = join(dir, '.tred-cache');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src/a.ts'), '// @TRED_START: A | fp=11111111\n// @TRED_END: A\n');
    writeFileSync(join(dir, 'src/b.ts'), 'export const x = 1;\n');
    return { dir, cacheDir };
  }

  it('首次 cache 全 miss，二次全 hit', function () {
    const { dir, cacheDir } = setup();
    try {
      const r1 = verifyDir({ dir, cache: true, cacheDir });
      assert.ok(r1.cacheStats);
      assert.equal(r1.cacheStats!.hits, 0);
      assert.equal(r1.cacheStats!.misses, 2);
      assert.equal(r1.files.length, 1);

      const r2 = verifyDir({ dir, cache: true, cacheDir });
      assert.equal(r2.cacheStats!.hits, 2);
      assert.equal(r2.cacheStats!.misses, 0);
      assert.equal(r2.files.length, 1);
      assert.deepEqual(r2.files[0].anchors, r1.files[0].anchors);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('改文件 → 该文件 miss，其余 hit', function () {
    const { dir, cacheDir } = setup();
    try {
      verifyDir({ dir, cache: true, cacheDir });
      writeFileSync(join(dir, 'src/a.ts'), '// @TRED_START: A | fp=22222222\n// @TRED_END: A\n');
      const r2 = verifyDir({ dir, cache: true, cacheDir });
      assert.equal(r2.cacheStats!.hits, 1);
      assert.equal(r2.cacheStats!.misses, 1);
      assert.equal(r2.files[0].anchors[0].fp, "22222222");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('删文件 → removed 计数', function () {
    const { dir, cacheDir } = setup();
    try {
      verifyDir({ dir, cache: true, cacheDir });
      rmSync(join(dir, 'src/b.ts'));
      const r2 = verifyDir({ dir, cache: true, cacheDir });
      assert.equal(r2.cacheStats!.removed, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('未开 cache：cacheStats 为 undefined，且不写缓存文件', function () {
    const { dir, cacheDir } = setup();
    try {
      const r = verifyDir({ dir });
      assert.equal(r.cacheStats, undefined);
      assert.throws(() => readFileSync(getCachePath(cacheDir), 'utf-8'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('缓存文件损坏 → 全 miss 后重建', function () {
    const { dir, cacheDir } = setup();
    try {
      verifyDir({ dir, cache: true, cacheDir });
      writeFileSync(getCachePath(cacheDir), '{bad');
      const r2 = verifyDir({ dir, cache: true, cacheDir });
      assert.equal(r2.cacheStats!.hits, 0);
      assert.equal(r2.cacheStats!.misses, 2);
      const c = loadCache(cacheDir);
      assert.ok(c);
      assert.equal(Object.keys(c!.entries).length, 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('.tred-cache 本身不会被扫进结果', function () {
    const { dir, cacheDir } = setup();
    try {
      verifyDir({ dir, cache: true, cacheDir });
      const r2 = verifyDir({ dir, cache: true, cacheDir });
      assert.equal(r2.scannedFiles, 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
