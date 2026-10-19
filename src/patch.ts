import { readFileSync, writeFileSync } from 'node:fs';
import { checkSyntax } from './safety.js';
import { getSimilarity } from './fuzzy.js';
import { tokenize, calcBM25 } from './bm25.js';
import { getAstShape, lcsRatio } from './ast-shape.js';
import { minHashJaccard } from './minhash.js';
import { calcHybridSimilarity } from './hybrid.js';
import { getEmbedding, getCache, saveCache } from './embedding.js';
import { buildAndSearch } from './vector-index.js';

export interface PatchExplain {
  candidateCount: number;
  reason: 'success' | 'ambiguous' | 'below-threshold' | 'not-found';
  best?: {
    line: number;
    score: number;
    charSimAvg: number;
    tokenSimAvg: number;
    keyLines: number;
    keyHits: number;
    rareHits: number;
    positionOffset: number;
  };
  second?: { line: number; score: number; margin: number };
}

export interface PatchResult {
  ok: boolean;
  message?: string;
  suggestion?: {
    line: number;
    score: number;
    context: string[];
    reason: string;
  };
  explain?: PatchExplain; // P1_3_explain
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

export async function applyPatch(
  filePath: string,
  patchText: string,
  options: { fuzzy?: boolean, fuzzyThreshold?: number, minRareTokens?: number, autoHeal?: boolean, html?: boolean, fuzzyMinMargin?: number, force?: boolean, semantic?: boolean } = {},
): Promise<PatchResult> {
  let lastExplain: PatchExplain | undefined; // P1_3_explain
  const original = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const lines = original.split('\n');
  // 修复：patch 文本末尾的 \n 会产生假空行，必须去掉
  const rawPatchLines = patchText.replace(/\r\n/g, '\n').split('\n');
  if (rawPatchLines.length > 0 && rawPatchLines[rawPatchLines.length - 1] === '') {
    rawPatchLines.pop();
  }
  const patchLines = rawPatchLines;

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

  type LineSimTier = 'exact' | 'trim' | 'token-set' | 'rare-hit' | 'blend' | 'empty';
  interface LineSimDetail { score: number; charSim: number; tokenSim: number; tier: LineSimTier; }

  function weightedLineSimilarityDetail(a: string, b: string): LineSimDetail {
    if (a === b) return { score: 1, charSim: 1, tokenSim: 1, tier: 'exact' };
    if (a.trim() === b.trim()) return { score: 0.95, charSim: 1, tokenSim: 1, tier: 'trim' };
    if (!a.trim() || !b.trim()) return { score: 0, charSim: 0, tokenSim: 0, tier: 'empty' };

    const charSim = getSimilarity(a, b);
    const ta = weightedTokenSet(a);
    const tb = weightedTokenSet(b);

    if (ta.size === 0 && tb.size === 0) return { score: charSim, charSim, tokenSim: charSim, tier: 'blend' };
    if (ta.size === 0 || tb.size === 0) return { score: charSim * 0.5, charSim, tokenSim: 0, tier: 'blend' };

    // P1: token 集完全相同
    if (ta.size === tb.size) {
      let same = true;
      for (const t of ta.keys()) if (!tb.has(t)) { same = false; break; }
      if (same) return { score: Math.max(charSim, 0.97), charSim, tokenSim: 1, tier: 'token-set' };
    }

    // P1: a 的所有稀有词都在 b 里
    let rareTotal = 0, rareHit = 0;
    for (const t of ta.keys()) {
      const freq = globalFreq.get(t) || 0;
      if (freq > 0 && freq <= 6) { rareTotal++; if (tb.has(t)) rareHit++; }
    }
    if (rareTotal > 0 && rareHit === rareTotal) return { score: Math.max(charSim, 0.92), charSim, tokenSim: 1, tier: 'rare-hit' };

    let intersection = 0, union = 0;
    for (const [t, w] of ta) { union += w; if (tb.has(t)) intersection += w; }
    for (const [t, w] of tb) if (!ta.has(t)) union += w;
    const tokenSim = union > 0 ? intersection / union : 0;
    return { score: charSim * 0.4 + tokenSim * 0.6, charSim, tokenSim, tier: 'blend' };
  }

  function weightedLineSimilarity(a: string, b: string): number {
    return weightedLineSimilarityDetail(a, b).score;
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

    // P1: 唯一 token（频率=1）用于判定"关键行"（必须完美命中）
    // 避免 import/from 等通用词在小文件里被误判为稀有词行
    const uniqueTokens = new Set<string>();
    for (const line of oldBlock) {
      // 只收文件里实际出现 1 次的 token（patch 独有 token 不进，避免 other1 这类被误判为关键）
      for (const t of extractTokens(line)) {
        if (globalFreq.get(t) === 1) uniqueTokens.add(t);
      }
    }

    // 同时 clamp 上界，防止 oldStart 落在 [len - blockLen, len) 时越界
    const maxIdx = Math.max(0, currentLines.length - oldBlock.length);
    const approxIdx = Math.min(Math.max(0, oldStart - 1), maxIdx);
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
      
      // P0_2_arbitration: 收集所有候选用于仲裁
      const candidates: { score: number, rareHits: number, idx: number, charSimAvg: number, tokenSimAvg: number, keyLines: number, keyHits: number }[] = [];

      // 🚀 v4.0 混合算法预计算
      const hunkText = oldBlock.join('\n');

      for (let i = startSearch; i <= endSearch; i++) {
        const windowTokenSet = new Set<string>();
        for (let j = 0; j < oldBlock.length; j++) {
          const w = currentLines[i + j];
          if (w !== undefined) for (const t of extractTokens(w)) windowTokenSet.add(t);
        }
        let rareHits = 0;
        for (const t of rareTokens) if (windowTokenSet.has(t)) rareHits++;
        if (rareHits < minRareTokens) continue;

        const candLines = currentLines.slice(i, i + oldBlock.length);
        const candText = candLines.join('\n');

        // 🚀 调用 v4.0 公共 API 进行混合打分
        const detail = calcHybridSimilarity(hunkText, candText);
        let finalScore = detail.finalScore;

        // 原有 P1 的稀有词加权兜底
        let keyLineCount = 0, keyLineHitCount = 0;
        for (let j = 0; j < oldBlock.length; j++) {
          let lineHasUnique = false;
          for (const t of extractTokens(oldBlock[j])) if (uniqueTokens.has(t)) { lineHasUnique = true; break; }
          if (lineHasUnique) {
            keyLineCount++;
            const sim = getSimilarity(candLines[j] || '', oldBlock[j]);
            if (sim >= 0.9) keyLineHitCount++;
          }
        }
        if (keyLineCount > 0 && keyLineHitCount === keyLineCount && finalScore < 0.93) {
          finalScore = 0.93;
        }

        if (finalScore > 0) candidates.push({
          score: finalScore,
          rareHits,
          idx: i,
          charSimAvg: 0,
          tokenSimAvg: 0,
          keyLines: keyLineCount,
          keyHits: keyLineHitCount,
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      
      // 🚀 v3.9.1 Hybrid Search 精排 (HNSW)
      if (options.semantic && candidates.length > 0) {
        const topK = candidates.slice(0, 3);
        const hunkText = oldBlock.join('\n');
        const cache = getCache();
        const hunkKey = 'hunk:' + hunkText.trim().slice(0, 100);
        let hunkVec: number[] | null | undefined = cache[hunkKey];
        
        if (!hunkVec) {
          hunkVec = await getEmbedding(hunkText);
          if (hunkVec) cache[hunkKey] = hunkVec;
        }

        if (hunkVec) {
          const hnswCandidates: { idx: number, text: string, vector: number[], score: number }[] = [];
          
          for (const cand of topK) {
            const candText = currentLines.slice(cand.idx, cand.idx + oldBlock.length).join('\n');
            const candKey = 'cand:' + candText.trim().slice(0, 100);
            let candVec: number[] | null | undefined = cache[candKey];
            if (!candVec) {
              candVec = await getEmbedding(candText);
              if (candVec) cache[candKey] = candVec;
            }
            if (candVec) {
              hnswCandidates.push({ idx: cand.idx, text: candText, vector: candVec, score: cand.score });
            }
          }
          
          if (hnswCandidates.length > 0) {
            // 用持久化 HNSW 索引搜索
            const searchResults = buildAndSearch(hnswCandidates, hunkVec);
            
            // 融合打分
            for (const res of searchResults) {
              // HNSW 返回的是距离 (越小越近)，转成相似度
              const vecSim = Math.max(0, 1 - res.distance); 
              const cand = candidates.find(c => c.idx === res.idx);
              if (cand) {
                cand.score = cand.score * 0.6 + vecSim * 0.4;
              }
            }
            
            saveCache(cache);
            // 重新排序
            topK.sort((a, b) => b.score - a.score);
            candidates[0] = topK[0];
            candidates[1] = topK[1] || null;
          } else {
            console.warn('⚠️ [tred] 向量生成失败，跳过语义重排。');
          }
        } else {
          console.warn('⚠️ [tred] Embedding 不可用，本次跳过语义重排。');
        }
      }

      const best = candidates[0] || null;
      const second = candidates[1] || null;

      // P1_3_explain: 构造 explain 结果
      const buildExplain = (reason: PatchExplain['reason']): PatchExplain => {
        const b = candidates[0];
        const s = candidates[1];
        return {
          candidateCount: candidates.length,
          reason,
          best: b ? {
            line: b.idx + 1,
            score: b.score,
            charSimAvg: b.charSimAvg,
            tokenSimAvg: b.tokenSimAvg,
            keyLines: b.keyLines,
            keyHits: b.keyHits,
            rareHits: b.rareHits,
            positionOffset: b.idx - approxIdx,
          } : undefined,
          second: s ? { line: s.idx + 1, score: s.score, margin: b ? b.score - s.score : 0 } : undefined,
        };
      };

      if (best) {
        // P0_2_arbitration: top1/top2 差距过小时拒绝（避免并列静默误伤）
        const minMargin = options.fuzzyMinMargin ?? 0.05;
        const force = options.force ?? false;
        let ambiguous = false;
        if (!force && second && best.score >= fuzzyThreshold) {
          const margin = best.score - second.score;
          if (margin < minMargin) ambiguous = true;
        }

        if (ambiguous) {
          const margin = best.score - second!.score;
          return {
            ok: false,
            explain: buildExplain('ambiguous'),
            message:
              '模糊匹配存在 ' + candidates.length + ' 个近似候选，可能"打错位置"。\n'
              + '  top1: ' + (best.score * 100).toFixed(1) + '% @ L' + (best.idx + 1) + '\n'
              + '  top2: ' + (second!.score * 100).toFixed(1) + '% @ L' + (second!.idx + 1) + '\n'
              + '  margin: ' + (margin * 100).toFixed(1) + '% < ' + (minMargin * 100).toFixed(0) + '%\n'
              + '  💡 缩小 hunk 上下文、提高 --fuzzy-threshold，或加 --force 强制接受 top1',
            suggestion: {
              line: best.idx + 1,
              score: best.score,
              context: currentLines.slice(Math.max(0, best.idx - 2), Math.min(currentLines.length, best.idx + oldBlock.length + 2)),
              reason: '存在并列候选，是否强制应用此处？（--force）',
            },
          };
        }

        if (autoHeal && best.score >= fuzzyThreshold - 0.15) {
          const actualBlock = currentLines.slice(best.idx, best.idx + oldBlock.length);
          const healedNew = healNewBlock(oldBlock, newBlock, actualBlock);
          if (healedNew) {
            console.log('  [tred patch] 🔧 Auto-Heal 成功，上下文已修正为当前文件内容 (原相似度: ' + (best.score * 100).toFixed(1) + '%)');
            newBlock = healedNew;
            foundIdx = best.idx;
          }
        }

        if (foundIdx === -1 && (best.score >= fuzzyThreshold || force)) {
          foundIdx = best.idx;
          lastExplain = buildExplain('success');
          console.log('  [tred patch] 模糊命中 (相似度 ' + (best.score * 100).toFixed(1) + '%, 行 ' + (foundIdx + 1) + ', 候选 ' + candidates.length + (force && best.score < fuzzyThreshold ? ', --force 覆盖' : '') + ')');
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
          // P1: 诊断最低匹配行 + --auto-heal 提示
          let worstJ = -1, worstSim = 2;
          for (let j = 0; j < oldBlock.length; j++) {
            const s = weightedLineSimilarity(currentLines[best.idx + j] || '', oldBlock[j]);
            if (s < worstSim) { worstSim = s; worstJ = j; }
          }
          let diag = '';
          if (worstJ >= 0) {
            diag = '\n  最低匹配行 hunk[' + worstJ + '] ' + (worstSim * 100).toFixed(1) + '%'
              + '\n    预期: ' + oldBlock[worstJ].slice(0, 100)
              + '\n    实际: ' + (currentLines[best.idx + worstJ] || '').slice(0, 100);
          }
          let autoHint = '';
          if (!autoHeal && best.score >= fuzzyThreshold - 0.15) {
            autoHint = '\n  💡 加 --auto-heal 可自动修正上下文（差距 ' + ((fuzzyThreshold - best.score) * 100).toFixed(1) + '%）';
          }
          return {
            ok: false,
            explain: buildExplain('below-threshold'),
            message: '模糊匹配得分 ' + (best.score * 100).toFixed(1) + '% 未达阈值 ' + (fuzzyThreshold * 100).toFixed(0) + '%' + diag + autoHint,
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
  return { ok: true, explain: lastExplain };
}