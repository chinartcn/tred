#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ==========================================
# 2.1 重写 embedding.ts（强切 WASM）
# ==========================================
cat > src/embedding.ts <<'TS_EOF'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let extractor: any = null;
let loadFailed = false;

export async function getEmbedding(text: string): Promise<number[] | null> {
  if (loadFailed) return null;

  if (!extractor) {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      
      // 🚀 强制 transformers 使用 WASM (onnxruntime-web)
      if (env?.backends?.onnx) {
        env.backends.onnx.wasm = { numThreads: 1 } as any;
      }
      env.useFSCache = false;
      
      extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        // @ts-ignore 逼它走 web
        executionProviders: ['wasm'],
      });
    } catch (e) {
      console.warn('⚠️ [tred] WASM 向量模型加载失败，降级为纯 TF-IDF 匹配。');
      loadFailed = true;
      return null;
    }
  }
  
  try {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch {
    loadFailed = true;
    return null;
  }
}

const CACHE_FILE = '.tred/embedding-cache.json';
export function getCache(): Record<string, number[]> {
  if (existsSync(CACHE_FILE)) {
    try { return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')); } catch { return {}; }
  }
  return {};
}
export function saveCache(cache: Record<string, number[]>) {
  mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}
TS_EOF

# ==========================================
# 2.2 新建 vector-index.ts (persistent-hnsw)
# ==========================================
cat > src/vector-index.ts <<'TS_EOF'
import { HNSWIndex } from 'persistent-hnsw';

// 构造一个极简的 HNSW 索引实例
export function buildAndSearch(
  candidates: { idx: number, text: string, vector: number[], score: number }[],
  hunkVector: number[]
): { idx: number, distance: number }[] {
  if (candidates.length === 0) return [];
  
  // 因为我们每次只拿 Top 3，维度是 384
  const dimension = hunkVector.length;
  const index = new HNSWIndex({ dimension, maxElements: candidates.length + 1 });
  
  for (const cand of candidates) {
    // 把向量加进去，用数组下标做 id
    index.addPoint(cand.vector, cand.idx);
  }
  
  // 搜索最相似的
  return index.searchKnn(hunkVector, candidates.length);
}
TS_EOF

# ==========================================
# 2.3 修改 patch.ts（替换原有的手动余弦）
# ==========================================
cat > .fix-patch.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/patch.ts';
let text = readFileSync(F, 'utf8');

// 替换 import
text = text.replace(
  "import { getEmbedding, cosineSimilarity, getCache, saveCache } from './embedding.js';",
  "import { getEmbedding, getCache, saveCache } from './embedding.js';\nimport { buildAndSearch } from './vector-index.js';"
);

// 找到原来的 Hybrid Search 精排逻辑
const OLD_RERANK = `      // 🚀 v3.9.0 Hybrid Search 精排
      if (options.semantic && candidates.length > 0) {
        const topK = candidates.slice(0, 3);
        const hunkText = oldBlock.join('\\n');
        const cache = getCache();
        const hunkKey = 'hunk:' + hunkText.trim().slice(0, 100); // 简易 hash
        let hunkVec: number[] | null | undefined = cache[hunkKey];
        
        if (!hunkVec) {
          hunkVec = await getEmbedding(hunkText);
          if (hunkVec) cache[hunkKey] = hunkVec;
        }

        if (hunkVec) {
          for (const cand of topK) {
            const candText = currentLines.slice(cand.idx, cand.idx + oldBlock.length).join('\\n');
            const candKey = 'cand:' + candText.trim().slice(0, 100);
            let candVec: number[] | null | undefined = cache[candKey];
            if (!candVec) {
              candVec = await getEmbedding(candText);
              if (candVec) cache[candKey] = candVec;
            }
            if (candVec) {
              const vecSim = cosineSimilarity(hunkVec, candVec);
              // 融合打分：0.6 TF-IDF + 0.4 语义
              cand.score = cand.score * 0.6 + vecSim * 0.4;
            }
          }
          saveCache(cache);
          // 重新排序
          topK.sort((a, b) => b.score - a.score);
          candidates[0] = topK[0];
          candidates[1] = topK[1] || null;
        } else {
          console.warn('⚠️ [tred] Embedding 不可用，本次跳过语义重排。');
        }
      }`;

const NEW_RERANK = `      // 🚀 v3.9.1 Hybrid Search 精排 (HNSW)
      if (options.semantic && candidates.length > 0) {
        const topK = candidates.slice(0, 3);
        const hunkText = oldBlock.join('\\n');
        const cache = getCache();
        const hunkKey = 'hunk:' + hunkText.trim().slice(0, 100);
        let hunkVec: number[] | null | undefined = cache[hunkKey];
        
        if (!hunkVec) {
          hunkVec = await getEmbedding(hunkText);
          if (hunkVec) cache[hunkKey] = hunkVec;
        }

        if (hunkVec) {
          const hnswCandidates: { idx: number, text: string, vector: number[], score: number }[] = [];
          
          for (const cand of topK) {
            const candText = currentLines.slice(cand.idx, cand.idx + oldBlock.length).join('\\n');
            const candKey = 'cand:' + candText.trim().slice(0, 100);
            let candVec: number[] | null | undefined = cache[candKey];
            if (!candVec) {
              candVec = await getEmbedding(candText);
              if (candVec) cache[candKey] = candVec;
            }
            if (candVec) {
              hnswCandidates.push({ idx: cand.idx, text: candText, vector: candVec, score: cand.score });
            }
          }
          
          if (hnswCandidates.length > 0) {
            // 用持久化 HNSW 索引搜索
            const searchResults = buildAndSearch(hnswCandidates, hunkVec);
            
            // 融合打分
            for (const res of searchResults) {
              // HNSW 返回的是距离 (越小越近)，转成相似度
              const vecSim = Math.max(0, 1 - res.distance); 
              const cand = candidates.find(c => c.idx === res.idx);
              if (cand) {
                cand.score = cand.score * 0.6 + vecSim * 0.4;
              }
            }
            
            saveCache(cache);
            // 重新排序
            topK.sort((a, b) => b.score - a.score);
            candidates[0] = topK[0];
            candidates[1] = topK[1] || null;
          } else {
            console.warn('⚠️ [tred] 向量生成失败，跳过语义重排。');
          }
        } else {
          console.warn('⚠️ [tred] Embedding 不可用，本次跳过语义重排。');
        }
      }`;

if (text.includes(OLD_RERANK)) {
  text = text.replace(OLD_RERANK, NEW_RERANK);
  writeFileSync(F, text);
  console.log('  ✓ patch.ts 已接入 HNSW 索引');
} else {
  console.error('❌ 找不到 OLD_RERANK 锚点，可能是代码已被修改过');
  process.exit(1);
}
MJS_EOF
node .fix-patch.mjs && rm .fix-patch.mjs

echo
echo "=== 重新 build ==="
npm run build

echo
echo "=== 冒烟测试 ==="
bash smoke.sh | tail -3
