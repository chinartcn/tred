import { readFileSync, writeFileSync } from 'node:fs';
import { checkSyntax } from './safety.js';
import { getSimilarity } from './fuzzy.js';

export interface PatchResult {
  ok: boolean;
  message?: string;
  suggestion?: {
    line: number;
    score: number;
    context: string[];
    reason: string;
  };
}

function extractTokens(line: string): string[] {
  if (!line) return [];
  const normalized = line.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  const tokens = normalized.match(/[a-zA-Z0-9]{4,}|[\u4e00-\u9fa5]{2,}/g) || [];
  return tokens.map(t => t.toLowerCase());
}

export function applyPatch(
  filePath: string,
  patchText: string,
  options: { fuzzy?: boolean, fuzzyThreshold?: number, minRareTokens?: number } = {},
): PatchResult {
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

  const globalFreq = new Map<string, number>();
  for (const line of lines) {
    for (const t of extractTokens(line)) globalFreq.set(t, (globalFreq.get(t) || 0) + 1);
  }

  function tokenWeight(token: string): number {
    const freq = globalFreq.get(token) || 1;
    return 1 / Math.log2(freq + 1);
  }

  function weightedTokenSet(line: string): Map<string, number> {
    const map = new Map<string, number>();
    for (const t of extractTokens(line)) if (!map.has(t)) map.set(t, tokenWeight(t));
    return map;
  }

  function weightedLineSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.trim() === b.trim()) return 0.95;
    if (!a.trim() || !b.trim()) return 0;
    const charSim = getSimilarity(a, b);
    const ta = weightedTokenSet(a);
    const tb = weightedTokenSet(b);
    if (ta.size === 0 || tb.size === 0) return charSim;
    let intersection = 0;
    let union = 0;
    for (const [t, w] of ta) {
      union += w;
      if (tb.has(t)) intersection += w;
    }
    for (const [t, w] of tb) if (!ta.has(t)) union += w;
    const tokenSim = union > 0 ? intersection / union : 0;
    return charSim * 0.4 + tokenSim * 0.6;
  }

  const fuzzyEnabled = Boolean(options.fuzzy);
  const fuzzyThreshold = options.fuzzyThreshold ?? 0.9;
  const minRareTokens = options.minRareTokens ?? 2;

  const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  let currentLines = [...lines];

  for (const hunk of sortedHunks) {
    const { oldStart, oldBlock, newBlock } = hunk;
    if (oldBlock.length === 0) return { ok: false, message: 'Hunk 缺少上下文，无法定位' };

    const rareTokens = new Set<string>();
    for (const line of oldBlock) {
      for (const t of extractTokens(line)) {
        if ((globalFreq.get(t) || 1) <= 6) rareTokens.add(t);
      }
    }

    const approxIdx = Math.max(0, oldStart - 1);
    let foundIdx = -1;

    // 策略 1：全文件精确
    for (let i = 0; i <= currentLines.length - oldBlock.length; i++) {
      let match = true;
      for (let j = 0; j < oldBlock.length; j++) {
        if (currentLines[i + j] !== oldBlock[j]) { match = false; break; }
      }
      if (match) { foundIdx = i; break; }
    }

    // 策略 2：±50 行精确
    if (foundIdx === -1) {
      const startSearch = Math.max(0, approxIdx - 50);
      const endSearch = Math.min(currentLines.length - oldBlock.length, approxIdx + 50);
      for (let i = startSearch; i <= endSearch; i++) {
        let match = true;
        for (let j = 0; j < oldBlock.length; j++) {
          if (currentLines[i + j] !== oldBlock[j]) { match = false; break; }
        }
        if (match) { foundIdx = i; break; }
      }
    }

    // 策略 3：±50 行忽略空白
    if (foundIdx === -1) {
      const startSearch = Math.max(0, approxIdx - 50);
      const endSearch = Math.min(currentLines.length - oldBlock.length, approxIdx + 50);
      for (let i = startSearch; i <= endSearch; i++) {
        let match = true;
        for (let j = 0; j < oldBlock.length; j++) {
          if (currentLines[i + j].trim() !== oldBlock[j].trim()) { match = false; break; }
        }
        if (match) { foundIdx = i; break; }
      }
    }

    // 策略 4：Rare-Token × TF-IDF
    if (foundIdx === -1 && fuzzyEnabled) {
      if (rareTokens.size < minRareTokens) {
        return {
          ok: false,
          message: 'Hunk @@ -' + oldStart + ' 只有 ' + rareTokens.size + ' 个稀有标识符（要求 ≥ ' + minRareTokens + '），模糊匹配已拒绝。',
        };
      }

      let startSearch: number;
      let endSearch: number;
      if (approxIdx + 100 > currentLines.length) {
        startSearch = 0;
        endSearch = currentLines.length - oldBlock.length;
      } else {
        startSearch = Math.max(0, approxIdx - 100);
        endSearch = Math.min(currentLines.length - oldBlock.length, approxIdx + 100);
      }

      type Candidate = { score: number; rareHits: number; idx: number };
      let best: Candidate | null = null;

      for (let i = startSearch; i <= endSearch; i++) {
        const windowTokenSet = new Set<string>();
        for (let j = 0; j < oldBlock.length; j++) {
          const w = currentLines[i + j];
          if (w === undefined) continue;
          for (const t of extractTokens(w)) windowTokenSet.add(t);
        }
        let rareHits = 0;
        for (const t of rareTokens) if (windowTokenSet.has(t)) rareHits++;
        if (rareHits < minRareTokens) continue;

        let totalScore = 0, totalWeight = 0;
        for (let j = 0; j < oldBlock.length; j++) {
          const line = oldBlock[j];
          const winLine = currentLines[i + j] || '';
          const sim = weightedLineSimilarity(winLine, line);
          let lineHasRare = false;
          for (const t of extractTokens(line)) if (rareTokens.has(t)) { lineHasRare = true; break; }
          const w = lineHasRare ? 2.0 : 1.0;
          totalScore += sim * w;
          totalWeight += w;
        }
        const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;
        if (!best || finalScore > best.score) best = { score: finalScore, rareHits, idx: i };
      }

      if (best && best.score >= fuzzyThreshold) {
        foundIdx = best.idx;
        console.log('  [tred patch] 模糊命中 (TF-IDF 相似度 ' + (best.score * 100).toFixed(1) + '%, 稀有词 ' + best.rareHits + '/' + rareTokens.size + ', 行 ' + (foundIdx + 1) + ')');
      } else if (best) {
        // ★ v3.4.0 核心：失败时给出 suggestion
        const ctxStart = Math.max(0, best.idx - 2);
        const ctxEnd = Math.min(currentLines.length, best.idx + oldBlock.length + 2);
        return {
          ok: false,
          message: '模糊匹配得分 ' + (best.score * 100).toFixed(1) + '% 未达阈值 ' + (fuzzyThreshold * 100).toFixed(0) + '%',
          suggestion: {
            line: best.idx + 1,
            score: best.score,
            context: currentLines.slice(ctxStart, ctxEnd),
            reason: '是不是想改这里？'
          }
        };
      }
    }

    if (foundIdx === -1) {
      return { ok: false, message: 'Hunk @@ -' + oldStart + ' 未找到匹配位置' + (fuzzyEnabled ? '（已尝试模糊匹配）' : '（可加 --fuzzy 尝试）') };
    }

    currentLines.splice(foundIdx, oldBlock.length, ...newBlock);
  }

  const newText = currentLines.join('\n');
  if (/\.[jt]sx?$/.test(filePath)) {
    const errors = checkSyntax(filePath, newText);
    if (errors.length > 0) return { ok: false, message: '应用 Patch 后语法报错：' + errors.join('; ') };
  }
  writeFileSync(filePath, newText, 'utf-8');
  return { ok: true };
}