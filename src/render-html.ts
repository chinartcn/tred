import type { VerifyIssue, VerifyReport, VerifyFileReport } from './types.js';

export interface HtmlOptions {
  version?: string;
  title?: string;
}

const LF = String.fromCharCode(10);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = "body { font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif; margin: 0; padding: 2em; background: #f6f8fa; color: #24292f; }\nh1 { font-size: 1.8em; margin-bottom: 0.3em; }\n.meta { color: #57606a; margin-bottom: 1.5em; font-size: 0.9em; }\n.stats { display: flex; gap: 1em; margin-bottom: 2em; flex-wrap: wrap; }\n.card { padding: 1em 1.5em; background: white; border: 1px solid #d0d7de; border-radius: 6px; min-width: 120px; }\n.card .num { font-size: 1.6em; font-weight: 600; }\n.card .label { color: #57606a; font-size: 0.85em; }\n.card.error { border-left: 4px solid #cf222e; }\n.card.warning { border-left: 4px solid #bf8700; }\n.card.ok { border-left: 4px solid #2da44e; }\n.card.info { border-left: 4px solid #0969da; }\n.status { padding: 0.8em 1.2em; border-radius: 6px; margin-bottom: 2em; font-weight: 600; }\n.status.ok { background: #dafbe1; color: #1a7f37; }\n.status.fail { background: #ffebe9; color: #cf222e; }\ntable { width: 100%; border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden; border: 1px solid #d0d7de; margin-bottom: 2em; }\nth, td { padding: 0.6em 1em; text-align: left; border-bottom: 1px solid #eaeef2; }\nth { background: #f6f8fa; font-weight: 600; font-size: 0.9em; }\ntr:last-child td { border-bottom: none; }\n.badge { display: inline-block; padding: 0.1em 0.5em; border-radius: 3px; font-size: 0.8em; font-weight: 600; }\n.badge.error { background: #ffebe9; color: #cf222e; }\n.badge.warning { background: #fff8c5; color: #7d4e00; }\ndetails { background: white; border: 1px solid #d0d7de; border-radius: 6px; padding: 1em 1.5em; margin-bottom: 1em; }\nsummary { cursor: pointer; font-weight: 600; }\nsummary:hover { color: #0969da; }\n.anchor-item { padding: 0.3em 0; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.9em; }\n.anchor-item.orphan { color: #cf222e; }\n.empty { color: #57606a; font-style: italic; }\n#filter { width: 100%; padding: 0.6em 1em; border: 1px solid #d0d7de; border-radius: 6px; margin-bottom: 1em; font-size: 1em; box-sizing: border-box; }\nfooter { margin-top: 3em; color: #57606a; font-size: 0.85em; text-align: center; }\ncode { background: #f6f8fa; padding: 0.1em 0.4em; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.9em; }";

function badge(level: 'error' | 'warning'): string {
  return '<span class="badge ' + level + '">' + level + '</span>';
}

function statCard(num: number, label: string, kind: string): string {
  return '<div class="card ' + kind + '"><div class="num">' + num + '</div><div class="label">' + label + '</div></div>';
}

function renderIssueRow(issue: VerifyIssue): string {
  const loc = issue.file ? escapeHtml(issue.file) + (issue.line ? ':' + issue.line : '') : '—';
  return '<tr><td>' + badge(issue.level) + '</td><td><code>' + escapeHtml(issue.code) + '</code></td><td>' + loc + '</td><td>' + escapeHtml(issue.message) + '</td></tr>';
}

function renderFileDetails(fr: VerifyFileReport): string {
  const orphan = fr.orphans.length > 0;
  const icon = orphan ? '❌' : '✅';
  const parts: string[] = [];
  parts.push('<details>');
  parts.push('<summary>' + icon + ' ' + escapeHtml(fr.file) + ' (' + fr.anchors.length + ' anchors, ' + fr.orphans.length + ' orphans)</summary>');
  parts.push('<div style="margin-top: 1em">');
  if (fr.anchors.length > 0) {
    parts.push('<div style="margin-bottom: 0.5em"><strong>Anchors:</strong></div>');
    for (const a of fr.anchors) {
      const fp = a.fp ? ' fp=' + escapeHtml(a.fp) : '';
      parts.push('<div class="anchor-item">' + escapeHtml(a.name) + ' L' + a.line + '-L' + a.endLine + fp + '</div>');
    }
  }
  if (fr.orphans.length > 0) {
    parts.push('<div style="margin: 0.5em 0"><strong>Orphans:</strong></div>');
    for (const o of fr.orphans) {
      parts.push('<div class="anchor-item orphan">⚠ ' + o.kind.toUpperCase() + ' ' + escapeHtml(o.name) + ' L' + o.line + '</div>');
    }
  }
  parts.push('</div>');
  parts.push('</details>');
  return parts.join(LF);
}

export function renderHtml(report: VerifyReport, opts?: HtmlOptions): string {
  const version = (opts && opts.version) || '0.0.0';
  const title = (opts && opts.title) || 'tred verify report';
  const errors = report.issues.filter((i) => i.level === 'error').length;
  const warnings = report.issues.filter((i) => i.level === 'warning').length;
  const ts = new Date().toISOString();

  const parts: string[] = [];
  parts.push('<!DOCTYPE html>');
  parts.push('<html lang="en">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push('<title>' + escapeHtml(title) + '</title>');
  parts.push('<style>');
  parts.push(CSS);
  parts.push('</style>');
  parts.push('</head>');
  parts.push('<body>');

  parts.push('<h1>🔍 ' + escapeHtml(title) + '</h1>');
  parts.push('<div class="meta">');
  parts.push('Dir: <code>' + escapeHtml(report.dir) + '</code> &middot; ');
  parts.push('tred v' + escapeHtml(version) + ' &middot; ');
  parts.push(ts);
  parts.push('</div>');

  parts.push('<div class="stats">');
  parts.push(statCard(report.scannedFiles, 'Scanned Files', 'info'));
  parts.push(statCard(report.files.length, 'With Anchors', 'info'));
  parts.push(statCard(errors, 'Errors', errors > 0 ? 'error' : 'ok'));
  parts.push(statCard(warnings, 'Warnings', warnings > 0 ? 'warning' : 'ok'));
  parts.push('</div>');

  if (report.ok) {
    parts.push('<div class="status ok">✅ All checks passed</div>');
  } else {
    parts.push('<div class="status fail">❌ ' + errors + ' error(s) found</div>');
  }

  if (report.issues.length > 0) {
    parts.push('<h2>Issues (' + report.issues.length + ')</h2>');
    parts.push('<input id="filter" type="text" placeholder="Filter by code / file / message...">');
    parts.push('<table id="issues-table">');
    parts.push('<thead><tr><th>Level</th><th>Code</th><th>Location</th><th>Message</th></tr></thead>');
    parts.push('<tbody>');
    for (const issue of report.issues) {
      parts.push(renderIssueRow(issue));
    }
    parts.push('</tbody>');
    parts.push('</table>');
  }

  if (report.files.length > 0) {
    parts.push('<h2>Files (' + report.files.length + ')</h2>');
    for (const fr of report.files) {
      parts.push(renderFileDetails(fr));
    }
  } else {
    parts.push('<div class="empty">No anchors found in scanned files.</div>');
  }

  parts.push('<footer>Generated by <strong>tred</strong> v' + escapeHtml(version) + '</footer>');

  parts.push('<script>');
  parts.push('(function() {');
  parts.push('  var f = document.getElementById("filter");');
  parts.push('  if (!f) return;');
  parts.push('  var table = document.getElementById("issues-table");');
  parts.push('  if (!table) return;');
  parts.push('  f.addEventListener("input", function() {');
  parts.push('    var q = f.value.toLowerCase();');
  parts.push('    var rows = table.querySelectorAll("tbody tr");');
  parts.push('    for (var i = 0; i < rows.length; i++) {');
  parts.push('      var txt = rows[i].textContent.toLowerCase();');
  parts.push('      rows[i].style.display = (q === "" || txt.indexOf(q) >= 0) ? "" : "none";');
  parts.push('    }');
  parts.push('  });');
  parts.push('})();');
  parts.push('</script>');

  parts.push('</body>');
  parts.push('</html>');

  return parts.join(LF) + LF;
}
