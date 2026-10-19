import { tokenize, calcBM25 } from './bm25.js';
import { getAstShape, lcsRatio } from './ast-shape.js';
import { minHashJaccard } from './minhash.js';

export interface HybridScoreDetail {
  bm25: number;
  astShape: number;
  minHash: number;
  finalScore: number;
}

/**
 * v4.0 混合匹配引擎打分器
 * 用于计算两段代码文本的结构与语义相似度 (0~1)
 */
export function calcHybridSimilarity(hunkText: string, candidateText: string): HybridScoreDetail {
  if (!hunkText || !candidateText) {
    return { bm25: 0, astShape: 0, minHash: 0, finalScore: 0 };
  }

  const hunkTokens = tokenize(hunkText);
  const candTokens = tokenize(candidateText);
  const avgLen = hunkTokens.length || 1;

  // 1. BM25 (文本频率)
  const bm25Raw = calcBM25(hunkTokens, candTokens, avgLen);
  const bm25Score = Math.min(1, bm25Raw / (hunkTokens.length || 1));

  // 2. MinHash (词集交集)
  const hashScore = minHashJaccard(hunkTokens, candTokens);

  // 3. AST Shape (语法骨架)
  let shapeScore = 0;
  try {
    const hunkShape = getAstShape(hunkText);
    const candShape = getAstShape(candidateText);
    shapeScore = lcsRatio(hunkShape, candShape);
  } catch {
    // 如果代码有语法错误，AST 解析失败，则退化为 0
    shapeScore = 0;
  }

  // 三轨融合 (BM25 0.3, AST Shape 0.4, MinHash 0.3)
  let finalScore = bm25Score * 0.3 + shapeScore * 0.4 + hashScore * 0.3;

  // 🚀 结构保底机制：如果 AST 骨架高度一致，说明是同一个逻辑框架，即使变量全改了也得给高分
  if (shapeScore >= 0.95) {
    finalScore = Math.max(finalScore, 0.88); // 强行拉高到 88%
  } else if (shapeScore >= 0.8) {
    finalScore = Math.max(finalScore, 0.75);
  }

  return { bm25: bm25Score, astShape: shapeScore, minHash: hashScore, finalScore };
}
