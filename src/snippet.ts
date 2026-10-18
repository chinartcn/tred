import type { SnippetSelector } from './types.js';

export function findSnippetRange(
  source: string,
  sel: SnippetSelector,
): { start: number; end: number } | null {
  const lines = source.split('\n');
  const lineStarts = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(pos);
    pos += lines[i].length + 1;
  }

  let startLineIdx = -1;
  let endLineIdx = -1;

  // 1. 找起始行
  if (sel.startLine !== undefined) {
    startLineIdx = sel.startLine - 1;
  } else if (sel.startSnippet) {
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(sel.startSnippet)) {
        count++;
        if (count === (sel.occurrence ?? 1)) {
          startLineIdx = i;
          break;
        }
      }
    }
  }

  if (startLineIdx < 0 || startLineIdx >= lines.length) return null;

  // 2. 找结束行（v2.5.0: cutToEnd 优先级最高）
  if (sel.cutToEnd) {
    endLineIdx = lines.length - 1;
  } else if (sel.endLine !== undefined) {
    endLineIdx = sel.endLine - 1;
  } else if (sel.endSnippet) {
    for (let i = startLineIdx; i < lines.length; i++) {
      if (lines[i].includes(sel.endSnippet)) {
        endLineIdx = i;
        break;
      }
    }
  } else {
    endLineIdx = startLineIdx;
  }

  if (endLineIdx < startLineIdx || endLineIdx >= lines.length) return null;

  const startPos = lineStarts[startLineIdx];
  const endPos = lineStarts[endLineIdx] + lines[endLineIdx].length;
  return { start: startPos, end: endPos };
}
