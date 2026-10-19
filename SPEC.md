# tred 工程契约与规范 (v3.8.5)

## 一、 CST (Changes Long Text) 语法规范

### 1. 块与转义
- 长文本以 `content:` 开头，遇到**未经转义**且**独占一行**的 `/#end` 结束。
- **转义规则**：若代码中恰好包含 `/#end` 字符串，请转义为 `\/#end`。引擎会自动将其还原为普通文本。
  - 若代码本身就需要字面量 `\/#end`，请写 `\\/#end`。
  - **去缩进（Dedent）**：块解析完毕后，引擎会去除 `content` 内容的第一行非空缩进。转义处理在解析时发生，因此不受缩进影响。
- **Node.js 安全**：`/#nodejs` 块默认被禁用。若需执行，必须加 `--allow-nodejs`，或在 `.tred/config.json` 中开启。
- **执行边界**：若脚本包含 `/#nodejs` 但未开启权限，引擎会直接**整体拒绝**（Fail-fast），不会执行前面的任何指令。

### 2. 完整指令字典
#### `replace` / `patch` / `split`
（语法同前略）

## 二、 AST Selector JSON Schema
所有选择器均支持 `occurrence?: number`（当有多个同名节点时，按 AST 遍历顺序选择第 n 个，从 1 开始）。
```typescript
type Selector = 
  | { kind: "class", className: string, occurrence?: number }
  | { kind: "function", functionName: string, occurrence?: number }
  | { kind: "method", className: string, methodName: string, occurrence?: number }
  | { kind: "variable", variableName: string, occurrence?: number }
  | { kind: "property", path: string, occurrence?: number } // path 格式为 a.b.c
  | { kind: "file", scope: "head" | "tail" | "all", line?: number, snippet?: string }; 
```
- **file.line**：从 1 开始（1-based）。
- **file.snippet**：多行时逐行进行精确包含匹配。
- **file.scope**：`head` 或 `tail` 不指定行数时，从文件第一/最后一行起算。

## 三、 MCP Tool 完整 Schema

| 工具名 | Input Schema | Output Schema |
|---|---|---|
| `tred_run_cst` | `{ file: string, allowNodejs?: boolean }` | `{ ok: boolean, output?: string, error?: string }` |
| `tred_map` | `{ dir: string }` | `{ files: Record<string, { lines: number, outline: any[] }> }` |
| `tred_grep` | `{ pattern: string, dir?: string, ast?: boolean }` | `{ text: string }` |
| `tred_split` | `{ file, name, to, className? }` | `{ ok: boolean, message: string }` |
| `tred_patch` | `{ file, diff, fuzzy?, autoHeal? }` | `{ ok: boolean, message?: string }` |
| `tred_replace`| `{ file, content, anchor?, selector? }` | `{ status: "replaced"\|"skipped"\|"failed", message?: string }` |
| `tred_impact` | `{ target: string, dir?: string }`| `{ text: string }` |

- **allowNodejs 读取时机**：MCP Server 会在每次调用 `tred_run_cst` 时，实时读取当前工作目录的 `.tred/config.json`。
- **config 与 CLI 优先级**：若同时存在 `--allow-nodejs` 与 `config.allowNodejs: false`，以 CLI 参数为准（true）。

## 四、 事务与原子性边界
- **单文件写入**：均为 `tmp + rename`，绝对原子。
- **多文件事务**：`tred run` 内的多个操作**不保证全局回滚**。
- **语法门禁**：若语法校验失败，当前指令回滚。

## 五、 错误码与退出码
- `ERR_UNEXPORTED_DEP`：同文件依赖未导出。
- `ERR_AMBIGUOUS_MATCH`：多候选并列。
- `ERR_SYNTAX_FAIL`：语法破坏。
- `ERR_NODEJS_DISABLED`：检测到 `/#nodejs` 但未授权。

## 六、 .tred/config.json 配置文件
```json
{
  "allowNodejs": false,        // 是否允许 .cst 执行原生 Node 代码
  "fuzzyThreshold": 0.9,       // 默认模糊匹配阈值
  "fuzzyMinMargin": 0.05,      // 多候选仲裁的最小分差
  "exclude": ["**/*.test.ts"]  // 忽略的文件 (使用 minimatch 语法)
}
```