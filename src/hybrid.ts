import { tokenize, calcBM25 } from './bm25.js';
import { getAstShape, lcsRatio } from './ast-shape.js';
import { minHashJaccard } from './minhash.js';
import { getSimilarity } from './fuzzy.js';

export interface HybridMatchOptions {
  mode?: 'code' | 'text';
}

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

// 字符级 N-gram Jaccard (非常适合中文查重)
function charNgramJaccard(a: string, b: string, n: number = 2): number {
  const cleanA = a.replace(/\s+/g, '');
  const cleanB = b.replace(/\s+/g, '');
  if (cleanA.length < n || cleanB.length < n) return cleanA === cleanB ? 1 : 0;
  
  const setA = new Set<string>();
  const setB = new Set<string>();
  for (let i = 0; i <= cleanA.length - n; i++) setA.add(cleanA.slice(i, i + n));
  for (let i = 0; i <= cleanB.length - n; i++) setB.add(cleanB.slice(i, i + n));
  
  let inter = 0;
  for (const s of setA) if (setB.has(s)) inter++;
  return inter / (setA.size + setB.size - inter);
}

export function calcHybridSimilarity(hunkText: string, candidateText: string, options?: HybridMatchOptions): HybridScoreDetail {
  if (!hunkText || !candidateText) {
    return { bm25: 0, astShape: 0, minHash: 0, finalScore: 0 };
  }

  // 🚀 绝对重合短路：如果文本完全一致，直接给满分，避免被 BM25 的数学上限拖累
  if (hunkText === candidateText) {
    return { bm25: 1, astShape: 1, minHash: 1, finalScore: 1 };
  }

  const hunkTokens = tokenize(hunkText);
  const candTokens = tokenize(candidateText);
  const avgLen = hunkTokens.length || 1;

  // 1. BM25 (文本频率)
  const bm25Raw = calcBM25(hunkTokens, candTokens, avgLen);
  const bm25Score = Math.min(1, bm25Raw / (hunkTokens.length || 1));

  // 2. MinHash (词集交集)
  const hashScore = minHashJaccard(hunkTokens, candTokens);

  const mode = options?.mode || 'code';

  if (mode === 'text') {
    // 🚀 纯文本模式：字符级 LCS Overlap
    const cleanA = hunkText.replace(/[\s\p{P}]/gu, '');
    const cleanB = candidateText.replace(/[\s\p{P}]/gu, '');
    const minLen = Math.min(cleanA.length, cleanB.length) || 1;

    // 1. 计算字符级最长公共子序列 (LCS)
    let dp = new Array(cleanB.length + 1).fill(0);
    for (let i = 1; i <= cleanA.length; i++) {
      let prev = 0;
      for (let j = 1; j <= cleanB.length; j++) {
        let tmp = dp[j];
        if (cleanA[i - 1] === cleanB[j - 1]) dp[j] = prev + 1;
        else dp[j] = Math.max(dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    const lcsLen = dp[cleanB.length];
    const overlapScore = lcsLen / minLen; // 短文本被覆盖的比例

    // 2. 字符 N-gram (用来处理局部打乱)
    const charGramSim = charNgramJaccard(hunkText, candidateText, 2);
    
    // 融合：只要短句被覆盖，保底分极高 (LCS 80% + N-gram 20%)
    let finalScore = overlapScore * 0.8 + charGramSim * 0.2;
    
    return { bm25: bm25Score, astShape: lcsLen, minHash: hashScore, finalScore };
  }

  // --- 以下是原有的代码模式 ---
  // 3. AST Shape (语法骨架)
  let shapeScore = 0;
  try {
    const hunkShape = getAstShape(hunkText);
    const candShape = getAstShape(candidateText);
    shapeScore = lcsRatio(hunkShape, candShape);
  } catch {
    shapeScore = 0;
  }

  // 三轨融合 (BM25 0.3, AST Shape 0.4, MinHash 0.3)
  let finalScore = bm25Score * 0.3 + shapeScore * 0.4 + hashScore * 0.3;

  // 🚀 结构保底机制
  if (shapeScore >= 0.95) {
    finalScore = Math.max(finalScore, 0.88);
  } else if (shapeScore >= 0.8) {
    finalScore = Math.max(finalScore, 0.75);
  }

  return { bm25: bm25Score, astShape: shapeScore, minHash: hashScore, finalScore };
}
