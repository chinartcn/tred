import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function stripAnchors(source: string): string {
  const lines = source.split('\n');
  const kept = lines.filter(line => {
    return !/^\s*\/\/\s*@TRED_(START|END):/.test(line);
  });
  return kept.join('\n');
}

export function stripDir(dir: string, apply: boolean): number {
  let changedCount = 0;

  function walk(d: string): void {
    const entries = readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        walk(fullPath);
      } else if (entry.isFile() && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        const raw = readFileSync(fullPath, 'utf-8');
        const stripped = stripAnchors(raw);
        if (stripped !== raw) {
          changedCount++;
          if (apply) writeFileSync(fullPath, stripped, 'utf-8');
        }
      }
    }
  }

  walk(dir);
  return changedCount;
}