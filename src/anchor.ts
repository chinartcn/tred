export interface AnchorBlock {
  name: string;
  fp: string | null;
  startLine: number;
  endLine: number;
  startLineStart: number;
  endLineEnd: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startPattern(name: string, fuzzy?: boolean): RegExp {
  const flags = fuzzy ? 'i' : '';
  const pat =
    '^\\s*//\\s*@TRED_START\\s*:\\s*' +
    escapeRegex(name) +
    '(?:\\s*\\|\\s*fp=([a-f0-9]{8}))?\\s*$';
  return new RegExp(pat, flags);
}

function endPattern(name: string, fuzzy?: boolean): RegExp {
  const flags = fuzzy ? 'i' : '';
  const pat =
    '^\\s*//\\s*@TRED_END\\s*:\\s*' +
    escapeRegex(name) +
    '\\s*$';
  return new RegExp(pat, flags);
}

function lineStarts(lines: string[]): number[] {
  const acc: number[] = new Array(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    acc[i] = pos;
    pos += lines[i].length + 1;
  }
  return acc;
}

/**
 * #3 扫描所有完整的 START/END 配对（用于重复检测）。
 * 未闭合的 START 视为不完整块，跳过。
 */
export function findAllAnchors(source: string, name: string, fuzzy?: boolean): AnchorBlock[] {
  const lines = source.split('\n');
  const starts = lineStarts(lines);
  const startRe = startPattern(name, fuzzy);
  const endRe = endPattern(name, fuzzy);
  const blocks: AnchorBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const sm = lines[i].match(startRe);
    if (!sm) {
      i++;
      continue;
    }
    const startLine = i;
    const fp = sm[1] ?? null;
    let endLine = -1;
    for (let j = i + 1; j < lines.length; j++) {
      if (endRe.test(lines[j])) {
        endLine = j;
        break;
      }
    }
    if (endLine === -1) break;
    blocks.push({
      name,
      fp,
      startLine,
      endLine,
      startLineStart: starts[startLine],
      endLineEnd: starts[endLine] + lines[endLine].length,
    });
    i = endLine + 1;
  }
  return blocks;
}

/** 兼容 v0.1：返回第一个块 */
export function findAnchor(source: string, name: string, fuzzy?: boolean): AnchorBlock | null {
  const all = findAllAnchors(source, name, fuzzy);
  return all[0] ?? null;
}

/** 取 pos 所在行的行首缩进 */
export function detectIndent(source: string, pos: number): string {
  let lineStart = pos;
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--;
  let i = lineStart;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
  return source.slice(lineStart, i);
}

export function formatAnchor(name: string, fp: string): { start: string; end: string } {
  return {
    start: '// @TRED_START: ' + name + ' | fp=' + fp,
    end: '// @TRED_END: ' + name,
  };
}
