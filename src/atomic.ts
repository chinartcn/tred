import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * 原子写入：先写 .tmp，成功后再 rename。
 * - mkdirSync: 防御目标目录不存在（TMPDIR 被清、容器新挂载、父目录被外部删等）
 * - POSIX rename 原子；Windows 目标存在会失败，unlink + rename 兜底
 */
export function atomicWrite(target: string, content: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tred.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  try {
    renameSync(tmp, target);
  } catch {
    if (existsSync(target)) unlinkSync(target);
    renameSync(tmp, target);
  }
}
