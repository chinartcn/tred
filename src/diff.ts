/**
 * 简易 unified diff（行级 LCS）。
 * 不做 hunk 上下文裁剪；对锚点替换场景够用。
 */
export function unifiedDiff(
  oldText: string,
  newText: string,
  oldName: string,
  newName: string,
): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, function () {
    return new Array<number>(n + 1).fill(0);
  });
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  type Op = { type: ' ' | '-' | '+'; line: string };
  const ops: Op[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      ops.push({ type: ' ', line: oldLines[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: '-', line: oldLines[i - 1] });
      i--;
    } else {
      ops.push({ type: '+', line: newLines[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: '-', line: oldLines[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.push({ type: '+', line: newLines[j - 1] });
    j--;
  }
  ops.reverse();

  const header = '--- ' + oldName + '\n+++ ' + newName + '\n';
  const body = ops.map(function (o) { return o.type + o.line; }).join('\n');
  return body ? header + body + '\n' : header;
}
