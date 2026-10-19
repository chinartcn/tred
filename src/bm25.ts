export function tokenize(text: string): string[] {
  // 提取字母、数字、下划线和常见符号构成的结构 token
  return text.match(/[a-zA-Z0-9_]{2,}|[(){}\[\];,.=+\-*/<>!&|]+/g) || [];
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
