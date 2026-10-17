import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import ts from 'typescript';
import { detectIndent } from './anchor.js';
import { scanFileAnchors } from './verify.js';
import { unifiedDiff } from './diff.js';
import { checkSyntax } from './safety.js';
import { atomicWrite } from './atomic.js';
import { getChangedFiles, isGitRepo } from './git.js';
import { matchesAnyGlob } from './glob.js';
import type { AnnotateAction, AnnotateDirOptions, AnnotateDirResult, AnnotateOptions, AnnotateResult } from './types.js';

export interface AnnotateCompute {
  nextSource: string;
  actions: AnnotateAction[];
}

export interface AnnotateKinds {
  classes?: boolean;
  methods?: boolean;
  functions?: boolean;
}

export function annotateFileContent(
  source: string,
  fileName: string,
  opts: AnnotateKinds,
): AnnotateCompute {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const existing = new Set<string>();
  const scan = scanFileAnchors(source);
  for (const a of scan.anchors) existing.add(a.name);
  for (const o of scan.orphans) existing.add(o.name);

  interface Insertion {
    pos: number;
    text: string;
    action: AnnotateAction;
  }
  const insertions: Insertion[] = [];

  function addAnchor(name: string, node: ts.Node, nodeKind: 'class' | 'method' | 'function'): void {
    if (existing.has(name)) return;
    const start = node.getStart(sf);
    const end = node.getEnd();
    const indent = detectIndent(source, start);
    const startLineStart = start - indent.length;
    const startLine = sf.getLineAndCharacterOfPosition(start).line + 1;
    const endLine = sf.getLineAndCharacterOfPosition(end).line + 1;
    insertions.push({
      pos: startLineStart,
      text: indent + '// @TRED_START: ' + name + '\n',
      action: { name: name, kind: 'start', nodeKind: nodeKind, line: startLine },
    });
    insertions.push({
      pos: end,
      text: '\n' + indent + '// @TRED_END: ' + name,
      action: { name: name, kind: 'end', nodeKind: nodeKind, line: endLine },
    });
    existing.add(name);
  }

  function visit(node: ts.Node): void {
    if (opts.classes && ts.isClassDeclaration(node) && node.name) {
      addAnchor(node.name.text, node, 'class');
    }
    if (
      opts.methods &&
      ts.isMethodDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ts.isClassLike(node.parent) &&
      node.parent.name
    ) {
      addAnchor(node.parent.name.text + '#' + node.name.text, node, 'method');
    }
    if (opts.functions && ts.isFunctionDeclaration(node) && node.name) {
      addAnchor(node.name.text, node, 'function');
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);

  if (insertions.length === 0) {
    return { nextSource: source, actions: [] };
  }

  insertions.sort((a, b) => b.pos - a.pos);
  let nextSource = source;
  for (const ins of insertions) {
    nextSource = nextSource.slice(0, ins.pos) + ins.text + nextSource.slice(ins.pos);
  }

  const actions = insertions
    .map((i) => i.action)
    .sort((a, b) => {
      if (a.line !== b.line) return a.line - b.line;
      return a.kind === 'start' ? -1 : 1;
    });

  return { nextSource: nextSource, actions: actions };
}

export function annotateFile(opts: AnnotateOptions): AnnotateResult {
  const result: AnnotateResult = {
    ok: true,
    file: opts.file,
    actions: [],
    diff: '',
    applied: false,
  };

  let original: string;
  try {
    original = readFileSync(opts.file, 'utf-8');
  } catch (e) {
    result.ok = false;
    result.syntaxErrors = ['读取失败: ' + (e instanceof Error ? e.message : String(e))];
    return result;
  }

  const computed = annotateFileContent(original, opts.file, opts);
  result.actions = computed.actions;

  if (computed.actions.length === 0) {
    return result;
  }

  const syntaxErrors = checkSyntax(opts.file, computed.nextSource);
  if (syntaxErrors.length > 0) {
    result.ok = false;
    result.syntaxErrors = syntaxErrors;
    return result;
  }

  result.diff = unifiedDiff(original, computed.nextSource, 'a/' + opts.file, 'b/' + opts.file);

  if (opts.apply) {
    atomicWrite(opts.file, computed.nextSource);
    result.applied = true;
  }

  return result;
}

const ANNOTATE_DEFAULT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const ANNOTATE_DEFAULT_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.tred-tmp', '.turbo', '.tred-cache',
]);

export function annotateDir(opts: AnnotateDirOptions): AnnotateDirResult {
  const exts = opts.extensions ?? ANNOTATE_DEFAULT_EXTS;
  const ignore = opts.ignore ?? ANNOTATE_DEFAULT_IGNORE;
  const apply = Boolean(opts.apply);
  let sinceSet: Set<string> | null = null;
  if (opts.since || opts.sinceFile) {
    sinceSet = new Set<string>();
    const cwd = process.cwd();
    const absDir = resolve(opts.dir);
    function addItem(item: string): void {
      if (!item) return;
      sinceSet!.add(item);
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
    if (opts.since && isGitRepo()) {
      const changed = getChangedFiles(opts.since, cwd);
      for (const item of changed) addItem(item);
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
  const files: AnnotateResult[] = [];
  let totalActions = 0;
  let annotatedFiles = 0;
  let failedFiles = 0;

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
        if (!exts.some((e) => file.endsWith(e))) continue;
        const rel = file.slice(opts.dir.length).replace(/^[\/\\]/, '');
        if (sinceSet) {
          const absFile = resolve(process.cwd(), file);
          if (!sinceSet.has(rel) && !sinceSet.has(file) && !sinceSet.has(absFile)) continue;
        }
        if (matchesAnyGlob(rel, excludeGlobs)) continue;
        const r = annotateFile({
          file: file,
          classes: opts.classes,
          methods: opts.methods,
          functions: opts.functions,
          apply: apply,
        });
        if (!r.ok) failedFiles++;
        if (r.actions.length > 0) {
          annotatedFiles++;
          totalActions += r.actions.length;
        }
        if (r.actions.length > 0 || !r.ok) {
          files.push(r);
        }
      }
    }
  }
  walk(opts.dir);

  // v0.19: 稳定排序（默认 source：按路径）
  const order = opts.order ?? 'source';
  if (order === 'source') {
    files.sort((a, b) => a.file.localeCompare(b.file));
  } else if (order === 'name') {
    files.sort((a, b) => {
      const an = a.actions[0] && a.actions[0].name ? a.actions[0].name : '';
      const bn = b.actions[0] && b.actions[0].name ? b.actions[0].name : '';
      return an.localeCompare(bn);
    });
  } else if (order === 'kind') {
    files.sort((a, b) => {
      const ak = a.actions[0] && a.actions[0].nodeKind ? a.actions[0].nodeKind : '';
      const bk = b.actions[0] && b.actions[0].nodeKind ? b.actions[0].nodeKind : '';
      if (ak !== bk) return ak.localeCompare(bk);
      const an = a.actions[0] && a.actions[0].name ? a.actions[0].name : '';
      const bn = b.actions[0] && b.actions[0].name ? b.actions[0].name : '';
      return an.localeCompare(bn);
    });
  }

  return {
    ok: failedFiles === 0,
    dir: opts.dir,
    apply: apply,
    files: files,
    totalActions: totalActions,
    annotatedFiles: annotatedFiles,
    failedFiles: failedFiles,
  };
}
