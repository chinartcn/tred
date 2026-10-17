import { existsSync, readFileSync } from 'node:fs';
import { detectIndent, findAllAnchors, formatAnchor } from './anchor.js';
import { findNodeRange } from './ast.js';
import { atomicWrite } from './atomic.js';
import { checkSyntax } from './safety.js';
import { unifiedDiff } from './diff.js';
import type { BatchResult, ReplaceManyOptions, ReplaceOptions, ReplaceResult, ReplaceStatus } from './types.js';
import { writeRollbackLog } from './rollback-log.js';

export { makeFingerprint } from './fingerprint.js';
export { checkSyntax } from './safety.js';
export { unifiedDiff } from './diff.js';
export { buildOutline } from './ast-outline.js';
export type {
  AstSelector,
  BatchResult,
  BatchStatus,
  Formatter,
  OutlineKind,
  OutlineNode,
  ReplaceOptions,
  ReplaceResult,
  ReplaceStatus,
} from './types.js';

export function normalizeContent(content: string): string {
  const lines = content.split('\n');
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0 && lines[lastIdx].trim() === '') lastIdx--;
  if (lastIdx < 0) return content;
  const baseMatch = lines[lastIdx].match(/^[\t ]*/);
  const baseIndent = baseMatch ? baseMatch[0] : '';
  if (baseIndent.length === 0) return content;
  return lines.map(function (line) {
    let k = 0;
    while (k < baseIndent.length && k < line.length && (line[k] === ' ' || line[k] === '\t')) k++;
    return line.slice(k);
  }).join('\n');
}

function indentLines(text: string, indent: string): string {
  if (!indent) return text;
  return text.split('\n').map(function (line) { return line ? indent + line : line; }).join('\n');
}

function buildBlock(anchor: string, fp: string, content: string, indent: string): string {
  const pair = formatAnchor(anchor, fp);
  const normalized = normalizeContent(content).replace(/\n+$/, '');
  const body = indentLines(normalized, indent);
  return indent + pair.start + '\n' + body + '\n' + indent + pair.end;
}

interface ComputeOutcome {
  nextSource: string | null;
  status: ReplaceStatus;
  message?: string;
  syntaxErrors?: string[];
  diff?: string;
}

async function computeReplace(original: string, opts: ReplaceOptions): Promise<ComputeOutcome> {
  const file = opts.file;
  const anchor = opts.anchor;
  const content = opts.content;
  const fingerprint = opts.fingerprint;

  const allAnchors = findAllAnchors(original, anchor);
  if (allAnchors.length > 1) {
    const where = allAnchors.map(function (b) { return b.startLine + 1; }).join(', ');
    return {
      nextSource: null,
      status: 'failed',
      message: '锚点名 "' + anchor + '" 出现 ' + allAnchors.length + ' 次（行 ' + where + '），请确保唯一',
    };
  }

  const block = allAnchors[0];
  let nextSource: string;
  let status: 'injected' | 'replaced';

  if (!block) {
    if (!opts.autoInjectAnchor || !opts.astSelector) {
      return { nextSource: null, status: 'failed', message: '找不到锚点；如需首次注入，请提供 autoInjectAnchor: true 与 astSelector' };
    }
    const range = findNodeRange(file, original, opts.astSelector);
    if (!range) {
      return { nextSource: null, status: 'failed', message: 'AST 中找不到节点: ' + JSON.stringify(opts.astSelector) };
    }
    const indent = detectIndent(original, range.start);
    const newBlock = buildBlock(anchor, fingerprint, content, indent);
    const lineStart = range.start - indent.length;
    nextSource = original.slice(0, lineStart) + newBlock + original.slice(range.end);
    status = 'injected';
  } else {
    if (block.fp === fingerprint) {
      return { nextSource: null, status: 'skipped', message: '指纹一致 (' + fingerprint + ')，跳过' };
    }
    const indent = detectIndent(original, block.startLineStart);
    const newBlock = buildBlock(anchor, fingerprint, content, indent);
    nextSource = original.slice(0, block.startLineStart) + newBlock + original.slice(block.endLineEnd);
    status = 'replaced';
  }

  if (opts.format) {
    try {
      nextSource = await opts.format(nextSource, file);
    } catch (e) {
      return { nextSource: null, status: 'failed', message: '格式化失败: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  const syntaxErrors = checkSyntax(file, nextSource);
  if (syntaxErrors.length > 0) {
    return { nextSource: null, status: 'failed', message: '语法校验失败，拒绝写入', syntaxErrors: syntaxErrors };
  }

  const diff = unifiedDiff(original, nextSource, 'a/' + file, 'b/' + file);
  return { nextSource: nextSource, status: status, diff: diff };
}

export async function replace(opts: ReplaceOptions): Promise<ReplaceResult> {
  if (!existsSync(opts.file)) {
    return { status: 'failed', file: opts.file, anchor: opts.anchor, message: '文件不存在: ' + opts.file };
  }
  const original = readFileSync(opts.file, 'utf-8');
  const c = await computeReplace(original, opts);
  const result: ReplaceResult = {
    status: c.status, file: opts.file, anchor: opts.anchor,
    message: c.message, syntaxErrors: c.syntaxErrors,
  };
  if (opts.dryRun) {
    result.diff = c.diff;
    if (!result.message) result.message = 'dry-run：未写盘';
    return result;
  }
  if (c.nextSource !== null) atomicWrite(opts.file, c.nextSource);
  return result;
}

export async function replaceMany(ops: ReplaceOptions[], options?: ReplaceManyOptions): Promise<BatchResult> {
  const anyDryRun = ops.some(function (o) { return Boolean(o.dryRun); });
  const continueOnError = Boolean(options?.continueOnError);
  const results: ReplaceResult[] = new Array(ops.length);
  for (let i = 0; i < ops.length; i++) {
    results[i] = { status: 'failed', file: ops[i].file, anchor: ops[i].anchor, message: '未执行' };
  }

  // 阶段 1：前置检查（文件存在性）
  const missing = new Set<string>();
  for (let i = 0; i < ops.length; i++) {
    if (!existsSync(ops[i].file)) {
      results[i] = {
        status: 'failed',
        file: ops[i].file,
        anchor: ops[i].anchor,
        message: '文件不存在: ' + ops[i].file,
      };
      missing.add(ops[i].file);
    }
  }
  if (missing.size > 0 && !continueOnError) {
    return { status: 'rolled-back', results: results, committedFiles: [] };
  }

  // 阶段 2：按文件分组（跳过缺失文件）
  const groups = new Map<string, { op: ReplaceOptions; index: number }[]>();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (missing.has(op.file)) continue;
    if (!groups.has(op.file)) groups.set(op.file, []);
    groups.get(op.file)!.push({ op: op, index: i });
  }

  const originals = new Map<string, string>();
  const pending = new Map<string, string>();

  // 阶段 3：串行 compute（同文件多 op 基于上一个 nextSource）
  for (const [file, items] of groups) {
    const original = readFileSync(file, 'utf-8');
    originals.set(file, original);
    let source = original;
    let dirty = false;
    let failedInThisFile = false;

    for (const item of items) {
      if (failedInThisFile) {
        results[item.index] = {
          status: 'failed',
          file: file,
          anchor: item.op.anchor,
          message: '同文件内前置 op 失败，跳过',
        };
        continue;
      }
      const c = await computeReplace(source, item.op);
      results[item.index] = {
        status: c.status,
        file: file,
        anchor: item.op.anchor,
        message: c.message,
        syntaxErrors: c.syntaxErrors,
        diff: c.diff,
      };
      if (c.status === 'failed') {
        failedInThisFile = true;
        // 回写同文件已成功 compute 的 op 状态：本文件整体 skip，前面 op 的改动未落地
        for (const prev of items) {
          if (prev.index === item.index) break;
          const pr = results[prev.index];
          if (pr.status !== 'failed') {
            results[prev.index] = {
              status: 'failed',
              file: file,
              anchor: prev.op.anchor,
              message: '同文件内后续 op 失败，本文件整体 skip',
            };
          }
        }
        if (!continueOnError) {
          return { status: 'rolled-back', results: results, committedFiles: [] };
        }
      } else if (c.nextSource !== null) {
        source = c.nextSource;
        dirty = true;
      }
    }
    if (!failedInThisFile && dirty) pending.set(file, source);
  }

  if (anyDryRun) {
    return { status: 'dry-run', results: results, committedFiles: [] };
  }

  // 阶段 4：提交
  const writer = options?._writer ?? atomicWrite;
  const committed: string[] = [];
  const attempted = Array.from(pending.keys());

  if (continueOnError) {
    // 尽力而为：每文件独立提交，失败不影响其他文件
    for (const [file, nextSource] of pending) {
      try {
        writer(file, nextSource);
        committed.push(file);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const items = groups.get(file)!;
        for (const item of items) {
          results[item.index] = {
            status: 'failed',
            file: file,
            anchor: item.op.anchor,
            message: '提交失败: ' + msg,
          };
        }
      }
    }
    const anyFailed = results.some(function (r) { return r.status === 'failed'; });
    if (anyFailed && committed.length === 0) {
      return { status: 'rolled-back', results: results, committedFiles: [] };
    }
    if (anyFailed) {
      return { status: 'partial', results: results, committedFiles: committed };
    }
    return { status: 'committed', results: results, committedFiles: committed };
  }

  // 非 continueOnError：原有全事务回滚 + rollbackLog
  let failedFile: string | null = null;
  let commitError: string | null = null;
  const rollbackErrors: { file: string; message: string }[] = [];

  try {
    for (const [file, nextSource] of pending) {
      try {
        writer(file, nextSource);
        committed.push(file);
      } catch (e) {
        failedFile = file;
        throw e;
      }
    }
  } catch (e) {
    commitError = e instanceof Error ? e.message : String(e);
    for (const file of committed) {
      try {
        writer(file, originals.get(file)!);
      } catch (err) {
        rollbackErrors.push({
          file: file,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (options?.rollbackLog) {
      try {
        writeRollbackLog(
          {
            timestamp: new Date().toISOString(),
            status: 'rolled-back',
            error: commitError,
            commitPhase: {
              attempted: attempted,
              committed: committed.slice(),
              failed: failedFile,
              rollbackErrors: rollbackErrors,
            },
            ops: results.map(function (r) {
              return Object.assign({}, r);
            }),
          },
          options.rollbackLog,
        );
      } catch (logErr) {
        commitError = commitError + ' | rollback-log 写入失败: ' + (logErr instanceof Error ? logErr.message : String(logErr));
      }
    }

    return {
      status: 'rolled-back',
      results: results,
      committedFiles: [],
      error: commitError,
    };
  }

  return { status: 'committed', results: results, committedFiles: committed };
}

// v0.5: verify
export { scanFileAnchors, verifyDir } from './verify.js';
export type {
  VerifyAnchorEntry,
  VerifyDuplicateAcross,
  VerifyDuplicateWithin,
  VerifyFingerprintMismatch,
  VerifyFileReport,
  VerifyIssue,
  VerifyOrphan,
  VerifyReport,
} from './types.js';

// v0.7: verify --fix
export { fixDir, fixFileContent } from './fix.js';
export type { FixFileCompute } from './fix.js';
export type {
  FixAction,
  FixActionKind,
  FixFileResult,
  FixOptions,
  FixRemainingOrphan,
  FixReport,
} from './types.js';

// v0.8: markdown 渲染
export { renderVerifyMarkdown, renderFixMarkdown } from './render-markdown.js';

// v0.11: cache
export { getCachePath, loadCache, saveCache, statFile, isCacheHit } from './cache.js';
export type { FileSig } from './cache.js';
export type { VerifyCache, VerifyCacheEntry, VerifyCacheStats } from './types.js';

// v0.12: rollback-log
export { writeRollbackLog } from './rollback-log.js';
export type { ReplaceManyOptions, RollbackLog } from './types.js';

// v0.14: tred diff --anchor
export { diffAnchor } from './diff-anchor.js';
export type { DiffAnchorOptions, DiffAnchorResult, DiffAnchorSide } from './types.js';

// v0.15: diff --dir + annotate
export { diffDir } from './diff-dir.js';
export { annotateDir, annotateFile, annotateFileContent } from './annotate.js';
export type { AnnotateCompute, AnnotateKinds } from './annotate.js';
export type {
  AnnotateAction,
  AnnotateOptions,
  AnnotateResult,
  DiffDirAnchorResult,
  DiffDirFileResult,
  DiffDirOptions,
  DiffDirResult,
  DiffDirStats,
} from './types.js';
export type { AnnotateDirOptions, AnnotateDirResult } from './types.js';

export { globToRegex, matchesAnyGlob } from './glob.js';
export { getChangedFiles, isGitRepo, gitShow } from './git.js';
export { diffDirGit } from './diff-dir.js';
export { renderDiffDirMarkdown, renderAnnotateDirMarkdown } from './render-markdown.js';
export type { SinceOption, ExcludeOption, FormatOption } from './types.js';

export { getCurrentBranch, getHeadSha, getMergeBase, isDirty, getStagedFiles, getUnstagedFiles, getUntrackedFiles } from './git.js';
export { doctor } from './doctor.js';
export type { DoctorOptions, DoctorReport, DoctorGitInfo, DoctorCacheInfo, DoctorAnchorInfo, DoctorDepsInfo, SinceFileOption } from './types.js';

export { buildBaseline, loadBaseline, saveBaseline, filterIssuesByBaseline } from './baseline.js';
export { init } from './init.js';
export type { BaselineFile, BaselineIssue, InitOptions, InitResult } from './types.js';

export { renderGithubAnnotations, renderFixGithubAnnotations } from './render-github.js';
export { watchDir } from './watch.js';
export { getDiffLines } from './diff-lines.js';
export type { WatchOptions, DiffFromOption } from './types.js';

export { renderSarif } from './render-sarif.js';
export type { SarifOptions } from './render-sarif.js';
export { renderHtml } from './render-html.js';
export type { HtmlOptions } from './render-html.js';

export { serveHtml, tryOpenBrowser } from './serve.js';
export type { ServeOptions, ServeHandle } from './serve.js';
