import { spawnSync } from 'node:child_process';

/**
 * 解析 git diff --unified=0 <ref> HEAD，得到每个文件"新增/修改"的行号集合。
 * 返回 Map<相对仓库根的路径, Set<行号>>。
 * 只删除不添加的 hunk 不产生行号。
 */
export function getDiffLines(ref: string, cwd?: string): Map<string, Set<number>> {
  const r = spawnSync('git', ['diff', '--unified=0', ref, 'HEAD'], {
    cwd: cwd ?? process.cwd(),
    encoding: 'utf-8',
  });
  const map = new Map<string, Set<number>>();
  if (r.status !== 0) return map;

  let currentFile: string | null = null;
  for (const line of (r.stdout || '').split('\n')) {
    if (line.indexOf('+++ b/') === 0) {
      currentFile = line.slice(6);
      if (!map.has(currentFile)) map.set(currentFile, new Set());
      continue;
    }
    if (line.indexOf('+++ ') === 0) {
      currentFile = null;
      continue;
    }
    if (currentFile && line.indexOf('@@') === 0) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        const start = parseInt(m[1], 10);
        const count = m[2] ? parseInt(m[2], 10) : 1;
        const set = map.get(currentFile);
        if (set) {
          for (let i = 0; i < count; i++) {
            set.add(start + i);
          }
        }
      }
    }
  }
  return map;
}
