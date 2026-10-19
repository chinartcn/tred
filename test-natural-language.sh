#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cat > nl-test.ts <<'TS'
import { calcHybridSimilarity } from './src/index.js';

function runTest(title: string, a: string, b: string) {
  console.log(`\n🧪 ${title}`);
  const result = calcHybridSimilarity(a, b);
  console.log(`  - BM25 (词频):      ${(result.bm25 * 100).toFixed(1)}%`);
  console.log(`  - AST Shape (结构): ${(result.astShape * 100).toFixed(1)}%`);
  console.log(`  - MinHash (词集):   ${(result.minHash * 100).toFixed(1)}%`);
  console.log(`  🚀 最终得分:        ${(result.finalScore * 100).toFixed(1)}%`);
}

// 1. 纯英文自然语言
runTest(
  '纯英文文本：莎士比亚 vs 相似句式',
  "To be, or not to be, that is the question.",
  "To be, or not to be, that is the ultimate question."
);

// 2. 纯中文自然语言
runTest(
  '纯中文文本：描述相似的逻辑',
  "我们需要在这个模块中验证用户的密码是否正确。",
  "在此模块里，必须校验用户输入的密码到底对不对。"
);

// 3. 风马牛不相及的两段代码
runTest(
  '完全不同结构的代码',
  "function add(a, b) { return a + b; }",
  "class Dog { bark() { console.log('woof'); } }"
);

// 4. 混合体：自然语言 + 代码
runTest(
  '混合体：代码注释 vs 实际代码',
  "// This function calculates the total price\nfunction calc() {}",
  "function calculateTotalPrice() { return price; }"
);
TS

npx tsx nl-test.ts
rm -f nl-test.ts
