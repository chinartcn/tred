import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { atomicWrite } from './atomic.js';
import { makeFingerprint } from './fingerprint.js';

export interface CreateOptions {
  file: string;
  type: 'class' | 'function' | 'interface';
  name: string;
  apply?: boolean;
}

export function createSkeleton(opts: CreateOptions): { ok: boolean; message: string; diff?: string } {
  const { file, type, name, apply } = opts;
  let original = existsSync(file) ? readFileSync(file, 'utf-8') : '';

  const fp = makeFingerprint({ anchor: name, source: 'tred-create', version: '1' });
  const startComment = `// @TRED_START: ${name} | fp=${fp}`;
  const endComment = `// @TRED_END: ${name}`;

  let skeleton = '';
  if (type === 'class') {
    skeleton = `${startComment}\nexport class ${name} {\n  constructor() {\n    // TODO\n  }\n}\n${endComment}`;
  } else if (type === 'function') {
    skeleton = `${startComment}\nexport function ${name}() {\n  // TODO\n}\n${endComment}`;
  } else if (type === 'interface') {
    skeleton = `${startComment}\nexport interface ${name} {\n  // TODO\n}\n${endComment}`;
  }

  const newContent = original.trim() ? original + '\n\n' + skeleton + '\n' : skeleton + '\n';

  if (apply) {
    atomicWrite(file, newContent);
  }

  return {
    ok: true,
    message: `成功生成 ${type} 骨架 "${name}" ${apply ? '并写入' : '(dry-run)'}`,
  };
}
