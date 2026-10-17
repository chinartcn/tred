import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'node:os';
import { join } from 'node:path';
import { verifyDir } from './verify.js';
import { getChangedFiles, isGitRepo } from './git.js';
import { spawnSync } from 'node:child_process';
import { diffAnchor } from './diff-anchor.js';
import type {
  DiffDirAnchorResult,
  DiffDirFileResult,
  DiffDirOptions,
  DiffDirResult,
  VerifyFileReport,
} from './types.js';

export function diffDir(opts: DiffDirOptions): DiffDirResult {
  const leftReport = verifyDir({ dir: opts.leftDir, extensions: opts.extensions, ignore: opts.ignore });
  const rightReport = verifyDir({ dir: opts.rightDir, extensions: opts.extensions, ignore: opts.ignore });

  const leftMap = new Map<string, VerifyFileReport>();
  for (const f of leftReport.files) leftMap.set(f.file, f);
  const rightMap = new Map<string, VerifyFileReport>();
  for (const f of rightReport.files) rightMap.set(f.file, f);

  const allFiles = new Set<string>();
  for (const f of leftMap.keys()) allFiles.add(f);
  for (const f of rightMap.keys()) allFiles.add(f);

  const files: DiffDirFileResult[] = [];
  let compared = 0;
  let unchanged = 0;
  let changed = 0;
  let missing = 0;

  const sortedFiles = Array.from(allFiles).sort();
  for (const rel of sortedFiles) {
    const lf = leftMap.get(rel);
    const rf = rightMap.get(rel);
    const leftPath = join(opts.leftDir, rel);
    const rightPath = join(opts.rightDir, rel);
    const leftExists = existsSync(leftPath);
    const rightExists = existsSync(rightPath);

    if (!leftExists || !rightExists) {
      const side = lf || rf;
      const anchors: DiffDirAnchorResult[] = [];
      if (side) {
        for (const a of side.anchors) {
          if (opts.anchorFilter && a.name !== opts.anchorFilter) continue;
          anchors.push({
            name: a.name,
            leftFound: !!lf && lf.anchors.some((x) => x.name === a.name),
            rightFound: !!rf && rf.anchors.some((x) => x.name === a.name),
            diff: '',
            message: leftExists ? '右侧文件缺失' : '左侧文件缺失',
          });
          missing++;
        }
      }
      if (anchors.length > 0) {
        files.push({ file: rel, leftExists: leftExists, rightExists: rightExists, anchors: anchors });
      }
      continue;
    }

    const names = new Set<string>();
    if (lf) for (const a of lf.anchors) names.add(a.name);
    if (rf) for (const a of rf.anchors) names.add(a.name);

    const anchorResults: DiffDirAnchorResult[] = [];
    const sortedNames = Array.from(names).sort();
    for (const name of sortedNames) {
      if (opts.anchorFilter && name !== opts.anchorFilter) continue;
      compared++;
      const dr = diffAnchor({ anchor: name, left: leftPath, right: rightPath });
      if (!dr.ok) {
        missing++;
        anchorResults.push({
          name: name,
          leftFound: dr.left.found,
          rightFound: dr.right.found,
          diff: '',
          message: dr.message,
        });
      } else if (dr.diff === '') {
        unchanged++;
        anchorResults.push({ name: name, leftFound: true, rightFound: true, diff: '' });
      } else {
        changed++;
        anchorResults.push({ name: name, leftFound: true, rightFound: true, diff: dr.diff });
      }
    }

    if (anchorResults.length > 0) {
      files.push({ file: rel, leftExists: leftExists, rightExists: rightExists, anchors: anchorResults });
    }
  }

  return {
    ok: changed === 0 && missing === 0,
    leftDir: opts.leftDir,
    rightDir: opts.rightDir,
    files: files,
    stats: { compared: compared, unchanged: unchanged, changed: changed, missing: missing },
  };
}

/**
 * diffDirGit：从 git ref 提取历史内容，与当前目录对比。
 * 只处理 git 改动过的文件（增量验证）。
 */
export function diffDirGit(opts: DiffDirOptions & { since?: string; changedFiles?: string[] }): DiffDirResult {
  const since = opts.since || (opts.changedFiles ? 'HEAD' : undefined);
  if (!since) {
    return diffDir(opts as DiffDirOptions);
  }
  if (!isGitRepo()) {
    return {
      ok: false,
      leftDir: opts.leftDir,
      rightDir: opts.rightDir,
      files: [],
      stats: { compared: 0, unchanged: 0, changed: 0, missing: 0 },
    };
  }

  const tmp = mkdtempSync(join(os.tmpdir(), 'tred-git-'));
  const leftDir = join(tmp, 'ref');
  const rightDir = join(tmp, 'current');
  mkdirSync(leftDir, { recursive: true });
  mkdirSync(rightDir, { recursive: true });

  try {
    const changed = opts.changedFiles ?? getChangedFiles(since);
    const cwd = process.cwd();
    const dirPrefix = opts.leftDir === '.' ? '' : opts.leftDir.replace(/^\.\//, '') + '/';

    for (const rel of changed) {
      if (dirPrefix && !rel.startsWith(dirPrefix)) continue;
      const relUnderDir = dirPrefix ? rel.slice(dirPrefix.length) : rel;
      const extMatch = (opts.extensions ?? ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
        .some((e) => relUnderDir.endsWith(e));
      if (!extMatch) continue;

      const srcPath = join(cwd, rel);
      if (!existsSync(srcPath)) continue;

      const leftOut = join(leftDir, relUnderDir);
      mkdirSync(dirname(leftOut), { recursive: true });
      const r = spawnSync('git', ['show', since + ':' + rel], { cwd, encoding: 'utf-8' });
      if (r.status === 0) {
        writeFileSync(leftOut, r.stdout);
      }

      const rightOut = join(rightDir, relUnderDir);
      mkdirSync(dirname(rightOut), { recursive: true });
      copyFileSync(srcPath, rightOut);
    }

    return diffDir({
      leftDir,
      rightDir,
      extensions: opts.extensions,
      ignore: opts.ignore,
      anchorFilter: opts.anchorFilter,
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
