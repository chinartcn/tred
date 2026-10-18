import { readFileSync, existsSync } from 'node:fs';
import { replace } from './index.js';
import { annotateDir } from './annotate.js';
import { verifyDir } from './verify.js';

export interface OpsConfig {
  ops: Array<any>;
}

export async function runOps(filePath: string, flags: Record<string, string | true | string[]>): Promise<number> {
  if (!existsSync(filePath)) {
    console.error('[tred] ops 文件不存在: ' + filePath);
    return 1;
  }
  const raw = readFileSync(filePath, 'utf-8');
  let config: OpsConfig;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    console.error('[tred] ops 文件 JSON 解析失败: ' + (e instanceof Error ? e.message : String(e)));
    return 1;
  }
  if (!config.ops || !Array.isArray(config.ops)) {
    console.error('[tred] ops 文件格式错误：必须是包含 ops 数组的对象');
    return 1;
  }

  let hasError = false;
  for (let i = 0; i < config.ops.length; i++) {
    const op = config.ops[i];
    console.log('[tred ops] [' + (i + 1) + '/' + config.ops.length + '] ' + op.type + ' ...');

    if (op.type === 'replace') {
      if (flags['dry-run']) op.dryRun = true;
      const r = await replace(op);
      if (r.status === 'failed') {
        hasError = true;
        console.error('  ❌ ' + (r.message || 'replace 失败'));
        if (r.syntaxErrors) r.syntaxErrors.forEach((e: string) => console.error('     ' + e));
      } else {
        console.log('  ✓ ' + r.status);
      }
    } else if (op.type === 'annotate') {
      const r = annotateDir(op);
      if (!r.ok) hasError = true;
      console.log('  ' + (r.ok ? '✓' : '❌') + ' 文件: ' + r.annotatedFiles + ', 动作: ' + r.totalActions);
    } else if (op.type === 'verify') {
      const r = verifyDir(op);
      if (!r.ok) hasError = true;
      console.log('  ' + (r.ok ? '✓' : '❌') + ' issues: ' + r.issues.length);
    } else {
      console.warn('  ⚠ 未知操作类型: ' + op.type);
    }
  }

  return hasError ? 1 : 0;
}
