import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getCachePath, loadCache } from './cache.js';
import { getChangedFiles, getCurrentBranch, getHeadSha, isDirty, isGitRepo } from './git.js';
import { verifyDir } from './verify.js';
import type { DoctorOptions, DoctorReport } from './types.js';

function fileSize(p: string): number {
  try { return statSync(p).size; } catch { return 0; }
}

function hasModule(name: string, rootDir: string): boolean {
  return existsSync(join(rootDir, 'node_modules', name));
}

function readVersionFile(p: string): string {
  try { return readFileSync(p, 'utf-8').trim(); } catch { return 'unknown'; }
}

export function doctor(opts?: DoctorOptions): DoctorReport {
  const o = opts || {};
  const dir = o.dir || '.';
  const absDir = resolve(dir);

  const packageVersion = (function () {
    try {
      const raw = readFileSync(join(absDir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw) as { version?: string };
      return pkg.version || 'unknown';
    } catch { return 'unknown'; }
  })();

  const tredVersion = readVersionFile(join(absDir, '.tred-version'));

  const gitRepo = isGitRepo(absDir);
  const changedList = gitRepo ? getChangedFiles('HEAD', absDir) : [];
  const git = {
    available: gitRepo,
    isRepo: gitRepo,
    branch: gitRepo ? getCurrentBranch(absDir) : null,
    head: gitRepo ? getHeadSha(absDir) : null,
    dirty: gitRepo ? isDirty(absDir) : false,
    changedFiles: changedList.length,
  };

  const cacheDir = join(absDir, '.tred-cache');
  const cachePath = getCachePath(cacheDir);
  const cacheExists = existsSync(cachePath);
  const loadedCache = loadCache(cacheDir);
  const cache = {
    exists: cacheExists,
    entries: loadedCache ? Object.keys(loadedCache.entries).length : 0,
    sizeBytes: fileSize(cachePath),
    path: cachePath,
  };

  const verifyReport = verifyDir({ dir: absDir });
  const errors = verifyReport.issues.filter((i) => i.level === 'error').length;
  const warnings = verifyReport.issues.filter((i) => i.level === 'warning').length;
  const anchors = {
    files: verifyReport.files.length,
    total: verifyReport.files.reduce((acc, f) => acc + f.anchors.length, 0),
    issues: verifyReport.issues.length,
    errors,
    warnings,
  };

  const deps = {
    tsx: hasModule('tsx', absDir),
    prettier: hasModule('prettier', absDir),
  };

  const suggestions: string[] = [];
  if (!git.isRepo) suggestions.push('当前目录不是 git 仓库，--since 用法受限（可用 --since-file）');
  if (git.dirty) suggestions.push('git 有 ' + git.changedFiles + ' 个改动文件，可用 tred verify --since HEAD 只扫改动');
  if (errors > 0) suggestions.push(errors + ' 个 error 级锚点问题，运行 tred verify --strict 查看');
  if (warnings > 0) suggestions.push(warnings + ' 个 warning 级锚点问题');
  if (!cache.exists) suggestions.push('缓存未启用，tred verify --cache 可加速重复扫描');
  if (packageVersion !== 'unknown' && tredVersion !== 'unknown' && packageVersion !== tredVersion) {
    suggestions.push('版本不一致：package.json=' + packageVersion + ' vs .tred-version=' + tredVersion);
  }
  if (!deps.tsx) suggestions.push('tsx 未安装：npm i -D tsx');
  if (suggestions.length === 0) suggestions.push('环境健康，一切正常');

  return {
    ok: errors === 0,
    tredVersion,
    packageVersion,
    nodeVersion: process.version,
    platform: process.platform + '/' + process.arch,
    dir: absDir,
    git,
    cache,
    anchors,
    deps,
    suggestions,
  };
}
