import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from '../src/atomic.js';
import { findAnchor } from '../src/anchor.js';

describe('Snapshot & Undo logic (Simulated)', function () {
  it('模拟局部回滚：仅恢复特定锚点区域', function () {
    const dir = mkdtempSync(join(tmpdir(), 'tred-undo-'));
    const file = join(dir, 'test.ts');
    
    const originalCode = `// @TRED_START: X | fp=11111111\nconst x = 1;\n// @TRED_END: X\n\nconst y = 2;\n`;
    const modifiedCode = `// @TRED_START: X | fp=11111111\nconst x = 999;\n// @TRED_END: X\n\nconst y = 2;\n`;

    writeFileSync(file, modifiedCode);

    // 模拟从快照恢复
    const snapBlock = findAnchor(originalCode, 'X');
    const currBlock = findAnchor(modifiedCode, 'X');
    assert.ok(snapBlock && currBlock);

    const snapLines = originalCode.split('\n');
    const currLines = modifiedCode.split('\n');

    const restoredBlock = snapLines.slice(snapBlock.startLine, snapBlock.endLine + 1).join('\n');
    const newContent = currLines.slice(0, currBlock.startLine).join('\n') + '\n' + restoredBlock + '\n' + currLines.slice(currBlock.endLine + 1).join('\n');

    atomicWrite(file, newContent);
    const finalCode = readFileSync(file, 'utf-8');

    assert.match(finalCode, /const x = 1;/, 'X 区域应被恢复');
    assert.match(finalCode, /const y = 2;/, 'Y 区域应保持原样不受影响');
    
    rmSync(dir, { recursive: true, force: true });
  });
});
