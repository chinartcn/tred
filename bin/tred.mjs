#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distCli = resolve(here, '../dist/cli.js');
const srcCli = resolve(here, '../src/cli.ts');

// 优先级：TRED_DEV=1 强制源码；否则 dist 存在就用 dist；都没有回退 tsx src
const forceDev = process.env.TRED_DEV === '1';
const useDist = !forceDev && existsSync(distCli);

const args = process.argv.slice(2);
const r = useDist
  ? spawnSync(process.execPath, [distCli, ...args], { stdio: 'inherit' })
  : spawnSync(process.execPath, ['--import', 'tsx', srcCli, ...args], {
      stdio: 'inherit',
    });

if (r.error) {
  process.stderr.write('[tred] 启动失败: ' + r.error.message + '\n');
  if (!useDist) {
    process.stderr.write('[tred] 开发模式回退失败，请确认已安装 tsx: npm i -D tsx\n');
    process.stderr.write('[tred] 或先构建：npm run build\n');
  }
  process.exit(1);
}

process.exit(r.status ?? 1);
