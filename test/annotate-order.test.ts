import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotateDir } from '../src/index.js';

function setup(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tred-ao-'));
  for (const rel of Object.keys(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, files[rel]);
  }
  return dir;
}

describe('annotateDir order', function () {
  it('source（默认）：按路径字母排', function () {
    const dir = setup({
      'z.ts': 'export class Zed {}\n',
      'a.ts': 'export class Alpha {}\n',
      'm.ts': 'export class Mike {}\n',
    });
    try {
      const r = annotateDir({ dir, classes: true });
      assert.equal(r.files.length, 3);
      assert.ok(r.files[0].file.endsWith('a.ts'));
      assert.ok(r.files[1].file.endsWith('m.ts'));
      assert.ok(r.files[2].file.endsWith('z.ts'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('name：按首锚点名排', function () {
    const dir = setup({
      'z.ts': 'export class Charlie {}\n',
      'a.ts': 'export class Alpha {}\n',
      'm.ts': 'export class Bravo {}\n',
    });
    try {
      const r = annotateDir({ dir, classes: true, order: 'name' });
      assert.equal(r.files.length, 3);
      // 按 class 名字母排：Alpha, Bravo, Charlie
      assert.ok(r.files[0].file.endsWith('a.ts'));
      assert.ok(r.files[1].file.endsWith('m.ts'));
      assert.ok(r.files[2].file.endsWith('z.ts'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('kind：按 nodeKind 排', function () {
    const dir = setup({
      'f.ts': 'export function helper() {}\n',
      'c.ts': 'export class Alpha {}\n',
    });
    try {
      const r = annotateDir({ dir, classes: true, functions: true, order: 'kind' });
      assert.equal(r.files.length, 2);
      // class < function
      assert.ok(r.files[0].file.endsWith('c.ts'));
      assert.ok(r.files[1].file.endsWith('f.ts'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('空目录 → 排序无副作用', function () {
    const dir = setup({});
    try {
      const r = annotateDir({ dir, classes: true, order: 'name' });
      assert.equal(r.files.length, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
