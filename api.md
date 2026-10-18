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
  - `--fuzzy`：开启模糊匹配（⚠️ 见下方警告）
  - `--occurrence <n>`：匹配第 n 个同名节点
  - `--cut-to-end`：从 start 直接切到文件末尾
  - `--assert-has-ast <k:n>`：断言必须包含某 AST 节点。`k:n` 表示 `kind:name`，例如 `method:run`
  - `--assert-include <str>` / `--assert-exclude <str>`：文本断言
  - `--dry-run`：只对比输出 diff，不写盘

> ⚠️ **关于 `fuzzy: true` 的双刃剑**：
> 目前算法会直接返回相似度最高（Dice 系数 > 0）的节点，**不设绝对阈值拒绝**。
> 这意味着只要有任何共同字符，它就会命中某个函数（有悄悄改错相邻函数的风险）。
> AI 改代码或不确定时，强烈建议配合 `--dry-run` 或 `--assert-include` 先确认目标！

### 2. `tred grep` 语义搜索
```bash
tred grep <pattern> [--dir <path>] [--ast]
```
为了兼容传统 `grep` / `ripgrep` 的使用习惯，`pattern` 直接作为第一个位置参数传入。加上 `--ast` 会在结果前标注 `[in class/function: name]`。

### 3. `tred ops` 声明式流水线
```bash
tred ops <ops.json> [--dry-run]
```
自带 Schema 校验，字段缺失时输出中文错误。

### 4. 其他高频命令简表
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
  selector: { kind: 'function', functionName: 'main', fuzzy: true, context: 'worker' },
  content: 'function main() {}',
  dryRun: false
});
```
**`ReplaceResult` 返回结构：**
- `status`: `"replaced"` | `"skipped"` | `"failed"`
- `message?`: 跳过或失败的具体原因（如 "指纹一致，跳过" 或 "智能断言失败"）
- `diff?`: **重点说明**：
  - 当 `dryRun: true` 时，返回**完整文件**的 unified diff，供你审核。
  - 当 `dryRun: false` 且替换成功时，返回**被替换段前后各 3 行**的局部 diff（大文件场景），避免内存溢出或输出过载。
- `failureContext?`: 失败时的局部对比，含 `oldCode` 和 `newCode`
- `syntaxErrors?`: 失败时的具体语法报错信息（如 TS1109）

### 2. `verifyDir()` 全局验证
```typescript
import { verifyDir, VerifyReport } from '@rtcn/tred';

// 注意：verifyDir 是同步函数，且不执行语法校验！
const report: VerifyReport = verifyDir({ dir: 'src' });
```
**行为说明：**
- `verifyDir` 只检查**锚点健康度**（孤儿、重复）和 `.tred/state.json` 的外部追踪状态。
- 真正的 `tsc` / `postcss` 语法校验，仅在 `replace` 即将写盘前发生。

### 3. `buildOutline()` 语法树大纲
```typescript
import { buildOutline, OutlineNode } from '@rtcn/tred';

const outline: OutlineNode[] = buildOutline('src/main.ts', sourceCode);
```
