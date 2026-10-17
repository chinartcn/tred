import { atomicWrite } from './atomic.js';
import type { RollbackLog } from './types.js';

/** 原子写 rollback log（tmp + rename，失败时向上抛） */
export function writeRollbackLog(log: RollbackLog, path: string): void {
  atomicWrite(path, JSON.stringify(log, null, 2) + '\n');
}
