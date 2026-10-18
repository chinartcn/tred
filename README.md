# @rtcn/tred

> 终极代码与文本重构引擎：**六大语言支持**，自带 **AST 定位**、**语法门禁**与**状态追踪**。

## 为什么是 tred？

传统的正则替换遇到复杂嵌套就会崩溃，而重度依赖 AST 重构又面临陡峭的学习曲线。
tred 提出了 **“锚点 + AST + 模糊状态”** 的三轨制解析方案：

1. **多语言解析**：原生支持 TS / JS / JSON / Markdown / HTML / CSS。
2. **零妥协安全**：替换前必须通过原生编译器的**语法校验**（如 `tsc` 检查 JS，`postcss` 检查 CSS），写坏代码绝不允许落盘。
3. **声明式流水线**：用 `tred ops` 组合任意操作，像流水线一样重构代码。

## 快速开始

```bash
npm i -D @rtcn/tred
```

### 1. 万物皆可定位

无论你改什么文件，只要给它一个“选择器”：

```bash
# 改 TS/JS：用 AST
tred replace --file a.ts --selector '{"kind":"method","className":"Engine","methodName":"run"}' --content-file new.ts

# 改 JSON：用对象路径
tred replace --file package.json --selector '{"path":"version"}' --content '"2.0.0"'

# 改 CSS：用 CSS 选择器
tred replace --file style.css --selector '{"selector":".btn"}' --content-file btn.css

# 改 Markdown：定位代码块或标题
tred replace --file README.md --selector '{"codeLang":"js"}' --content-file demo.js
```

### 2. 声明式编排 (`ops.json`)

告别凌乱的脚本，用 JSON 定义整条重构流水线：

```json
{
  "ops": [
    { "type": "annotate", "dir": "src", "apply": true },
    {
      "type": "replace",
      "file": "src/engine.ts",
      "anchor": "Engine#run",
      "content": "run() { /* new logic */ }",
      "assertions": { "hasAst": ["method:run"] }
    },
    { "type": "verify", "dir": "src", "strict": true }
  ]
}
```

一键执行：`tred ops ops.json`

### 3. 隐形状态追踪 (`.tred/state.json`)

如果文件不允许写注释（如 JSON、MD、HTML），tred 会自动生成 `.tred/state.json` 记录**模糊行号与 AST 特征**。下次替换时，即使文件被外部工具篡改了行数，tred 也能通过 AST 特征瞬间找回目标。

### 4. 极速安全闭环 (`tred commit`)

```bash
tred commit -m "feat: refactored ui"
```
自动执行 `verify` 拦截错误，并帮你完成 `git add` 和 `git commit`，坏代码连提交的机会都没有。

## 🛠️ 进阶与救急操作

### 1. 残骸文件抢救 (`--cut-to-end`)
当文件末尾被意外截断或语法崩溃，AST 无法解析时，可以直接从某个注释切到文件末尾：

```bash
tred replace --file broken.ts --snippet-start "// ===== ENTRY =====" --cut-to-end --content-file new-tail.ts
```

### 2. 文件级暴力覆盖 (`kind: "file"`)
如果连注释都没有，直接用行号或全文覆盖：

```bash
# 覆盖整个文件
tred replace --file main.ts --selector '{"kind":"file","scope":"all"}' --content-file new-main.ts

# 从第 50 行删到文件末尾
tred replace --file main.ts --selector '{"kind":"file","scope":"tail","line":50}' --content ''
```

### 3. ops.json 的友好校验
现在的 `tred ops` 支持 `contentFile` 和 `selector`，字段缺失时会输出大白话错误：

```
❌ op[0]: 必须提供 "content" 或 "contentFile"
❌ op[0]: 缺少 "file" 字段
```

## 完整命令矩阵

| 命令 | 描述 |
|---|---|
| `tred replace` | 单文件精准替换（支持锚点 / Snippet / 多语言 AST） |
| `tred ops` | 声明式执行 JSON 脚本流水线 |
| `tred commit` | 自动验证 + 安全提交 |
| `tred verify` | 检查锚点健康度、孤儿、重复与多语言状态 |
| `tred annotate` | 自动给 TS/JS 代码加锚点注释 |
| `tred serve` | 生成 HTML 报告并在本地预览 |

## License

MIT © chinartcn