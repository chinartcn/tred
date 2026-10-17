# tred

> Anchor + AST precise find-and-replace with syntax validation, atomic writes, and idempotent fingerprints.

## 为什么

批量重构/迁移代码时，字符串替换脆弱（空格、缩进、注释），AST 替换过重（依赖大、难维护）。tred 用 **注释锚点 + AST 兜底** 的组合：

- **简单**：正则找 `// @TRED_START: X` / `// @TRED_END: X`
- **精准**：无锚点时用 TypeScript AST 定位（class / method / function）
- **安全**：语法检查 + 原子写 + 指纹幂等 + 事务回滚

## 安装

```bash
npm i -D tred
```

要求 Node.js >= 20。

## 快速开始

```bash
# 1. 环境诊断
tred doctor

# 2. 看代码结构（含 selector，可直接喂给 replace）
tred ast --file src/main.ts

# 3. 自动给 class / method / function 加锚点（幂等）
tred annotate --dir src --all --apply

# 4. 验证锚点健康度
tred verify --dir src --strict

# 5. 精准替换锚点内容
tred replace --file src/main.ts \
  --anchor GraphEngine#loadUnlocked \
  --content-file new-body.ts \
  --fp-source migrator --fp-version 1
```

## 完整命令

| 命令 | 描述 |
|---|---|
| `tred replace` | 单文件锚点替换（AST 兜底） |
| `tred replace-many` | 批量事务替换（成功全提交 / 失败回滚） |
| `tred ast` | 查看文件 AST 大纲 |
| `tred annotate` | 自动加锚点（支持 `--dir` 目录批量） |
| `tred verify` | 检查锚点配对 / 孤儿 / 跨文件重复 / 指纹 |
| `tred verify --fix` | 修复孤儿 END（保守策略） |
| `tred diff` | 锚点级 / 目录级 / 历史版本对比 |
| `tred serve` | 起 HTTP 服务，浏览器打开 HTML 报告 |
| `tred watch` | 监听文件变化自动重跑 verify |
| `tred check` | 常用组合（verify --strict 或 --pre-commit） |
| `tred init` | 生成 .tred/config.json + pre-commit hook |
| `tred doctor` | 诊断环境（git / cache / 锚点 / 依赖） |

## 典型工作流

### 首次接入项目

```bash
tred init --with-hook
tred verify --dir src --save-baseline .tred-baseline.json
```

之后 git commit 会自动跑 `tred check --pre-commit`，只挡新增问题，历史债不阻塞。

### 日常开发

```bash
tred watch --dir src              # 一边改代码，一边验证
tred serve --dir src --watch      # 浏览器里热刷新报告
```

### CI 集成

```bash
# GitHub PR 原生注释（红叉显示在 diff 上）
tred verify --dir src --format github-annotations

# SARIF（Security 面板显示）
tred verify --dir src --format sarif > tred.sarif

# PR 注释（Markdown）
tred verify --dir src --format markdown > pr-comment.md
```

## 库 API

```ts
import { replace, replaceMany, makeFingerprint } from 'tred';

// 单文件替换
const r = await replace({
  file: 'src/main.ts',
  anchor: 'GraphEngine#loadUnlocked',
  content: newBodyCode,
  fingerprint: makeFingerprint({
    anchor: 'GraphEngine#loadUnlocked',
    source: 'my-migrator',
    version: '1',
  }),
  autoInjectAnchor: true,
  astSelector: { kind: 'method', className: 'GraphEngine', methodName: 'loadUnlocked' },
});
// r.status: 'replaced' | 'injected' | 'skipped' | 'failed'
```

## 核心概念

**锚点**：`// @TRED_START: <name> | fp=<hash>` 和 `// @TRED_END: <name>` 之间的代码块。

**指纹（fp）**：基于"意图"而非"内容"的 8 位哈希（`makeFingerprint({anchor, source, version})`）。指纹相同则跳过替换——幂等的核心。

**安全网**：
- 语法门禁：`tsc.parseDiagnostics` 有错则拒写
- 原子写：tmp + rename
- 事务：`replace-many` 全成功或全回滚

## 常见问题

**Q: 和 ts-morph / jscodeshift 有什么区别？**

A: 它们对 API 做了大量封装，学习曲线陡。tred 用"注释锚点"这个最简单的定位方式，遇到边界时才回落到 AST。代价是需要先跑 `annotate` 一次。

**Q: 锚点会污染代码吗？**

A: 就是两行注释。如果你不喜欢，用完 `tred verify --fix` 清理（只删孤儿）或者手动删。

**Q: 支持 JS / JSX 吗？**

A: 支持 `.ts` / `.tsx` / `.js` / `.jsx` / `.mjs` / `.cjs`。

**Q: 性能如何？**

A: 1000 文件 monorepo 首次 verify 约 1s，开 `--cache` 后增量约 50ms。

## License

MIT © chinartcn
