import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDiffLines } from '../src/index.js';

const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf-8' }).status === 0;

function gitIn(dir: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr);
}

describe('getDiffLines', { skip: !HAS_GIT ? 'git not installed' : false }, function () {
  it('单文件单行修改：返回该行号', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-dl-'));
    try {
      gitIn(dir, ['init', '-b', 'main']);
      gitIn(dir, ['config', 'user.email', 't@t.com']);
      gitIn(dir, ['config', 'user.name', 'T']);
      writeFileSync(join(dir, 'a.ts'), 'line1\nline2\nline3\n');
      gitIn(dir, ['add', '.']);
      gitIn(dir, ['commit', '-m', 'init']);
      writeFileSync(join(dir, 'a.ts'), 'line1\nMODIFIED\nline3\n');
      gitIn(dir, ['add', '.']);
      gitIn(dir, ['commit', '-m', 'mod']);

      const map = getDiffLines('HEAD~1', dir);
      const lines = map.get('a.ts');
      assert.ok(lines);
      assert.ok(lines!.has(2));
      assert.equal(lines!.has(1), false);
      assert.equal(lines!.has(3), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('多文件改动：各自返回行号', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-dl-'));
    try {
      gitIn(dir, ['init', '-b', 'main']);
      gitIn(dir, ['config', 'user.email', 't@t.com']);
      gitIn(dir, ['config', 'user.name', 'T']);
      writeFileSync(join(dir, 'a.ts'), 'a1\na2\n');
      writeFileSync(join(dir, 'b.ts'), 'b1\nb2\n');
      gitIn(dir, ['add', '.']);
      gitIn(dir, ['commit', '-m', 'init']);
      writeFileSync(join(dir, 'a.ts'), 'a1\nMOD\na3\n');
      writeFileSync(join(dir, 'b.ts'), 'b1\nB_MOD\n');
      gitIn(dir, ['add', '.']);
      gitIn(dir, ['commit', '-m', 'mods']);

      const map = getDiffLines('HEAD~1', dir);
      assert.ok(map.get('a.ts'));
      assert.ok(map.get('b.ts'));
      assert.ok(map.get('a.ts')!.has(2));
      assert.ok(map.get('b.ts')!.has(2));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('无改动：空 Map', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-dl-'));
    try {
      gitIn(dir, ['init', '-b', 'main']);
      gitIn(dir, ['config', 'user.email', 't@t.com']);
      gitIn(dir, ['config', 'user.name', 'T']);
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      gitIn(dir, ['add', '.']);
      gitIn(dir, ['commit', '-m', 'init']);

      const map = getDiffLines('HEAD', dir);
      assert.equal(map.size, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('非法 ref：返回空 Map（不抛错）', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-dl-'));
    try {
      gitIn(dir, ['init', '-b', 'main']);
      gitIn(dir, ['config', 'user.email', 't@t.com']);
      gitIn(dir, ['config', 'user.name', 'T']);
      writeFileSync(join(dir, 'a.ts'), 'x\n');
      gitIn(dir, ['add', '.']);
      gitIn(dir, ['commit', '-m', 'init']);
      const map = getDiffLines('no-such-ref-999', dir);
      assert.equal(map.size, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
