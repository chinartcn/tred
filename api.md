# tred API 与 CLI 参考手册

## 一、 CLI 完整语法

### 1. `tred replace` 单文件精准替换
```bash
tred replace --file <path> \
             (--anchor <name> | --selector <json> | --snippet-start <str>) \
             (--content <string> | --content-file <path> | --content-stdin) \
             [options]
```
**参数说明：**
- `locator`（三选一）：`--anchor` / `--selector` / `--snippet-start`
- `content`（三选一）：`--content` / `--content-file` / `--content-stdin`
- `options`：
  - `--fuzzy`：开启模糊匹配
  - `--fuzzy-threshold <n>`：设置模糊匹配最低阈值（0~1），低于此分数直接报错
  - `--occurrence <n>`：匹配第 n 个同名节点
  - `--cut-to-end`：从 start 直接切到文件末尾
  - `--assert-has-ast <k:n>`：断言必须包含某 AST 节点。`k:n` 表示 `kind:name`，例如 `method:run`
  - `--assert-include <str>` / `--assert-exclude <str>`：文本断言
  - `--dry-run`：只对比输出 diff，不写盘

> ⚠️ **关于 `fuzzy: true` 的双刃剑**：
> 如果不加 `--fuzzy-threshold`，算法会直接返回相似度最高（>0）的节点，可能命中错误目标。
> AI 改代码时，强烈建议配合 `--fuzzy-threshold 0.8` 和 `--dry-run` 使用。

### 2. `tred grep` 语义搜索
```bash
tred grep <pattern> [--dir <path>] [--ast] [--html]
```
- 默认行为与普通 `grep` 一致。
- `--ast`：在结果前标注 `[in class/function: name]`。
- `--html`：生成 `tred-grep-report.html`，用浏览器打开可查看漂亮的上下文卡片。

### 3. `tred ops` 声明式流水线
```bash
tred ops <ops.json> [--dry-run]
```
自带 Schema 校验，字段缺失时输出中文错误。

### 4. `tred patch` 原生差异合并
```bash
tred patch --file <path> <diff-file> [options]
```
如果未指定 `<diff-file>`，默认从标准输入 (stdin) 读取 unified diff 格式。

**匹配策略（优先级递减）：**
1. 全文件精确匹配
2. `@@ -X` 行号 ±50 行精确匹配
3. 行号 ±50 行忽略首尾空白匹配
4. `--fuzzy` 显式开启：Rare-Token × TF-IDF 加权模糊匹配

**高级参数：**
- `--fuzzy`：开启模糊匹配（默认关闭，安全第一）
- `--fuzzy-threshold <n>`：TF-IDF 加权相似度阈值，默认 0.9
- `--fuzzy-min-rare <n>`：最少稀有词要求，默认 2
- **`--auto-heal`**：当相似度极高（>阈值-0.15）但因为有细微改动未命中时，自动将补丁上下文替换为真实文件内容并应用。
- **`--html`**：当匹配失败时，生成 `tred-suggest.html` 可视化左右对比视图。

> ⚠️ 模糊匹配默认关闭。hunk 里稀有标识符不足时直接拒绝，避免误伤相似结构。

### 5. `tred impact` 依赖分析
```bash
tred impact <targetName> [--dir <path>]
```
分析目标符号被引用的次数与具体位置（包含所在的函数/类）。

### 6. `tred split` 自动拆分
```bash
# 提取顶层函数
tred split --file <path> --name <func1,func2> --to <new.ts>

# 提取类方法（自动处理 this 上下文）
tred split --file <path> --class <ClassName> --name <method1,method2> --to <new.ts>
```
- **顶层函数拆分**：自动移动函数定义，并维护原文件的 export。
- **类方法拆分**：将方法转为带 `this` 参数的独立函数，并自动追加 `Object.assign(ClassName.prototype, { ... })` 混入，零破坏原对象架构。
- 自动执行 Dedent 与空行清理。

### 7. 其他高频命令简表

### 7. 其他高频命令简表
| 命令 | 说明 |
|---|---|
| `tred replace-many --ops-file <json>` | 仅做批量事务替换（失败全回滚），不支持混合指令。 |
| `tred ops <ops.json>` | 声明式流水线。支持 `annotate`/`replace`/`verify` 等指令混合编排。 |
| `tred verify [--dir <path>]` | 检查锚点健康度与 `.tred/state.json` 外部追踪。 |
| `tred diff (--anchor <name> | --dir <a> --against-dir <b>)` | 锚点级或目录级代码对比（二选一）。 |
| `tred ast --file <path>` | 输出任意文件的 AST 树状大纲。 |
| `tred annotate [--dir <path>]` | 自动为文件注入锚点注释。 |
| `tred strip [--dir <path>]` | 剥离内部锚点（用于 npm 发布前清理）。 |
| `tred commit -m <msg>` | 自动跑 verify 检查并安全提交 Git。 |

## 二、 库 API (TypeScript)

### 1. `replace()` 代码替换
```typescript
import { replace, ReplaceResult } from '@rtcn/tred';

const result: ReplaceResult = await replace({
  file: 'src/main.ts',
  selector: {
    kind: 'function',
    functionName: 'main',
    fuzzy: true,
    fuzzyThreshold: 0.8,
    context: ['class:Worker', 'method:onmessage']
  },
  content: 'function main() {}',
  dryRun: false
});
```
**`ReplaceResult` 返回结构：**
- `status`: `"replaced"` | `"skipped"` | `"failed"`
- `message?`: 跳过或失败的具体原因。
- `diff?`: `dryRun: true` 时返回完整 diff；正常写盘时，仅返回被替换段前后各 3 行的局部 diff。
- `failureContext?`: 失败时的局部对比，含 `oldCode` 和 `newCode`。
- `syntaxErrors?`: 失败时的具体语法报错信息。

**`AstSelector` 高级参数：**
- `context?: string | string[]`：支持多级上下文锁定（如 `["class:Worker", "method:onmessage"]`）。
- `fuzzyThreshold?: number`：模糊匹配的最低相似度阈值（0~1）。

### 2. `verifyDir()` 全局验证
```typescript
import { verifyDir, VerifyReport } from '@rtcn/tred';

// 注意：verifyDir 是同步函数，且不执行语法校验！
const report: VerifyReport = verifyDir({ dir: 'src' });
```

### 3. `buildOutline()` 语法树大纲
```typescript
import { buildOutline, OutlineNode } from '@rtcn/tred';

const outline: OutlineNode[] = buildOutline('src/main.ts', sourceCode);
```
