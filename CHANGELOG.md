# Changelog

## [1.3.0] - 2026-10-18
### Added
- **`tred ops` 声明式引擎**：支持用一个 `ops.json` 组合执行 `annotate`、`replace`、`verify`。
- 完全实现自举：tred 的内部升级现在通过其自身的 `ops` 引擎完成。

## [1.2.2] - 2026-10-18
### Added
- **Snippet 无锚点定位**：支持 `--snippet-start/end`（文本片段）或 `--snippet-start/end-line`（行号）直接替换。
- **同名节点处理**：AST Selector 增加 `occurrence` 属性（如替换第 2 个 `run` 方法）。
- **AST 断言**：`--assert-has-ast` / `--assert-no-ast`，结合智能包裹，支持校验片段内的代码结构。
- 顶层语句/变量定位：支持 `kind: "statement"` 和 `kind: "variable"`。

## [1.2.1] - 2026-10-18
### Added
- **`--fuzzy` 模糊匹配**：忽略锚点名大小写，允许冒号前后无空格。
- **文本断言**：`--assert-include` / `--assert-exclude` / `--assert-regex`。

## [1.2.0] - 2026-10-17
### Added
- 增加 `--format sarif` 支持 GitHub Code Scanning。
- 增加 `--format html` 生成静态审查报告。
- 增加 `tred serve` 一键预览 HTML 报告。

## [1.1.0] - 2026-10-17
### Added
- 首次发布至 npm (`@rtcn/tred`)。
- 提供 `baseline`、`check`、`init`、`doctor` 等完整的项目治理命令。
