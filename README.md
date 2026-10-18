# @rtcn/tred

> **全栈代码语义感知引擎**：基于 AST / 向量 / WASM 极速定位，自带全语言语法门禁与外部状态追踪。

## 🚀 核心痛点解决

1. **正则替换太脆弱**：多一个空格、换行就崩溃。
2. **传统 AST 库太重**：学习成本极高，且不支持非代码文件。
3. **AI 生成代码不可靠**：少个括号直接白屏。

**`tred` 的答案：** 多轨制精准定位 + 全语言编译门禁 + C/WASM 极致模糊匹配 + 事务安全。

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

### 1. 像 Grep 一样扫描，但懂 AST
传统 `grep` 只能告诉你文本在哪，`tred grep --ast` 会直接告诉你这段代码属于哪个函数或类：
```bash
tred grep "getResource" --ast
```
输出示例：
```text
src/worker.ts:5: [in function: worker.onmessage] const data = getResource();
src/utils.ts:12: [in class: ResourceLoader] const res = getResource();
```

### 2. 模糊向量匹配
记不清确切的变量名？开启 `fuzzy: true`（CLI 传 `--fuzzy` 等价）。底层由 C/WASM 驱动，自动返回相似度最高的节点：
> ⚠️ **注意**：fuzzy 不设绝对阈值拒绝（>0 即命中），可能悄悄改错相邻函数。强烈建议在 AI 场景下配合 `--dry-run` 或 `--assert-include` 使用！
```bash
# 输入 "update status"，精准命中 const updateStatsPanel = () => {}
tred replace --file main.ts --selector '{"kind":"arrow-function","functionName":"update status","fuzzy":true}' --content-file new.ts
```

### 3. 上下文级精准手术
只在特定的代码块内部修改，绝不误伤同名的外部函数：
```bash
tred replace --file worker.ts \
  --selector '{"kind":"function","functionName":"fetchData","context":"worker.onmessage"}' \
  --content-file new-body.ts
```

## 🔥 进阶杀手锏

### 失败局部 Diff 与缓存
如果替换引发语法错误，tred 会直接打印出“原代码 vs 新代码”对比，并缓存到 `.tred/last-failure.json`，让你一眼定位。

### 隐形状态追踪 (`.tred/state.json`)
对于无法写注释的文件，tred 会自动记录模糊行号和 AST 特征。格式片段如下：
```json
{
  "version": 1,
  "tracked": {
    "package.json": {
      "auto-5": { "approxLine": 5, "astSignature": "{\"path\":\"version\"}", "fingerprint": "a1b2c3d4" }
    }
  }
}
```

### 声明式流水线 (`tred ops`)
自带 Schema 校验，字段错直接大白话报错：
```text
❌ op[0]: 必须提供 "content" 或 "contentFile"
❌ op[0]: 缺少 "file" 字段
```

## 📖 更多文档
完整的 CLI 命令（包含 `replace-many`、`verify`、`strip` 等）与 API 用法，请参阅 [api.md](./api.md)。

## 📄 License

MIT © chinartcn
