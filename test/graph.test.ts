import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMermaidGraph } from '../src/graph.js';

describe('generateMermaidGraph', function () {
  it('生成合法的 Mermaid 语法', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-graph-'));
    writeFileSync(join(dir, 'a.ts'), "import { b } from './b';");
    writeFileSync(join(dir, 'b.ts'), "export const b = 1;");
    try {
      const graph = generateMermaidGraph(dir);
      assert.match(graph, /```mermaid/);
      assert.match(graph, /graph TD/);
      assert.match(graph, /"a.ts" --> "b.ts"/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
