import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { calcHybridSimilarity } from '../src/hybrid.js';

describe('Hybrid Similarity Algorithm', function () {
  it('完全相同的代码得分为 1.0', function () {
    const code = 'function add(a, b) { return a + b; }';
    const res = calcHybridSimilarity(code, code);
    assert.ok(res.finalScore >= 0.99, `Expect 1.0, got ${res.finalScore}`);
  });

  it('变量全部改名的同构代码，AST Shape 保底高分', function () {
    const codeA = 'function add(x, y) { for(let i=0; i<10; i++) { x += y; } return x; }';
    const codeB = 'function calc(a, b) { for(let j=0; j<10; j++) { a += b; } return a; }';
    const res = calcHybridSimilarity(codeA, codeB);
    assert.ok(res.astShape >= 0.9, 'AST shape should be identical');
    assert.ok(res.finalScore >= 0.88, `Expect boosted score > 0.88, got ${res.finalScore}`);
  });

  it('文本模式：子集包含应得高分', function () {
    const a = '这是一个非常长的描述性文字，包含核心信息。';
    const b = '包含核心信息';
    const res = calcHybridSimilarity(a, b, { mode: 'text' });
    assert.ok(res.finalScore > 0.8, `Expect > 0.8, got ${res.finalScore}`);
  });
});
