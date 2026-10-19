// 纯 TS 实现的暴力余弦相似度检索
// 对于 Top 3 / Top 5 的小候选集，这比构建 HNSW 图索引快得多，且零依赖。

export function buildAndSearch(
  candidates: { idx: number, text: string, vector: number[], score: number }[],
  hunkVector: number[]
): { idx: number, distance: number }[] {
  if (candidates.length === 0) return [];

  const results = candidates.map(cand => {
    let dot = 0, magA = 0, magB = 0;
    const v = cand.vector;
    const h = hunkVector;
    const len = Math.min(v.length, h.length);

    for (let i = 0; i < len; i++) {
      dot += v[i] * h[i];
      magA += v[i] * v[i];
      magB += h[i] * h[i];
    }

    const similarity = dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
    // HNSW 返回的是距离（越小越近），这里把相似度转成距离（1 - 相似度）
    return { idx: cand.idx, distance: 1 - similarity };
  });

  // 按距离升序排列（距离越小越相似）
  results.sort((a, b) => a.distance - b.distance);
  return results;
}
