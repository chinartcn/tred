import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSkeleton } from '../src/create.js';

describe('createSkeleton', function () {
  it('生成 function 骨架（apply）', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-create-'));
    const file = join(dir, 'test.ts');
    try {
      const r = createSkeleton({ file, type: 'function', name: 'myFunc', apply: true });
      assert.equal(r.ok, true);
      const content = readFileSync(file, 'utf-8');
      assert.match(content, /@TRED_START: myFunc/);
      assert.match(content, /export function myFunc\(\)/);
      assert.match(content, /@TRED_END: myFunc/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('生成 class 骨架（dry-run 不写盘）', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-create-'));
    const file = join(dir, 'test.ts');
    try {
      const r = createSkeleton({ file, type: 'class', name: 'MyClass', apply: false });
      assert.equal(r.ok, true);
      assert.equal(existsSync(file), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('追加到已有文件', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-create-'));
    const file = join(dir, 'test.ts');
    writeFileSync(file, 'export const x = 1;\n');
    try {
      createSkeleton({ file, type: 'interface', name: 'IFoo', apply: true });
      const content = readFileSync(file, 'utf-8');
      assert.match(content, /export const x = 1;/);
      assert.match(content, /export interface IFoo/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
