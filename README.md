# @rtcn/tred

> Anchor + AST precise find-and-replace with syntax validation, atomic writes, and idempotent fingerprints.

## 为什么需要 tred？

传统的正则替换遇到代码缩进、嵌套括号、同名变量就会直接崩溃；纯 AST 方案（如 jscodeshift）依赖重、学习成本高。

tred 提供了一套**“锚点 + AST + Snippet”三轨制**的代码替换引擎。它天生带安全护栏：**语法编译门禁、智能断言、原子写入**。不仅能改代码，还能像流水线一样跑 `ops.json` 声明式任务。

## 安装

```bash
npm i -D @rtcn/tred
```
要求 Node.js >= 20。

## 快速开始

```bash
# 1. 看代码结构（生成可直接用于 replace 的 selector）
tred ast --file src/main.ts

# 2. 自动给代码加锚点（注释块）
tred annotate --dir src --all --apply

# 3. 基于锚点精准替换
tred replace --file src/main.ts \
  --anchor "GraphEngine#loadUnlocked" \
  --content-file new-body.ts \
  --fp-source migrator --fp-version 1
```

## 声明式引擎：`tred ops`

用 JSON 定义一连串修改动作，一步到位。**遇到错误自动中止**，并把所有改动作为一个“事务”处理。

```json
{
  "ops": [
    { "type": "annotate", "dir": "src", "apply": true },
    {
      "type": "replace",
      "file": "src/engine.ts",
      "selector": { "kind": "method", "className": "Engine", "methodName": "run", "occurrence": 2 },
      "content": "run() { /* new logic */ }"
    },
    { "type": "verify", "dir": "src", "strict": true }
  ]
}
```

运行：`tred ops ops.json --dry-run` 或 `tred ops ops.json`。

## 核心定位器

1. **锚点匹配**（推荐）：基于 `// @TRED_START: Name` 注释。
2. **Snippet 片段**：无需加注释，直接用行号或起止字符串定位。
   ```bash
   tred replace --file a.ts --snippet-start "function foo()" --snippet-end "return true;" --content-file new.ts
   ```
3. **AST 选择器**：精准到节点，支持处理同名冲突。
   ```bash
   # 替换第 2 个 run 方法
   tred replace --file a.ts --selector '{"kind":"method","className":"Engine","methodName":"run","occurrence":2}' --content "run() {}"
   ```

## 安全护栏（智能断言）

替换前，强制要求新内容满足特定条件，否则拒绝写入：

- `--fuzzy`：模糊匹配锚点名（忽略大小写、允许冒号带空格）。
- `--assert-include <str>` / `--assert-exclude <str>`：内容必须/禁止包含某字符串。
- `--assert-regex <re>`：内容必须匹配某正则。
- `--assert-has-ast <k:n>` / `--assert-no-ast <k:n>`：**强力 AST 断言**。如 `--assert-has-ast "method:run"` 确保替换后代码里依然有 `run` 方法。

## 完整命令表

| 命令 | 描述 |
|---|---|
| `tred replace` | 单文件精准替换（支持锚点 / Snippet / AST） |
| `tred replace-many` | 批量事务替换（失败回滚） |
| `tred ops` | 声明式执行 JSON 脚本 |
| `tred ast` | 查看 AST 大纲 |
| `tred annotate` | 自动加锚点（单文件 / 目录） |
| `tred verify` | 检查锚点孤儿 / 重复 / 指纹不一致 |
| `tred verify --fix` | 修复孤儿 END |
| `tred diff` | 锚点级 / 目录级代码对比 |
| `tred serve` | 起 HTTP 服务查看 HTML 报告 |
| `tred watch` | 监听变化自动 verify |
| `tred check` | 组合验证（CI / pre-commit） |
| `tred init` | 生成配置和 git hook |
| `tred doctor` | 环境与依赖诊断 |

## CI / 自动化

```bash
# GitHub PR 原生注释（红叉显示在 diff 上）
tred verify --dir src --format github-annotations

# 生成 SARIF 报告（上传到 Code Scanning）
tred verify --dir src --format sarif > tred.sarif

# 只检查 git 改动过的文件（极速）
tred verify --dir src --since origin/main --strict
```

## License

MIT © chinartcn
