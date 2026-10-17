import { spawnSync } from 'node:child_process';

function run(args: string[], cwd?: string): { ok: boolean; stdout: string } {
  const r = spawnSync('git', args, { cwd: cwd ?? process.cwd(), encoding: 'utf-8' });
  return { ok: r.status === 0, stdout: r.stdout || '' };
}

export function isGitRepo(cwd?: string): boolean {
  return run(['rev-parse', '--git-dir'], cwd).ok;
}

export function getCurrentBranch(cwd?: string): string | null {
  const r = run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return r.ok ? r.stdout.trim() : null;
}

export function getHeadSha(cwd?: string): string | null {
  const r = run(['rev-parse', 'HEAD'], cwd);
  return r.ok ? r.stdout.trim() : null;
}

export function isDirty(cwd?: string): boolean {
  const r = run(['status', '--porcelain'], cwd);
  return r.ok && r.stdout.trim().length > 0;
}

export function getMergeBase(target: string, cwd?: string): string | null {
  const r = run(['merge-base', target, 'HEAD'], cwd);
  return r.ok ? r.stdout.trim() : null;
}

export function getStagedFiles(cwd?: string): string[] {
  const r = run(['diff', '--name-only', '--diff-filter=ACMR', '--cached'], cwd);
  if (!r.ok) return [];
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

export function getUnstagedFiles(cwd?: string): string[] {
  const r = run(['diff', '--name-only', '--diff-filter=ACMR'], cwd);
  if (!r.ok) return [];
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

export function getUntrackedFiles(cwd?: string): string[] {
  const r = run(['ls-files', '--others', '--exclude-standard'], cwd);
  if (!r.ok) return [];
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

function parseRange(ref: string): string {
  const t = ref.trim();
  if (!t) return 'HEAD';
  if (t.indexOf('...') >= 0) return t;
  if (t === 'HEAD') return 'HEAD';
  return t + '...HEAD';
}

export function getChangedFiles(ref: string, cwd?: string): string[] {
  if (!isGitRepo(cwd)) return [];
  const set = new Set<string>();
  const range = parseRange(ref);
  const r = run(['diff', '--name-only', '--diff-filter=ACMR', range], cwd);
  if (r.ok) {
    for (const line of r.stdout.split('\n')) {
      const t = line.trim();
      if (t) set.add(t);
    }
  }
  for (const f of getStagedFiles(cwd)) set.add(f);
  for (const f of getUnstagedFiles(cwd)) set.add(f);
  for (const f of getUntrackedFiles(cwd)) set.add(f);
  return Array.from(set).sort();
}

export function gitShow(ref: string, path: string, cwd?: string): string | null {
  const r = run(['show', ref + ':' + path], cwd);
  return r.ok ? r.stdout : null;
}
