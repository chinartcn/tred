import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let extractor: any = null;
let loadFailed = false;

export async function getEmbedding(text: string): Promise<number[] | null> {
  if (loadFailed) return null;

  if (!extractor) {
    try {
      const modName = '@huggingface/transformers';
      // @ts-ignore - 动态导入，允许用户不安装此可选依赖
      const { pipeline, env } = await import(modName);
      
      // 🚀 强制 transformers 使用 WASM (onnxruntime-web)
      if (env?.backends?.onnx) {
        (env.backends.onnx as any).wasm = { numThreads: 1 };
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
