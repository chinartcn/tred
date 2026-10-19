# tred CLI & API Reference (v3.8.3)

## 一、 CLI 完整手册

### 核心执行
- `tred run <file.cst> [--allow-nodejs] [--dry-run]`：执行 CST 脚本。
- `tred replace --file <path> (--anchor | --selector <json>) (--content <str> | --content-file <path> | --content-stdin) [--fuzzy] [--auto-inject] [--dry-run]`：精准替换。
- `tred split --file <path> --name <a,b> --to <new.ts> [--class <ClassName>]`：全薄壳拆分。
- `tred patch --file <path> [diff-file] [--fuzzy] [--explain] [--force]`：智能打补丁。

### 分析与搜索
- `tred map [--dir <path>]`：JSON 树状大纲。
- `tred impact <name> [--dir <path>]`：依赖影响分析。
- `tred grep <pattern> [--dir <path>] [--ast]`：语义搜索。
- `tred ast --file <path>`：打印 AST 树。
- `tred verify [--dir <path>] [--strict]`：检查锚点与代码健康度。

### 工程化工具
- `tred init [--with-hook]`：生成 `.tred/config.json`。
- `tred annotate [--dir] [--apply]`：自动注入锚点。
- `tred strip [--dir]`：移除锚点。
- `tred doctor`：环境诊断。
- `tred mcp`：启动 MCP Server。

## 二、 TypeScript / JavaScript API

### `runCst(filePath: string, options?: { allowNodejs?: boolean })`
执行 CST 脚本。

### `splitFile(file: string, targets: string[], to: string, className?: string)`
返回 `{ ok: boolean, message: string }`。若中途产生新文件但原文件语法报错，会清理新文件并返回 `ok: false`。

### `applyPatch(file: string, patchText: string, options?: PatchOptions)`
```typescript
interface PatchOptions {
  fuzzy?: boolean;
  fuzzyThreshold?: number; // 默认 0.9
  minRareTokens?: number; // 默认 2
  fuzzyMinMargin?: number; // 默认 0.05
  force?: boolean;
  autoHeal?: boolean;
}
```

### `replace(options: ReplaceOptions): Promise<ReplaceResult>`
```typescript
interface ReplaceOptions {
  file: string;
  content: string;
  astSelector?: AstSelector;
  anchor?: string;
  dryRun?: boolean;
}
interface ReplaceResult {
  status: "replaced" | "skipped" | "failed";
  message?: string;
  syntaxErrors?: string[];
}
```