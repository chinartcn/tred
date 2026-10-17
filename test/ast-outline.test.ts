import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOutline, makeFingerprint, replace } from '../src/index.js';

const SRC = [
  'export class GraphEngine {',
  '  loadUnlocked(): void {}',
  '  save(): void {}',
  '}',
  '',
  'export function helper(): void {}',
  '',
].join('\n');

describe('buildOutline', function () {
  it('提取 class + method + function，含 selector', function () {
    const o = buildOutline('t.ts', SRC);
    assert.equal(o.length, 2);
    assert.equal(o[0].kind, 'class');
    assert.equal(o[0].name, 'GraphEngine');
    assert.equal(o[0].line, 1);
    assert.equal(o[0].children?.length, 2);
    const m0 = o[0].children![0];
    assert.equal(m0.kind, 'method');
    assert.equal(m0.name, 'loadUnlocked');
    assert.equal(m0.line, 2);
    assert.deepEqual(m0.selector, { kind: 'method', className: 'GraphEngine', methodName: 'loadUnlocked' });
    assert.equal(o[1].kind, 'function');
    assert.equal(o[1].name, 'helper');
  });

  it('无 class/function 返回空数组', function () {
    const o = buildOutline('t.ts', 'const x = 1;\n');
    assert.equal(o.length, 0);
  });

  it('selector 可直接喂给 replace autoInjectAnchor', async function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-outline-'));
    const file = join(dir, 't.ts');
    try {
      writeFileSync(file, SRC);
      const o = buildOutline(file, readFileSync(file, 'utf-8'));
      const methodSel = o[0].children![0].selector!;
      const fp = makeFingerprint({ anchor: 'X', source: 'outline-test', version: '1' });
      const r = await replace({
        file: file, anchor: 'X',
        content: 'loadUnlocked(): void {\n  console.log(1);\n}',
        fingerprint: fp, autoInjectAnchor: true, astSelector: methodSel,
      });
      assert.equal(r.status, 'injected');
      assert.match(readFileSync(file, 'utf-8'), /console\.log\(1\)/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
