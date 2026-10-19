#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cat > api-test.ts <<'TS'
import { calcHybridSimilarity, searchFuzzy } from './src/index.js';

console.log('══════════════════════════════════════════════');
console.log('🧪 测试 1: calcHybridSimilarity (抗改名结构打分)');
console.log('══════════════════════════════════════════════');

const codeA = `
function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}`;

// 变量名全变，但 AST 结构完全一致
const codeB = `
function calcSum(products) {
  let sum = 0;
  for (const p of products) {
    sum += p.cost;
  }
  return sum;
}`;

const scoreResult = calcHybridSimilarity(codeA, codeB);
console.log('原始代码与目标代码打分明细：');
console.log(`- BM25 (词频):     ${(scoreResult.bm25 * 100).toFixed(2)}%`);
console.log(`- AST Shape (结构): ${(scoreResult.astShape * 100).toFixed(2)}%`);
console.log(`- MinHash (词集):   ${(scoreResult.minHash * 100).toFixed(2)}%`);
console.log(`🚀 最终融合得分:    ${(scoreResult.finalScore * 100).toFixed(2)}%`);

if (scoreResult.finalScore > 0.8) {
  console.log('✅ 结构识别通过，变量改名免疫！\n');
} else {
  console.log('❌ 结构识别失败\n');
}


console.log('══════════════════════════════════════════════');
console.log('🧪 测试 2: searchFuzzy (语义级代码搜索)');
console.log('══════════════════════════════════════════════');

// 生成一个临时的测试目录
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
mkdirSync('.temp-api-test', { recursive: true });

writeFileSync('.temp-api-test/auth.ts', `
export class AuthManager {
  // 这个方法用来校验用户密码
  public verifyCredentials(user: string, pwd: string) {
    return user === 'admin' && pwd === '123';
  }
}
`);

writeFileSync('.temp-api-test/payment.ts', `
export class PaymentService {
  public processOrder(orderId: string) {
    // 处理支付逻辑
    return { status: 'success' };
  }
}
`);

// 模拟开发者的编辑器插件调用
console.log('🔍 发起搜索: "fetchCredentials" (标识符变异)');
const results1 = searchFuzzy('.temp-api-test', 'fetchCredentials', { maxResults: 3 });
results1.forEach((r, i) => {
  console.log(`  #${i + 1} [${r.file}:${r.line}] ${r.context} | 得分: ${(r.score * 100).toFixed(1)}%`);
});

console.log('\n🔍 发起搜索: "处理支付逻辑" (自然语言意图)');
const results2 = searchFuzzy('.temp-api-test', '处理支付逻辑', { maxResults: 3 });
results2.forEach((r, i) => {
  console.log(`  #${i + 1} [${r.file}:${r.line}] ${r.context} | 得分: ${(r.score * 100).toFixed(1)}%`);
});

// 清理
rmSync('.temp-api-test', { recursive: true, force: true });
console.log('\n✅ API 测试完成！');
TS

npx tsx api-test.ts
rm -f api-test.ts
