# tred CLI & API Reference (v4.0.0)

本手册提供 `tred` 所有 CLI 命令、环境配置及 TypeScript 接口的完整技术说明。

## 一、 CLI 命令手册

### 1. 核心执行
- `tred run <file.cst>`：执行 CST 宏脚本。
  - 可选参数：`--allow-nodejs`（放行 Node 执行）、`--dry-run`（仅输出变更，不写盘）。
- `tred chop --file <path> --dir <out-dir>`：执行 CodeChopper 图聚类拆分。将巨型文件拆分为多个 chunk。
- `tred split --file <path> --name <a,b> --to <new.ts>`：全薄壳 AST 定向拆分。
  - 可选参数：`--class <ClassName>`（当同文件有多个类含同名方法时必须指定）。
- `tred patch --file <path> [diff-file]`：应用 unified diff。
  - 可选参数：`--fuzzy`（开启模糊匹配）、`--explain`（输出打分详情）、`--force`（忽略并列仲裁）。
- `tred replace --file <path> (--anchor | --selector)`：精准替换。
  - 替换内容：`--content <str>` 或 `--content-file <path>` 或 `--content-stdin`。
  - 可选参数：`--dry-run`（不写盘）。

### 2. 分析与搜索
- `tred map [--dir <path>]`：输出 JSON 格式的 AST 结构树。
- `tred impact <name> [--dir <path>]`：分析特定符号（函数/变量/类）的依赖影响面。
- `tred grep <pattern> [--ast]`：全项目搜索，加 `--ast` 会标注上下文（如所属函数）。
- `tred ast --file <path>`：打印单个文件的 AST 树。

### 3. 工程化管理
- `tred init`：生成 `.tred/config.json` 配置。
- `tred verify`：检查锚点健康度与循环依赖。
- `tred mcp`：启动 MCP Server。

---

## 二、 TypeScript API
### `calcHybridSimilarity(codeA: string, codeB: string): HybridScoreDetail`
计算两段代码文本的结构与语义相似度（0~1）。
包含 AST 结构保底机制：如果语法骨架高度一致，即使变量名全部被修改，也能获得极高的评分。
- 返回值：

    {
      bm25: number;
      astShape: number;
      minHash: number;
      finalScore: number;
    }

### `searchFuzzy(dir: string, query: string, options?: FuzzySearchOptions): GrepResult[]`
使用 v4.0 混合算法（BM25 + AST + Jaro-Winkler）在指定目录进行语义级代码搜索。
- 支持自然语言意图搜索（如"处理支付"）和标识符变异搜索（如搜 `fetchUser` 命中 `getUserData`）。
- 可直接用于开发编辑器插件、代码审计工具。

    interface FuzzySearchOptions {
      ignoreDirs?: Set<string>;
      extensions?: RegExp;
      maxResults?: number;
    }

    interface GrepResult {
      file: string;
      line: number;
      context: string;
      text: string;
      score: number;
    }


### `runCst(filePath: string, options?: { allowNodejs?: boolean })`
执行 CST 脚本。
- 若 `.cst` 中包含 `/#nodejs` 且 `allowNodejs` 为 `false`（且配置文件未放行），直接抛出异常中断。

### `splitFile(file: string, targets: string[], to: string, className?: string)`
执行定向拆分。
- 返回值：`{ ok: boolean, message: string }`。
- 特点：自动降级私有成员、自动补齐跨文件依赖。

### `applyPatch(file: string, patchText: string, options: PatchOptions): Promise<PatchResult>`
执行补丁匹配。

    interface PatchOptions {
      fuzzy?: boolean;
      fuzzyThreshold?: number; // 默认 0.9
      fuzzyMinMargin?: number; // 默认 0.05
      autoHeal?: boolean;      // 自动修正上下文偏差
      force?: boolean;         // 忽略多候选并列警告
    }

### `chopFile(filePath: string, outDir: string)`
执行 CodeChopper。
- 返回值：`{ ok: boolean, message: string }`。
- 特点：自动提取枢纽变量、自动重构相对路径、自动生成入口引导器。

### `generateMap(dir: string): CodeMap`
生成全息大纲 JSON 对象。

### `analyzeImpact(dir: string, target: string): string`
返回格式化的人类可读影响报告。
