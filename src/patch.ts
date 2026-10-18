import { readFileSync, writeFileSync } from 'node:fs';
import { checkSyntax } from './safety.js';
import { getSimilarity } from './fuzzy.js';

function blockSimilarity(blockA: string[], blockB: string[]): number {
  if (blockA.length !== blockB.length || blockA.length === 0) return 0;
  let totalScore = 0;
  for (let i = 0; i < blockA.length; i++) {
    const a = blockA[i];
    const b = blockB[i];
    if (a === b) totalScore += 1;
    else if (a.trim() === b.trim()) totalScore += 0.95;
    else totalScore += getSimilarity(a, b);
  }
  return totalScore / blockA.length;
}

export function applyPatch(filePath: string, patchText: string): { ok: boolean; message?: string } {
  const original = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const lines = original.split('\n');
  const patchLines = patchText.replace(/\r\n/g, '\n').split('\n');

  const hunks: { oldStart: number, oldBlock: string[], newBlock: string[] }[] = [];
  let currentHunk: { oldStart: number, oldBlock: string[], newBlock: string[] } | null = null;

  for (const l of patchLines) {
    if (l.startsWith('---') || l.startsWith('+++') || l.startsWith('diff') || l.startsWith('index') || l.startsWith('\\')) continue;
    
    const hunkMatch = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = { oldStart: parseInt(hunkMatch[1], 10), oldBlock: [], newBlock: [] };
      continue;
    }

    if (!currentHunk) continue;

    const firstChar = l.charAt(0);
    if (firstChar === ' ') {
      const text = l.slice(1);
      currentHunk.oldBlock.push(text);
      currentHunk.newBlock.push(text);
    } else if (firstChar === '-') {
      currentHunk.oldBlock.push(l.slice(1));
    } else if (firstChar === '+') {
      currentHunk.newBlock.push(l.slice(1));
    } else if (l === '') {
      currentHunk.oldBlock.push('');
      currentHunk.newBlock.push('');
    }
  }
  if (currentHunk) hunks.push(currentHunk);

  if (hunks.length === 0) return { ok: false, message: '未找到有效的 Hunk (@@ ... @@)' };

  let currentLines = [...lines];
  for (const hunk of hunks) {
    const { oldStart, oldBlock, newBlock } = hunk;
    if (oldBlock.length === 0) return { ok: false, message: 'Hunk 缺少上下文，无法定位' };

    let foundIdx = -1;

    // 策略 1：全文件精确匹配
    for (let i = 0; i <= currentLines.length - oldBlock.length; i++) {
      let match = true;
      for (let j = 0; j < oldBlock.length; j++) {
        if (currentLines[i + j] !== oldBlock[j]) { match = false; break; }
      }
      if (match) { foundIdx = i; break; }
    }

    // 策略 2：行号兜底匹配
    if (foundIdx === -1) {
      const approxIdx = Math.max(0, oldStart - 1);
      const startSearch = Math.max(0, approxIdx - 20);
      const endSearch = Math.min(currentLines.length - oldBlock.length, approxIdx + 20);
      for (let i = startSearch; i <= endSearch; i++) {
        let match = true;
        for (let j = 0; j < oldBlock.length; j++) {
          if (currentLines[i + j] !== oldBlock[j]) { match = false; break; }
        }
        if (match) { foundIdx = i; break; }
      }
    }

    // 策略 3：忽略首尾空白兜底
    if (foundIdx === -1) {
      for (let i = 0; i <= currentLines.length - oldBlock.length; i++) {
        let match = true;
        for (let j = 0; j < oldBlock.length; j++) {
          if (currentLines[i + j].trim() !== oldBlock[j].trim()) { match = false; break; }
        }
        if (match) { foundIdx = i; break; }
      }
    }

    // 策略 4：模糊匹配兜底（容忍被 Prettier 格式化或错字）
    if (foundIdx === -1) {
      let maxScore = 0;
      let bestIdx = -1;
      for (let i = 0; i <= currentLines.length - oldBlock.length; i++) {
        const window = currentLines.slice(i, i + oldBlock.length);
        const score = blockSimilarity(window, oldBlock);
        if (score > maxScore) {
          maxScore = score;
          bestIdx = i;
        }
      }
      if (maxScore >= 0.6) {
        foundIdx = bestIdx;
        console.log('  [tred patch] 精确匹配失败，已使用模糊匹配命中 (相似度: ' + (maxScore * 100).toFixed(1) + '%)');
      }
    }

    if (foundIdx === -1) {
      return { ok: false, message: '在原文件中未找到匹配的上下文块（尝试了精确、行号、忽略空白、模糊匹配四种策略）' };
    }

    currentLines.splice(foundIdx, oldBlock.length, ...newBlock);
  }

  const newText = currentLines.join('\n');

  if (/\.[jt]sx?$/.test(filePath)) {
    const errors = checkSyntax(filePath, newText);
    if (errors.length > 0) {
      return { ok: false, message: '应用 Patch 后语法报错：' + errors.join('; ') };
    }
  }

  writeFileSync(filePath, newText, 'utf-8');
  return { ok: true };
}