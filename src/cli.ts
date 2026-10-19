import type { SnippetSelector } from './types.js';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { runOps } from './ops.js';
import { annotateDir, annotateFile, buildOutline, diffAnchor, diffDir, fixDir, makeFingerprint, replace, replaceMany, verifyDir, renderVerifyMarkdown, renderFixMarkdown, diffDirGit, renderDiffDirMarkdown, renderAnnotateDirMarkdown, doctor, buildBaseline, loadBaseline, saveBaseline, filterIssuesByBaseline, init, renderGithubAnnotations, renderFixGithubAnnotations, watchDir, getDiffLines, renderSarif, renderHtml, serveHtml, tryOpenBrowser } from './index.js';
import type { AnnotateDirResult, AnnotateResult, AstSelector, DiffDirResult, FixReport, Formatter, OutlineNode, ReplaceOptions, VerifyReport, DoctorReport, InitResult, BaselineFile } from './types.js';

import { fileURLToPath } from 'node:url';
import { dirname as _dirname, resolve as _resolve, join } from 'node:path';
import { stripDir } from './strip.js';
import { grepDir } from './grep.js';
import { generateMap } from './map.js';
import { analyzeImpact } from './impact.js';
import { splitFile } from './split.js';
import { applyPatch } from './patch.js';
import { runCst } from './cst.js';
import { startMcpServer } from './mcp.js';

const __pkgDir = _dirname(fileURLToPath(import.meta.url));
const VERSION: string = (JSON.parse(
  readFileSync(_resolve(__pkgDir, '../package.json'), 'utf-8'),
) as { version: string }).version;

const HELP = [
  'tred - Anchor + AST + Vector 语义感知引擎',
  '',
  '命令 (核心):',
  '  tred replace       单文件精准替换（锚点 / Snippet / 多语言 AST）',
  '  tred replace-many  批量事务替换（支持并发，失败回滚）',
  '  tred patch         原生代码差异合并（支持 + / - 行 diff，自动语法校验）',
  '  tred grep          极速全局扫描（--ast 显示上下文，--html 生成可视化报告）',
  '  tred ast           导出文件 AST 大纲',
  '  tred ops           声明式流水线（编排 annotate / replace / verify）',
  '',
  '命令 (分析):',
  '  tred map           生成代码库全息地图（JSON 结构树，AI 友好）',
  '  tred impact <name> 分析目标符号的依赖影响面',
  '  tred split         自动拆分巨型文件（提取顶层函数到新文件）',
  '  tred verify        全项目体检（锚点 / state.json / 孤儿 / 重复）',
  '  tred diff          锚点级 / 目录级代码对比',
  '  tred annotate      自动给代码加锚点',
  '  tred doctor        诊断当前环境（git / cache / 锚点 / 依赖）',
  '',
  '命令 (工程化):',
  '  tred init          生成 .tred/config.json 和 pre-commit hook',
  '  tred check         组合验证（等价于 verify --strict 或 --pre-commit）',
  '  tred commit        自动跑 verify 并安全提交 Git',
  '  tred strip         剥离源码中的内部锚点（用于发布前清理）',
  '  tred serve         起 HTTP 服务查看 HTML 报告（--watch 支持热刷新）',
  '  tred watch         监听文件变化自动重跑 verify',
  '',
  '示例:',
  '  tred grep "getResource" --ast --html',
  '  tred impact ITEMS --dir src',
  '  tred split --file giant.ts --name foo,bar --to util.ts',
  '  tred replace --file src/a.ts --selector \'{"kind":"function","functionName":"main"}\' --content-file new.ts',
  '  tred patch --file a.ts diff.patch',
  '  tred map --dir src',
  '',
  'run tred <command> --help for details.'
].join('\n');

interface ParsedArgs { flags: Record<string, string | true>; positionals: string[]; }

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq >= 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { flags[a.slice(2)] = next; i++; }
        else flags[a.slice(2)] = true;
      }
    } else positionals.push(a);
  }
  return { flags: flags, positionals: positionals };
}

function die(msg: string): never {
  process.stderr.write('tred: ' + msg + '\n');
  process.stderr.write('运行 tred --help 查看用法\n');
  process.exit(1);
}

function requireStr(flags: Record<string, string | true>, key: string): string {
  const v = flags[key];
  if (typeof v !== 'string') die('缺少或非法 --' + key);
  return v;
}

let __stdinOverride: string | undefined = undefined;

/** @internal 测试用：覆盖 stdin 内容，避免 readFileSync(0) 阻塞 */
export function _setStdinOverride(s: string | undefined): void {
  __stdinOverride = s;
}

function readContent(flags: Record<string, string | true>): string {
  const has = function (k: string): boolean { return flags[k] !== undefined; };
  const count = (has('content') ? 1 : 0) + (has('content-file') ? 1 : 0) + (has('content-stdin') ? 1 : 0);
  if (count === 0) die('必须指定 --content / --content-file / --content-stdin 之一');
  if (count > 1) die('--content / --content-file / --content-stdin 只能选一个');
  if (has('content')) return requireStr(flags, 'content');
  if (has('content-file')) return readFileSync(requireStr(flags, 'content-file'), 'utf-8');
  if (__stdinOverride !== undefined) return __stdinOverride;
  return readFileSync(0, 'utf-8');
}

async function buildFormatter(flags: Record<string, string | true>): Promise<Formatter | undefined> {
  if (!flags.prettier) return undefined;
  let prettier: any;
  try {
    const spec = 'prettier';
    prettier = await import(spec);
  } catch { die('--prettier 需要先安装 prettier: npm i -D prettier'); }
  return function (src: string, file: string): Promise<string> {
    return prettier.format(src, { filepath: file });
  };
}

function resolveFingerprint(flags: Record<string, string | true>, anchor: string): string {
  const hasFp = typeof flags.fp === 'string';
  const hasGen = typeof flags['fp-source'] === 'string' && typeof flags['fp-version'] === 'string';
  if (hasFp && hasGen) die('--fp 与 --fp-source/--fp-version 不能同时使用');
  if (hasFp) {
    const fp = flags.fp as string;
    if (!/^[a-f0-9]{8}$/.test(fp)) die('--fp 必须是 8 位小写十六进制，如 a1b2c3d4');
    return fp;
  }
  if (hasGen) {
    return makeFingerprint({
      anchor: anchor,
      source: flags['fp-source'] as string,
      version: flags['fp-version'] as string,
    });
  }
  die('必须提供 --fp，或 --fp-source + --fp-version 自动生成指纹');
}

async function cmdImpact(flags: Record<string, string | true | string[]>, positionals: string[]): Promise<number> {
  const target = positionals[1];
  if (!target) die('用法: tred impact <targetName> [--dir <path>]');
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const report = analyzeImpact(dir, target);
  console.log(report);
  return 0;
}

async function cmdSplit(flagsRaw: Record<string, string | true | string[]>, positionals: string[]): Promise<number> {
  const flags: Record<string, string | true> = {};
  for (const k of Object.keys(flagsRaw)) {
    const v = flagsRaw[k];
    flags[k] = Array.isArray(v) ? v[v.length - 1] : v;
  }
  const file = requireStr(flags, 'file');
  const name = requireStr(flags, 'name');
  const to = requireStr(flags, 'to');
  const targets = name.split(',').map(s => s.trim());
  const targetClass = typeof flags['class'] === 'string' ? flags['class'] : undefined;
  const res = splitFile(file, targets, to, targetClass);
  if (!res.ok) { console.error('❌ [tred split] ' + res.message); return 1; }
  console.log('✅ [tred split] ' + res.message);
  return 0;
}

async function cmdMap(flags: Record<string, string | true | string[]>): Promise<number> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const map = generateMap(dir);
  process.stdout.write(JSON.stringify(map, null, 2) + '\n');
  return 0;
}

async function cmdPatch(flagsRaw: Record<string, string | true | string[]>, positionals: string[]): Promise<number> {
  const flags: Record<string, string | true> = {};
  for (const k of Object.keys(flagsRaw)) {
    const v = flagsRaw[k];
    flags[k] = Array.isArray(v) ? v[v.length - 1] : v;
  }
  const file = requireStr(flags, 'file');
  let patchText = '';
  if (positionals[1]) {
    patchText = readFileSync(positionals[1], 'utf-8');
  } else {
    patchText = readFileSync(0, 'utf-8');
  }

  const fuzzy = Boolean(flags.fuzzy);
  const fuzzyThreshold = typeof flags['fuzzy-threshold'] === 'string' ? parseFloat(flags['fuzzy-threshold']) : undefined;
  const minRareTokens = typeof flags['fuzzy-min-rare'] === 'string' ? parseInt(flags['fuzzy-min-rare'], 10) : undefined;
  const autoHeal = Boolean(flags['auto-heal']);
  const html = Boolean(flags.html);
  // P0_2_cli: 多候选仲裁参数
  const fuzzyMinMargin = typeof flags['fuzzy-min-margin'] === 'string' ? parseFloat(flags['fuzzy-min-margin']) : undefined;
  const force = Boolean(flags.force);
  const explain = Boolean(flags.explain);
  const semantic = Boolean(flags.semantic);
  const res = await applyPatch(file, patchText, { fuzzy, fuzzyThreshold, minRareTokens, autoHeal, html, fuzzyMinMargin, force, semantic });

  // P1_3_explain: 结构化分数分解
  function formatExplain(e: import('./patch.js').PatchExplain): string {
    const lines: string[] = [];
    lines.push('[tred explain] 候选 ' + e.candidateCount + ', reason: ' + e.reason);
    if (e.best) {
      const b = e.best;
      lines.push('  top1 @ L' + b.line + ' (score ' + b.score.toFixed(4) + ')');
      lines.push('    charSimAvg     ' + b.charSimAvg.toFixed(3));
      lines.push('    tokenSimAvg    ' + b.tokenSimAvg.toFixed(3));
      lines.push('    keyLines       ' + b.keyHits + '/' + b.keyLines + ' 命中');
      lines.push('    rareHits       ' + b.rareHits);
      lines.push('    positionOffset ' + (b.positionOffset >= 0 ? '+' : '') + b.positionOffset + ' 行');
    }
    if (e.second) {
      const s = e.second;
      lines.push('  top2 @ L' + s.line + ' (score ' + s.score.toFixed(4) + ', margin ' + (s.margin * 100).toFixed(1) + '%)');
    }
    return lines.join('\n');
  }

  if (!res.ok) {
    console.error('❌ [tred patch] ' + res.message);
    if (explain && res.explain) console.error('\n' + formatExplain(res.explain));
    if (res.suggestion) {
      console.log('\n💡 [tred suggest] 发现第 ' + res.suggestion.line + ' 行有 ' + (res.suggestion.score * 100).toFixed(1) + '% 相似度的代码块，' + res.suggestion.reason);
      console.log('   -----------------------------');
      res.suggestion.context.forEach((line: string, i: number) => {
        const lineNum = res.suggestion!.line - 2 + i;
        console.log('   ' + String(lineNum).padStart(4) + ' | ' + line);
      });
      console.log('   -----------------------------');
      const nextThresh = Math.max(0, res.suggestion.score - 0.05);
      console.log('   如果你确认这是正确的目标，可以尝试降低阈值：');
      console.log('   tred patch --file ' + file + ' ... --fuzzy --fuzzy-threshold ' + nextThresh.toFixed(2));
    }
    return 1;
  }

  console.log('✓ Patch 应用成功: ' + file);
  if (explain && res.explain) console.log('\n' + formatExplain(res.explain));
  return 0;
}

async function cmdGrep(flags: Record<string, string | true | string[]>, positionals: string[]): Promise<number> {
  const pattern = positionals[1];
  if (!pattern) die('用法: tred grep <pattern> [--dir <path>] [--ast] [--html]');
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const useAst = Boolean(flags.ast);
  const useHtml = Boolean(flags.html);
  grepDir(dir, pattern, useAst, useHtml);
  return 0;
}

async function cmdReplace(flagsRaw: Record<string, string | true | string[]>): Promise<number> {
  const flags: Record<string, string | true> = {};
  for (const k of Object.keys(flagsRaw)) {
    const v = flagsRaw[k];
    flags[k] = Array.isArray(v) ? v[v.length - 1] : v;
  }

  const file = requireStr(flags, 'file');
  const anchor = typeof flags.anchor === 'string' ? flags.anchor : undefined;
  const content = readContent(flags);

  let fingerprint = '';
  if (anchor) {
    fingerprint = resolveFingerprint(flags, anchor);
  }

  let astSelector: AstSelector | undefined;
  let genericSelector: any;
  if (typeof flags.selector === 'string') {
    try {
      genericSelector = JSON.parse(flags.selector);
      if (['class','method','function','arrow-function','statement','variable','property'].includes(genericSelector.kind)) {
        astSelector = genericSelector as AstSelector;
      }
    } catch {
      die('--selector 必须是合法 JSON');
    }
  }
  
  const toArr = (v: any) => (Array.isArray(v) ? v : v ? [v] : undefined);
  const fuzzThresh = typeof flags['fuzzy-threshold'] === 'string' ? parseFloat(flags['fuzzy-threshold']) : undefined;
  if (fuzzThresh !== undefined && astSelector) astSelector.fuzzyThreshold = fuzzThresh;
  const occ = typeof flags.occurrence === 'string' ? parseInt(flags.occurrence, 10) : undefined;
  if (astSelector && occ) astSelector.occurrence = occ;

  const snippetSelector: SnippetSelector = {};
  if (flags['snippet-start-line']) snippetSelector.startLine = parseInt(flags['snippet-start-line'] as string, 10);
  if (flags['snippet-end-line']) snippetSelector.endLine = parseInt(flags['snippet-end-line'] as string, 10);
  if (flags['snippet-start']) snippetSelector.startSnippet = flags['snippet-start'] as string;
  if (flags['snippet-end']) snippetSelector.endSnippet = flags['snippet-end'] as string;
  if (flags['cut-to-end']) snippetSelector.cutToEnd = true;
  if (occ) snippetSelector.occurrence = occ;

  const hasSnippet = Object.keys(snippetSelector).length > 0;

  if (!anchor && !astSelector && !genericSelector && !hasSnippet) {
    die('必须提供 --anchor 或 --selector 或 --snippet-* 之一');
  }

  if (flags['auto-inject'] && (!anchor || !astSelector)) {
    die('--auto-inject 需要同时提供 --anchor 和 --selector');
  }

  const opts: ReplaceOptions = {
    file,
    anchor: anchor || '',
    content,
    fingerprint,
    dryRun: Boolean(flags['dry-run']),
    autoInjectAnchor: Boolean(flags['auto-inject']),
    fuzzy: Boolean(flags.fuzzy),
    astSelector,
    selector: genericSelector,
    snippetSelector: hasSnippet ? snippetSelector : undefined,
    assertions: {
      include: toArr(flagsRaw['assert-include']),
      exclude: toArr(flagsRaw['assert-exclude']),
      regex: toArr(flagsRaw['assert-regex']),
      hasAst: toArr(flagsRaw['assert-has-ast']),
      noAst: toArr(flagsRaw['assert-no-ast']),
    },
    format: await buildFormatter(flags),
  };
  
  const r = await replace(opts);

  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write('[tred] ' + r.status.toUpperCase() + ' ' + r.file + '\n');
    if (r.message) process.stdout.write('        ' + r.message + '\n');
    if (r.syntaxErrors && r.syntaxErrors.length) {
      process.stdout.write('        错误:\n');
      for (const e of r.syntaxErrors) process.stdout.write('          ' + e + '\n');
    }
    if (r.status === 'failed' && r.failureContext) {
      process.stdout.write('\n        ⚠️ 原代码 (将被替换):\n');
      process.stdout.write(r.failureContext.oldCode.split('\n').map((l: string) => '          ' + l).join('\n') + '\n');
      process.stdout.write('\n        ⚠️ 你的新代码 (导致失败):\n');
      process.stdout.write(r.failureContext.newCode.split('\n').map((l: string) => '          ' + l).join('\n') + '\n');
    } else if (r.diff) {
      process.stdout.write('\n' + r.diff);
    }
  }
  return r.status === 'failed' ? 1 : 0;
}

function renderTree(nodes: OutlineNode[], prefix: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const last = i === nodes.length - 1;
    const branch = last ? '└─ ' : '├─ ';
    let label = branch + node.kind + ' ' + node.name + ' @' + node.line + ':' + node.column;
    if (node.selector) label += '  selector=' + JSON.stringify(node.selector);
    out.push(prefix + label);
    if (node.children && node.children.length > 0) {
      const nextPrefix = prefix + (last ? '   ' : '│  ');
      const sub = renderTree(node.children, nextPrefix);
      for (const line of sub) out.push(line);
    }
  }
  return out;
}

async function cmdAst(flags: Record<string, string | true>): Promise<number> {
  const file = requireStr(flags, 'file');
  if (!existsSync(file)) die('文件不存在: ' + file);
  const source = readFileSync(file, 'utf-8');
  const outline = buildOutline(file, source);

  if (flags.json || flags['json-ast']) {
    process.stdout.write(JSON.stringify(outline, null, 2) + '\n');
    return 0;
  }

  process.stdout.write(file + '\n');
  if (outline.length === 0) {
    process.stdout.write('  (无 class / function)\n');
    return 0;
  }
  const lines = renderTree(outline, '');
  for (const line of lines) process.stdout.write(line + '\n');
  process.stdout.write('\n提示: 把 selector={...} 的内容直接传给 --selector\n');
  return 0;
}

async function cmdReplaceMany(flags: Record<string, string | true>): Promise<number> {
  const opsFile = requireStr(flags, 'ops-file');
  const raw = readFileSync(opsFile, 'utf-8');
  let ops: ReplaceOptions[];
  try { ops = JSON.parse(raw) as ReplaceOptions[]; }
  catch { die('--ops-file 必须是合法 JSON'); }
  if (!Array.isArray(ops)) die('--ops-file 必须是 JSON 数组');

  if (flags['dry-run']) {
    ops = ops.map(function (op) {
      const copy: ReplaceOptions = Object.assign({}, op);
      copy.dryRun = true;
      return copy;
    });
  }

  const r = await replaceMany(ops, {
    rollbackLog: typeof flags['rollback-log'] === 'string' ? flags['rollback-log'] : undefined,
    continueOnError: Boolean(flags['continue-on-error']),
  });

  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write('[tred] batch ' + r.status.toUpperCase() + '\n');
    for (let i = 0; i < r.results.length; i++) {
      const res = r.results[i];
      process.stdout.write('  #' + (i + 1) + ' ' + res.status + ' ' + res.anchor + ' @ ' + res.file + '\n');
      if (res.message) process.stdout.write('     ' + res.message + '\n');
    }
    if (r.committedFiles.length > 0) process.stdout.write('  写入: ' + r.committedFiles.join(', ') + '\n');
    if (r.error) process.stdout.write('  error: ' + r.error + '\n');
    if (r.status === 'rolled-back' && typeof flags['rollback-log'] === 'string') {
      process.stdout.write('  审计日志: ' + flags['rollback-log'] + '\n');
    }
  }
  return (r.status === 'rolled-back' || r.status === 'partial') ? 1 : 0;
}

function renderVerifyHuman(r: VerifyReport): string {
  const out: string[] = [];
  const absDir = r.dir || '.';
  out.push('[tred] verify ' + absDir);
  out.push('扫描 ' + r.scannedFiles + ' 个文件，' + r.files.length + ' 个含锚点');
  if (r.files.length === 0 && r.issues.length === 0) {
    out.push('✅ 无锚点，无问题');
    return out.join('\n') + '\n';
  }
  out.push('');

  for (const fr of r.files) {
    const hasOrphan = fr.orphans.length > 0;
    const icon = hasOrphan ? '❌' : '✅';
    out.push(icon + ' ' + fr.file);
    for (const a of fr.anchors) {
      const fp = a.fp ? '  fp=' + a.fp : '  (无指纹)';
      out.push('   @TRED  ' + a.name + '  L' + a.line + '-L' + a.endLine + fp);
    }
    for (const o of fr.orphans) {
      out.push('   ⚠ 孤儿 ' + o.kind.toUpperCase() + '  ' + o.name + '  L' + o.line);
    }
  }

  if (r.issues.length > 0) {
    out.push('');
    out.push('问题 (' + r.issues.length + '):');
    for (const i of r.issues) {
      const loc = i.file ? i.file + (i.line ? ':' + i.line : '') : '';
      out.push('  [' + i.level + '] ' + i.code + (loc ? ' ' + loc : '') + '  ' + i.message);
    }
  }

  if (r.duplicatesAcross.length > 0) {
    out.push('');
    out.push('跨文件同名锚点 (' + r.duplicatesAcross.length + '):');
    for (const d of r.duplicatesAcross) {
      const locs = d.entries.map(function (e) { return e.file + ':' + e.line; }).join(', ');
      out.push('  "' + d.name + '"  ' + locs);
    }
  }

  if (r.fingerprintMismatches.length > 0) {
    out.push('');
    out.push('跨文件指纹不一致 (' + r.fingerprintMismatches.length + '):');
    for (const m of r.fingerprintMismatches) {
      const locs = m.entries.map(function (e) { return e.file + ':' + e.line + (e.fp ? '=' + e.fp : '=?'); }).join(', ');
      out.push('  "' + m.name + '"  ' + locs);
    }
  }

  out.push('');
  out.push(r.ok ? '✅ ok' : '❌ 未通过');
  return out.join('\n') + '\n';
}

function renderFixHuman(r: FixReport): string {
  const out: string[] = [];
  out.push('[tred] verify --fix ' + (r.dryRun ? '（dry-run，用 --apply 实际写盘）' : '（--apply）'));
  out.push('扫描 ' + r.scannedFiles + ' 个文件');

  if (r.totalActions === 0 && r.remainingOrphanStarts.length === 0) {
    out.push('✅ 无需修复');
    return out.join('\n') + '\n';
  }

  if (r.files.length > 0) {
    out.push('');
    out.push(r.dryRun ? '待修复 (' + r.totalActions + ' 处):' : '修复结果:');
    for (const f of r.files) {
      const status = f.error ? '✗' : (f.applied ? '✅' : '·');
      out.push('  ' + status + ' ' + f.file);
      for (const a of f.actions) {
        out.push('      L' + a.line + '  ' + a.description);
      }
      if (f.error) out.push('      error: ' + f.error);
    }
  }

  if (r.remainingOrphanStarts.length > 0) {
    out.push('');
    out.push('⚠ 需手动处理 (孤儿 START 无法自动修复):');
    for (const o of r.remainingOrphanStarts) {
      out.push('  ' + o.file + ':' + o.line + '  锚点 "' + o.anchorName + '" 有 START 无 END');
    }
    out.push('  提示：手动补 END，或用 replace --auto-inject 重写该锚点');
  }

  if (r.dryRun && r.files.length > 0) {
    out.push('');
    out.push('--- diff ---');
    for (const f of r.files) {
      out.push(f.diff);
    }
    out.push('提示: 加 --apply 实际写盘');
  }

  out.push('');
  out.push(r.ok ? (r.dryRun ? '✅ dry-run 完成' : '✅ 修复完成') : '❌ 有文件修复失败');
  return out.join('\n') + '\n';
}

function renderDiffHuman(r: {
  ok: boolean;
  anchor: string;
  left: { file: string; found: boolean; startLine: number | null; endLine: number | null };
  right: { file: string; found: boolean; startLine: number | null; endLine: number | null };
  diff: string;
  message?: string;
}): string {
  const out: string[] = [];
  out.push('[tred] diff ' + r.anchor);
  const leftLoc = r.left.found ? r.left.file + ' L' + r.left.startLine + '-L' + r.left.endLine : r.left.file + ' (未找到)';
  const rightLoc = r.right.found ? r.right.file + ' L' + r.right.startLine + '-L' + r.right.endLine : r.right.file + ' (未找到)';
  out.push('  left:  ' + leftLoc);
  out.push('  right: ' + rightLoc);
  if (!r.ok) {
    out.push('  ' + (r.message || '失败'));
    return out.join("\n") + "\n";
  }
  if (!r.diff) {
    out.push('  (无差异)');
    return out.join("\n") + "\n";
  }
  out.push('');
  out.push(r.diff.trimEnd());
  return out.join("\n") + "\n";
}

function renderDiffDirHuman(r: DiffDirResult): string {
  const out: string[] = [];
  out.push('[tred] diff-dir ' + r.leftDir + ' ↔ ' + r.rightDir);
  out.push('  比对: ' + r.stats.compared + ' 个锚点');
  out.push('  未变: ' + r.stats.unchanged);
  out.push('  变化: ' + r.stats.changed);
  out.push('  缺失: ' + r.stats.missing);
  out.push('');
  for (const f of r.files) {
    if (f.anchors.length === 0) continue;
    const suffix = f.leftExists && f.rightExists ? '' : ' (文件单侧存在)';
    out.push(f.file + suffix);
    for (const a of f.anchors) {
      if (a.message) {
        out.push('  ⚠ ' + a.name + ': ' + a.message);
      } else if (!a.diff) {
        out.push('  ✓ ' + a.name + ' (无变化)');
      } else {
        out.push('  ≠ ' + a.name);
        const lines = a.diff.trimEnd().split('\n');
        for (const line of lines) out.push('    ' + line);
      }
    }
    out.push('');
  }
  out.push(r.ok ? '✅ 无差异' : '❌ 有差异');
  return out.join('\n') + '\n';
}

function renderDoctorHuman(r: DoctorReport): string {
  const out: string[] = [];
  out.push('[tred] doctor');
  out.push('  环境: ' + r.platform + ' / node ' + r.nodeVersion);
  out.push('  目录: ' + r.dir);
  out.push('  版本: tred=' + r.tredVersion + ', package=' + r.packageVersion);
  out.push('');
  out.push('  git:');
  out.push('    ' + (r.git.isRepo ? '✓ 仓库 (branch=' + r.git.branch + ', head=' + (r.git.head ? r.git.head.slice(0, 8) : 'n/a') + ')' : '× 非 git 仓库'));
  out.push('    ' + (r.git.dirty ? '⚠ 有 ' + r.git.changedFiles + ' 个改动文件' : '✓ 工作树干净'));
  out.push('');
  out.push('  缓存:');
  out.push('    ' + (r.cache.exists ? '✓ ' + r.cache.entries + ' 条 (' + r.cache.sizeBytes + ' 字节)' : '· 未启用'));
  out.push('');
  out.push('  锚点:');
  out.push('    ' + r.anchors.files + ' 文件, ' + r.anchors.total + ' 锚点, ' + r.anchors.errors + ' error / ' + r.anchors.warnings + ' warning');
  out.push('');
  out.push('  依赖:');
  out.push('    tsx=' + (r.deps.tsx ? '✓' : '×') + ', prettier=' + (r.deps.prettier ? '✓' : '×'));
  out.push('');
  out.push('  建议:');
  for (const s of r.suggestions) out.push('    · ' + s);
  out.push('');
  out.push(r.ok ? '✅ 环境健康' : '⚠ 有问题需要处理');
  return out.join('\n') + '\n';
}

async function cmdDoctor(flags: Record<string, string | true>): Promise<number> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const r = doctor({ dir });
  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write(renderDoctorHuman(r));
  }
  return r.ok ? 0 : 1;
}

async function cmdDiff(flags: Record<string, string | true>): Promise<number> {
  if (flags['against-dir'] !== undefined) {
    const leftDir = requireStr(flags, 'dir');
    const rightDir = requireStr(flags, 'against-dir');
    const anchorFilter = typeof flags.anchor === 'string' ? flags.anchor : undefined;
    let fileList: string[] | undefined;
    if (typeof flags['since-file'] === 'string') {
      try {
        fileList = readFileSync(flags['since-file'] as string, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
      } catch (e) {
        die('--since-file 读取失败: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
    const useGit = typeof flags.since === 'string' || fileList !== undefined;
    const r = useGit
      ? diffDirGit({ leftDir: leftDir, rightDir: rightDir, anchorFilter: anchorFilter, since: typeof flags.since === 'string' ? flags.since : 'HEAD', changedFiles: fileList } as any)
      : diffDir({ leftDir: leftDir, rightDir: rightDir, anchorFilter: anchorFilter });
    if (flags.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    } else if (flags.format === 'markdown') {
      process.stdout.write(renderDiffDirMarkdown(r as any));
    } else {
      process.stdout.write(renderDiffDirHuman(r));
    }
    // v0.17 修正：目录模式 ok=false 只代表有差异/缺失，不是错误；--exit-code 才断言
    if (flags['exit-code'] && (r.stats.changed > 0 || r.stats.missing > 0)) return 1;
    return 0;
  }

  const anchor = requireStr(flags, 'anchor');
  const left = requireStr(flags, 'file');
  const right = requireStr(flags, 'against');
  const r = diffAnchor({ anchor: anchor, left: left, right: right });
  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write(renderDiffHuman(r));
  }
  if (!r.ok) return 1;
  if (flags['exit-code'] && r.diff !== '') return 1;
  return 0;
}



function renderAnnotateHuman(r: AnnotateResult): string {
  const out: string[] = [];
  out.push('[tred] annotate ' + r.file + (r.applied ? ' (已写盘)' : ' (dry-run)'));
  if (!r.ok) {
    out.push('  ❌ 失败');
    if (r.syntaxErrors) for (const e of r.syntaxErrors) out.push('    ' + e);
    return out.join('\n') + '\n';
  }
  if (r.actions.length === 0) {
    out.push('  无新锚点（全部已存在或无可匹配节点）');
    return out.join('\n') + '\n';
  }
  out.push('  新增 ' + r.actions.length + ' 条锚点注释');
  for (const a of r.actions) {
    out.push('    L' + a.line + '  ' + a.kind.toUpperCase() + '  ' + a.name + '  (' + a.nodeKind + ')');
  }
  if (r.diff) {
    out.push('');
    out.push(r.diff.trimEnd());
  }
  if (!r.applied) {
    out.push('');
    out.push('提示: 加 --apply 写盘');
  }
  return out.join('\n') + '\n';
}

function renderAnnotateDirHuman(r: AnnotateDirResult): string {
  const out: string[] = [];
  out.push('[tred] annotate --dir ' + r.dir + (r.apply ? ' (已写盘)' : ' (dry-run)'));
  out.push('  涉及文件: ' + r.annotatedFiles + ' 个');
  out.push('  新增锚点: ' + r.totalActions + ' 条');
  if (r.failedFiles > 0) out.push('  失败文件: ' + r.failedFiles + ' 个');
  if (r.files.length === 0) {
    out.push('  (无可标注节点)');
    return out.join('\n') + '\n';
  }
  out.push('');
  for (const f of r.files) {
    const icon = f.ok ? (f.applied ? '✅' : '·') : '❌';
    out.push(icon + ' ' + f.file + '  (' + f.actions.length + ' 条' + (f.ok ? '' : '，失败') + ')');
    if (!f.ok && f.syntaxErrors) {
      for (const e of f.syntaxErrors) out.push('    ' + e);
    }
  }
  if (!r.apply) {
    out.push('');
    out.push('提示: 加 --apply 写盘');
  }
  return out.join('\n') + '\n';
}

async function cmdAnnotate(flags: Record<string, string | true>): Promise<number> {
  const all = Boolean(flags.all);
  const classes = all || Boolean(flags.classes);
  const methods = all || Boolean(flags.methods);
  const functions = all || Boolean(flags.functions);
  if (!classes && !methods && !functions) {
    die('至少指定 --classes / --methods / --functions 之一，或用 --all');
  }

  const apply = Boolean(flags.apply);
  const useDir = typeof flags.dir === 'string';
  const useFile = typeof flags.file === 'string';
  if (useDir && useFile) die('--file 和 --dir 不能同时使用');
  if (!useDir && !useFile) die('必须指定 --file 或 --dir');

  if (useDir) {
    const r = annotateDir({
      dir: flags.dir as string,
      classes: classes,
      methods: methods,
      functions: functions,
      apply: apply,
      order: (typeof flags.order === 'string' ? flags.order : 'source') as any,
      since: typeof flags.since === 'string' ? flags.since : undefined,
    sinceFile: typeof flags['since-file'] === 'string' ? flags['since-file'] : undefined,
      exclude: typeof flags.exclude === 'string' ? [flags.exclude as string] : undefined,
    } as any);
    if (flags.json) {
      process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    } else if (flags.format === 'markdown') {
      process.stdout.write(renderAnnotateDirMarkdown(r as any));
    } else {
      process.stdout.write(renderAnnotateDirHuman(r));
    }
    return r.ok ? 0 : 1;
  }

  const r = annotateFile({
    file: flags.file as string,
    classes: classes,
    methods: methods,
    functions: functions,
    apply: apply,
  });
  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write(renderAnnotateHuman(r));
  }
  return r.ok ? 0 : 1;
}


async function cmdCheck(flags: Record<string, string | true>): Promise<number> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const preCommit = Boolean(flags['pre-commit']);
  const strict = Boolean(flags.strict) || !preCommit;

  let baselineFile: string | undefined;
  if (preCommit && typeof flags.baseline === 'string') {
    baselineFile = flags.baseline;
  } else if (preCommit) {
    const auto = join(process.cwd(), '.tred-baseline.json');
    if (existsSync(auto)) baselineFile = auto;
  }

  let report = verifyDir({ dir: dir, strict: strict });
  if (baselineFile) {
    const bl = loadBaseline(baselineFile);
    if (bl) {
      report = filterIssuesByBaseline(report, bl, strict);
    } else {
      console.error('[tred] baseline 文件无效: ' + baselineFile);
    }
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (flags.format === 'markdown') {
    process.stdout.write(renderVerifyMarkdown(report));
  } else {
    process.stdout.write(renderVerifyHuman(report));
  }
  return report.ok ? 0 : 1;
}

async function cmdInit(flags: Record<string, string | true>): Promise<number> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const withHook = Boolean(flags['with-hook']);
  const r = init({ dir: dir, withHook: withHook });
  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write('[tred] init ' + dir + '\n');
    for (const f of r.created) process.stdout.write('  ✓ 创建: ' + f + '\n');
    for (const f of r.skipped) process.stdout.write('  · 已存在: ' + f + '\n');
    for (const f of r.errors) process.stdout.write('  ❌ 失败: ' + f + '\n');
    if (r.created.length === 0 && r.skipped.length === 0) {
      process.stdout.write('  (无文件变化)\n');
    }
    process.stdout.write('\n下一步建议:\n');
    process.stdout.write('  1. 编辑 .tred/config.json 调整 dir / exclude\n');
    process.stdout.write('  2. tred verify --dir src --save-baseline .tred-baseline.json  （冻结现存问题）\n');
    process.stdout.write('  3. tred check --pre-commit  （只报新增）\n');
  }
  return r.ok ? 0 : 1;
}

async function cmdVerify(flags: Record<string, string | true>): Promise<number> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  if (!existsSync(dir)) die('目录不存在: ' + dir);

  const format = typeof flags.format === 'string' ? flags.format : 'text';
  const VALID = ['text', 'markdown', 'github-annotations', 'sarif', 'html'];
  if (VALID.indexOf(format) < 0) {
    die('--format 只支持 ' + VALID.join(' | ') + '（json 请用 --json）');
  }
  const useMarkdown = format === 'markdown';
  const useGithub = format === 'github-annotations';
  const useSarif = format === 'sarif';
  const useHtml = format === 'html';

  if (flags.fix) {
    if (useSarif || useHtml) {
      die('--fix 不支持 --format ' + format + '（仅支持 text | markdown | github-annotations）');
    }
    const fixReport = fixDir({
      dir: dir,
      apply: Boolean(flags.apply),
      fixOrphanStart: Boolean(flags['fix-orphan-start']),
      cache: Boolean(flags.cache),
      cacheDir: typeof flags['cache-dir'] === 'string' ? flags['cache-dir'] : undefined,
    });
    if (flags.json) {
      process.stdout.write(JSON.stringify(fixReport, null, 2) + '\n');
    } else if (useMarkdown) {
      process.stdout.write(renderFixMarkdown(fixReport));
    } else if (useGithub) {
      process.stdout.write(renderFixGithubAnnotations(fixReport));
    } else {
      process.stdout.write(renderFixHuman(fixReport));
    }
    return fixReport.ok ? 0 : 1;
  }

  let verifyReport = verifyDir({
    dir: dir,
    strict: Boolean(flags.strict),
    cache: Boolean(flags.cache),
    cacheDir: typeof flags['cache-dir'] === 'string' ? flags['cache-dir'] : undefined,
    since: typeof flags.since === 'string' ? flags.since : undefined,
    sinceFile: typeof flags['since-file'] === 'string' ? flags['since-file'] : undefined,
    exclude: Array.isArray(flags.exclude) ? (flags.exclude as any) : (typeof flags.exclude === 'string' ? [flags.exclude as string] : undefined),
  } as any);

  const saveBaselineFile = typeof flags['save-baseline'] === 'string' ? flags['save-baseline'] : undefined;
  const baselineFile = typeof flags.baseline === 'string' ? flags.baseline : undefined;

  if (saveBaselineFile) {
    const bl = buildBaseline(verifyReport);
    try {
      saveBaseline(saveBaselineFile, bl);
      process.stdout.write('[tred] 基线已保存: ' + saveBaselineFile + ' (' + bl.issues.length + ' 个 issues)\n');
    } catch (e) {
      die('保存基线失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  let finalReport = verifyReport;
  if (baselineFile) {
    const bl = loadBaseline(baselineFile);
    if (!bl) {
      die('基线文件不存在或损坏: ' + baselineFile);
    }
    finalReport = filterIssuesByBaseline(verifyReport, bl, Boolean(flags.strict));
  }

  if (typeof flags['diff-from'] === 'string') {
    const diffMap = getDiffLines(flags['diff-from'] as string);
    if (diffMap.size === 0) {
      process.stdout.write('[tred] --diff-from ' + flags['diff-from'] + ': 无改动行\n');
    } else {
      const dirPrefix = (function () {
        if (dir === '.' || dir === './') return '';
        let d = dir.replace(/\/+$/, '');
        if (d.indexOf('./') === 0) d = d.slice(2);
        return d;
      })();
      const kept = finalReport.issues.filter((issue) => {
        if (!issue.file || !issue.line) return false;
        const key = dirPrefix ? dirPrefix + '/' + issue.file : issue.file;
        const lines = diffMap.get(key);
        if (!lines) return false;
        return lines.has(issue.line);
      });
      const hasError = kept.some((i) => i.level === 'error');
      const hasWarning = kept.some((i) => i.level === 'warning');
      const strict = Boolean(flags.strict);
      const ok = strict ? (!hasError && !hasWarning) : !hasError;
      finalReport = Object.assign({}, finalReport, { issues: kept, ok: ok });
    }
  }

  const pkgVersion = readPkgVersion();
  const informationUri = readPkgField('homepage') || 'https://github.com/chinartcn/tred';

  if (flags.json) {
    process.stdout.write(JSON.stringify(finalReport, null, 2) + '\n');
  } else if (useMarkdown) {
    process.stdout.write(renderVerifyMarkdown(finalReport));
  } else if (useGithub) {
    process.stdout.write(renderGithubAnnotations(finalReport));
  } else if (useSarif) {
    process.stdout.write(renderSarif(finalReport, { version: pkgVersion, informationUri: informationUri }));
  } else if (useHtml) {
    process.stdout.write(renderHtml(finalReport, { version: pkgVersion }));
  } else {
    process.stdout.write(renderVerifyHuman(finalReport));
  }
  return finalReport.ok ? 0 : 1;
}

function readPkgVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version || '0.0.0';
  } catch {
    try {
      const here = fileURLToPath(import.meta.url);
      const pkgPath = join(_dirname(here), '..', 'package.json');
      const raw = readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as { version?: string };
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}

function readPkgField(field: string): string | null {
  try {
    const here = fileURLToPath(import.meta.url);
    const pkgPath = join(_dirname(here), '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const v = pkg[field];
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

async function cmdWatch(flags: Record<string, string | true>): Promise<number> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  if (!existsSync(dir)) die('目录不存在: ' + dir);

  const strict = Boolean(flags.strict);
  const format = typeof flags.format === 'string' ? flags.format : 'text';
  if (format !== 'text' && format !== 'markdown' && format !== 'github-annotations') {
    die('--format 只支持 text | markdown | github-annotations');
  }

  function runOnce(): void {
    let report;
    try {
      report = verifyDir({ dir: dir, strict: strict });
    } catch (e) {
      process.stdout.write('[tred] verify 失败: ' + (e instanceof Error ? e.message : String(e)) + '\n');
      return;
    }
    const ts = new Date().toISOString().slice(11, 19);
    process.stdout.write('\n[' + ts + '] verify ' + dir + '\n');
    if (format === 'markdown') {
      process.stdout.write(renderVerifyMarkdown(report));
    } else if (format === 'github-annotations') {
      process.stdout.write(renderGithubAnnotations(report));
    } else {
      process.stdout.write(renderVerifyHuman(report));
    }
  }

  runOnce();
  process.stdout.write('\n[tred] watch 已启动（Ctrl+C 退出）\n');

  const handle = watchDir(dir, runOnce);

  await new Promise<void>((resolve) => {
    const onSigint = (): void => {
      process.stdout.write('\n[tred] watch 已停止\n');
      handle.close();
      process.removeListener('SIGINT', onSigint);
      resolve();
    };
    process.on('SIGINT', onSigint);
  });
  return 0;
}

async function cmdServe(flags: Record<string, string | true>): Promise<number> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  if (!existsSync(dir)) die('目录不存在: ' + dir);

  const portRaw = typeof flags.port === 'string' ? flags.port : '8080';
  const port = parseInt(portRaw, 10);
  if (isNaN(port) || port < 1 || port > 65535) die('非法 --port: ' + portRaw);

  const shouldOpen = !Boolean(flags['no-open']);
  const watch = Boolean(flags.watch);
  const strict = Boolean(flags.strict);

  const pkgVersion = readPkgVersion();

  function regenerate(): string {
    return renderHtml(verifyDir({ dir: dir, strict: strict }), { version: pkgVersion });
  }

  let cached = '';
  try {
    cached = regenerate();
  } catch (e) {
    die('首次生成报告失败: ' + (e instanceof Error ? e.message : String(e)));
  }

  let dirty = false;
  function getHtml(): string {
    if (dirty) {
      try { cached = regenerate(); }
      catch { /* keep old */ }
      dirty = false;
    }
    return cached;
  }

  let handle: Awaited<ReturnType<typeof serveHtml>>;
  try {
    handle = await serveHtml(getHtml, { port: port });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      die('端口 ' + port + ' 已被占用，请用 --port <other> 换一个');
    }
    die('启动 HTTP 服务失败: ' + (e instanceof Error ? e.message : String(e)));
  }

  process.stdout.write('[tred] serve ' + handle.url + ' (dir: ' + dir + ')' + String.fromCharCode(10));
  process.stdout.write('[tred] Ctrl+C 停止' + String.fromCharCode(10));

  if (shouldOpen) {
    const ok = tryOpenBrowser(handle.url);
    if (ok) process.stdout.write('[tred] 已尝试打开浏览器' + String.fromCharCode(10));
    else process.stdout.write('[tred] 请手动打开上面的 URL' + String.fromCharCode(10));
  }

  let watchHandle: ReturnType<typeof watchDir> | null = null;
  if (watch) {
    watchHandle = watchDir(dir, () => {
      dirty = true;
      process.stdout.write('[tred] 文件变化，刷新浏览器查看最新' + String.fromCharCode(10));
    });
    process.stdout.write('[tred] watch 已启用' + String.fromCharCode(10));
  }

  await new Promise<void>((resolve) => {
    const onSig = (): void => {
      process.stdout.write(String.fromCharCode(10) + '[tred] 已停止' + String.fromCharCode(10));
      if (watchHandle) watchHandle.close();
      handle.close();
      process.removeListener('SIGINT', onSig);
      resolve();
    };
    process.on('SIGINT', onSig);
  });

  return 0;
}


export async function cliMain(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const flags = parsed.flags;
  const positionals = parsed.positionals;

  if (flags.help || positionals[0] === 'help') { process.stdout.write(HELP); return; }
  if (flags.version || positionals[0] === 'version') { process.stdout.write('tred v' + VERSION + '\n'); return; }

  const cmd = positionals[0];
  if (cmd === 'mcp') { await startMcpServer(); return; }
  if (cmd === 'grep')         { process.exit(await cmdGrep(flags, positionals)); }
  if (cmd === 'map')          { process.exit(await cmdMap(flags)); }
  if (cmd === 'impact')       { process.exit(await cmdImpact(flags, positionals)); }
  if (cmd === 'split')        { process.exit(await cmdSplit(flags, positionals)); }
  if (cmd === 'patch')        { process.exit(await cmdPatch(flags, positionals)); }
  if (cmd === 'run') {
    const cstFile = positionals[1] || (typeof flags.file === 'string' ? flags.file : undefined);
    if (!cstFile) die('用法: tred run <file.cst> 或 tred run --file <file.cst>');
    await runCst(cstFile, { allowNodejs: Boolean(flags['allow-nodejs']) });
    process.exit(0);
  }
  if (cmd === 'replace')      { process.exit(await cmdReplace(flags)); }
  if (cmd === 'replace-many') { process.exit(await cmdReplaceMany(flags)); }
  if (cmd === 'ast')          { process.exit(await cmdAst(flags)); }
  if (cmd === 'verify')       { process.exit(await cmdVerify(flags)); }
  if (cmd === 'diff')         { process.exit(await cmdDiff(flags)); }
  if (cmd === 'doctor')       { process.exit(await cmdDoctor(flags)); }
  if (cmd === 'check')        { process.exit(await cmdCheck(flags)); }
  if (cmd === 'init')         { process.exit(await cmdInit(flags)); }
  if (cmd === 'watch')        { process.exit(await cmdWatch(flags)); }
  if (cmd === 'serve')        { process.exit(await cmdServe(flags)); }
  
  // v1.3.0: ops 声明式执行
  if (cmd === 'commit')       { process.exit(await cmdCommit(flags)); }
  if (cmd === 'strip')        { process.exit(await cmdStrip(flags)); }
  if (cmd === 'ops' || (cmd && cmd.endsWith('.json'))) {
    const opsFile = cmd.endsWith('.json') ? cmd : positionals[1];
    if (!opsFile) die('用法: tred ops <ops.json>');
    process.exit(await runOps(opsFile, flags));
  }
  
  if (!cmd) { process.stderr.write(HELP); process.exit(1); }
  die('未知命令: ' + cmd);
}

// 只有作为 CLI 入口（cli.ts / cli.js）时才自动执行；被 import 时静默
const __argv1 = process.argv[1] ?? '';
const __isCliEntry = __argv1.endsWith('cli.ts') || __argv1.endsWith('cli.js');
if (__isCliEntry) {
  cliMain(process.argv.slice(2)).catch(function (e: unknown) {
    process.stderr.write('tred: ' + (e instanceof Error ? e.message : String(e)) + '\n');
    process.exit(1);
  });
}


async function cmdCommit(flags: Record<string, string | true | string[]>): Promise<number> {
  const msg = typeof flags.message === 'string' ? flags.message : 'tred: auto commit';
  console.log('[tred commit] 执行前置验证...');
  
  // 1. 跑 verify
  const v = await cmdVerify({ ...flags, strict: true });
  if (v !== 0) {
    console.error('[tred commit] ❌ 验证失败，已中止提交');
    return 1;
  }

  // 2. 跑 git add
  console.log('[tred commit] git add -A');
  const add = spawnSync('git', ['add', '-A'], { stdio: 'inherit' });
  if (add.status !== 0) return 1;

  // 3. 跑 git commit
  console.log('[tred commit] git commit -m "' + msg + '"');
  const commit = spawnSync('git', ['commit', '-m', msg], { stdio: 'inherit' });
  if (commit.status !== 0) {
    // 如果没有文件变更，git 会返回非 0
    return 1;
  }

  console.log('[tred commit] ✅ 提交成功！');
  return 0;
}

async function cmdStrip(flags: Record<string, string | true | string[]>): Promise<number> {
  const dir = typeof flags.dir === 'string' ? flags.dir : '.';
  const apply = Boolean(flags.apply);
  
  console.log('[tred strip] 扫描目录: ' + dir + (apply ? ' (写入模式)' : ' (dry-run)'));
  const count = stripDir(dir, apply);
  
  if (count === 0) {
    console.log('  ✓ 没有需要清理的锚点。');
  } else {
    if (apply) {
      console.log('  ✓ 已从 ' + count + ' 个文件中剥离了内部锚点。');
    } else {
      console.log('  ℹ 发现 ' + count + ' 个文件包含内部锚点。加 --apply 执行清理。');
    }
  }
  return 0;
}