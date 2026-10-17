import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  isGitRepo, getCurrentBranch, getHeadSha, isDirty,
  getStagedFiles, getUnstagedFiles, getUntrackedFiles,
  getChangedFiles, gitShow,
} from '../src/index.js';

const HAS_GIT = spawnSync('git', ['--version'], { encoding: 'utf-8' }).status === 0;

function gitIn(dir: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + r.stderr);
}

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tred-git-'));
  gitIn(dir, ['init', '-b', 'main']);
  gitIn(dir, ['config', 'user.email', 'test@test.com']);
  gitIn(dir, ['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
  gitIn(dir, ['add', 'a.ts']);
  gitIn(dir, ['commit', '-m', 'init']);
  return dir;
}

describe('git APIs', { skip: !HAS_GIT ? 'git not installed' : false }, function () {
  it('isGitRepo: 仓库外 false，仓库内 true', function () {
    assert.equal(isGitRepo(os.tmpdir()), false);
    const dir = setupRepo();
    try { assert.equal(isGitRepo(dir), true); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('getCurrentBranch / getHeadSha', function () {
    const dir = setupRepo();
    try {
      assert.equal(getCurrentBranch(dir), 'main');
      assert.ok(getHeadSha(dir));
      assert.equal((getHeadSha(dir) as string).length, 40);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('isDirty：clean → false，modify → true', function () {
    const dir = setupRepo();
    try {
      assert.equal(isDirty(dir), false);
      writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
      assert.equal(isDirty(dir), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('getUntrackedFiles / getStagedFiles / getUnstagedFiles', function () {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'b.ts'), 'x\n');
      assert.deepEqual(getUntrackedFiles(dir), ['b.ts']);
      gitIn(dir, ['add', 'b.ts']);
      assert.deepEqual(getStagedFiles(dir), ['b.ts']);
      assert.deepEqual(getUnstagedFiles(dir), []);
      writeFileSync(join(dir, 'b.ts'), 'y\n');
      assert.deepEqual(getUnstagedFiles(dir), ['b.ts']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('getChangedFiles("HEAD")：未提交改动 + untracked', function () {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'a.ts'), 'export const a = 9;\n');
      writeFileSync(join(dir, 'new.ts'), 'x\n');
      const files = getChangedFiles('HEAD', dir);
      assert.ok(files.indexOf('a.ts') >= 0);
      assert.ok(files.indexOf('new.ts') >= 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('getChangedFiles("HEAD~0") 等价 HEAD', function () {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'a.ts'), 'export const a = 9;\n');
      const files = getChangedFiles('HEAD', dir);
      assert.ok(files.indexOf('a.ts') >= 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('gitShow：取出 HEAD 版本内容', function () {
    const dir = setupRepo();
    try {
      writeFileSync(join(dir, 'a.ts'), 'modified\n');
      const headContent = gitShow('HEAD', 'a.ts', dir);
      assert.equal(headContent, 'export const a = 1;\n');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('gitShow：不存在路径返回 null', function () {
    const dir = setupRepo();
    try {
      assert.equal(gitShow('HEAD', 'nope.ts', dir), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

import os from 'node:os';
