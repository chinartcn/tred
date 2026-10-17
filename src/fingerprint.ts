import { createHash } from 'node:crypto';

/**
 * 基于"意图"生成 8 位指纹：
 * - anchor：被替换的锚点名
 * - source：脚本标识（比如 "graph-engine-migrator"）
 * - version：脚本版本号
 *
 * 不要传代码内容进来——Prettier/ESLint 一跑就全变了。
 */
export function makeFingerprint(parts: {
  anchor: string;
  source: string;
  version: string;
}): string {
  return createHash('sha1')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 8);
}
