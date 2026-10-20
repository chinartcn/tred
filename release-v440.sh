#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1. 改造 cst.ts：引入事务快照与自动回滚 ==="
cat > .fix-cst-snapshot.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cst.ts';
let text = readFileSync(F, 'utf8');

// 1.1 引入 snapshot 相关依赖
if (!text.includes("import { resolve, dirname, relative, basename, join } from 'node:path';")) {
  text = text.replace(
    "import { join, dirname } from 'node:path';",
    "import { resolve, dirname, relative, basename, join } from 'node:path';\nimport { writeFileSync, mkdirSync, rmSync } from 'node:fs';"
  );
}

// 1.2 在 runCst 中，执行前打快照，执行失败则回滚
const OLD_RUN = `  // 根据当前文件（dist/cst.js）的物理位置，直接推导同级的 dist/index.js
  let tredPath = '"@rtcn/tred"';`;

const NEW_RUN = `  // 🚀 v4.4.0 安全快照机制
  const snapshotDir = join(process.cwd(), '.tred', 'snapshots');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const currentSnapshotDir = join(snapshotDir, runId);
  const fileBackups = new Map<string, string | null>(); // 路径 -> 原内容(null表示原本不存在)

  // 收集所有涉及的文件
  const filesToSnapshot = new Set<string>();
  for (const op of ops) {
    if (op.props.file) filesToSnapshot.add(resolve(process.cwd(), op.props.file));
    if (op.props.to) filesToSnapshot.add(resolve(process.cwd(), op.props.to));
  }

  mkdirSync(currentSnapshotDir, { recursive: true });
  for (const filePath of filesToSnapshot) {
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, 'utf-8');
      fileBackups.set(filePath, content);
      const rel = relative(process.cwd(), filePath).replace(/\\\\/g, '/').replace(/\\.\\.\\//g, '_');
      writeFileSync(join(currentSnapshotDir, rel), content, 'utf-8');
    } else {
      fileBackups.set(filePath, null);
    }
  }

  // 根据当前文件（dist/cst.js）的物理位置，直接推导同级的 dist/index.js
  let tredPath = '"@rtcn/tred"';`;

text = text.replace(OLD_RUN, NEW_RUN);

// 1.3 在子进程执行失败时，触发回滚
const OLD_CATCH = `    const res = spawnSync(process.execPath, [tmpFile], { stdio: 'inherit', cwd: process.cwd() });
    if (res.status !== 0) {
      process.exit(res.status || 1);
    }`;

const NEW_CATCH = `    const res = spawnSync(process.execPath, [tmpFile], { stdio: 'inherit', cwd: process.cwd() });
    if (res.status !== 0) {
      console.error('\\n⚠️ [tred] 脚本执行失败，正在触发事务回滚...');
      for (const [filePath, origContent] of fileBackups.entries()) {
        if (origContent === null) {
          if (existsSync(filePath)) rmSync(filePath, { force: true });
          console.error('  🧹 删除新建文件: ' + relative(process.cwd(), filePath));
        } else {
          writeFileSync(filePath, origContent, 'utf-8');
          console.error('  ♻️  恢复文件: ' + relative(process.cwd(), filePath));
        }
      }
      console.error('✅ 回滚完成，代码库已恢复至执行前状态。');
      process.exit(res.status || 1);
    }`;

text = text.replace(OLD_CATCH, NEW_CATCH);

// 1.4 成功后打印快照位置
const OLD_FINALLY = `  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      // 如果清理后 .tred-tmp 空了，顺手把它也删了
      if (existsSync(tmpBase) && readdirSync(tmpBase).length === 0) {
        rmSync(tmpBase, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }`;

const NEW_FINALLY = `  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      if (existsSync(tmpBase) && readdirSync(tmpBase).length === 0) {
        rmSync(tmpBase, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }
  console.log('\\n💾 [tred] 成功执行！本次操作快照已保存至 .tred/snapshots/' + runId);`;

text = text.replace(OLD_FINALLY, NEW_FINALLY);

writeFileSync(F, text);
console.log('  ✓ cst.ts 已加入事务快照与自动回滚机制');
MJS_EOF
node .fix-cst-snapshot.mjs && rm .fix-cst-snapshot.mjs

echo "=== 2. 新增 cli.ts 的 undo 命令 ==="
cat > .add-undo.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cli.ts';
let text = readFileSync(F, 'utf8');

// 导入 readdirSync, rmSync
if (!text.includes('readdirSync')) {
  text = text.replace(
    "import { existsSync, readFileSync } from 'node:fs';",
    "import { existsSync, readFileSync, readdirSync, cpSync, rmSync } from 'node:fs';"
  );
}

const UNDO_FUNC = `
async function cmdUndo(): Promise<number> {
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
}
`;

if (!text.includes('cmdUndo')) {
  text = text.replace('async function cmdCommit(', UNDO_FUNC + '\nasync function cmdCommit(');
  text = text.replace(
    "  if (cmd === 'commit')       { process.exit(await cmdCommit(flags)); }",
    "  if (cmd === 'undo')         { process.exit(await cmdUndo()); }\n  if (cmd === 'commit')       { process.exit(await cmdCommit(flags)); }"
  );
  writeFileSync(F, text);
  console.log('  ✓ cli.ts 已加入 undo 命令');
}
MJS_EOF
node .add-undo.mjs && rm .add-undo.mjs

echo "=== 3. 更新文档与 CHANGELOG ==="
cat > .update-docs.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';

// CHANGELOG
let cl = readFileSync('CHANGELOG.md', 'utf8');
const ENTRY = `## [4.4.0] - 2026-10-20

### Added
- **\`.cst\` 事务快照与自动回滚**：在执行 \`.cst\` 脚本前，自动为所有涉及的文件创建物理快照。如果执行中途失败，引擎将**自动回滚**所有已修改的文件，彻底解决“部分成功”导致代码库损坏的问题。
- **\`tred undo\` 命令**：支持一键撤销最近一次成功的 \`.cst\` 操作，恢复到执行前的快照状态。
- 快照统一保存在项目的 \`.tred/snapshots/\` 目录下，以时间戳区分。

`;
if (!cl.includes('## [4.4.0]')) {
  cl = cl.replace('## [4.3.2]', ENTRY + '## [4.3.2]');
  writeFileSync('CHANGELOG.md', cl);
  console.log('  ✓ CHANGELOG.md 更新至 4.4.0');
}

// skill.md
let skill = readFileSync('skill.md', 'utf8');
if (!skill.includes('自动回滚')) {
  skill = skill.replace(
    '2. 执行 `tred run refactor.cst`',
    '2. 执行 `tred run refactor.cst`\n   > 💡 若脚本中途失败，tred 会**自动回滚**所有文件。如果执行成功但后悔了，可以执行 `tred undo` 撤销。'
  );
  writeFileSync('skill.md', skill);
  console.log('  ✓ skill.md 已更新');
}
MJS_EOF
node .update-docs.mjs && rm .update-docs.mjs

echo "=== 4. 跑冒烟测试 ==="
npm run build
bash smoke.sh | tail -3

echo "=== 5. 发版 4.4.0 ==="
npm version 4.4.0 --no-git-tag-version
echo '4.4.0' > .tred-version
npm run build

git add -A
git commit -m "feat(cst): v4.4.0 事务快照、自动回滚与 undo 命令

- 执行 cst 前全量快照，失败自动回滚至一致状态
- 新增 tred undo 命令，一键撤销上一次操作
- 所有快照保存在 .tred/snapshots/
- 更新 skill.md 提示 AI 能够利用此安全机制"
git tag v4.4.0
npm publish --access public
git push origin main --tags
