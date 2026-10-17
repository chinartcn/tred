import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import type {
  FixAction,
  FixFileResult,
  FixOptions,
  FixRemainingOrphan,
  FixReport,
} from './types.js';
import { scanFileAnchors, verifyDir } from './verify.js';
import { checkSyntax } from './safety.js';
import { unifiedDiff } from './diff.js';
import { atomicWrite } from './atomic.js';
import { loadCache, saveCache, statFile } from './cache.js';

export interface FixFileOptions {
  /** 是否尝试补全孤儿 START（默认 false） */
  fixOrphanStart?: boolean;
}

export interface FixFileCompute {
  nextSource: string;
  actions: FixAction[];
  remainingOrphanStarts: FixRemainingOrphan[];
}

function computeLineStarts(lines: string[]): number[] {
  const acc: number[] = [];
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    acc[i] = pos;
    pos += lines[i].length + 1;
  }
  return acc;
}

function lineOfPos(lineStarts: number[], pos: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

/** 判断 pos 是否在文件顶层（不在 Block/ClassBody/ModuleBlock 内） */
function isTopLevel(sf: ts.SourceFile, pos: number): boolean {
  let node: ts.Node = sf;
  for (;;) {
    let next: ts.Node | null = null;
    ts.forEachChild(node, (c) => {
      if (next) return;
      if (c.getStart(sf) <= pos && pos <= c.getEnd()) next = c;
    });
    if (!next) return true;
    const n: ts.Node = next;
    if (
      ts.isBlock(n) ||
      ts.isModuleBlock(n) ||
      ts.isClassLike(n) ||
      ts.isInterfaceDeclaration(n)
    ) return false;
    node = n;
  }
}

/** 收集所有可作为"块内容"的节点（Statement / ClassElement），按 start 升序 */
function collectEligibleNodes(sf: ts.SourceFile): { start: number; end: number }[] {
  const nodes: { start: number; end: number }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStatement(node) || ts.isClassElement(node)) {
      nodes.push({ start: node.getStart(sf), end: node.getEnd() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  nodes.sort((a, b) => a.start - b.start);
  return nodes;
}

interface OrphanStartFixer {
  nextSource: string;
  actions: FixAction[];
  remaining: FixRemainingOrphan[];
}

function fixOrphanStarts(source: string, orphanStarts: { line: number; name: string }[]): OrphanStartFixer {
  const lines = source.split("\n");
  const lineStarts = computeLineStarts(lines);
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const eligible = collectEligibleNodes(sf);

  // 所有 START 行（含健康 + 孤儿），用于跨锚点检测
  const allAnchorStartLines = new Set<number>();
  {
    const scan = scanFileAnchors(source);
    for (const a of scan.anchors) allAnchorStartLines.add(a.line);
    for (const o of scan.orphans) if (o.kind === "start") allAnchorStartLines.add(o.line);
  }

  const actions: FixAction[] = [];
  const remaining: FixRemainingOrphan[] = [];
  const insertions: { pos: number; text: string; line: number; name: string }[] = [];

  for (const o of orphanStarts) {
    const startLineEndPos = (lineStarts[o.line - 1] ?? 0) + (lines[o.line - 1]?.length ?? 0);
    const target = eligible.find((n) => n.start > startLineEndPos);

    if (!target) {
      if (!isTopLevel(sf, startLineEndPos)) {
        remaining.push({ file: "", line: o.line, anchorName: o.name, kind: "start" });
        continue;
      }
      const indent = (lines[o.line - 1].match(/^[\t ]*/) || [""])[0];
      const hadTrailing = source.endsWith("\n");
      insertions.push({
        pos: source.length,
        text: (hadTrailing ? "" : "\n") + indent + "// @TRED_END: " + o.name + (hadTrailing ? "\n" : ""),
        line: o.line,
        name: o.name,
      });
      actions.push({
        kind: "add-orphan-end",
        line: o.line,
        anchorName: o.name,
        description: "补孤儿 END 到文件末尾: \"" + o.name + "\" @ L" + o.line,
      });
      continue;
    }

    const targetEndLine = lineOfPos(lineStarts, target.end);
    let crossed = false;
    for (let ln = o.line + 1; ln <= targetEndLine; ln++) {
      if (allAnchorStartLines.has(ln)) {
        crossed = true;
        break;
      }
    }
    if (crossed) {
      remaining.push({ file: "", line: o.line, anchorName: o.name, kind: "start" });
      continue;
    }

    const indent = (lines[o.line - 1].match(/^[\t ]*/) || [""])[0];
    insertions.push({
      pos: target.end,
      text: "\n" + indent + "// @TRED_END: " + o.name,
      line: o.line,
      name: o.name,
    });
    actions.push({
      kind: "add-orphan-end",
      line: o.line,
      anchorName: o.name,
      description: "补孤儿 END 到 L" + targetEndLine + " 之后: \"" + o.name + "\" @ L" + o.line,
    });
  }

  insertions.sort((a, b) => {
    if (a.pos !== b.pos) return b.pos - a.pos;
    return b.line - a.line;
  });

  let nextSource = source;
  for (const ins of insertions) {
    nextSource = nextSource.slice(0, ins.pos) + ins.text + nextSource.slice(ins.pos);
  }
  return { nextSource, actions, remaining };
}

/**
 * 修复：删孤儿 END（总是）。fixOrphanStart=true 时额外补孤儿 END（AST 定位，保守）。
 */
export function fixFileContent(source: string, options?: FixFileOptions): FixFileCompute {
  const opts = options || {};
  const scan = scanFileAnchors(source);
  const orphanEnds = scan.orphans.filter((o) => o.kind === "end");

  const actions: FixAction[] = [];
  let working = source;

  if (orphanEnds.length > 0) {
    const lines = working.split("\n");
    const kept: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineNo = i + 1;
      const orphan = orphanEnds.find((o) => o.line === lineNo);
      if (orphan) {
        actions.push({
          kind: "delete-orphan-end",
          line: lineNo,
          anchorName: orphan.name,
          description: "删除孤儿 END: \"" + orphan.name + "\" @ L" + lineNo,
        });
        continue;
      }
      kept.push(lines[i]);
    }
    working = kept.join("\n");
  }

  let remainingOrphanStarts: FixRemainingOrphan[] = [];

  if (opts.fixOrphanStart) {
    const scan2 = scanFileAnchors(working);
    const orphanStarts = scan2.orphans.filter((o) => o.kind === "start");
    if (orphanStarts.length > 0) {
      const r = fixOrphanStarts(working, orphanStarts.map((o) => ({ line: o.line, name: o.name })));
      working = r.nextSource;
      actions.push(...r.actions);
      remainingOrphanStarts = r.remaining;
    }
  } else {
    const scan2 = scanFileAnchors(working);
    remainingOrphanStarts = scan2.orphans
      .filter((o) => o.kind === "start")
      .map((o) => ({ file: "", line: o.line, anchorName: o.name, kind: "start" as const }));
  }

  return { nextSource: working, actions, remainingOrphanStarts };
}

function updateCacheForApplied(
  cacheDir: string,
  dir: string,
  relFiles: string[],
): void {
  const cache = loadCache(cacheDir);
  if (!cache) return;
  for (const rel of relFiles) {
    const fullPath = resolve(dir, rel);
    const sig = statFile(fullPath);
    if (!sig) continue;
    const source = readFileSync(fullPath, 'utf-8');
    const scan = scanFileAnchors(source);
    const hasContent = scan.anchors.length > 0 || scan.orphans.length > 0;
    cache.entries[rel] = {
      mtimeMs: sig.mtimeMs,
      size: sig.size,
      file: hasContent ? { file: rel, anchors: scan.anchors, orphans: scan.orphans } : null,
    };
  }
  saveCache(cacheDir, cache);
}

export function fixDir(opts: FixOptions): FixReport {
  const apply = Boolean(opts.apply);
  const useCache = Boolean(opts.cache);
  const cacheDir = opts.cacheDir ?? '.tred-cache';

  const scanReport = verifyDir({
    dir: opts.dir,
    extensions: opts.extensions,
    ignore: opts.ignore,
    cache: useCache,
    cacheDir: cacheDir,
  });

  const files: FixFileResult[] = [];
  const remainingOrphanStarts: FixRemainingOrphan[] = [];
  let totalActions = 0;

  for (const fr of scanReport.files) {
    const fullPath = resolve(opts.dir, fr.file);
    let original: string;
    try {
      original = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }
    const computed = fixFileContent(original, { fixOrphanStart: opts.fixOrphanStart });

    for (const o of computed.remainingOrphanStarts) {
      remainingOrphanStarts.push({ file: fr.file, line: o.line, anchorName: o.anchorName, kind: 'start' });
    }

    if (computed.actions.length === 0) continue;

    const diff = unifiedDiff(original, computed.nextSource, 'a/' + fr.file, 'b/' + fr.file);
    const result: FixFileResult = {
      file: fr.file,
      actions: computed.actions,
      diff: diff,
      applied: false,
    };

    if (apply) {
      const syntaxErrors = checkSyntax(fullPath, computed.nextSource);
      if (syntaxErrors.length > 0) {
        result.error = '语法校验失败，拒绝写入：' + syntaxErrors.join('; ');
      } else {
        try {
          atomicWrite(fullPath, computed.nextSource);
          result.applied = true;
        } catch (e) {
          result.error = e instanceof Error ? e.message : String(e);
        }
      }
    }

    files.push(result);
    totalActions += computed.actions.length;
  }

  // 修复完成后主动更新缓存：仅写入本次修改过的文件（下次 verify 全 hit）
  if (useCache && apply) {
    const applied = files.filter(function (f) { return f.applied; });
    if (applied.length > 0) {
      updateCacheForApplied(
        cacheDir,
        opts.dir,
        applied.map(function (f) { return f.file; }),
      );
    }
  }

  const ok = files.every(function (f) { return !f.error; });
  return {
    ok: ok,
    dryRun: !apply,
    dir: opts.dir,
    scannedFiles: scanReport.scannedFiles,
    files: files,
    totalActions: totalActions,
    remainingOrphanStarts: remainingOrphanStarts,
  };
}
