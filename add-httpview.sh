#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1. 引入 serveHtml 并添加 startHttpView 辅助函数 ==="
cat > .add-serve.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cli.ts';
let text = readFileSync(F, 'utf8');

// 1.1 补充导入
if (!text.includes('import { serveHtml, tryOpenBrowser }')) {
  text = text.replace(
    "import { generateMermaidGraph, generateHtmlGraph } from './graph.js';",
    "import { generateMermaidGraph, generateHtmlGraph } from './graph.js';\nimport { serveHtml, tryOpenBrowser } from './serve.js';"
  );
}

// 1.2 注入挂起函数
const HELPER = `
async function startHttpView(html: string, title: string): Promise<void> {
  const handle = await serveHtml(() => html, { port: 0 });
  console.log('\\n🌐 HTTP 预览已启动: ' + handle.url);
  const opened = tryOpenBrowser(handle.url);
  if (!opened) console.log('  (请手动在浏览器中打开上述地址)');
  console.log('  (按 Ctrl+C 停止预览服务并退出)');
  
  return new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\\n[tred] 预览服务已停止');
      handle.close();
      resolve();
    });
  });
}
`;

if (!text.includes('startHttpView')) {
  text = text.replace('async function cmdGraph(', HELPER + '\nasync function cmdGraph(');
}

writeFileSync(F, text);
console.log('  ✓ cli.ts 已注入 startHttpView 函数');
MJS_EOF
node .add-serve.mjs && rm .add-serve.mjs

echo "=== 2. 改造 cmdGraph 和 cmdUndo ==="
cat > .up-cmds.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cli.ts';
let text = readFileSync(F, 'utf8');

// 2.1 改造 cmdGraph
const OLD_GRAPH = `  if (flags.html) {
    const html = generateHtmlGraph(dir);
    writeFileSync('tred-graph.html', html, 'utf-8');
    console.log('✅ 架构图已生成: tred-graph.html (用浏览器打开即可查看)');
    return 0;
  }`;

const NEW_GRAPH = `  if (flags.html) {
    const html = generateHtmlGraph(dir);
    writeFileSync('tred-graph.html', html, 'utf-8');
    console.log('✅ 架构图已生成: tred-graph.html');
    if (flags.httpview) {
      await startHttpView(html, 'tred 架构图');
    }
    return 0;
  }`;
text = text.replace(OLD_GRAPH, NEW_GRAPH);

// 2.2 改造 cmdUndo 的 preview
const OLD_PREVIEW = `          writeFileSync('tred-undo-preview.html', html, 'utf-8');
          console.log('✅ 撤销预览已生成: tred-undo-preview.html');
        } else {
          console.log(diff);
        }`;

const NEW_PREVIEW = `          writeFileSync('tred-undo-preview.html', html, 'utf-8');
          console.log('✅ 撤销预览已生成: tred-undo-preview.html');
          if (flags.httpview) {
            await startHttpView(html, '撤销预览');
          }
        } else {
          console.log(diff);
        }`;
text = text.replace(OLD_PREVIEW, NEW_PREVIEW);

writeFileSync(F, text);
console.log('  ✓ cmdGraph 和 cmdUndo 已接入 --httpview');
MJS_EOF
node .up-cmds.mjs && rm .up-cmds.mjs

echo "=== 3. 重新构建并跑测试 ==="
npm run build
bash smoke.sh | tail -3

echo "=== 4. 提交推送到 CI ==="
git add -A
git commit -m "feat(cli): 新增 --httpview 功能，自动唤起浏览器预览 HTML 报告

- 在 graph --html 和 undo --preview --html 中支持 --httpview
- 自动使用本地随机端口起 HTTP 服务，调用 termux-open-url 等打开浏览器
- 阻塞进程，按 Ctrl+C 时优雅关闭服务"

git push origin main
