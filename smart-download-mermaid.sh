#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 0. 清理之前留在根目录的垃圾 ==="
rm -f mermaid.min.js

echo "=== 1. 改造 graph.ts，支持外部传入本地引擎代码 ==="
cat > .up-graph.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/graph.ts';
let text = readFileSync(F, 'utf8');

// 替换 generateHtmlGraph 函数签名和内部逻辑
const OLD_SIG = `export function generateHtmlGraph(dir: string): string {`;
const NEW_SIG = `export function generateHtmlGraph(dir: string, mermaidJsCode?: string): string {`;
text = text.replace(OLD_SIG, NEW_SIG);

// 把之前读取本地文件的死板逻辑删掉，改成直接使用传入的代码
const OLD_READ = `  // 🚀 读取本地 mermaid.min.js
  let mermaidJs = '';
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const paths = [
      join(process.cwd(), 'mermaid.min.js'),
      join(__dirname, '../mermaid.min.js'),
      join(__dirname, '../../mermaid.min.js')
    ];
    for (const p of paths) {
      if (existsSync(p)) {
        mermaidJs = readFileSync(p, 'utf-8');
        break;
      }
    }
  } catch { /* ignore */ }

  // 如果没找到本地库，降级用 CDN
  const script1 = mermaidJs 
    ? \`<script>\\n\${mermaidJs}\\n<\\/script>\`
    : '<script src="https://cdn.bootcdn.net/ajax/libs/mermaid/10.9.0/mermaid.min.js"><\\/script>';`;

const NEW_READ = `  // 🚀 使用传入的本地代码，如果没有则降级用 CDN
  const script1 = mermaidJsCode 
    ? \`<script>\\n\${mermaidJsCode}\\n<\\/script>\`
    : '<script src="https://cdn.bootcdn.net/ajax/libs/mermaid/10.9.0/mermaid.min.js"><\\/script>';`;

text = text.replace(OLD_READ, NEW_READ);
writeFileSync(F, text);
console.log('  ✓ graph.ts 已支持外部注入 Mermaid 引擎');
MJS_EOF
node .up-graph.mjs && rm .up-graph.mjs

echo "=== 2. 在 cli.ts 中实现智能询问与下载缓存 ==="
cat > .up-cli.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
const F = 'src/cli.ts';
let text = readFileSync(F, 'utf8');

// 引入 fs, path, readline 和 https
if (!text.includes('import { createWriteStream, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, cpSync, rmSync }')) {
  text = text.replace(
    "import { existsSync, readFileSync, readdirSync, cpSync, rmSync } from 'node:fs';",
    "import { existsSync, readFileSync, readdirSync, cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { createInterface } from 'node:readline/promises';\nimport { pipeline } from 'node:stream/promises';\nimport { Readable } from 'node:stream';"
  );
}

// 注入 ensureMermaid 函数
const ENSURE_FUNC = `
async function ensureMermaid(): Promise<string | undefined> {
  const cacheDir = join(process.cwd(), '.tred', 'cache');
  const cachePath = join(cacheDir, 'mermaid.min.js');

  if (existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf-8');
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer = 'y';
  try {
    answer = await rl.question('\\n💡 提示: 为了极速渲染架构图并支持离线查看，需要下载 Mermaid 渲染引擎 (约 3MB)。是否同意？(Y/n) ');
  } catch { /* TTY 异常时默认同意 */ }
  rl.close();

  if (answer.toLowerCase() === 'n') {
    console.log('  (将降级使用在线 CDN 渲染)');
    return undefined;
  }

  console.log('  ⏳ 正在下载引擎...');
  try {
    const res = await fetch('https://cdn.bootcdn.net/ajax/libs/mermaid/10.9.0/mermaid.min.js');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    mkdirSync(cacheDir, { recursive: true });
    const fileStream = createWriteStream(cachePath);
    // 兼容 Node.js 18+ 的 Web Stream 到 Node Stream
    await pipeline(Readable.fromWeb(res.body as any), fileStream);
    console.log('  ✓ 引擎已缓存至 .tred/cache/mermaid.min.js');
    return readFileSync(cachePath, 'utf-8');
  } catch (e) {
    console.log('  ❌ 下载失败: ' + (e instanceof Error ? e.message : String(e)));
    console.log('  (将降级使用在线 CDN 渲染)');
    return undefined;
  }
}
`;

if (!text.includes('async function ensureMermaid')) {
  text = text.replace('async function cmdGraph(', ENSURE_FUNC + '\nasync function cmdGraph(');
}

// 修改 cmdGraph
const OLD_GRAPH = `  if (flags.html) {
    const html = generateHtmlGraph(dir);`;

const NEW_GRAPH = `  if (flags.html) {
    const mermaidCode = await ensureMermaid();
    const html = generateHtmlGraph(dir, mermaidCode);`;
text = text.replace(OLD_GRAPH, NEW_GRAPH);

// 修改 cmdUndo 的 preview
const OLD_PREVIEW = `          const html = [
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>tred Undo Preview</title></head><body style="font-family:monospace;padding:20px;background:#f6f8fa;">',
            '<h3>撤销预览: ' + flags.file + '</h3>',
            '<div style="background:#fff;border:1px solid #ccc;padding:10px;border-radius:6px;overflow-x:auto;">' + coloredDiff + '</div>',
            '</body></html>'
          ].join('');`;

const NEW_PREVIEW = `          const html = [
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>tred Undo Preview</title></head><body style="font-family:monospace;padding:20px;background:#f6f8fa;">',
            '<h3>撤销预览: ' + flags.file + '</h3>',
            '<div style="background:#fff;border:1px solid #ccc;padding:10px;border-radius:6px;overflow-x:auto;">' + coloredDiff + '</div>',
            '</body></html>'
          ].join('');`;
// 撤销预览是纯文本高亮，不需要 mermaid 引擎，所以这里不用改

writeFileSync(F, text);
console.log('  ✓ cli.ts 已注入按需下载与缓存逻辑');
MJS_EOF
node .up-cli.mjs && rm .up-cli.mjs

echo "=== 3. 重新构建并跑测试 ==="
npm run build
bash smoke.sh | tail -3

echo "=== 4. 提交并推送 ==="
git add -A
git commit -m "feat(graph): 改为按需询问并缓存 Mermaid 引擎，避免每次生成依赖网络和污染项目根目录"
git push origin main
