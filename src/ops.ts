import { existsSync, readFileSync } from 'node:fs';
import { replace } from './index.js';
import { annotateDir } from './annotate.js';
import { verifyDir } from './verify.js';

export interface OpsConfig {
  ops: Array<any>;
}

function normalizeReplaceOp(raw: any, index: number): { op?: any; errors: string[] } {
  const errors: string[] = [];
  const prefix = 'op[' + index + ']';

  if (!raw || typeof raw !== 'object') return { errors: [prefix + ': 必须是一个 JSON 对象'] };

  let content: string | undefined = undefined;
  if (typeof raw.content === 'string') {
    content = raw.content;
  } else if (typeof raw.contentFile === 'string') {
    try {
      content = readFileSync(raw.contentFile, 'utf-8');
    } catch (e) {
      errors.push(prefix + ': 读取 contentFile 失败（' + raw.contentFile + '）：' + (e instanceof Error ? e.message : String(e)));
    }
  }
  if (content === undefined) errors.push(prefix + ': 必须提供 "content" 或 "contentFile"');

  if (typeof raw.file !== 'string') errors.push(prefix + ': 缺少 "file" 字段');

  const selector = raw.selector ?? raw.astSelector;
  const snippetSelector = raw.snippetSelector;
  const anchor = raw.anchor;

  if (!anchor && !selector && !snippetSelector) errors.push(prefix + ': 必须提供 "anchor" / "selector" 之一');
  if (errors.length > 0) return { errors };

  let astSelector: any = undefined;
  let universalSelector: any = undefined;
  if (selector) {
    if (selector.kind === 'file') {
      universalSelector = selector;
    } else if (['class', 'method', 'function', 'statement', 'variable'].includes(selector.kind)) {
      astSelector = selector;
    } else {
      universalSelector = selector;
    }
  }

  const op: any = {
    file: raw.file,
    anchor,
    content,
    fingerprint: raw.fingerprint,
    dryRun: raw.dryRun,
    autoInjectAnchor: raw.autoInjectAnchor,
    fuzzy: raw.fuzzy,
    astSelector,
    selector: universalSelector,
    snippetSelector,
    assertions: raw.assertions,
    format: raw.format,
  };

  if (op.autoInjectAnchor && (!op.anchor || !op.astSelector)) {
    errors.push(prefix + ': 使用 autoInjectAnchor 时，必须提供 "anchor" 和 "selector"');
    return { errors };
  }

  return { op, errors: [] };
}

export async function runOps(filePath: string, flags: Record<string, string | true | string[]>): Promise<number> {
  if (!existsSync(filePath)) {
    console.error('❌ [tred ops] ops 文件不存在: ' + filePath);
    return 1;
  }

  let config: OpsConfig;
  try {
    config = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e) {
    console.error('❌ [tred ops] JSON 解析失败：' + (e instanceof Error ? e.message : String(e)));
    console.error('   建议：检查有没有多余的逗号、少写的引号');
    return 1;
  }

  if (!config.ops || !Array.isArray(config.ops)) {
    console.error('❌ [tred ops] 格式错误：顶层必须是 {"ops": [...]}');
    return 1;
  }

  let hasError = false;
  for (let i = 0; i < config.ops.length; i++) {
    const raw = config.ops[i];
    const type = raw && raw.type;
    console.log('[tred ops] [' + (i + 1) + '/' + config.ops.length + '] ' + (type || '?') + ' ...');

    try {
      if (type === 'replace') {
        const { op, errors } = normalizeReplaceOp(raw, i);
        if (errors.length > 0) {
          hasError = true;
          for (const err of errors) console.error('  ❌ ' + err);
          continue;
        }
        if (flags['dry-run']) op.dryRun = true;
        const r = await replace(op);
        if (r.status === 'failed') {
          hasError = true;
          console.error('  ❌ ' + (r.message || 'replace 失败'));
          if (r.syntaxErrors) r.syntaxErrors.forEach((e: string) => console.error('     ' + e));
          if (r.failureContext) {
            console.error('\n  ⚠️ 原代码:\n' + r.failureContext.oldCode.split('\n').map((l: string) => '     ' + l).join('\n'));
            console.error('\n  ⚠️ 你的新代码:\n' + r.failureContext.newCode.split('\n').map((l: string) => '     ' + l).join('\n'));
          }
        } else {
          console.log('  ✓ ' + r.status);
        }
      } else if (type === 'annotate') {
        const r = annotateDir(raw);
        if (!r.ok) hasError = true;
        console.log('  ' + (r.ok ? '✓' : '❌') + ' 文件: ' + r.annotatedFiles + ', 动作: ' + r.totalActions);
      } else if (type === 'verify') {
        const r = verifyDir(raw);
        if (!r.ok) hasError = true;
        console.log('  ' + (r.ok ? '✓' : '❌') + ' issues: ' + r.issues.length);
      } else {
        console.warn('  ⚠ 未知操作类型: ' + type);
      }
    } catch (e) {
      hasError = true;
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('undefined') || msg.includes('null')) {
        console.error('  ❌ op[' + i + '] 字段类型不对：' + msg);
      } else {
        console.error('  ❌ op[' + i + '] 执行失败：' + msg);
      }
    }
  }
  return hasError ? 1 : 0;
}