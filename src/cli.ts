import { existsSync, readFileSync } from 'node:fs';
import { annotateDir, annotateFile, buildOutline, diffAnchor, diffDir, fixDir, makeFingerprint, replace, replaceMany, verifyDir, renderVerifyMarkdown, renderFixMarkdown, diffDirGit, renderDiffDirMarkdown, renderAnnotateDirMarkdown, doctor, buildBaseline, loadBaseline, saveBaseline, filterIssuesByBaseline, init, renderGithubAnnotations, renderFixGithubAnnotations, watchDir, getDiffLines, renderSarif, renderHtml, serveHtml, tryOpenBrowser } from './index.js';
import type { AnnotateDirResult, AnnotateResult, AstSelector, DiffDirResult, FixReport, Formatter, OutlineNode, ReplaceOptions, VerifyReport, DoctorReport, InitResult, BaselineFile } from './types.js';

import { fileURLToPath } from 'node:url';
import { dirname as _dirname, resolve as _resolve, join } from 'node:path';

const __pkgDir = _dirname(fileURLToPath(import.meta.url));
const VERSION: string = (JSON.parse(
  readFileSync(_resolve(__pkgDir, '../package.json'), 'utf-8'),
) as { version: string }).version;

const HELP = [
  'tred - Anchor + AST 精准查找替换',
  '',
  '命令:',
  '  tred replace       单次替换',
  '  tred replace-many  批量事务替换（全成功或全回滚）',
  '  tred ast           导出文件 AST 大纲（class / method / function + selector）',
  '  tred verify        全项目体检（锚点配对 / 孤儿 / 跨文件重复 / 指纹）',
  '  tred diff          锚点级跨文件对比（迁移前 → 迁移后验证）',
  '  tred annotate      自动给 class / method / function 加锚点注释',
  '  tred doctor        诊断当前环境（git / cache / 锚点 / 依赖）',
  '',
  '用法:',
  '  tred replace --file <path> --anchor <name> <content-source> <fp-source> [options]',
  '  tred replace-many --ops-file <json> [--dry-run] [--json]',
  '  tred ast --file <path> [--json | --json-ast]',
  '  tred verify [--dir <path>] [--json] [--strict]',
  '  tred diff --anchor <name> --file <a> --against <b> [--exit-code] [--json]',
  '  tred diff --dir <dir-a> --against-dir <dir-b> [--anchor <name>] [--exit-code] [--json]',
  '  tred annotate --file <path> (--classes|--methods|--functions|--all) [--apply] [--json]',
  '  tred verify --fix [--apply] [--dir <path>] [--json]  保守修复（只删孤儿 END）',
  '  tred --help | --version',
  '',
  'replace 的 content-source (三选一):',
  '  --content <string> | --content-file <path> | --content-stdin',
  '',
  'replace 的 fp-source (二选一):',
  '  --fp <8hex>',
  '  --fp-source <s> --fp-version <v>',
  '',
  'replace options:',
  '  --auto-inject / --selector <json> / --dry-run / --prettier / --json',
  '  --rollback-log <path>   replace-many 提交失败时写 JSON 审计日志',
  '  --continue-on-error     replace-many 单文件失败不阻塞其他文件（返回 partial）',
  '',
  'ast options:',
  '  --file <path>',
  '  --json | --json-ast  输出 JSON（含 selector）',
  '',
  'diff options:',
  '  --anchor <name>   锚点名（单文件必需；目录模式可选作过滤器）',
  '  --dir <path>      目录模式：左侧目录',
  '  --against-dir <p> 目录模式：右侧目录',
  '  --file <path>     左侧文件',
  '  --against <path>  右侧文件',
  '  --exit-code       有差异时退出码 1（CI 用）',
  '  --json            输出 JSON',
  '',
  'verify options:',
  '  --dir <path>         扫描目录（默认 .）',
  '  --strict             warning 也算失败（退出码 1）',
  '  --json               输出 JSON',
  '  --cache               启用增量缓存（.tred-cache/verify.json）',
  '  --cache-dir <path>    自定义缓存目录（默认 .tred-cache）',
  '  --since <ref>         只处理 git 改动文件（如 HEAD~5 / main / <sha>）',
  '  --since-file <path>   从文件读改动列表（每行一个相对路径）',
  '  --exclude <glob>      annotate 排除 glob（如 *.test.ts）',
  '  --format <text|md>    输出格式（markdown 用于 PR 注释）',
  '  --format <f>          输出格式: text | markdown | github-annotations | sarif | html',
  '  --fix                 进入修复模式（默认 dry-run）',
  '  --apply               配合 --fix 实际写盘',
  '  --fix-orphan-start    配合 --fix：尝试补全孤儿 START 的 END（AST 定位，保守）',
  '',
  '退出码:',
  '  0  成功 / verify 无 error',
  '  1  失败 / verify 有 error',
  '',
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

async function cmdReplace(flags: Record<string, string | true>): Promise<number> {
  const file = requireStr(flags, 'file');
  const anchor = requireStr(flags, 'anchor');
  const content = readContent(flags);
  const fingerprint = resolveFingerprint(flags, anchor);

  let astSelector: AstSelector | undefined;
  if (flags.selector !== undefined) {
    try { astSelector = JSON.parse(requireStr(flags, 'selector')) as AstSelector; }
    catch { die('--selector 必须是合法 JSON'); }
  }
  if (flags['auto-inject'] && !astSelector) die('--auto-inject 需要同时提供 --selector');

  const r = await replace({
    file: file, anchor: anchor, content: content, fingerprint: fingerprint,
    dryRun: Boolean(flags['dry-run']),
    autoInjectAnchor: Boolean(flags['auto-inject']),
    astSelector: astSelector,
    format: await buildFormatter(flags),
  });

  if (flags.json) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } else {
    process.stdout.write('[tred] ' + r.status.toUpperCase() + ' ' + r.anchor + ' @ ' + r.file + '\n');
    if (r.message) process.stdout.write('        ' + r.message + '\n');
    if (r.syntaxErrors && r.syntaxErrors.length) {
      process.stdout.write('        语法错误:\n');
      for (const e of r.syntaxErrors) process.stdout.write('          ' + e + '\n');
    }
    if (r.diff) process.stdout.write('\n' + r.diff);
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
  if (cmd === 'annotate')     { process.exit(await cmdAnnotate(flags)); }
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
