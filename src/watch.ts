import { readdirSync, watch as fsWatch } from 'node:fs';
import { join } from 'node:path';

const WATCH_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.tred-tmp', '.turbo', '.tred-cache',
]);

export interface WatchHandle {
  close: () => void;
}

export function watchDir(dir: string, onChange: () => void, debounceMs?: number): WatchHandle {
  const delay = debounceMs ?? 200;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const trigger = (): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!closed) onChange();
    }, delay);
  };

  const cleanups: (() => void)[] = [];

  function attachOne(d: string): void {
    try {
      const w = fsWatch(d, trigger);
      cleanups.push(() => { try { w.close(); } catch { /* */ } });
    } catch { /* skip */ }
  }

  function walk(d: string): void {
    try {
      attachOne(d);
      const entries = readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !WATCH_IGNORE.has(e.name)) {
          walk(join(d, e.name));
        }
      }
    } catch { /* skip */ }
  }

  let usedRecursive = false;
  try {
    const w = fsWatch(dir, { recursive: true }, trigger);
    cleanups.push(() => { try { w.close(); } catch { /* */ } });
    usedRecursive = true;
  } catch {
    walk(dir);
  }

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const fn of cleanups) {
        try { fn(); } catch { /* */ }
      }
    },
  };
}
