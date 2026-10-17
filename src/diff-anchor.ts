import { existsSync, readFileSync } from 'node:fs';
import { findAnchor } from './anchor.js';
import { unifiedDiff } from './diff.js';
import type {
  DiffAnchorOptions,
  DiffAnchorResult,
  DiffAnchorSide,
} from './types.js';

function extractAnchorSide(file: string, anchor: string): DiffAnchorSide {
  if (!existsSync(file)) {
    return { file: file, found: false, content: null, startLine: null, endLine: null };
  }
  const source = readFileSync(file, 'utf-8');
  const block = findAnchor(source, anchor);
  if (!block) {
    return { file: file, found: false, content: null, startLine: null, endLine: null };
  }
  const lines = source.split('\n');
  // 提取 START 行之后到 END 行之前的内容（不含两条注释）
  const inner = lines.slice(block.startLine + 1, block.endLine);
  return {
    file: file,
    found: true,
    content: inner.join('\n'),
    startLine: block.startLine + 2,
    endLine: block.endLine,
  };
}

export function diffAnchor(opts: DiffAnchorOptions): DiffAnchorResult {
  const left = extractAnchorSide(opts.left, opts.anchor);
  const right = extractAnchorSide(opts.right, opts.anchor);

  if (!left.found && !right.found) {
    return {
      ok: false,
      anchor: opts.anchor,
      left: left,
      right: right,
      diff: '',
      message: '两侧均未找到锚点 "' + opts.anchor + '"',
    };
  }
  if (!left.found) {
    return {
      ok: false,
      anchor: opts.anchor,
      left: left,
      right: right,
      diff: '',
      message: '左侧文件未找到锚点: ' + opts.left,
    };
  }
  if (!right.found) {
    return {
      ok: false,
      anchor: opts.anchor,
      left: left,
      right: right,
      diff: '',
      message: '右侧文件未找到锚点: ' + opts.right,
    };
  }

  const a = left.content ?? '';
  const b = right.content ?? '';
  if (a === b) {
    return { ok: true, anchor: opts.anchor, left: left, right: right, diff: '' };
  }

  const diff = unifiedDiff(a, b, 'a/' + opts.left, 'b/' + opts.right);
  return { ok: true, anchor: opts.anchor, left: left, right: right, diff: diff };
}
