import type { VerifyIssue, VerifyReport, FixReport } from './types.js';

function escProp(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

function escMsg(s: string): string {
  return s
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function issueToAnnotation(issue: VerifyIssue): string {
  const level = issue.level === 'error' ? 'error' : 'warning';
  const props: string[] = [];
  if (issue.file) props.push('file=' + escProp(issue.file));
  if (issue.line) props.push('line=' + issue.line);
  if (issue.code) props.push('title=' + escProp(issue.code));
  return '::' + level + ' ' + props.join(',') + '::' + escMsg(issue.message);
}

export function renderGithubAnnotations(report: VerifyReport): string {
  if (report.issues.length === 0) {
    return '::notice title=tred::verify 通过（' + report.scannedFiles + ' 个文件）\n';
  }
  const lines: string[] = [];
  for (const issue of report.issues) {
    lines.push(issueToAnnotation(issue));
  }
  return lines.join('\n') + '\n';
}

export function renderFixGithubAnnotations(report: FixReport): string {
  const lines: string[] = [];
  for (const f of report.files) {
    if (f.error) {
      lines.push('::error file=' + escProp(f.file) + ',title=tred-fix::' + escMsg(f.error));
    } else if (f.applied) {
      lines.push('::notice file=' + escProp(f.file) + ',title=tred-fix::' + f.actions.length + ' 处已修复');
    }
  }
  if (lines.length === 0) {
    lines.push('::notice title=tred-fix::无需修复');
  }
  return lines.join('\n') + '\n';
}
