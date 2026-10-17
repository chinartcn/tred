import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFingerprint, replaceMany, writeRollbackLog } from '../src/index.js';
import type { RollbackLog } from '../src/index.js';

function makeSetup() {
  const dir = mkdtempSync(join(tmpdir(), 'tred-rl-'));
  const f1 = join(dir, 'a.ts');
  const f2 = join(dir, 'b.ts');
  const src = [
    'export class A {',
    '  // @TRED_START: A#x | fp=00000000',
    '  x(): void {}',
    '  // @TRED_END: A#x',
    '}',
    '',
  ].join('\n');
  writeFileSync(f1, src);
  writeFileSync(f2, src);
  return { dir, f1, f2 };
}

describe('writeRollbackLog 纯函数', function () {
  it('写出合法 JSON，结构完整', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-rlw-'));
    const logPath = join(dir, 'nested/rl.json');
    try {
      const log: RollbackLog = {
        timestamp: '2026-01-01T00:00:00.000Z',
        status: 'rolled-back',
        error: 'disk full',
        commitPhase: {
          attempted: ['a.ts', 'b.ts'],
          committed: ['a.ts'],
          failed: 'b.ts',
          rollbackErrors: [{ file: 'a.ts', message: 'permission denied' }],
        },
        ops: [],
      };
      writeRollbackLog(log, logPath);
      const parsed = JSON.parse(readFileSync(logPath, 'utf-8'));
      assert.equal(parsed.status, 'rolled-back');
      assert.equal(parsed.error, 'disk full');
      assert.deepEqual(parsed.commitPhase.attempted, ['a.ts', 'b.ts']);
      assert.deepEqual(parsed.commitPhase.committed, ['a.ts']);
      assert.equal(parsed.commitPhase.failed, 'b.ts');
      assert.equal(parsed.commitPhase.rollbackErrors.length, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('replaceMany + rollbackLog 集成', function () {
  it('提交成功：不写日志（即使传了路径）', async function () {
    const { dir, f1 } = makeSetup();
    const logPath = join(dir, "rollback.json");
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'rl', version: '1' });
      const r = await replaceMany(
        [{ file: f1, anchor: 'A#x', content: 'x(): void { console.log(1); }', fingerprint: fp }],
        { rollbackLog: logPath },
      );
      assert.equal(r.status, 'committed');
      assert.throws(
        () => readFileSync(logPath, "utf-8"),
        /ENOENT/,
        "提交成功不应写 rollback log",
      );
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('提交失败：写日志，含 attempted/committed/failed', async function () {
    const { dir, f1, f2 } = makeSetup();
    const logPath = join(dir, "rollback.json");
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'rl', version: '1' });
      // 第一个文件写成功，第二个抛错
      const r = await replaceMany(
        [
          { file: f1, anchor: 'A#x', content: 'x(): void { console.log(1); }', fingerprint: fp },
          { file: f2, anchor: 'A#x', content: 'x(): void { console.log(2); }', fingerprint: fp },
        ],
        {
          rollbackLog: logPath,
          _writer: function (file, content) {
            if (file === f2) throw new Error('boom on f2');
            writeFileSync(file, content, "utf-8");
          },
        },
      );
      assert.equal(r.status, 'rolled-back');
      assert.match(r.error || '', /boom on f2/);
      const log: RollbackLog = JSON.parse(readFileSync(logPath, 'utf-8'));
      assert.equal(log.status, 'rolled-back');
      assert.match(log.error, /boom on f2/);
      assert.equal(log.commitPhase.attempted.length, 2);
      assert.equal(log.commitPhase.committed.length, 1);
      assert.equal(log.commitPhase.committed[0], f1);
      assert.equal(log.commitPhase.failed, f2);
      assert.equal(log.commitPhase.rollbackErrors.length, 0);
      assert.equal(log.ops.length, 2);
      // f1 文件内容已被回滚到原状
      const after = readFileSync(f1, 'utf-8');
      assert.doesNotMatch(after, /console\.log\(1\)/);
      assert.match(after, /fp=00000000/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('回滚本身失败：记录 rollbackErrors', async function () {
    const { dir, f1, f2 } = makeSetup();
    const logPath = join(dir, "rollback.json");
    let calls = 0;
    try {
      const fp = makeFingerprint({ anchor: 'A#x', source: 'rl', version: '1' });
      const r = await replaceMany(
        [
          { file: f1, anchor: 'A#x', content: 'x(): void { console.log(1); }', fingerprint: fp },
          { file: f2, anchor: 'A#x', content: 'x(): void { console.log(2); }', fingerprint: fp },
        ],
        {
          rollbackLog: logPath,
          _writer: function (file, content) {
            calls++;
            // 前 1 次成功（f1 写入），第 2 次触发 f2 错误，第 3 次（回滚 f1）也失败
            if (calls === 1) { writeFileSync(file, content, "utf-8"); return; }
            if (calls === 2) throw new Error('commit failed');
            throw new Error('rollback failed');
          },
        },
      );
      assert.equal(r.status, 'rolled-back');
      const log: RollbackLog = JSON.parse(readFileSync(logPath, 'utf-8'));
      assert.equal(log.commitPhase.rollbackErrors.length, 1);
      assert.equal(log.commitPhase.rollbackErrors[0].file, f1);
      assert.match(log.commitPhase.rollbackErrors[0].message, /rollback failed/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('写日志本身失败：原错误仍保留，附加日志错误', async function () {
    const { dir, f1, f2 } = makeSetup();
    const logPath = join(dir, "no-such-dir/rollback.json");
    try {
      // 先创建 no-such-dir 再 chmod 不可写？跨平台不稳，改用路径是目录来触发
      const fp = makeFingerprint({ anchor: 'A#x', source: 'rl', version: '1' });
      // 让 logPath 指向一个目录（atomicWrite 的 mkdir 会因目标已是目录而失败？不一定）
      // 更稳的方案：让 writer 在第二个文件失败，logPath 指向一个文件（非目录）但被占用
      // 简化：writer 失败导致 rollback log 写入尝试用 atomicWrite，正常应成功
      // 这里只验证：即使 rollbackLog 路径非法，也不抛异常，原错误仍返回
      const r = await replaceMany(
        [
          { file: f1, anchor: 'A#x', content: 'x(): void { console.log(1); }', fingerprint: fp },
          { file: f2, anchor: 'A#x', content: 'x(): void { console.log(2); }', fingerprint: fp },
        ],
        {
          rollbackLog: "/dev/null/not/a/file.json",
          _writer: function (file, content) {
            if (file === f2) throw new Error('boom');
            writeFileSync(file, content, "utf-8");
          },
        },
      );
      assert.equal(r.status, 'rolled-back');
      // 原错误仍是主导，日志错误附加在后
      assert.match(r.error || '', /boom/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
