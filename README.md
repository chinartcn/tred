# @rtcn/tred

> **全栈代码语义感知引擎**：基于 AST / 向量 / WASM 极速定位，自带全语言语法门禁与外部状态追踪。

## 🚀 核心痛点解决

1. **正则替换太脆弱**：多一个空格、换行就崩溃。
2. **传统 AST 库太重**：学习成本极高，且不支持非代码文件。
3. **AI 生成代码不可靠**：少个括号直接白屏，改错同名函数防不胜防。

**`tred` 的答案：** 多轨制精准定位 + 多级 Context 锁定 + 全语言编译门禁 + C/WASM 极致模糊匹配。

## 📦 安装

```bash
npm i -D @rtcn/tred
```
要求 Node.js >= 20。

## 🛡️ 五大主流语言全覆盖

| 语言 | 定位方式 | 语法门禁 |
|---|---|---|
| **TS / JS** | AST（Class / Method / Arrow / Property 嵌套） | 走 `tsc` 强校验 |
| **JSON** | 嵌套路径（如 `$.scripts.test`） | 走 `JSON.parse` |
| **CSS** | 选择器（如 `.btn`） | 走 `postcss` |
| **HTML** | CSS Selector（如 `#title`） | 走 DOM 解析 |
| **Markdown** | 标题层级 / 代码块语言 | 容错极高 |

## ⚡ 快速开始

### 1. 像 Grep 一样扫描，但懂 AST（支持 HTML 可视化）
传统 `grep` 只能告诉你文本在哪，`tred grep` 会直接告诉你这段代码属于哪个函数或类：
```bash
tred grep "getResource" --ast --html
```
加上 `--html` 会生成一份 `tred-grep-report.html`，用浏览器打开即可看到带上下文的卡片式搜索结果。

### 2. 多级 Context 空间锁定
只在特定的代码块内部修改，支持数组级深度锁定：
```bash
tred replace --file worker.ts \
  --selector '{"kind":"function","functionName":"fetchData","context":["class:Worker","method:onmessage"]}' \
  --content-file new-body.ts
```

### 3. 模糊向量匹配（自带安全阈值）
记不清确切的变量名？开启 `fuzzy`。为了防误伤，还可以设置 `--fuzzy-threshold` 强制要求相似度：
```bash
# 如果 "update status" 与目标的相似度低于 0.8，直接报错拒绝替换
tred replace --file main.ts \
  --selector '{"kind":"arrow-function","functionName":"update status","fuzzy":true,"fuzzyThreshold":0.8}' \
  --content-file new.ts
```

## 🔥 进阶杀手锏

### 失败局部 Diff 与缓存
如果替换引发语法错误，tred 会直接打印出“原代码 vs 新代码”对比，并缓存到 `.tred/last-failure.json`，让你一眼定位。

### 隐形状态追踪 (`.tred/state.json`)
对于无法写注释的文件，tred 会自动记录模糊行号和 AST 特征。下次替换时，即便行号偏移也能精准找回。

### 声明式流水线 (`tred ops`)
自带 Schema 校验，字段错直接大白话报错。

## 🤖 AI 原生工作流 (v3.2.0)

如果你在使用 Cursor、Claude 或其它 AI 编程助手，请让 AI 阅读根目录的 **`skill.md`**。

1. **全局感知**：`tred map` 让 AI 免于读取整个源码文件，瞬间掌握项目架构。
2. **微创修改**：使用 `tred patch`，AI 只需生成极小的 `+` 和 `-` 行，大幅减少出错率和 Token 消耗。
3. **零误伤**：底层自带语法门禁，哪怕 AI 补丁写错，也绝不破坏原有代码。

## 📖 更多文档
完整的 CLI 命令（包含 `replace-many`、`verify`、`strip` 等）与 API 用法，请参阅 [api.md](./api.md)。

## 📄 License

MIT © chinartcn
