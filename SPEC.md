# tred 工程契约与规范 (v3.8.3)

## 一、 CST (Changes Long Text) 语法规范

### 1. 块与转义
- 长文本以 `content:` 开头，遇到换行且独占一行的 `/#end` 结束。
- **转义**：若代码中恰好包含 `/#end`，请在其前加反斜杠 `\/#end`，引擎会自动将其转换为普通文本。
- **Node.js 安全**：`/#nodejs` 块默认被禁用。若需执行，必须在 CLI 加 `--allow-nodejs`。

### 2. 完整指令字典

#### `replace`
```text
replace {
  file: src/a.ts
  selector: {"kind":"method","className":"A","methodName":"run"}
  content:
    // 代码
  /#end
}
```

#### `patch` (应用 Unified Diff)
```text
patch {
  file: src/a.ts
  fuzzy: true
  content:
    @@ -1,1 +1,1 @@
    -old
    +new
  /#end
}
```

#### `split` (自动拆分)
```text
split {
  file: src/giant.ts
  name: renderNode,update
  to: src/render.ts
  class: Engine
}
```

## 二、 AST Selector JSON Schema
所有选择器均支持 `occurrence?: number`（当有多个同名节点时，选择第 n 个，从 1 开始）。
```typescript
type Selector = 
  | { kind: "class", className: string, occurrence?: number }
  | { kind: "function", functionName: string, occurrence?: number }
  | { kind: "method", className: string, methodName: string, occurrence?: number }
  | { kind: "variable", variableName: string }
  | { kind: "property", path: string } // path 格式为 a.b.c
  | { kind: "file", scope: "head" | "tail" | "all", line?: number, snippet?: string }; // snippet 精确包含
```

## 三、 MCP Tool 完整 Schema

| 工具名 | Input Schema | Output Schema (成功) |
|---|---|---|
| `tred_map` | `{ dir: string }` | `{ files: Record<string, { lines: number, outline: any[] }> }` |
| `tred_split` | `{ file, name, to, className? }` | `{ ok: boolean, message: string }` |
| `tred_patch` | `{ file, diff, fuzzy?, autoHeal? }` | `{ ok: boolean, message?: string }` |
| `tred_replace`| `{ file, content, anchor?, selector? }` | `{ status: "replaced"|"skipped"|"failed", message?: string }` |
| `tred_impact` | `{ target: string, dir?: string }`| `{ text: string }` |

## 四、 事务与原子性边界
- **单文件写入**：任何 `replace`, `patch` 操作均采用 `tmp + rename`，绝对原子。
- **多文件事务**：`tred run` 脚本内的多个操作**不保证全局回滚**。若第 3 个操作失败，前 2 个已写盘的文件不会自动撤销。请配合 Git 使用。
- **语法门禁**：所有替换在写盘前均调用 `tsc` 进行纯语法解析。若失败，当前操作回滚，但**不会**抛出 TypeScript 类型错误。

## 五、 错误码与退出码（供 AI 解析）
退出码统一为 1。stderr 会以 `ERR_XXX:` 开头输出，`--json` 模式下输出 `{ error: "ERR_XXX", message: string }`。
- `ERR_UNEXPORTED_DEP`：同文件依赖未导出，需加入 `--name`。
- `ERR_AMBIGUOUS_MATCH`：多候选差距 < 5%，需用 `--force` 或 `--explain`。
- `ERR_SYNTAX_FAIL`：修改后代码破坏语法。
- `ERR_FILE_NOT_FOUND`：文件不存在。
- `ERR_SELECTOR_NOT_FOUND`：AST 未找到节点。
- `ERR_NODEJS_DISABLED`：检测到 `/#nodejs` 但未加 `--allow-nodejs`。