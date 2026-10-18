# @rtcn/tred

> **全栈代码语义感知引擎**：基于 AST / Snippet / 向量 / WASM 极速定位，自带全语言语法门禁与外部状态追踪。

## 🚀 核心痛点解决

1. **正则替换太脆弱**：多一个空格、多一个换行就崩溃。
2. **纯 AST 库太重**：`jscodeshift` 学习成本极高，不支持非代码文件（JSON/MD/HTML）。
3. **AI 辅助改代码不可靠**：AI 生成的内容如果少个括号，直接导致整个项目白屏。

**`tred` 的答案：** 多轨制精准定位 + 全语言编译门禁 + C/WASM 极致模糊匹配 + 事务安全。

## 📦 安装

```bash
npm i -D @rtcn/tred
```
要求 Node.js >= 20。

## ⚡ 快速开始

### 1. 像 Grep 一样扫描，但懂 AST
传统 `grep` 只能告诉你文本在哪，`tred grep --ast` 会直接告诉你这段代码属于哪个函数或类：
```bash
tred grep "getResource" --ast
# 输出: worker.ts:5: [in function: worker.onmessage] const data = getResource();
```

### 2. 模糊向量匹配 (AI 时代的神器)
记不清具体的变量名？开启 `fuzzy: true`，底层由 C/WASM 和零分配算法驱动：
```bash
# 输入 "update status"，精准命中 const updateStatsPanel = () => {}
tred replace --file main.ts --selector '{"kind":"arrow-function","functionName":"update status","fuzzy":true}' --content-file new.js
```

### 3. 上下文级精准手术
只在特定的代码块内部修改，绝不误伤同名的外部函数：
```bash
tred replace --file worker.ts \
  --selector '{"kind":"function","functionName":"fetchData","context":"worker.onmessage"}' \
  --content-file new-body.ts
```

## 🛡️ 六大语言全量支持

| 语言 | 定位方式 | 语法门禁 |
|---|---|---|
| **TS / JS** | AST（Class / Method / Arrow / Property 嵌套） | 走 `tsc` 强校验 |
| **JSON** | 嵌套路径（如 `$.scripts.test`） | 走 `JSON.parse` |
| **CSS** | 选择器（如 `.btn`） | 走 `postcss` |
| **HTML** | CSS Selector（如 `#title`） | 走 DOM 解析 |
| **Markdown** | 标题层级 / 代码块语言 | 容错极高 |

## 🔥 进阶杀手锏

### 声明式流水线 (`tred ops`)
把一连串重构写成 JSON 脚本，一步到位（自带 Schema 校验，字段错直接大白话报错）：
```json
{
  "ops": [
    { "type": "annotate", "dir": "src", "apply": true },
    { "type": "replace", "file": "src/a.ts", "anchor": "A#run", "content": "run() {}" },
    { "type": "verify", "dir": "src" }
  ]
}
```

### 失败局部 Diff 与缓存
如果替换引发语法错误或断言失败，tred 会直接打印出“原代码 vs 新代码”对比，并缓存到 `.tred/last-failure.json`，让你一眼定位问题。

### 隐形状态追踪 (`.tred/state.json`)
对于无法写注释的文件（如 JSON、MD），tred 会自动记录模糊行号和 AST 特征。下次替换时，即使行数变了，也能精准找回。

## 📖 完整命令矩阵

| 命令 | 描述 |
|---|---|
| `tred replace` | 单文件精准替换（锚点 / 多语言 AST / Snippet） |
| `tred replace-many`| 批量事务替换（支持并发，失败回滚） |
| `tred grep` | 全局扫描，支持 `--ast` 输出代码上下文 |
| `tred ops` | 声明式执行 ops.json 流水线 |
| `tred verify` | 检查锚点健康度与外部状态 |
| `tred ast` | 查看任意文件的 AST 大纲 |
| `tred annotate` | 自动给代码加锚点 |
| `tred diff` | 极速锚点级 / 目录级对比 |
| `tred strip` | 剥离源码内部锚点（用于 npm 发布前清理） |
| `tred commit` | 自动验证 + 安全提交 Git |

## 📄 License

MIT © chinartcn
