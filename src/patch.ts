import { readFileSync, writeFileSync } from 'node:fs';
import { checkSyntax } from './safety.js';

/**
 * 极简的 unified diff 应用器。
 * 解析 -行 和 +行，然后在原文件中进行替换。
 * 如果应用后语法错误，则拒绝写入。
 */
export function applyPatch(filePath: string, patchText: string): { ok: boolean; message?: string } {
  const original = readFileSync(filePath, 'utf-8');
  const lines = original.split('\n');
  const patchLines = patchText.split('\n');

  // 1. 提取出要删除的行和要添加的行
  const minusLines: string[] = [];
  const plusLines: string[] = [];

  for (const l of patchLines) {
    if (l.startsWith('-') && !l.startsWith('---')) minusLines.push(l.slice(1));
    else if (l.startsWith('+') && !l.startsWith('+++')) plusLines.push(l.slice(1));
  }

  if (minusLines.length === 0 && plusLines.length === 0) {
    return { ok: false, message: 'Patch 格式错误：未找到 + 或 - 行' };
  }

  // 2. 在原文件中寻找要删除的块
  let foundIdx = -1;
  for (let i = 0; i <= lines.length - minusLines.length; i++) {
    let match = true;
    for (let j = 0; j < minusLines.length; j++) {
      if (lines[i + j] !== minusLines[j]) {
        match = false; break;
      }
    }
    if (match) { foundIdx = i; break; }
  }

  if (foundIdx === -1) {
    return { ok: false, message: '在原文件中未找到待删除的代码块，Patch 应用失败' };
  }

  // 3. 替换为新行
  lines.splice(foundIdx, minusLines.length, ...plusLines);
  const newText = lines.join('\n');

  // 4. 语法门禁
  if (/\.[jt]sx?$/.test(filePath)) {
    const errors = checkSyntax(filePath, newText);
    if (errors.length > 0) {
      return { ok: false, message: '应用 Patch 后语法报错：' + errors.join('; ') };
    }
  }

  writeFileSync(filePath, newText, 'utf-8');
  return { ok: true };
}