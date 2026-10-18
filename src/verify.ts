import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isCacheHit, loadCache, saveCache, statFile } from './cache.js';
import { getChangedFiles, isGitRepo } from './git.js';
import { loadState } from './state.js';
import { matchesAnyGlob } from './glob.js';
import type {
  VerifyAnchorEntry,
  VerifyDuplicateAcross,
  VerifyDuplicateWithin,
  VerifyCacheEntry,
  VerifyCacheStats,
  VerifyFileReport,
  VerifyFingerprintMismatch,
  VerifyIssue,
  VerifyOrphan,
  VerifyReport,
} from './types.js';

const START_RE = /^\s*\/\/\s*@TRED_START:\s*(.+?)(?:\s*\|\s*fp=([a-f0-9]{8}))?\s*$/;
const END_RE = /^\s*\/\/\s*@TRED_END:\s*(.+?)\s*$/;

const DEFAULT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const DEFAULT_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.tred-tmp', '.turbo', '.tred-cache',
]);

export interface ScanResult {
  anchors: VerifyAnchorEntry[];
  orphans: VerifyOrphan[];
}

/**
 * 线性扫描单个文件的所有锚点。
 * - 配对采用 FIFO：第一个 START 配下一个同名 END（支持嵌套不同名锚点）
 * - 有 START 无 END → 孤儿 START；有 END 无 START → 孤儿 END
 */
export function scanFileAnchors(source: string): ScanResult {
  const lines = source.split('\n');
  const anchors: VerifyAnchorEntry[] = [];
  const orphans: VerifyOrphan[] = [];
  const pending = new Map<string, Array<{ line: number; fp: string | null }>>();

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const sm = lines[i].match(START_RE);
    if (sm) {
      const name = sm[1].trim();
      const fp = sm[2] ?? null;
      const list = pending.get(name) ?? [];
      list.push({ line: lineNo, fp });
      pending.set(name, list);
      continue;
    }
    const em = lines[i].match(END_RE);
    if (em) {
      const name = em[1].trim();
      const list = pending.get(name);
      if (list && list.length > 0) {
        const head = list.shift()!;
        anchors.push({ name, line: head.line, endLine: lineNo, fp: head.fp });
        if (list.length === 0) pending.delete(name);
      } else {
        orphans.push({ name, line: lineNo, kind: 'end' });
      }
    }
  }

  for (const [name, list] of pending) {
    for (const item of list) {
      orphans.push({ name, line: item.line, kind: 'start' });
    }
  }

  anchors.sort((a, b) => a.line - b.line);
  orphans.sort((a, b) => a.line - b.line);
  return { anchors, orphans };
}

export interface VerifyOptions {
  dir: string;
  strict?: boolean;
  extensions?: string[];
  ignore?: Set<string>;
  /** 启用增量缓存（.tred-cache/verify.json） */
  cache?: boolean;
  /** 缓存目录，默认 .tred-cache（相对 cwd） */
  cacheDir?: string;
  /** v0.17: 只处理 git 改动文件（HEAD / main / <sha>） */
  since?: string;
  /** v0.18: 从文件读取改动列表（每行一个相对路径） */
  sinceFile?: string;
  /** v0.17: glob 排除列表，如 ['*.test.ts'] */
  exclude?: string[];
}

export function verifyDir(opts: VerifyOptions): VerifyReport {
  const exts = opts.extensions ?? DEFAULT_EXTS;
  const ignore = opts.ignore ?? DEFAULT_IGNORE;
  const files: VerifyFileReport[] = [];
  let scannedFiles = 0;

  const useCache = Boolean(opts.cache);
  const cacheDir = opts.cacheDir ?? '.tred-cache';
  const oldCache = useCache ? loadCache(cacheDir) : null;
  const newEntries: Record<string, VerifyCacheEntry> = {};
  const seenFiles = new Set<string>();
  const cacheStats: VerifyCacheStats = { enabled: useCache, hits: 0, misses: 0, removed: 0 };

  // v0.17: --since / --exclude 过滤
  let sinceSet: Set<string> | null = null;
  if (opts.since || opts.sinceFile) {
    sinceSet = new Set<string>();
    const cwd = process.cwd();
    const absDir = resolve(opts.dir);
    function addItem(item: string): void {
      if (!item) return;
      sinceSet!.add(item);
      // 尝试各种基准目录拼接，任一命中即可
      const candidates = [
        resolve(cwd, item),
        resolve(absDir, item),
        resolve(absDir, '..', item),
      ];
      for (const abs of candidates) {
        sinceSet!.add(abs);
        const relFromDir = relative(absDir, abs);
        if (relFromDir && relFromDir.indexOf('..') !== 0) sinceSet!.add(relFromDir);
      }
    }
    if (opts.since) {
      if (!isGitRepo()) {
        console.error('[tred] --since 需要 git 仓库');
      } else {
        const changed = getChangedFiles(opts.since, cwd);
        for (const item of changed) addItem(item);
        if (sinceSet.size === 0) {
          console.error('[tred] --since ' + opts.since + ': 无改动文件');
        }
      }
    }
    if (opts.sinceFile) {
      try {
        const raw = readFileSync(opts.sinceFile, 'utf-8');
        const items = raw.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const item of items) addItem(item);
      } catch (e) {
        console.error('[tred] --since-file 读取失败: ' + (e instanceof Error ? e.message : String(e)));
        // 全部读取失败且没有 since 来源 → 还原为 null（等价于"没传过滤"）
        if (sinceSet && sinceSet.size === 0) sinceSet = null;
      }
    }
  }
  const excludeGlobs: string[] = (opts.exclude) || [];

  function walk(d: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignore.has(entry.name)) continue;
        walk(join(d, entry.name));
      } else if (entry.isFile()) {
        const file = join(d, entry.name);
        if (!exts.some(function (e) { return file.endsWith(e); })) continue;
        const rel = relative(opts.dir, file) || entry.name;
        if (sinceSet) {
          const absFile = resolve(process.cwd(), file);
          if (!sinceSet.has(rel) && !sinceSet.has(file) && !sinceSet.has(absFile)) return;
        }
        if (matchesAnyGlob(rel, excludeGlobs)) return;
        seenFiles.add(rel);

        if (useCache) {
          const sig = statFile(file);
          if (sig) {
            const cached = oldCache?.entries[rel];
            if (isCacheHit(cached, sig)) {
              cacheStats.hits++;
              scannedFiles++;
              newEntries[rel] = { mtimeMs: sig.mtimeMs, size: sig.size, file: cached!.file };
              if (cached!.file) files.push(cached!.file);
              continue;
            }
            cacheStats.misses++;
            let source: string;
            try {
              source = readFileSync(file, 'utf-8');
            } catch {
              continue;
            }
            scannedFiles++;
            const scan = scanFileAnchors(source);
            const hasContent = scan.anchors.length > 0 || scan.orphans.length > 0;
            const fileReport: VerifyFileReport | null = hasContent
              ? { file: rel, anchors: scan.anchors, orphans: scan.orphans }
              : null;
            newEntries[rel] = { mtimeMs: sig.mtimeMs, size: sig.size, file: fileReport };
            if (fileReport) files.push(fileReport);
            continue;
          }
        }

        let source: string;
        try {
          source = readFileSync(file, 'utf-8');
        } catch {
          continue;
        }
        scannedFiles++;
        const scan = scanFileAnchors(source);
        if (scan.anchors.length === 0 && scan.orphans.length === 0) continue;
        files.push({
          file: rel,
          anchors: scan.anchors,
          orphans: scan.orphans,
        });
      }
    }
  }
  const isSingleFile = existsSync(opts.dir) && statSync(opts.dir).isFile();
  if (isSingleFile) {
    const rel = relative(process.cwd(), opts.dir) || opts.dir;
    const source = readFileSync(opts.dir, 'utf-8');
    scannedFiles++;
    const scan = scanFileAnchors(source);
    if (scan.anchors.length > 0 || scan.orphans.length > 0) {
      files.push({ file: rel, anchors: scan.anchors, orphans: scan.orphans });
    }
  } else {
    walk(opts.dir);
  }

  if (useCache) {
    if (oldCache) {
      for (const rel of Object.keys(oldCache.entries)) {
        if (!seenFiles.has(rel)) cacheStats.removed++;
      }
    }
    saveCache(cacheDir, { version: 1, entries: newEntries });
  }

  // 同文件内重复
  const duplicatesWithin: VerifyDuplicateWithin[] = [];
  for (const fr of files) {
    const byName = new Map<string, number[]>();
    for (const a of fr.anchors) {
      const arr = byName.get(a.name) ?? [];
      arr.push(a.line);
      byName.set(a.name, arr);
    }
    for (const [name, lines] of byName) {
      if (lines.length > 1) duplicatesWithin.push({ file: fr.file, name, lines });
    }
  }

  // 跨文件同名
  const globalByName = new Map<string, Array<{ file: string; line: number; fp: string | null }>>();
  for (const fr of files) {
    for (const a of fr.anchors) {
      const arr = globalByName.get(a.name) ?? [];
      arr.push({ file: fr.file, line: a.line, fp: a.fp });
      globalByName.set(a.name, arr);
    }
  }
  const duplicatesAcross: VerifyDuplicateAcross[] = [];
  for (const [name, entries] of globalByName) {
    const uniqFiles = new Set(entries.map(function (e) { return e.file; }));
    if (uniqFiles.size > 1) duplicatesAcross.push({ name, entries });
  }

  // 跨文件指纹不一致（非 null fp 出现 >=2 个不同值）
  const fingerprintMismatches: VerifyFingerprintMismatch[] = [];
  for (const [name, entries] of globalByName) {
    const fps = new Set<string>();
    for (const e of entries) if (e.fp) fps.add(e.fp);
    if (fps.size >= 2) fingerprintMismatches.push({ name, entries });
  }

  // 汇总 issues
  const issues: VerifyIssue[] = [];
  for (const fr of files) {
    for (const o of fr.orphans) {
      issues.push({
        level: 'error',
        code: o.kind === 'start' ? 'ORPHAN_START' : 'ORPHAN_END',
        file: fr.file,
        line: o.line,
        message:
          o.kind === 'start'
            ? '锚点 "' + o.name + '" 有 START 无 END'
            : '锚点 "' + o.name + '" 有 END 无 START',
      });
    }
  }
  for (const d of duplicatesWithin) {
    issues.push({
      level: 'error',
      code: 'DUPLICATE_WITHIN',
      file: d.file,
      message: '锚点 "' + d.name + '" 在同文件出现 ' + d.lines.length + ' 次（行 ' + d.lines.join(', ') + '）',
    });
  }
  for (const d of duplicatesAcross) {
    const files = Array.from(new Set(d.entries.map(function (e) { return e.file; })));
    issues.push({
      level: 'warning',
      code: 'DUPLICATE_ACROSS',
      message: '锚点 "' + d.name + '" 跨 ' + files.length + ' 个文件出现：' + files.join(', '),
    });
  }
  for (const m of fingerprintMismatches) {
    issues.push({
      level: 'warning',
      code: 'FP_MISMATCH',
      message: '锚点 "' + m.name + '" 跨文件指纹不一致',
    });
  }

  // v2.2.0: 检查 .tred/state.json 中的外部锚点
  if (opts.dir === '.' || opts.dir === process.cwd()) {
    const state = loadState();
    for (const relFile of Object.keys(state.tracked)) {
      const absPath = resolve(opts.dir, relFile);
      if (!existsSync(absPath)) {
        issues.push({
          level: 'error',
          code: 'STATE_FILE_MISSING',
          file: relFile,
          message: '记录在 state.json 中的文件已丢失',
        });
        continue;
      }
      for (const [anchorName, anchorState] of Object.entries(state.tracked[relFile])) {
        issues.push({
          level: 'warning',
          code: 'STATE_ANCHOR',
          file: relFile,
          line: anchorState.approxLine,
          message: '外部锚点 [' + anchorName + '] (AST: ' + anchorState.astSignature + ')',
        });
      }
    }
  }

  const hasError = issues.some(function (i) { return i.level === 'error'; });
  const hasWarning = issues.some(function (i) { return i.level === 'warning'; });
  const ok = opts.strict ? !hasError && !hasWarning : !hasError;

  const report: VerifyReport = {
    ok,
    dir: opts.dir,
    scannedFiles,
    files,
    issues,
    duplicatesWithin,
    duplicatesAcross,
    fingerprintMismatches,
  };
  if (useCache) report.cacheStats = cacheStats;
  return report;
}
