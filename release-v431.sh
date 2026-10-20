#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1. 将 .tred-tmp 加入全局 .gitignore ==="
if ! grep -q "^.tred-tmp/" .gitignore 2>/dev/null; then
  echo -e "\n# tred 运行临时目录\n.tred-tmp/" >> .gitignore
  echo "✓ .gitignore 已更新"
else
  echo "· .gitignore 已存在 .tred-tmp/"
fi

echo "=== 2. 优化 cst.ts 的清理逻辑（连父目录一起删） ==="
cat > .fix-clean.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cst.ts';
let text = readFileSync(F, 'utf8');

const OLD_CLEAN = `  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }`;
const NEW_CLEAN = `  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
      // 如果清理后 .tred-tmp 空了，顺手把它也删了
      if (existsSync(tmpBase) && readdirSync(tmpBase).length === 0) {
        rmSync(tmpBase, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  }`;

if (text.includes(OLD_CLEAN)) {
  // 需要引入 readdirSync
  if (!text.includes('readdirSync')) {
    text = text.replace(
      "import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, rmSync } from 'node:fs';",
      "import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';"
    );
  }
  text = text.replace(OLD_CLEAN, NEW_CLEAN);
  writeFileSync(F, text);
  console.log('✓ cst.ts 清理逻辑已增强');
}
MJS_EOF
node .fix-clean.mjs && rm .fix-clean.mjs

echo "=== 3. 跑测试确认清理完美 ==="
npm run build
bash test-cst-cwd.sh | tail -n 5

echo "=== 4. 发版 4.3.1 ==="
npm version 4.3.1 --no-git-tag-version
echo '4.3.1' > .tred-version
npm run build

# 清理测试脚本
rm -f test-cst-cwd.sh fix-cst-cwd.sh fix-cst-path-final.sh fix-cst-require.sh

git add -A
git commit -m "fix(cst): 修复临时脚本在外部项目无法解析依赖的问题

- 将临时目录从 os.tmpdir() 移到项目的 .tred-tmp 下，确保 Node 模块解析正确
- 使用 createRequire 注入 require 垫片，完美支持 .cst 中的 CommonJS 语法
- 通过 import.meta.url 绝对路径加载 tred 核心，不依赖 cwd
- 增强清理逻辑，执行完毕后连同父目录一起清理
- .gitignore 忽略 .tred-tmp/"

git tag v4.3.1
npm publish --access public
git push origin main --tags
