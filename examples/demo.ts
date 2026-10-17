import { makeFingerprint, replace } from '../src/index.js';

const file = new URL('./_target.ts', import.meta.url).pathname;
const anchor = 'GraphEngine#loadUnlocked';

const fingerprint = makeFingerprint({
  anchor,
  source: 'demo',
  version: '1.0.0',
});

const result = await replace({
  file,
  anchor,
  content: [
    'loadUnlocked(): void {',
    "  console.log('replaced by tred', '" + new Date().toISOString() + "');",
    '}',
  ].join('\n'),
  fingerprint,
  autoInjectAnchor: true,
  astSelector: {
    kind: 'method',
    className: 'GraphEngine',
    methodName: 'loadUnlocked',
  },
});

console.log('[tred demo]', result);
