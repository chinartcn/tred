import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { InitOptions, InitResult } from './types.js';

const CONFIG_PATH = join('.tred', 'config.json');
const HOOK_PATH = join('.git', 'hooks', 'pre-commit');

const CONFIG_TEMPLATE = "{\n  \"dir\": \"src\",\n  \"exclude\": [\n    \"**/*.test.ts\",\n    \"**/*.spec.ts\"\n  ],\n  \"baseline\": \".tred-baseline.json\",\n  \"cacheDir\": \".tred-cache\"\n}\n";

const HOOK_TEMPLATE = "#!/usr/bin/env bash\n# 由 tred init 生成\nset -uo pipefail\nDIR=\"$(git rev-parse --show-toplevel 2>/dev/null || echo .)\"\ncd \"$DIR\"\n\nif [ -f .tred-baseline.json ]; then\n  tred verify --dir src --baseline .tred-baseline.json --strict\nelse\n  tred verify --dir src --strict\nfi\nexit $?\n";

export function init(opts?: InitOptions): InitResult {
  const dir = opts && opts.dir ? opts.dir : process.cwd();
  const withHook = Boolean(opts && opts.withHook);
  const created: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const configAbs = resolve(dir, CONFIG_PATH);
  if (existsSync(configAbs)) {
    skipped.push(CONFIG_PATH);
  } else {
    try {
      mkdirSync(resolve(dir, ".tred"), { recursive: true });
      writeFileSync(configAbs, CONFIG_TEMPLATE, "utf-8");
      created.push(CONFIG_PATH);
    } catch (e) {
      errors.push(CONFIG_PATH + ": " + (e instanceof Error ? e.message : String(e)));
    }
  }

  let hookPath: string | null = null;
  if (withHook) {
    const hookAbs = resolve(dir, HOOK_PATH);
    if (existsSync(hookAbs)) {
      skipped.push(HOOK_PATH);
    } else {
      try {
        mkdirSync(resolve(dir, ".git/hooks"), { recursive: true });
        writeFileSync(hookAbs, HOOK_TEMPLATE, "utf-8");
        try {
          chmodSync(hookAbs, 0o755);
        } catch { /* ignore */ }
        created.push(HOOK_PATH);
        hookPath = hookAbs;
      } catch (e) {
        errors.push(HOOK_PATH + ": " + (e instanceof Error ? e.message : String(e)));
      }
    }
  }

  return {
    ok: errors.length === 0,
    configPath: configAbs,
    hookPath: hookPath,
    created: created,
    skipped: skipped,
    errors: errors,
  };
}
