import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { VerifyCache, VerifyCacheEntry } from './types.js';
import { atomicWrite } from './atomic.js';

const CACHE_FILENAME = 'verify.json';
const CACHE_VERSION = 1;

export function getCachePath(cacheDir: string): string {
  return join(resolve(cacheDir), CACHE_FILENAME);
}

export function loadCache(cacheDir: string): VerifyCache | null {
  const p = getCachePath(cacheDir);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as VerifyCache;
    if (!parsed || parsed.version !== CACHE_VERSION) return null;
    if (typeof parsed.entries !== "object" || parsed.entries === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveCache(cacheDir: string, cache: VerifyCache): void {
  const p = getCachePath(cacheDir);
  mkdirSync(dirname(p), { recursive: true });
  atomicWrite(p, JSON.stringify(cache, null, 2) + '\n');
}

export interface FileSig {
  mtimeMs: number;
  size: number;
}

export function statFile(fullPath: string): FileSig | null {
  try {
    const st = statSync(fullPath);
    if (!st.isFile()) return null;
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

export function isCacheHit(entry: VerifyCacheEntry | undefined, sig: FileSig): boolean {
  if (!entry) return false;
  if (entry.mtimeMs !== sig.mtimeMs) return false;
  if (entry.size !== sig.size) return false;
  return true;
}
