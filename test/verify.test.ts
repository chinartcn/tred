import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanFileAnchors, verifyDir } from '../src/index.js';

describe('scanFileAnchors', function () {
  it('配对 + fp 提取', function () {
    const src = [
      '// @TRED_START: A | fp=12345678',
      'body',
      '// @TRED_END: A',
      '// @TRED_START: B',
      'body',
      '// @TRED_END: B',
    ].join('\n');
    const r = scanFileAnchors(src);
    assert.equal(r.anchors.length, 2);
    assert.equal(r.orphans.length, 0);
    assert.equal(r.anchors[0].name, 'A');
    assert.equal(r.anchors[0].fp, '12345678');
    assert.equal(r.anchors[0].line, 1);
    assert.equal(r.anchors[0].endLine, 3);
    assert.equal(r.anchors[1].fp, null);
  });

  it('孤儿 START', function () {
    const r = scanFileAnchors('// @TRED_START: X\nbody\n');
    assert.equal(r.anchors.length, 0);
    assert.equal(r.orphans.length, 1);
    assert.equal(r.orphans[0].kind, 'start');
    assert.equal(r.orphans[0].line, 1);
  });

  it('孤儿 END', function () {
    const r = scanFileAnchors('// @TRED_END: X\n');
    assert.equal(r.anchors.length, 0);
    assert.equal(r.orphans.length, 1);
    assert.equal(r.orphans[0].kind, 'end');
  });

  it('同名多块 FIFO 配对', function () {
    const src = [
      '// @TRED_START: X | fp=11111111',
      '// @TRED_END: X',
      '// @TRED_START: X | fp=22222222',
      '// @TRED_END: X',
    ].join('\n');
    const r = scanFileAnchors(src);
    assert.equal(r.anchors.length, 2);
    assert.equal(r.anchors[0].fp, '11111111');
    assert.equal(r.anchors[1].fp, '22222222');
  });

  it('嵌套不同名锚点', function () {
    const src = [
      '// @TRED_START: OUTER',
      '// @TRED_START: INNER',
      '// @TRED_END: INNER',
      '// @TRED_END: OUTER',
    ].join('\n');
    const r = scanFileAnchors(src);
    assert.equal(r.anchors.length, 2);
    assert.equal(r.orphans.length, 0);
  });
});

describe('verifyDir', function () {
  function setup(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'tred-verify-'));
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
    }
    return dir;
  }

  it('健康项目 ok=true', function () {
    const dir = setup({
      'a.ts': '// @TRED_START: X | fp=a1b2c3d4\n// @TRED_END: X\n',
    });
    try {
      const r = verifyDir({ dir });
      assert.equal(r.ok, true);
      assert.equal(r.issues.length, 0);
      assert.equal(r.files.length, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('孤儿 START → error，ok=false', function () {
    const dir = setup({
      'a.ts': '// @TRED_START: X\nbody\n',
    });
    try {
      const r = verifyDir({ dir });
      assert.equal(r.ok, false);
      assert.ok(r.issues.some(function (i) { return i.code === 'ORPHAN_START'; }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('同文件重复 → error', function () {
    const dir = setup({
      'a.ts': [
        '// @TRED_START: X | fp=11111111',
        '// @TRED_END: X',
        '// @TRED_START: X | fp=22222222',
        '// @TRED_END: X',
      ].join('\n'),
    });
    try {
      const r = verifyDir({ dir });
      assert.equal(r.ok, false);
      assert.equal(r.duplicatesWithin.length, 1);
      assert.ok(r.issues.some(function (i) { return i.code === 'DUPLICATE_WITHIN'; }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('跨文件重复 → warning，非 strict 下 ok=true', function () {
    const dir = setup({
      'a.ts': '// @TRED_START: X | fp=aaaaaaaa\n// @TRED_END: X\n',
      'b.ts': '// @TRED_START: X | fp=aaaaaaaa\n// @TRED_END: X\n',
    });
    try {
      const r = verifyDir({ dir });
      assert.equal(r.ok, true);
      assert.equal(r.duplicatesAcross.length, 1);
      assert.ok(r.issues.some(function (i) { return i.code === 'DUPLICATE_ACROSS' && i.level === 'warning'; }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('strict 模式下跨文件重复 → ok=false', function () {
    const dir = setup({
      'a.ts': '// @TRED_START: X | fp=aaaaaaaa\n// @TRED_END: X\n',
      'b.ts': '// @TRED_START: X | fp=aaaaaaaa\n// @TRED_END: X\n',
    });
    try {
      const r = verifyDir({ dir, strict: true });
      assert.equal(r.ok, false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('跨文件指纹不一致 → warning + fingerprintMismatches', function () {
    const dir = setup({
      'a.ts': '// @TRED_START: X | fp=aaaaaaaa\n// @TRED_END: X\n',
      'b.ts': '// @TRED_START: X | fp=bbbbbbbb\n// @TRED_END: X\n',
    });
    try {
      const r = verifyDir({ dir });
      assert.equal(r.fingerprintMismatches.length, 1);
      assert.ok(r.issues.some(function (i) { return i.code === 'FP_MISMATCH'; }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('忽略 node_modules / .git / dist', function () {
    const dir = setup({
      'node_modules/skip.ts': '// @TRED_START: X\n',
      'dist/skip.ts': '// @TRED_END: Y\n',
      'src/ok.ts': '// @TRED_START: OK | fp=a1b2c3d4\n// @TRED_END: OK\n',
    });
    try {
      const r = verifyDir({ dir });
      assert.equal(r.ok, true);
      assert.equal(r.files.length, 1);
      assert.equal(r.files[0].file, join('src', 'ok.ts'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('不扫无锚点文件（scannedFiles 计数，files 只含含锚点）', function () {
    const dir = setup({
      'empty.ts': 'export const x = 1;\n',
      'anchored.ts': '// @TRED_START: A | fp=11111111\n// @TRED_END: A\n',
    });
    try {
      const r = verifyDir({ dir });
      assert.equal(r.scannedFiles, 2);
      assert.equal(r.files.length, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('report 可 JSON 序列化', function () {
    const dir = setup({
      'a.ts': '// @TRED_START: X | fp=aaaaaaaa\n// @TRED_END: X\n',
    });
    try {
      const r = verifyDir({ dir });
      const j = JSON.parse(JSON.stringify(r));
      assert.equal(j.ok, true);
      assert.equal(typeof j.scannedFiles, 'number');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
