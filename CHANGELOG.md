## [2.5.0] - 2026-10-18
### Added
- **文件级切分（File Selector）**：新增 `kind: "file"` 与 `scope: "head"|"tail"|"all"`，支持无结构文件的暴力覆盖。
- **残骸抢救（cut-to-end）**：新增 `--cut-to-end` 参数，从指定片段直接切到文件末尾。
- **Schema 校验优化**：`ops.json` 支持 `contentFile` 和 `selector`；字段缺失时输出明确的大白话报错，不再崩溃。

# Changelog

## [2.8.0] - 2026-10-18
### Added
- **模糊向量引擎**：支持 `fuzzy: true`，将代码名称拆解为词根并计算 Dice 相似度。即使拼写错误（如 `update status`）也能精准命中 AST 节点（如 `updateStatsPanel`）。
- 词法解析原生支持中文字符（如 `TECHS.铁矿机`）。

## [2.7.0] - 2026-10-18
### Added
- **深度 AST 支持**：支持 `arrow-function`（自动向上提级包含 `const` 声明）和嵌套 `property`（支持带引号的中文键名，只替换值）。
- **人类友好的报错升级**：找不到 AST 节点时，直接提示“可能是局部作用域，建议改用 kind: file 覆盖”。
- **JSDoc/注释保留**：局部微创替换时，不再吞掉函数头部的注释。
- **行中替换缩进修复**：当替换发生在行中间时，首行不再强制加缩进，保持格式绝对对齐。

## [2.6.0] - 2026-10-18
### Added
- **人类友好的失败诊断**：当替换失败（断言失败 / 语法错误）时，CLI 会直接打印出“原代码”与“你的新代码”的对比。
- **失败上下文缓存**：所有失败信息会自动写入 `.tred/last-failure.json`，包含 `oldCode` 和 `newCode`，方便追溯。


## [2.1.0] - 2026-10-18
### Added
- **多语言统一语法门禁**：JS/TS 走 `tsc`，CSS 走 `postcss`，JSON 走 `JSON.parse`。写错一行直接拦截落盘。
- 引入完整的 HTML / CSS Parser，支持 `cssSelector` 与 CSS `selector` 定位。

## [2.0.0] - 2026-10-18
### Added
- **多语言解析引擎**：支持 TS, JS, JSON, Markdown, HTML, CSS。
- **外部状态追踪**：无法写注释的文件（如 JSON, MD）自动生成 `.tred/state.json` 记录模糊行号与 AST 特征。
- **`tred commit`**：自动跑 `verify` 校验并安全提交 Git。

## [1.3.0] - 2026-10-17
### Added
- 增加 `tred ops` 声明式流水线执行器。
- 新增 `--assert-has-ast` 等强力 AST 断言机制。
