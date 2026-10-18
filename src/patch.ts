import { readFileSync, writeFileSync } from 'node:fs';
import { checkSyntax } from './safety.js';

export function applyPatch(filePath: string, patchText: string): { ok: boolean; message?: string } {
  const original = readFileSync(filePath, 'utf-8');
  const lines = original.split('\n');
  const patchLines = patchText.split('\n');

  const hunks: { oldBlock: string[], newBlock: string[] }[] = [];
  let currentHunk: { oldBlock: string[], newBlock: string[] } | null = null;

  // 1. 解析 Patch 的 Hunk 块（包含上下文行）
  for (const l of patchLines) {
    if (l.startsWith('---') || l.startsWith('+++') || l.startsWith('diff')) continue;
    
    if (l.startsWith('@@ ')) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { oldBlock: [], newBlock: [] };
      continue;
    }

    if (!currentHunk) continue;

    if (l.startsWith(' ')) {
      const text = l.slice(1);
      currentHunk.oldBlock.push(text);
      currentHunk.newBlock.push(text);
    } else if (l.startsWith('-')) {
      const text = l.slice(1);
      currentHunk.oldBlock.push(text);
    } else if (l.startsWith('+')) {
      const text = l.slice(1);
      currentHunk.newBlock.push(text);
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  if (hunks.length === 0) {
    return { ok: false, message: '未找到有效的 Hunk (@@ ... @@)' };
  }

  // 2. 逐个应用 Hunk
  let currentLines = [...lines];
  for (const hunk of hunks) {
    const { oldBlock, newBlock } = hunk;
    if (oldBlock.length === 0) {
      return { ok: false, message: 'Hunk 缺少上下文，无法定位' };
    }

    let foundIdx = -1;
    // 寻找上下文匹配的位置
    for (let i = 0; i <= currentLines.length - oldBlock.length; i++) {
      let match = true;
      for (let j = 0; j < oldBlock.length; j++) {
        if (currentLines[i + j] !== oldBlock[j]) {
          match = false; break;
        }
      }
      if (match) { foundIdx = i; break; }
    }

    if (foundIdx === -1) {
      return { ok: false, message: '在原文件中未找到匹配的上下文块，Patch 应用失败' };
    }

    // 替换为新块
    currentLines.splice(foundIdx, oldBlock.length, ...newBlock);
  }

  const newText = currentLines.join('\n');

  // 3. 语法门禁
  if (/\.[jt]sx?$/.test(filePath)) {
    const errors = checkSyntax(filePath, newText);
    if (errors.length > 0) {
      return { ok: false, message: '应用 Patch 后语法报错：' + errors.join('; ') };
    }
  }

  writeFileSync(filePath, newText, 'utf-8');
  return { ok: true };
}