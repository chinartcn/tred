# tred 工程契约与规范 (v4.0.0)

本文件定义了 `tred` 解析和执行的底层标准，供高级集成和自定义脚本调用参考。

## 一、 CST 宏脚本规范

### 1. 块与转义
- 长文本以 `content:` 开头，遇到**独占一行**的 `/#end` 结束。
- 转义规则：
  - 若你的代码里有一整行是 `/#end`，请写成 `\/#end`。
  - 若需字面量 `\/#end`，请写成 `\\/#end`。
- 缩进处理：解析器在提取 `content:` 的内容后，会自动计算公共前导缩进（Dedent），因此无需担心在 `.cst` 文件中包裹代码时的排版缩进。

### 2. 指令字典
- `replace {}`：AST 替换。
  - `file` (string, 必填)：目标文件路径。
  - `selector` (string, 必填)：AST Selector 的 JSON 字符串。
  - `content` (block, 必填)：替换后的长文本代码。
- `patch {}`：应用 Diff。
  - `file` (string, 必填)：目标文件路径。
  - `fuzzy` (boolean, 可选)：开启模糊匹配。
  - `content` (block, 必填)：放入标准的 unified diff 文本。
- `split {}`：方法定向拆分。
  - `file` (string, 必填)：源文件。
  - `name` (string, 必填)：逗号分隔的方法名。
  - `to` (string, 必填)：新文件路径。
  - `class` (string, 可选)：指定类名。

### 3. Node.js 沙箱安全
`/#nodejs` 块默认被禁用。若引擎检测到该块但未获得授权，将直接触发 **Fail-fast（整体拒绝执行）**，连前面的 `replace` 也不会生效。
- 授权方式 1：CLI 参数 `--allow-nodejs`。
- 授权方式 2：`.tred/config.json` 中配置 `{"allowNodejs": true}`。

---

## 二、 AST Selector JSON Schema

所有选择器均支持 `occurrence?: number`（整数，从 1 开始），用于在同名节点中选择第 N 个（按 AST 遍历顺序）。

    type Selector = 
      | { kind: "class", className: string }
      | { kind: "function", functionName: string }
      | { kind: "method", className: string, methodName: string }
      | { kind: "variable", variableName: string }
      | { kind: "property", path: string }
      | { kind: "file", scope: "head" | "tail" | "all", line?: number, snippet?: string };

- **property**：`path` 格式为 `a.b.c`（无前导 `$`）。
- **file**：`line` 为 1-based（从 1 开始）。`snippet` 用于文本包含匹配。

---

## 三、 MCP 工具 Schema

| 工具名 | Input Schema | Output Schema |
|---|---|---|
| `tred_run_cst` | `{ file: string, allowNodejs?: boolean }` | `{ text: string }` (若 isError 为 true 则为错误文本) |
| `tred_split` | `{ file, name, to, className? }` | `{ ok: boolean, message: string }` |
| `tred_patch` | `{ file, diff, fuzzy?, autoHeal? }` | `{ ok: boolean, message: string }` |
| `tred_map` | `{ dir: string }` | `{ files: Record<string, any> }` |
| `tred_grep` | `{ pattern, dir?, ast? }` | `{ text: string }` |

---

## 四、 错误码与退出码

CLI 统一在出错时返回 Exit Code `1`。若使用 `--json`，引擎会输出如下结构化错误对象：

    {
      "status": "error",
      "error": "ERR_XXX",
      "message": "人类可读的报错信息"
    }

- `ERR_UNEXPORTED_DEP`：拆分时依赖了同文件未导出的顶层标识符。请将依赖一起加入 `--name`。
- `ERR_AMBIGUOUS_MATCH`：多候选并列，差距 < `fuzzyMinMargin`。可使用 `--force` 或 `occurrence`。
- `ERR_SYNTAX_FAIL`：修改后代码语法校验破坏。
- `ERR_NODEJS_DISABLED`：检测到 `/#nodejs` 但未授权。
- `ERR_FILE_NOT_FOUND`：路径不存在。
- `ERR_SELECTOR_NOT_FOUND`：AST 定位不到节点。

---

## 五、 配置文件 `.tred/config.json`

    {
      "allowNodejs": false,        
      "fuzzyThreshold": 0.9,       
      "fuzzyMinMargin": 0.05,      
      "exclude": ["**/*.test.ts"]  
    }

- **allowNodejs**：是否永久允许 `.cst` 执行 Node 代码。
- **fuzzyThreshold**：模糊匹配的最低阈值（0~1）。
- **fuzzyMinMargin**：多候选仲裁的最小分差，`0.05` 表示如果 top1 和 top2 差距不到 5%，直接拒绝。
- **exclude**：忽略的文件列表，使用 minimatch 语法（如 `**/*.test.ts`）。


## 六、 全局配置文件 (.tred/config.json)

`tred` 会自动读取项目根目录下的 `.tred/config.json`，你可以通过它全局控制引擎的行为：

```json
{
  "allowNodejs": false,
  "fuzzyThreshold": 0.9,
  "fuzzyMinMargin": 0.05,
  "minRareTokens": 2,
  "exclude": ["**/*.test.ts", "dist/**"],
  "snapshot": {
    "enabled": true,
    "maxKeep": 20
  },
  "chop": {
    "maxDepth": 8,
    "autoExport": true
  },
  "patch": {
    "autoHeal": false,
    "htmlOnFail": false
  }
}
```

### 配置项详解：

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `allowNodejs` | boolean | `false` | 是否允许 `.cst` 脚本执行 `/#nodejs` 代码块（防 RCE 注入）。 |
| `fuzzyThreshold` | number | `0.9` | 补丁模糊匹配的最低阈值。 |
| `fuzzyMinMargin` | number | `0.05` | 多候选仲裁的分差阈值，低于此值拒绝应用防误伤。 |
| `minRareTokens` | number | `2` | 模糊匹配要求的最少稀有标识符数量。 |
| `exclude` | string[] | `[]` | 全局忽略扫描的文件（支持 glob 语法）。 |
| `snapshot.enabled` | boolean | `true` | 是否开启 `v4.4.0` 的事务快照。 |
| `snapshot.maxKeep` | number | `20` | 最多保留多少个历史快照（超出后自动清理最旧的）。 |
| `chop.maxDepth` | number | `8` | CodeChopper 图聚类时的最大递归深度。 |
| `patch.autoHeal` | boolean | `false` | 是否默认在补丁失败时启用 `--auto-heal`。 |
| `patch.htmlOnFail`| boolean | `false` | 是否默认在补丁失败时生成可视化 HTML 冲突报告。 |

### 优先级
命令行参数 > 配置文件 > 内置默认值。
