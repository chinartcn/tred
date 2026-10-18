import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildOutline } from './ast-outline.js';

export interface CodeMapFile {
  lines: number;
  outline: any[];
}

export interface CodeMap {
  totalFiles: number;
  totalLines: number;
  files: Record<string, CodeMapFile>;
}

export function generateMap(dir: string): CodeMap {
  const result: CodeMap = { totalFiles: 0, totalLines: 0, files: {} };
  const ignore = new Set(['node_modules', '.git', 'dist', '.tred-tmp', '.tred']);

  function walk(d: string) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!ignore.has(e.name)) walk(join(d, e.name));
      } else if (e.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e.name)) {
        const full = join(d, e.name);
        const source = readFileSync(full, 'utf-8');
        const lines = source.split('\n').length;
        let outline: any[] = [];
        try { outline = buildOutline(full, source); } catch {}

        if (outline.length > 0) {
          const rel = relative(process.cwd(), full);
          result.files[rel] = { lines, outline };
          result.totalFiles++;
          result.totalLines += lines;
        }
      }
    }
  }
  walk(dir);
  return result;
}