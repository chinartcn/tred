import ts from 'typescript';

export function getAstShape(code: string): string[] {
  const sf = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);
  const shape: string[] = [];
  const visit = (node: ts.Node) => {
    shape.push(ts.SyntaxKind[node.kind]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return shape;
}

export function lcsRatio(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n] / Math.max(m, n);
}
