#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cp smoke.sh "smoke.sh.bak.$(date +%Y%m%d-%H%M%S)"
echo "已备份 smoke.sh"

cat > .add-cst-smoke.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'smoke.sh';
let s = readFileSync(F, 'utf8');

if (s.includes('CST 脚本：Node 逻辑 + 长文本')) {
  console.log('· CST 用例已存在，跳过');
  process.exit(0);
}

const ANCHOR = 'process.stdout.write(`\\n${pass} passed, ${fail} failed\\n`);';
if (!s.includes(ANCHOR)) { console.error('❌ 汇总行锚点丢失'); process.exit(1); }

const ADD = [
  "// ── 19. CST 脚本：Node 逻辑 + 长文本替换 + patch ──",
  "t('CST 脚本：Node 逻辑 + 长文本替换 + patch', () => {",
  "  const dir = mk({});",
  "  const cstFile = join(dir, 'test.cst');",
  "  const targetFile = join(dir, 'out.ts');",
  "  const cstContent = [",
  "    '/#nodejs',",
  "    'import fs from \"node:fs\";',",
  "    'fs.writeFileSync(' + JSON.stringify(targetFile) + ', \"const a = 1;\")',",
  "    '/#nodejs.end',",
  "    '',",
  "    'replace {',",
  "    '  file: ' + targetFile,",
  "    '  selector: {\"kind\":\"variable\",\"variableName\":\"a\"}',",
  "    '  content:',",
  "    '    const a = 999;',",
  "    '  /#end',",
  "    '}',",
  "    '',",
  "    'patch {',",
  "    '  file: ' + targetFile,",
  "    '  content:',",
  "    '    @@ -1,1 +1,1 @@',",
  "    '    -const a = 999;',",
  "    '    +const a = 777;',",
  "    '  /#end',",
  "    '}'",
  "  ].join('\\n');",
  "  writeFileSync(cstFile, cstContent);",
  "  ",
  "  // 直接在子进程中调用 CLI 跑 tred run",
  "  const { spawnSync } = require('node:child_process');",
  "  const res = spawnSync(process.execPath, [join(process.cwd(), 'dist/cli.js'), 'run', cstFile], { encoding: 'utf-8' });",
  "  assert.equal(res.status, 0, res.stderr);",
  "  ",
  "  const finalOut = readFileSync(targetFile, 'utf-8').trim();",
  "  assert.equal(finalOut, 'const a = 777;');",
  "  rmSync(dir, { recursive: true });",
  "});",
  "",
  ANCHOR,
].join('\n');

s = s.replace(ANCHOR, ADD);
writeFileSync(F, s);
console.log('✓ smoke.sh 已追加 CST 用例 (19)');
MJS_EOF

node --check .add-cst-smoke.mjs 2>/dev/null || { node --check .add-cst-smoke.mjs; rm -f .add-cst-smoke.mjs; exit 1; }
node .add-cst-smoke.mjs
rm -f .add-cst-smoke.mjs

# 注意：CST 内部 require 需要依赖，我们在脚本里稍微调整一下，改用 ESM 的 spawnSync
sed -i "s|const { spawnSync } = require('node:child_process');|const { spawnSync } = await import('node:child_process');|g" smoke.sh
sed -i "s|t('CST 脚本：Node 逻辑 + 长文本替换 + patch', () => {|t('CST 脚本：Node 逻辑 + 长文本替换 + patch', async () => {|g" smoke.sh

echo
echo "=== 跑一次全量 smoke（含 19 条 CST） ==="
bash smoke.sh | tail -5
