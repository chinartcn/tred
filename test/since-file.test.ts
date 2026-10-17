import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDir, annotateDir } from '../src/index.js';

describe('verifyDir --sinceFile', function () {
  it('只扫 sinceFile 列出的文件', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-sf-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/a.ts'), '// @TRED_START: A | fp=11111111\n// @TRED_END: A\n');
      writeFileSync(join(dir, 'src/b.ts'), '// @TRED_START: B | fp=22222222\n// @TRED_END: B\n');
      const listPath = join(dir, '_list.txt');
      writeFileSync(listPath, 'src/a.ts\n');
      const r = verifyDir({ dir, sinceFile: listPath } as any);
      assert.equal(r.files.length, 1);
      assert.match(r.files[0].file, /a\.ts$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('sinceFile 不存在：不崩溃，全量扫', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-sf-'));
    try {
      writeFileSync(join(dir, 'a.ts'), '// @TRED_START: A | fp=11111111\n// @TRED_END: A\n');
      const r = verifyDir({ dir, sinceFile: '/no/such/list.txt' } as any);
      // 应该 fallback 到全量（sinceSet 为空）
      assert.equal(r.files.length, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('空文件列表：处理 0 文件', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-sf-'));
    try {
      writeFileSync(join(dir, 'a.ts'), '// @TRED_START: A | fp=11111111\n// @TRED_END: A\n');
      const listPath = join(dir, '_empty.txt');
      writeFileSync(listPath, '');
      const r = verifyDir({ dir, sinceFile: listPath } as any);
      // 空 set 会过滤掉所有文件
      assert.equal(r.files.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('annotateDir --sinceFile', function () {
  it('只处理 sinceFile 列出的文件', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-sf-a-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src/a.ts'), 'export class Foo {}\n');
      writeFileSync(join(dir, 'src/b.ts'), 'export class Bar {}\n');
      const listPath = join(dir, '_list.txt');
      writeFileSync(listPath, 'src/a.ts\n');
      const r = annotateDir({ dir, classes: true, sinceFile: listPath } as any);
      assert.equal(r.annotatedFiles, 1);
      assert.match(r.files[0].file, /a\.ts$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
