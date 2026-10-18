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

export function extractTokens(line: string): string[] {
  if (!line) return [];
  const normalized = line.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  const tokens = normalized.match(/[a-zA-Z0-9]{4,}|[\u4e00-\u9fa5]{2,}/g) || [];
  return tokens.map(t => t.toLowerCase());
}

function genHtmlReport(file: string, line: number, current: string[], target: string[], score: number): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const currentHtml = current.map((l, i) => {
    const num = line - 2 + i;
    return '<div class="line"><span class="num">' + num + '</span>' + esc(l) + '</div>';
  }).join('');

  const targetHtml = target.map((l, i) => {
    const num = line - 2 + i;
    return '<div class="line"><span class="num">' + num + '</span>' + esc(l) + '</div>';
  }).join('');

  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"><title>tred suggest</title>',
    '<style>',
    'body{font-family:system-ui,sans-serif;margin:0;background:#f6f8fa;height:100vh;display:flex;flex-direction:column;}',
    '.header{padding:1em 2em;background:#fff;border-bottom:1px solid #d0d7de;box-shadow:0 1px 3px rgba(0,0,0,.05);}',
    '.header h1{margin:0;font-size:1.2em;color:#24292f;}',
    '.header p{margin:.5em 0 0;color:#57606a;font-size:.9em;}',
    '.split{display:flex;flex:1;overflow:hidden;}',
    '.pane{flex:1;overflow-y:auto;padding:1em;position:relative;}',
    '.pane.left{background:#fff;border-right:1px solid #d0d7de;}',
    '.pane.right{background:#f0fdf4;}',
    '.line{font-family:ui-monospace,monospace;font-size:0.9em;line-height:1.6;white-space:pre;}',
    '.num{display:inline-block;width:3em;color:#8c959f;text-align:right;margin-right:1em;user-select:none;}',
    '.tag{position:absolute;top:1em;right:2em;font-size:0.8em;color:#fff;padding:0.2em 0.6em;border-radius:1em;}',
    '.left .tag{background:#0969da;}',
    '.right .tag{background:#2da44e;}',
    '</style>',
    '</head><body>',
    '<div class="header"><h1>💡 tred suggest: ' + esc(file) + '</h1>',
    '<p>发现第 ' + line + ' 行有 ' + (score * 100).toFixed(1) + '% 的相似度。左侧为当前代码，右侧为想要应用的补丁目标。</p></div>',
    '<div class="split">',
    '  <div class="pane left"><div class="tag">CURRENT</div>' + currentHtml + '</div>',
    '  <div class="pane right"><div class="tag">TARGET</div>' + targetHtml + '</div>',
    '</div></body></html>'
  ].join('\n');
}

function healNewBlock(oldBlock: string[], newBlock: string[], actualBlock: string[]): string[] | null {
  if (oldBlock.length !== actualBlock.length) return null;
  const healed = [...newBlock];
  for (let i = 0; i < oldBlock.length; i++) {
    if (oldBlock[i] !== actualBlock[i]) {
      const idx = healed.indexOf(oldBlock[i]);
      if (idx !== -1) healed[idx] = actualBlock[i];
    }
  }
  return healed;
}

export function applyPatch(
  filePath: string,
  patchText: string,
  options: { fuzzy?: boolean, fuzzyThreshold?: number, minRareTokens?: number, autoHeal?: boolean, html?: boolean } = {},
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
    return 1 / Math.log2((globalFreq.get(token) || 1) + 1);
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
    let intersection = 0, union = 0;
    for (const [t, w] of ta) { union += w; if (tb.has(t)) intersection += w; }
    for (const [t, w] of tb) if (!ta.has(t)) union += w;
    return charSim * 0.4 + (union > 0 ? intersection / union : 0) * 0.6;
  }

  const fuzzyEnabled = Boolean(options.fuzzy);
  const fuzzyThreshold = options.fuzzyThreshold ?? 0.9;
  const minRareTokens = options.minRareTokens ?? 2;
  const autoHeal = Boolean(options.autoHeal);
  const html = Boolean(options.html);

  const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  let currentLines = [...lines];

  for (const hunk of sortedHunks) {
    const { oldStart, oldBlock } = hunk;
    let { newBlock } = hunk;
    if (oldBlock.length === 0) return { ok: false, message: 'Hunk 缺少上下文，无法定位' };

    const rareTokens = new Set<string>();
    for (const line of oldBlock) {
      for (const t of extractTokens(line)) if ((globalFreq.get(t) || 1) <= 6) rareTokens.add(t);
    }

    const approxIdx = Math.max(0, oldStart - 1);
    let foundIdx = -1;

    for (let i = 0; i <= currentLines.length - oldBlock.length; i++) {
      let match = true;
      for (let j = 0; j < oldBlock.length; j++) {
        if (currentLines[i + j] !== oldBlock[j]) { match = false; break; }
      }
      if (match) { foundIdx = i; break; }
    }

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

    if (foundIdx === -1 && fuzzyEnabled) {
      if (rareTokens.size < minRareTokens) {
        return { ok: false, message: 'Hunk @@ -' + oldStart + ' 只有 ' + rareTokens.size + ' 个稀有标识符，模糊匹配已拒绝。' };
      }
      const isOutOfBounds = approxIdx + 100 > currentLines.length;
      const startSearch = isOutOfBounds ? 0 : Math.max(0, approxIdx - 100);
      const endSearch = isOutOfBounds ? currentLines.length - oldBlock.length : Math.min(currentLines.length - oldBlock.length, approxIdx + 100);
      let best: { score: number, rareHits: number, idx: number } | null = null;

      for (let i = startSearch; i <= endSearch; i++) {
        const windowTokenSet = new Set<string>();
        for (let j = 0; j < oldBlock.length; j++) {
          const w = currentLines[i + j];
          if (w !== undefined) for (const t of extractTokens(w)) windowTokenSet.add(t);
        }
        let rareHits = 0;
        for (const t of rareTokens) if (windowTokenSet.has(t)) rareHits++;
        if (rareHits < minRareTokens) continue;

        let totalScore = 0, totalWeight = 0;
        for (let j = 0; j < oldBlock.length; j++) {
          const sim = weightedLineSimilarity(currentLines[i + j] || '', oldBlock[j]);
          let lineHasRare = false;
          for (const t of extractTokens(oldBlock[j])) if (rareTokens.has(t)) { lineHasRare = true; break; }
          totalScore += sim * (lineHasRare ? 2 : 1);
          totalWeight += (lineHasRare ? 2 : 1);
        }
        const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;
        if (!best || finalScore > best.score) best = { score: finalScore, rareHits, idx: i };
      }

      if (best) {
        if (autoHeal && best.score >= fuzzyThreshold - 0.15) {
          const actualBlock = currentLines.slice(best.idx, best.idx + oldBlock.length);
          const healedNew = healNewBlock(oldBlock, newBlock, actualBlock);
          if (healedNew) {
            console.log('  [tred patch] 🔧 Auto-Heal 成功，上下文已修正为当前文件内容 (原相似度: ' + (best.score * 100).toFixed(1) + '%)');
            newBlock = healedNew;
            foundIdx = best.idx;
          }
        }

        if (foundIdx === -1 && best.score >= fuzzyThreshold) {
          foundIdx = best.idx;
          console.log('  [tred patch] 模糊命中 (相似度 ' + (best.score * 100).toFixed(1) + '%, 行 ' + (foundIdx + 1) + ')');
        } else if (foundIdx === -1) {
          const ctxStart = Math.max(0, best.idx - 2);
          const ctxEnd = Math.min(currentLines.length, best.idx + oldBlock.length + 2);
          const currentCtx = currentLines.slice(ctxStart, ctxEnd);
          if (html) {
            const targetCtx = newBlock;
            const htmlStr = genHtmlReport(filePath, best.idx + 1, currentCtx, targetCtx, best.score);
            writeFileSync('tred-suggest.html', htmlStr);
            console.log('  [tred suggest] 可视化报告已生成: tred-suggest.html');
          }
          return {
            ok: false,
            message: '模糊匹配得分 ' + (best.score * 100).toFixed(1) + '% 未达阈值 ' + (fuzzyThreshold * 100).toFixed(0) + '%',
            suggestion: { line: best.idx + 1, score: best.score, context: currentCtx, reason: '是不是想改这里？' }
          };
        }
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