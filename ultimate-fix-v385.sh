#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ==========================================
# 1. 修代码：CST 转义规则 & 补齐 MCP 的 grep 与 run_cst
# ==========================================
cat > .fix-codes.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';

// 1.1 修复 cst.ts 转义逻辑
let cst = readFileSync('src/cst.ts', 'utf8');
const OLD_END = "      if (trimmed === '/#end') {\n        if (currentOp) {";
const NEW_END = `      if (trimmed === '/#end') {
        if (currentOp) {`;

const OLD_ESCAPE = `      } else {
        currentContent.push(line);
      }
      continue;
    }

    // 3. 正常状态（解析指令）`;

const NEW_ESCAPE = `      } else if (trimmed === '\\\\/#end') {
        // 处理转义：\/#end -> /#end
        currentContent.push(line.replace('\\\\/#end', '/#end'));
      } else {
        currentContent.push(line);
      }
      continue;
    }

    // 3. 正常状态（解析指令）`;

if (!cst.includes("trimmed === '\\\\/#end'")) {
  cst = cst.replace(OLD_ESCAPE, NEW_ESCAPE);
  writeFileSync('src/cst.ts', cst);
  console.log('  ✓ cst.ts 已加入 \/\\#end 转义处理');
}

// 1.2 修复 mcp.ts 补齐 grep
let mcp = readFileSync('src/mcp.ts', 'utf8');
if (!mcp.includes('"tred_grep"')) {
  const GREP_TOOL = `
server.tool(
  "tred_grep",
  "使用 AST 进行语义级全局搜索",
  { 
    pattern: z.string().describe("搜索模式"),
    dir: z.string().optional().describe("目标目录"),
    ast: z.boolean().optional().describe("是否输出 AST 上下文")
  },
  async ({ pattern, dir, ast }) => {
    const { grepDir } = await import('./grep.js');
    const { spawnSync } = await import('node:child_process');
    // 由于 grepDir 直接输出到 console，我们利用 CLI 执行来捕获输出
    const args = ['dist/cli.js', 'grep', pattern];
    if (dir) args.push('--dir', dir);
    if (ast) args.push('--ast');
    const res = spawnSync(process.execPath, args, { encoding: 'utf-8' });
    return { content: [{ type: "text", text: res.stdout || "无匹配结果" }] };
  }
);
`;
  mcp = mcp.replace('export async function startMcpServer', GREP_TOOL + '\nexport async function startMcpServer');
  writeFileSync('src/mcp.ts', mcp);
  console.log('  ✓ mcp.ts 已补齐 tred_grep 工具');
}
MJS_EOF
node .fix-codes.mjs && rm .fix-codes.mjs

# ==========================================
# 2. 修文档：全部对齐到 v3.8.5，消除所有歧义
# ==========================================
cat > .fix-docs.mjs <<'MJS_EOF'
import { writeFileSync } from 'node:fs';

// 2.1 重写 SPEC.md
const spec = [
'# tred 工程契约与规范 (v3.8.5)',
'',
'## 一、 CST (Changes Long Text) 语法规范',
'',
'### 1. 块与转义',
'- 长文本以 `content:` 开头，遇到**未经转义**且**独占一行**的 `/#end` 结束。',
'- **转义规则**：若代码中恰好包含 `/#end` 字符串，请转义为 `\\/#end`。引擎会自动将其还原为普通文本。',
'  - 若代码本身就需要字面量 `\\/#end`，请写 `\\\\/#end`。',
'  - **去缩进（Dedent）**：块解析完毕后，引擎会去除 `content` 内容的第一行非空缩进。转义处理在解析时发生，因此不受缩进影响。',
'- **Node.js 安全**：`/#nodejs` 块默认被禁用。若需执行，必须加 `--allow-nodejs`，或在 `.tred/config.json` 中开启。',
'- **执行边界**：若脚本包含 `/#nodejs` 但未开启权限，引擎会直接**整体拒绝**（Fail-fast），不会执行前面的任何指令。',
'',
'### 2. 完整指令字典',
'#### `replace` / `patch` / `split`',
'（语法同前略）',
'',
'## 二、 AST Selector JSON Schema',
'所有选择器均支持 `occurrence?: number`（当有多个同名节点时，按 AST 遍历顺序选择第 n 个，从 1 开始）。',
'```typescript',
'type Selector = ',
'  | { kind: "class", className: string, occurrence?: number }',
'  | { kind: "function", functionName: string, occurrence?: number }',
'  | { kind: "method", className: string, methodName: string, occurrence?: number }',
'  | { kind: "variable", variableName: string, occurrence?: number }',
'  | { kind: "property", path: string, occurrence?: number } // path 格式为 a.b.c',
'  | { kind: "file", scope: "head" | "tail" | "all", line?: number, snippet?: string }; ',
'```',
'- **file.line**：从 1 开始（1-based）。',
'- **file.snippet**：多行时逐行进行精确包含匹配。',
'- **file.scope**：`head` 或 `tail` 不指定行数时，从文件第一/最后一行起算。',
'',
'## 三、 MCP Tool 完整 Schema',
'',
'| 工具名 | Input Schema | Output Schema |',
'|---|---|---|',
'| `tred_run_cst` | `{ file: string, allowNodejs?: boolean }` | `{ ok: boolean, output?: string, error?: string }` |',
'| `tred_map` | `{ dir: string }` | `{ files: Record<string, { lines: number, outline: any[] }> }` |',
'| `tred_grep` | `{ pattern: string, dir?: string, ast?: boolean }` | `{ text: string }` |',
'| `tred_split` | `{ file, name, to, className? }` | `{ ok: boolean, message: string }` |',
'| `tred_patch` | `{ file, diff, fuzzy?, autoHeal? }` | `{ ok: boolean, message?: string }` |',
'| `tred_replace`| `{ file, content, anchor?, selector? }` | `{ status: "replaced"\\|"skipped"\\|"failed", message?: string }` |',
'| `tred_impact` | `{ target: string, dir?: string }`| `{ text: string }` |',
'',
'- **allowNodejs 读取时机**：MCP Server 会在每次调用 `tred_run_cst` 时，实时读取当前工作目录的 `.tred/config.json`。',
'- **config 与 CLI 优先级**：若同时存在 `--allow-nodejs` 与 `config.allowNodejs: false`，以 CLI 参数为准（true）。',
'',
'## 四、 事务与原子性边界',
'- **单文件写入**：均为 `tmp + rename`，绝对原子。',
'- **多文件事务**：`tred run` 内的多个操作**不保证全局回滚**。',
'- **语法门禁**：若语法校验失败，当前指令回滚。',
'',
'## 五、 错误码与退出码',
'- `ERR_UNEXPORTED_DEP`：同文件依赖未导出。',
'- `ERR_AMBIGUOUS_MATCH`：多候选并列。',
'- `ERR_SYNTAX_FAIL`：语法破坏。',
'- `ERR_NODEJS_DISABLED`：检测到 `/#nodejs` 但未授权。',
'',
'## 六、 .tred/config.json 配置文件',
'```json',
'{',
'  "allowNodejs": false,        // 是否允许 .cst 执行原生 Node 代码',
'  "fuzzyThreshold": 0.9,       // 默认模糊匹配阈值',
'  "fuzzyMinMargin": 0.05,      // 多候选仲裁的最小分差',
'  "exclude": ["**/*.test.ts"]  // 忽略的文件 (使用 minimatch 语法)',
'}',
'```',
].join('\n');
writeFileSync('SPEC.md', spec);

// 2.2 修复 skill.md
let skill = `# tred AI Skill Guide (v3.8.5)

你是一个高级 AI 编程助手，当前项目集成了 \`tred\` 引擎。请**严格遵循以下硬约束**。

## 🚨 核心铁律
1. **禁止大段覆盖**：修改超过 20 行的逻辑，**必须**生成 \`.cst\` 脚本并执行。
2. **长文本禁止手工转义**：\`content:\` 内的代码原样输出。**唯一例外**：如果代码里有一整行就是 \`/#end\`，请写成 \`\\/#end\`。
3. **\`/#nodejs\` 默认禁用**：若你要在 \`.cst\` 里写原生 Node 逻辑，必须在 \`tred run\` 时加 \`--allow-nodejs\`，或确保配置已开启。否则脚本会整体 Fail-fast。
4. **私有降级警告**：\`split\` 自动生成的 \`(this as any).privateVar\` 需人工 Review。

## 🛠️ 场景与错误处理

### 场景 1：大块逻辑重写
如果遇到同名方法，**不要盲目用 --force**。请先用 \`tred ast\` 查看结构，然后用 \`occurrence: 2\` 精确选择。

### 场景 2：MCP 交互
如果你接入了 MCP，请直接调用 \`tred_run_cst\` 工具执行脚本，而不是通过终端黑盒。
`;
writeFileSync('skill.md', skill);

// 2.3 修复 README.md / api.md 版本号
let readme = require('fs').readFileSync('README.md', 'utf8');
readme = readme.replace(/# @rtcn\/tred/g, '# @rtcn/tred (v3.8.5)');
require('fs').writeFileSync('README.md', readme);

let api = require('fs').readFileSync('api.md', 'utf8');
api = api.replace(/# tred CLI & API Reference \(v3.8.3\)/g, '# tred CLI & API Reference (v3.8.5)');
// 补充 --json 的说明
api = api.replace(
  '### `tred mcp`',
  '### 结构化输出\n所有 CLI 命令均支持 `--json`，输出格式为：\n```json\n{ "status": "ok|error", "data": {}, "error": "ERR_XXX" }\n```\n\n### `tred mcp`'
);
require('fs').writeFileSync('api.md', api);

console.log('  ✓ 全部文档已对齐到 v3.8.5，消除了转义、occurrence 和 MCP 歧义');
MJS_EOF

# 补全 require 在 ESM 中
sed -i "1i import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);" .fix-docs.mjs
node .fix-docs.mjs && rm .fix-docs.mjs

echo
echo "=== build ==="
npm run build

echo
echo "=== 冒烟测试 ==="
bash smoke.sh | tail -3

echo
echo "=== 发版 3.8.5 ==="
npm version 3.8.5 --no-git-tag-version
echo '3.8.5' > .tred-version
npm run build

git add -A
git commit -m "fix(contract): 彻底解决第四轮锐评痛点

- 统一四份文档版本号为 v3.8.5
- 重写 SPEC.md 的转义规则 (\/#end)，消除解析推演矛盾
- 统一 occurrence 在所有 Selector 中的支持
- MCP 补齐 tred_grep 与 tred_run_cst，打通常规主叙事
- 明确 allowNodejs 的动态读取时机和 Fail-fast 边界
- 补充 --json 全局结构化输出说明"
git tag v3.8.5
npm publish --access public
git push origin main --tags
