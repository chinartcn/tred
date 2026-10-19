// Jaro-Winkler 算法 (专门对付前缀相同的标识符，如 updateStatus vs update_state)
function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  
  const matchWindow = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] === b[j]) {
        aMatches[i] = true;
        bMatches[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (aMatches[i]) {
      while (!bMatches[k]) k++;
      if (a[i] !== b[k]) t++;
      k++;
    }
  }
  t /= 2;

  const jaro = (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
  
  // Winkler 前缀加成 (对前 4 个字符敏感)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// 编辑距离归一化
function levenshteinRatio(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n === 0 ? 1 : 0;
  if (n === 0) return 0;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

// 拆分标识符 (camelCase / snake_case)
function splitIdentifier(s: string): string[] {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-]+/).map(x => x.toLowerCase()).filter(Boolean);
}

// 词集 Jaccard
function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a), setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 1 : inter / union;
}

export function getSimilarity(query: string, target: string): number {
  if (!query || !target) return 0;
  if (query === target) return 1;
  
  const qWords = splitIdentifier(query);
  const tWords = splitIdentifier(target);
  
  const jw = jaroWinkler(query.toLowerCase(), target.toLowerCase());
  const lev = levenshteinRatio(query.toLowerCase(), target.toLowerCase());
  const jac = jaccard(qWords, tWords);
  
  // 标识符级融合：如果共享了很长的词（如 credentials），给予更高的权重
  let commonLongWordBonus = 0;
  for (const qw of qWords) {
    for (const tw of tWords) {
      if (qw === tw && qw.length >= 4) commonLongWordBonus += 0.15;
    }
  }
  
  const finalScore = jw * 0.4 + lev * 0.3 + jac * 0.3 + commonLongWordBonus;
  return Math.min(1, finalScore);
}
