export function tokenize(text: string): string[] {
  // 分离：连续的英数字下划线 / 连续的结构符号 / 连续的中文
  const rawTokens = text.match(/[a-zA-Z0-9_]+|[(){}\[\];,.=+\-*/<>!&|]+|[\u4e00-\u9fa5]+/g) || [];
  const result: string[] = [];
  
  for (const t of rawTokens) {
    if (/^[(){}\[\];,.=+\-*/<>!&|]+$/.test(t)) {
      result.push(t);
      continue;
    }
    
    if (/^[\u4e00-\u9fa5]+$/.test(t)) {
      // 🚀 中文使用 Bi-gram 切词（如 "校验密码" -> "校验", "验密", "密码"）
      if (t.length === 1) {
        result.push(t);
      } else {
        for (let i = 0; i < t.length - 1; i++) {
          result.push(t.slice(i, i + 2));
        }
      }
      continue;
    }

    // 拆分 camelCase 和 snake_case
    const parts = t.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s_\-]+/);
    for (const p of parts) {
      if (p.length >= 2) {
        result.push(p.toLowerCase());
      }
    }
  }
  return result;
}

export function nGrams(tokens: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    grams.push(tokens.slice(i, i + n).join(' '));
  }
  return grams;
}

export function calcBM25(queryTokens: string[], docTokens: string[], avgDocLen: number, k1 = 1.5, b = 0.75): number {
  if (docTokens.length === 0 || queryTokens.length === 0) return 0;
  
  const termFreq = new Map<string, number>();
  for (const t of docTokens) termFreq.set(t, (termFreq.get(t) || 0) + 1);

  let score = 0;
  for (const q of new Set(queryTokens)) {
    const tf = termFreq.get(q) || 0;
    if (tf === 0) continue;
    
    // 简化版的 IDF，假定查询词就是本文档体系的唯一来源，给一个固定权重
    const idf = Math.log(1 + 1 / (1 + 0));
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docTokens.length / avgDocLen));
    score += idf * (numerator / denominator);
  }
  return score;
}
