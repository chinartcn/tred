import { makeFingerprint, replace } from '../src/index.js';

const file = new URL('./_target_v2.ts', import.meta.url).pathname;
const anchor = 'GraphEngine#loadUnlocked';

const fingerprint = makeFingerprint({
  anchor,
  source: 'demo-v2',
  version: '1.0.0',
});

// 故意写成"绝对缩进"：body 4 空格，闭合 } 2 空格
const content = [
  'loadUnlocked(): void {',
  "    console.log('absolute indent body');",
  '  }',
].join('\n');

const selector = {
  kind: 'method' as const,
  className: 'GraphEngine',
  methodName: 'loadUnlocked',
};

console.log('=== #2 dry-run ===');
const dry = await replace({
  file, anchor, content, fingerprint, autoInjectAnchor: true, astSelector: selector, dryRun: true,
});
console.log(dry.diff);

console.log('=== #6 归一化 + injected ===');
const r1 = await replace({
  file, anchor, content, fingerprint, autoInjectAnchor: true, astSelector: selector,
});
console.log(r1);

console.log('=== 幂等 skipped ===');
const r2 = await replace({
  file, anchor, content, fingerprint, autoInjectAnchor: true, astSelector: selector,
});
console.log(r2);
