interface Op { type: ' ' | '-' | '+'; line: string; }

const LCS_CELL_LIMIT = 4_000_000;

function lcsDiff(a: string[], b: string[]): Op[] {
  const m = a.length;
  const n = b.length;

  if (m * n > LCS_CELL_LIMIT) {
    const ops: Op[] = [];
    for (const line of a) ops.push({ type: '-', line });
    for (const line of b) ops.push({ type: '+', line });
    return ops;
  }

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

export function unifiedDiff(
  oldText: string,
  newText: string,
  oldName: string,
  newName: string,
  contextLines: number = 3,
): string {
  if (oldText === newText) {
    return '--- ' + oldName + '\n+++ ' + newName + '\n';
  }

  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const minLen = Math.min(oldLines.length, newLines.length);

  let prefix = 0;
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);
  const midOps = lcsDiff(oldMid, newMid);

  const allOps: Op[] = [];
  for (const line of oldLines.slice(0, prefix)) allOps.push({ type: ' ', line });
  for (const op of midOps) allOps.push(op);
  for (const line of oldLines.slice(oldLines.length - suffix)) allOps.push({ type: ' ', line });

  // 截取局部上下文
  let startIdx = 0;
  let endIdx = allOps.length - 1;
  for (let k = 0; k < allOps.length; k++) {
    if (allOps[k].type !== ' ') { startIdx = Math.max(0, k - contextLines); break; }
  }
  for (let k = allOps.length - 1; k >= 0; k--) {
    if (allOps[k].type !== ' ') { endIdx = Math.min(allOps.length - 1, k + contextLines); break; }
  }
  
  const slicedOps = allOps.slice(startIdx, endIdx + 1);

  const header = '--- ' + oldName + '\n+++ ' + newName + '\n';
  const body = slicedOps.map((o) => o.type + o.line).join('\n');
  return body ? header + body + '\n' : header;
}