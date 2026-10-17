import type { FixReport, VerifyReport } from './types.js';

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function codeInline(s: string): string {
  if (s.includes('`')) return '`` ' + s + ' ``';
  return '`' + s + '`';
}

function statusEmoji(level: 'error' | 'warning'): string {
  return level === 'error' ? '🔴' : '🟡';
}

export function renderVerifyMarkdown(r: VerifyReport): string {
  const out: string[] = [];
  out.push('<!-- tred:verify -->');
  out.push('## 🔍 tred verify');
  out.push('');
  out.push('- **目录**: ' + codeInline(r.dir));
  out.push('- **扫描**: ' + r.scannedFiles + ' 个文件，' + r.files.length + ' 个含锚点');
  if (r.cacheStats && r.cacheStats.enabled) {
    out.push('- **缓存**: ' + r.cacheStats.hits + ' hits / ' + r.cacheStats.misses + ' misses / ' + r.cacheStats.removed + ' removed');
  }

  const errors = r.issues.filter(function (i) { return i.level === 'error'; }).length;
  const warnings = r.issues.filter(function (i) { return i.level === 'warning'; }).length;

  out.push('');
  if (r.issues.length === 0) {
    out.push('### ✅ 无问题');
  } else if (r.ok) {
    out.push('### ⚠️ 通过（' + warnings + ' 个 warning）');
  } else {
    out.push('### ❌ 未通过（' + errors + ' 个 error，' + warnings + ' 个 warning）');
  }

  if (r.issues.length > 0) {
    out.push('');
    out.push('#### 问题汇总');
    out.push('');
    out.push('| 级别 | 代码 | 位置 | 描述 |');
    out.push('|---|---|---|---|');
    for (const i of r.issues) {
      const loc = i.file
        ? codeInline(i.file) + (i.line ? ':' + i.line : '')
        : '—';
      out.push('| ' + statusEmoji(i.level) + ' ' + i.level + ' | ' + codeInline(i.code) + ' | ' + loc + ' | ' + cell(i.message) + ' |');
    }
  }

  if (r.files.length > 0) {
    out.push('');
    out.push('#### 文件明细');
    out.push('');
    for (const fr of r.files) {
      const orphan = fr.orphans.length > 0;
      const icon = orphan ? '❌' : '✅';
      out.push('<details><summary>' + icon + ' ' + codeInline(fr.file) + '</summary>');
      out.push('');
      if (fr.anchors.length > 0) {
        out.push('**健康锚点**');
        out.push('');
        for (const a of fr.anchors) {
          const fp = a.fp ? '`fp=' + a.fp + '`' : '_no fp_';
          out.push('- ' + codeInline(a.name) + ' L' + a.line + '-L' + a.endLine + ' ' + fp);
        }
      }
      if (fr.orphans.length > 0) {
        out.push('');
        out.push('**孤儿**');
        out.push('');
        for (const o of fr.orphans) {
          out.push('- ⚠ ' + o.kind.toUpperCase() + ' ' + codeInline(o.name) + ' L' + o.line);
        }
      }
      out.push('');
      out.push('</details>');
    }
  }

  return out.join('\n') + '\n';
}

export function renderFixMarkdown(r: FixReport): string {
  const out: string[] = [];
  out.push('<!-- tred:verify-fix -->');
  out.push('## 🛠 tred verify --fix' + (r.dryRun ? ' (dry-run)' : ' (--apply)'));
  out.push('');
  out.push('- **目录**: ' + codeInline(r.dir));
  out.push('- **扫描**: ' + r.scannedFiles + ' 个文件');
  out.push('- **模式**: ' + (r.dryRun ? 'dry-run（不写盘）' : 'apply（已写盘）'));

  if (r.totalActions === 0 && r.remainingOrphanStarts.length === 0) {
    out.push('');
    out.push('### ✅ 无需修复');
    return out.join('\n') + '\n';
  }

  if (r.totalActions > 0) {
    out.push('');
    out.push(r.dryRun ? '### 待修复 (' + r.totalActions + ' 处)' : '### 修复结果 (' + r.totalActions + ' 处)');
    out.push('');
    for (const f of r.files) {
      const icon = f.error ? '❌' : (f.applied ? '✅' : '·');
      out.push('#### ' + icon + ' ' + codeInline(f.file));
      out.push('');
      for (const a of f.actions) {
        out.push('- L' + a.line + ' — ' + cell(a.description));
      }
      if (f.error) {
        out.push('');
        out.push('> ❌ **错误**: ' + cell(f.error));
      }
      out.push('');
    }
  }

  if (r.remainingOrphanStarts.length > 0) {
    out.push('');
    out.push('### ⚠ 需手动处理 (' + r.remainingOrphanStarts.length + ' 处孤儿 START)');
    out.push('');
    out.push('以下锚点有 START 但无 END，**未自动修复**（保守策略）。');
    out.push('建议用 `tred replace --auto-inject --selector ...` 重写，或手动补 `@TRED_END`。');
    out.push('');
    for (const o of r.remainingOrphanStarts) {
      out.push('- ' + codeInline(o.file) + ':' + o.line + ' — ' + codeInline(o.anchorName));
    }
  }

  if (r.dryRun && r.files.length > 0) {
    out.push('');
    out.push('<details><summary>查看 diff（' + r.files.length + ' 个文件）</summary>');
    out.push('');
    for (const f of r.files) {
      out.push('**' + codeInline(f.file) + '**');
      out.push('');
      out.push('````diff');
      out.push(f.diff.trimEnd());
      out.push('````');
      out.push('');
    }
    out.push('</details>');
    out.push('');
    out.push('> 💡 加 `--apply` 实际写盘');
  }

  out.push('');
  out.push(r.ok ? (r.dryRun ? '✅ dry-run 完成' : '✅ 修复完成') : '❌ 有文件修复失败');
  return out.join('\n') + '\n';
}

// v0.17: diff-dir / annotate-dir markdown
function bq(s: string): string { return String.fromCharCode(96) + s + String.fromCharCode(96); }

export function renderDiffDirMarkdown(r: {
  ok: boolean;
  leftDir: string;
  rightDir: string;
  files: { file: string; leftExists: boolean; rightExists: boolean; anchors: { name: string; leftFound: boolean; rightFound: boolean; diff: string; message?: string }[] }[];
  stats: { compared: number; unchanged: number; changed: number; missing: number };
}): string {
  const out: string[] = [];
  out.push('<!-- tred:diff-dir -->');
  out.push('## 🔀 tred diff --dir');
  out.push('');
  out.push('- **左侧**: ' + bq(r.leftDir));
  out.push('- **右侧**: ' + bq(r.rightDir));
  out.push('- **统计**: 比对 ' + r.stats.compared + ' / 未变 ' + r.stats.unchanged + ' / 变化 ' + r.stats.changed + ' / 缺失 ' + r.stats.missing);
  out.push('');
  out.push(r.ok ? '### ✅ 无差异' : '### ❌ 有差异');
  for (const f of r.files) {
    if (f.anchors.length === 0) continue;
    out.push('');
    out.push('### ' + bq(f.file));
    for (const a of f.anchors) {
      if (a.message) {
        out.push('- ⚠ ' + bq(a.name) + ' — ' + a.message);
      } else if (!a.diff) {
        out.push('- ✓ ' + bq(a.name) + ' — 无变化');
      } else {
        out.push('- ≠ ' + bq(a.name));
        out.push('');
        out.push('````diff');
        out.push(a.diff.trimEnd());
        out.push('````');
      }
    }
  }
  return out.join('\n') + '\n';
}

export function renderAnnotateDirMarkdown(r: {
  ok: boolean;
  dir: string;
  apply: boolean;
  files: { file: string; ok: boolean; actions: { name: string; kind: string; nodeKind: string; line: number }[]; applied: boolean; syntaxErrors?: string[] }[];
  totalActions: number;
  annotatedFiles: number;
  failedFiles: number;
}): string {
  const out: string[] = [];
  out.push('<!-- tred:annotate-dir -->');
  out.push('## 🏷 tred annotate' + (r.apply ? ' (--apply)' : ' (dry-run)'));
  out.push('');
  out.push('- **目录**: ' + bq(r.dir));
  out.push('- **涉及文件**: ' + r.annotatedFiles);
  out.push('- **新增锚点**: ' + r.totalActions);
  if (r.failedFiles > 0) out.push('- **失败文件**: ' + r.failedFiles);
  if (r.files.length === 0) {
    out.push('');
    out.push('### ✅ 无需新增');
    return out.join('\n') + '\n';
  }
  out.push('');
  out.push('### ' + (r.ok ? '✅ 全部成功' : '❌ 有失败'));
  for (const f of r.files) {
    const icon = f.ok ? (f.applied ? '✅' : '·') : '❌';
    out.push('');
    out.push('<details><summary>' + icon + ' ' + bq(f.file) + ' (' + f.actions.length + ' 条)</summary>');
    out.push('');
    for (const a of f.actions) {
      out.push('- L' + a.line + ' ' + a.kind.toUpperCase() + ' ' + bq(a.name) + ' (' + a.nodeKind + ')');
    }
    if (!f.ok && f.syntaxErrors) {
      out.push('');
      for (const e of f.syntaxErrors) out.push('> ❌ ' + e);
    }
    out.push('');
    out.push('</details>');
  }
  if (!r.apply) {
    out.push('');
    out.push('> 💡 加 --apply 写盘');
  }
  return out.join('\n') + '\n';
}
