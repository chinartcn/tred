interface Op { type: ' ' | '-' | '+'; line: string; }

const LCS_CELL_LIMIT = 4_000_000; // 2000x2000 上限，超过就退化

function lcsDiff(a: string[], b: string[]): Op[] {
  const m = a.length;
  const n = b.length;

  // 超大 mid 时退化：直接全删全加
  if (m * n > LCS_CELL_LIMIT) {
    const ops: Op[] = [];
    for (const line of a) ops.push({ type: '-', line: line });
    for (const line of b) ops.push({ type: '+', line: line });
    return ops;
  }

  // 标准 LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: ' ', line: a[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: '-', line: a[i - 1] });
      i--;
    } else {
      ops.push({ type: '+', line: b[j - 1] });
      j--;
    }
  }
  while (i > 0) { ops.push({ type: '-', line: a[i - 1] }); i--; }
  while (j > 0) { ops.push({ type: '+', line: b[j - 1] }); j--; }
  ops.reverse();
  return ops;
}

export function unifiedDiff(oldText: string, newText: string, oldName: string, newName: string): string {
  if (oldText === newText) {
    return '--- ' + oldName + '\n+++ ' + newName + '\n';
  }

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const minLen = Math.min(oldLines.length, newLines.length);

  // 1. 剥离公共前缀
  let prefix = 0;
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) prefix++;

  // 2. 剥离公共后缀
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;

  // 3. 仅对中间变化区域做 LCS
  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);
  const midOps = lcsDiff(oldMid, newMid);

  // 4. 组装最终结果（前缀省略，直接显示变化 + 后缀省略）
  const allOps: Op[] = [];
  for (const line of oldLines.slice(0, prefix)) allOps.push({ type: ' ', line: line });
  for (const op of midOps) allOps.push(op);
  for (const line of oldLines.slice(oldLines.length - suffix)) allOps.push({ type: ' ', line: line });

  const header = '--- ' + oldName + '\n+++ ' + newName + '\n';
  const body = allOps.map((o) => o.type + o.line).join('\n');
  return body ? header + body + '\n' : header;
}
