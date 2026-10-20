#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1. 新增 src/create.ts (AST 骨架生成器) ==="
cat > src/create.ts <<'TS_EOF'
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
TS_EOF

echo "=== 2. 改造 cli.ts (接入 create 命令并升级 undo) ==="
cat > .add-cli.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cli.ts';
let text = readFileSync(F, 'utf8');

// 2.1 引入 createSkeleton 和 AST 定位工具
if (!text.includes("import { createSkeleton }")) {
  text = text.replace(
    "import { runCst } from './cst.js';",
    "import { runCst } from './cst.js';\nimport { createSkeleton } from './create.js';\nimport { findAnchor } from './anchor.js';"
  );
}

// 2.2 注入 cmdCreate
const CREATE_FUNC = `
async function cmdCreate(flags: Record<string, string | true>): Promise<number> {
  const file = requireStr(flags, 'file');
  const type = requireStr(flags, 'type') as any;
  const name = requireStr(flags, 'name');
  const apply = Boolean(flags.apply);
  if (!['class', 'function', 'interface'].includes(type)) {
    die('--type 必须是 class, function 或 interface');
  }
  const res = createSkeleton({ file, type, name, apply });
  console.log(res.ok ? '✅ ' + res.message : '❌ ' + res.message);
  return res.ok ? 0 : 1;
}
`;

if (!text.includes('cmdCreate')) {
  text = text.replace('async function cmdUndo(', CREATE_FUNC + '\nasync function cmdUndo(');
  text = text.replace(
    "  if (cmd === 'undo')         { process.exit(await cmdUndo()); }",
    "  if (cmd === 'create')       { process.exit(await cmdCreate(flags)); }\n  if (cmd === 'undo')         { process.exit(await cmdUndo(flags)); }"
  );
}

// 2.3 升级 cmdUndo，支持 --anchor 局部回滚
const OLD_UNDO = `async function cmdUndo(): Promise<number> {
  const snapshotDir = join(process.cwd(), '.tred', 'snapshots');
  if (!existsSync(snapshotDir)) {
    die('没有找到任何操作快照（.tred/snapshots 不存在）');
  }
  const snapshots = readdirSync(snapshotDir).sort();
  if (snapshots.length === 0) {
    die('没有可撤销的快照');
  }
  const latest = snapshots[snapshots.length - 1];
  const latestPath = join(snapshotDir, latest);

  console.log('[tred] 正在从快照回滚: ' + latest);
  // 把快照里的文件覆盖回项目
  cpSync(latestPath, process.cwd(), { recursive: true });
  
  // 删除已撤销的快照
  rmSync(latestPath, { recursive: true, force: true });

  console.log('✅ 撤销成功，代码已恢复到执行 "' + latest + '" 前的状态。');
  return 0;
}`;

const NEW_UNDO = `async function cmdUndo(flags: Record<string, string | true>): Promise<number> {
  const snapshotDir = join(process.cwd(), '.tred', 'snapshots');
  if (!existsSync(snapshotDir)) {
    die('没有找到任何操作快照（.tred/snapshots 不存在）');
  }
  const snapshots = readdirSync(snapshotDir).sort();
  if (snapshots.length === 0) {
    die('没有可撤销的快照');
  }
  const latest = snapshots[snapshots.length - 1];
  const latestPath = join(snapshotDir, latest);
  const anchorName = typeof flags.anchor === 'string' ? flags.anchor : undefined;
  const filePath = typeof flags.file === 'string' ? flags.file : undefined;

  if (!anchorName) {
    console.log('[tred] 正在从快照全局回滚: ' + latest);
    cpSync(latestPath, process.cwd(), { recursive: true });
    rmSync(latestPath, { recursive: true, force: true });
    console.log('✅ 撤销成功，代码已恢复。');
    return 0;
  }

  // 局部按锚点回滚
  if (!filePath) die('局部回滚必须指定 --file');
  const snapFilePath = join(latestPath, filePath);
  if (!existsSync(snapFilePath)) die('快照中找不到该文件: ' + filePath);
  if (!existsSync(filePath)) die('当前项目找不到该文件: ' + filePath);

  const snapContent = readFileSync(snapFilePath, 'utf-8');
  const currentContent = readFileSync(filePath, 'utf-8');

  const snapBlock = findAnchor(snapContent, anchorName);
  const currBlock = findAnchor(currentContent, anchorName);

  if (!snapBlock || !currBlock) {
    die('快照或当前文件中找不到锚点: ' + anchorName);
  }

  const snapLines = snapContent.split('\\n');
  const currLines = currentContent.split('\\n');

  const restoredBlockText = snapLines.slice(snapBlock.startLine, snapBlock.endLine + 1).join('\\n');
  const newContent = currLines.slice(0, currBlock.startLine).join('\\n') + '\\n' + restoredBlockText + '\\n' + currLines.slice(currBlock.endLine + 1).join('\\n');

  atomicWrite(filePath, newContent);
  console.log('✅ 成功局部回滚锚点 "' + anchorName + '" 到状态: ' + latest);
  return 0;
}`;

if (text.includes(OLD_UNDO)) {
  text = text.replace(OLD_UNDO, NEW_UNDO);
}

// 保证 atomicWrite 被导入
if (!text.includes('import { atomicWrite }')) {
  text = "import { atomicWrite } from './atomic.js';\n" + text;
}

writeFileSync(F, text);
console.log('  ✓ cli.ts 已升级 create 命令与精细 undo');
MJS_EOF
node .add-cli.mjs && rm .add-cli.mjs

echo "=== 3. 重新 build & 冒烟 ==="
npm run build
bash smoke.sh | tail -3

echo "=== 4. 发版 4.5.0 ==="
npm version 4.5.0 --no-git-tag-version
echo '4.5.0' > .tred-version
npm run build

git add -A
git commit -m "feat(cli): v4.5.0 新增 AST 骨架生成与基于锚点的细粒度回滚

- 新增 \`tred create\` 命令，一键生成包含锚点的 class/function 骨架
- 升级 \`tred undo\`，支持 \`--file\` 和 \`--anchor\` 参数，实现函数级别的局部代码回滚
- 配合 v4.4.0 的事务快照机制，实现工业级的安全撤销"
git tag v4.5.0
npm publish --access public
git push origin main --tags
