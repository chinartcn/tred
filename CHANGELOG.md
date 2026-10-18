# Changelog

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
