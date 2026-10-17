import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { BaselineFile, BaselineIssue, VerifyIssue, VerifyReport } from './types.js';

export function buildBaseline(report: VerifyReport, dir?: string): BaselineFile {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    dir: dir ?? report.dir,
    issues: report.issues.map((i) => ({
      code: i.code,
      file: i.file,
      line: i.line,
      message: i.message,
      level: i.level,
    })),
  };
}

export function loadBaseline(filePath: string): BaselineFile | null {
  const abs = resolve(filePath);
  if (!existsSync(abs)) return null;
  try {
    const raw = readFileSync(abs, 'utf-8');
    const parsed = JSON.parse(raw) as BaselineFile;
    if (!parsed || parsed.version !== 1) return null;
    if (!Array.isArray(parsed.issues)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveBaseline(filePath: string, baseline: BaselineFile): void {
  const abs = resolve(filePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
}

function issueKey(i: BaselineIssue | VerifyIssue): string {
  return i.code + '|' + (i.file ?? '') + '|' + i.message;
}

export function filterIssuesByBaseline(
  report: VerifyReport,
  baseline: BaselineFile,
  strict: boolean,
): VerifyReport {
  const baseSet = new Set<string>();
  for (const b of baseline.issues) baseSet.add(issueKey(b));

  const kept = report.issues.filter((i) => !baseSet.has(issueKey(i)));

  const hasError = kept.some((i) => i.level === 'error');
  const hasWarning = kept.some((i) => i.level === 'warning');
  const ok = strict ? (!hasError && !hasWarning) : !hasError;

  return Object.assign({}, report, { ok: ok, issues: kept });
}
