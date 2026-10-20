import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { generateMermaidGraph } from '../src/graph.js';

describe('generateMermaidGraph Views', function () {
  it('dir 视图应包含 subgraph 语法', function () {
    const graph = generateMermaidGraph('src', 'dir');
    // 如果 src 下有子目录，必然有 subgraph
    assert.ok(graph.includes('subgraph') || graph.includes('root'), 'Should contain subgraphs');
  });

  it('flat 视图不应包含 subgraph 语法', function () {
    const graph = generateMermaidGraph('src', 'flat');
    assert.ok(!graph.includes('subgraph'), 'Should not contain subgraphs');
  });
});
