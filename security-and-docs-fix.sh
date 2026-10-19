#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cp src/cst.ts "src/cst.ts.bak.$(date +%Y%m%d-%H%M%S)"
cp src/cli.ts "src/cli.ts.bak.$(date +%Y%m%d-%H%M%S)"

# ═══════════════════════════════════════════════════════════
# 1. 堵死安全漏洞：给 /#nodejs 加锁
# ═══════════════════════════════════════════════════════════
cat > .fix-security.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';

// 1.1 修改 cst.ts，增加 allowNodejs 参数控制
let cst = readFileSync('src/cst.ts', 'utf8');

cst = cst.replace(
  "export async function runCst(filePath: string): Promise<void> {",
  "export async function runCst(filePath: string, options?: { allowNodejs?: boolean }): Promise<void> {"
);

const OLD_GEN = "  if (nodeCode) {\n    script += `// --- User Node.js Code ---\\n${nodeCode}\\n// -------------------------\\n\\n`;\n  }";
const NEW_GEN = `  if (nodeCode) {
    if (!options?.allowNodejs) {
      console.error('❌ [安全拦截] 检测到 /#nodejs 块。为防止 RCE，默认禁止执行。请确认脚本安全后，加 --allow-nodejs 重试。');
      process.exit(1);
    }
    script += \`// --- User Node.js Code ---\\n\${nodeCode}\\n// -------------------------\\n\\n\`;
  }`;

if (cst.includes(OLD_GEN)) {
  cst = cst.replace(OLD_GEN, NEW_GEN);
  writeFileSync('src/cst.ts', cst);
  console.log('  ✓ cst.ts 已增加 --allow-nodejs 安全拦截');
}

// 1.2 修改 cli.ts，传入 allowNodejs 并支持全局 --json
let cli = readFileSync('src/cli.ts', 'utf8');
const OLD_RUN = "  if (cmd === 'run') {\n    const cstFile = positionals[1] || (typeof flags.file === 'string' ? flags.file : undefined);\n    if (!cstFile) die('用法: tred run <file.cst> 或 tred run --file <file.cst>');\n    await runCst(cstFile);\n    process.exit(0);\n  }";
const NEW_RUN = "  if (cmd === 'run') {\n    const cstFile = positionals[1] || (typeof flags.file === 'string' ? flags.file : undefined);\n    if (!cstFile) die('用法: tred run <file.cst> 或 tred run --file <file.cst>');\n    await runCst(cstFile, { allowNodejs: Boolean(flags['allow-nodejs']) });\n    process.exit(0);\n  }";

if (cli.includes(OLD_RUN)) {
  cli = cli.replace(OLD_RUN, NEW_RUN);
  writeFileSync('src/cli.ts', cli);
  console.log('  ✓ cli.ts 已接入 --allow-nodejs 控制');
}
MJS_EOF
node .fix-security.mjs && rm .fix-security.mjs

# ═══════════════════════════════════════════════════════════
# 2. 重写 SPEC.md (包含完整语法、Schema、事务边界)
# ═══════════════════════════════════════════════════════════
cat > .write-spec.mjs <<'MJS_EOF'
import { writeFileSync } from 'node:fs';

const spec = [
'# tred 工程契约与规范 (v3.8.3)',
'',
'## 一、 CST (Changes Long Text) 语法规范',
'',
'### 1. 块与转义',
'- 长文本以 `content:` 开头，遇到换行且独占一行的 `/#end` 结束。',
'- **转义**：若代码中恰好包含 `/#end`，请在其前加反斜杠 `\\/#end`，引擎会自动将其转换为普通文本。',
'- **Node.js 安全**：`/#nodejs` 块默认被禁用。若需执行，必须在 CLI 加 `--allow-nodejs`。',
'',
'### 2. 完整指令字典',
'',
'#### `replace`',
'```text',
'replace {',
'  file: src/a.ts',
'  selector: {"kind":"method","className":"A","methodName":"run"}',
'  content:',
'    // 代码',
'  /#end',
'}',
'```',
'',
'#### `patch` (应用 Unified Diff)',
'```text',
'patch {',
'  file: src/a.ts',
'  fuzzy: true',
'  content:',
'    @@ -1,1 +1,1 @@',
'    -old',
'    +new',
'  /#end',
'}',
'```',
'',
'#### `split` (自动拆分)',
'```text',
'split {',
'  file: src/giant.ts',
'  name: renderNode,update',
'  to: src/render.ts',
'  class: Engine',
'}',
'```',
'',
'## 二、 AST Selector JSON Schema',
'所有选择器均支持 `occurrence?: number`（当有多个同名节点时，选择第 n 个，从 1 开始）。',
'```typescript',
'type Selector = ',
'  | { kind: "class", className: string, occurrence?: number }',
'  | { kind: "function", functionName: string, occurrence?: number }',
'  | { kind: "method", className: string, methodName: string, occurrence?: number }',
'  | { kind: "variable", variableName: string }',
'  | { kind: "property", path: string } // path 格式为 a.b.c',
'  | { kind: "file", scope: "head" | "tail" | "all", line?: number, snippet?: string }; // snippet 精确包含',
'```',
'',
'## 三、 MCP Tool 完整 Schema',
'',
'| 工具名 | Input Schema | Output Schema (成功) |',
'|---|---|---|',
'| `tred_map` | `{ dir: string }` | `{ files: Record<string, { lines: number, outline: any[] }> }` |',
'| `tred_split` | `{ file, name, to, className? }` | `{ ok: boolean, message: string }` |',
'| `tred_patch` | `{ file, diff, fuzzy?, autoHeal? }` | `{ ok: boolean, message?: string }` |',
'| `tred_replace`| `{ file, content, anchor?, selector? }` | `{ status: "replaced"\|"skipped"\|"failed", message?: string }` |',
'| `tred_impact` | `{ target: string, dir?: string }`| `{ text: string }` |',
'',
'## 四、 事务与原子性边界',
'- **单文件写入**：任何 `replace`, `patch` 操作均采用 `tmp + rename`，绝对原子。',
'- **多文件事务**：`tred run` 脚本内的多个操作**不保证全局回滚**。若第 3 个操作失败，前 2 个已写盘的文件不会自动撤销。请配合 Git 使用。',
'- **语法门禁**：所有替换在写盘前均调用 `tsc` 进行纯语法解析。若失败，当前操作回滚，但**不会**抛出 TypeScript 类型错误。',
'',
'## 五、 错误码与退出码（供 AI 解析）',
'退出码统一为 1。stderr 会以 `ERR_XXX:` 开头输出，`--json` 模式下输出 `{ error: "ERR_XXX", message: string }`。',
'- `ERR_UNEXPORTED_DEP`：同文件依赖未导出，需加入 `--name`。',
'- `ERR_AMBIGUOUS_MATCH`：多候选差距 < 5%，需用 `--force` 或 `--explain`。',
'- `ERR_SYNTAX_FAIL`：修改后代码破坏语法。',
'- `ERR_FILE_NOT_FOUND`：文件不存在。',
'- `ERR_SELECTOR_NOT_FOUND`：AST 未找到节点。',
'- `ERR_NODEJS_DISABLED`：检测到 `/#nodejs` 但未加 `--allow-nodejs`。',
].join('\n');

writeFileSync('SPEC.md', spec);
console.log('  ✓ SPEC.md 已重建（含转义、nth、事务、错误码）');
MJS_EOF
node .write-spec.mjs && rm .write-spec.mjs

# ═══════════════════════════════════════════════════════════
# 3. 重写 api.md (恢复全部 API)
# ═══════════════════════════════════════════════════════════
cat > .write-api.mjs <<'MJS_EOF'
import { writeFileSync } from 'node:fs';

const api = [
'# tred CLI & API Reference (v3.8.3)',
'',
'## 一、 CLI 完整手册',
'',
'### 核心执行',
'- `tred run <file.cst> [--allow-nodejs] [--dry-run]`：执行 CST 脚本。',
'- `tred replace --file <path> (--anchor | --selector <json>) (--content <str> | --content-file <path> | --content-stdin) [--fuzzy] [--auto-inject] [--dry-run]`：精准替换。',
'- `tred split --file <path> --name <a,b> --to <new.ts> [--class <ClassName>]`：全薄壳拆分。',
'- `tred patch --file <path> [diff-file] [--fuzzy] [--explain] [--force]`：智能打补丁。',
'',
'### 分析与搜索',
'- `tred map [--dir <path>]`：JSON 树状大纲。',
'- `tred impact <name> [--dir <path>]`：依赖影响分析。',
'- `tred grep <pattern> [--dir <path>] [--ast]`：语义搜索。',
'- `tred ast --file <path>`：打印 AST 树。',
'- `tred verify [--dir <path>] [--strict]`：检查锚点与代码健康度。',
'',
'### 工程化工具',
'- `tred init [--with-hook]`：生成 `.tred/config.json`。',
'- `tred annotate [--dir] [--apply]`：自动注入锚点。',
'- `tred strip [--dir]`：移除锚点。',
'- `tred doctor`：环境诊断。',
'- `tred mcp`：启动 MCP Server。',
'',
'## 二、 TypeScript / JavaScript API',
'',
'### `runCst(filePath: string, options?: { allowNodejs?: boolean })`',
'执行 CST 脚本。',
'',
'### `splitFile(file: string, targets: string[], to: string, className?: string)`',
'返回 `{ ok: boolean, message: string }`。若中途产生新文件但原文件语法报错，会清理新文件并返回 `ok: false`。',
'',
'### `applyPatch(file: string, patchText: string, options?: PatchOptions)`',
'```typescript',
'interface PatchOptions {',
'  fuzzy?: boolean;',
'  fuzzyThreshold?: number; // 默认 0.9',
'  minRareTokens?: number; // 默认 2',
'  fuzzyMinMargin?: number; // 默认 0.05',
'  force?: boolean;',
'  autoHeal?: boolean;',
'}',
'```',
'',
'### `replace(options: ReplaceOptions): Promise<ReplaceResult>`',
'```typescript',
'interface ReplaceOptions {',
'  file: string;',
'  content: string;',
'  astSelector?: AstSelector;',
'  anchor?: string;',
'  dryRun?: boolean;',
'}',
'interface ReplaceResult {',
'  status: "replaced" | "skipped" | "failed";',
'  message?: string;',
'  syntaxErrors?: string[];',
'}',
'```',
].join('\n');

writeFileSync('api.md', api);
console.log('  ✓ api.md 已全面恢复');
MJS_EOF
node .write-api.mjs && rm .write-api.mjs

# ═══════════════════════════════════════════════════════════
# 4. 修补 README.md 的矛盾点
# ═══════════════════════════════════════════════════════════
cat > .write-readme.mjs <<'MJS_EOF'
import { readFileSync, writeFileSync } from 'node:fs';
let r = readFileSync('README.md', 'utf8');

r = r.replace(
  "### 4. MCP 原生接入\n内置 Model Context Protocol (MCP) Server。详见 [MCP 配置指南](./api.md#mcp)。",
  "### 4. MCP 原生接入\n内置 Model Context Protocol (MCP) Server。详见 [SPEC.md](./SPEC.md) 中的工具 Schema。"
);

r = r.replace(
  "- **CST 执行权限**：`tred run` 内的 `/#nodejs` 块**具备任意原生 Node 执行权限**。请勿运行来历不明的 `.cst` 文件（如被 Prompt Injection 注入的脚本）。",
  "- **CST 执行权限**：`/#nodejs` 块默认被禁用（防 RCE 注入）。若确需运行，请加 `--allow-nodejs`。"
);

r = r.replace(
  "- **私有降级**：自动把 `this.buffer` 转为 `(this as any).buffer`。",
  "- **私有降级**：自动把 `this.buffer` 转为 `(this as any).buffer`（需人工 Review 类型安全）。"
);

writeFileSync('README.md', r);
console.log('  ✓ README.md 已修复安全声明矛盾');
MJS_EOF
node .write-readme.mjs && rm .write-readme.mjs

echo
echo "=== build & 测试安全拦截 ==="
npm run build

cat > .test-sec.cst <<'CST'
/#nodejs
import fs from 'node:fs';
fs.writeFileSync('hacked.txt', 'hacked');
/#nodejs.end
CST

echo "--- 测试默认拦截（应报错退出）---"
node dist/cli.js run .test-sec.cst || echo "✓ 成功拦截"

echo "--- 测试 --allow-nodejs 放行 ---"
node dist/cli.js run .test-sec.cst --allow-nodejs
cat hacked.txt
rm -f .test-sec.cst hacked.txt

echo
echo "=== 发版 3.8.3 ==="
npm version 3.8.3 --no-git-tag-version
echo '3.8.3' > .tred-version
npm run build

git add -A
git commit -m "feat(security): 增加 /#nodejs 安全沙箱开关，补齐完整 SPEC 与 API 文档

- cst: 默认禁用 /#nodejs 防止 AI 注入 RCE，需显式传 --allow-nodejs
- spec: 补齐 patch/split 语法、nth 选择器、事务边界说明
- api: 恢复所有 CLI 与 TS API 定义
- docs: 修复 README 中安全声明自相矛盾的漏洞"
git tag v3.8.3
npm publish --access public
git push origin main --tags
