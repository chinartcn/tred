# Changelog

## [3.3.0] - 2026-10-25
### Added (Architect Level)
- **`tred impact`**：自动依赖分析。修改全局配置或函数前，一键查清它在哪些文件、哪些类/函数中被引用。
- **`tred split`**：全自动结构分块。针对千行大文件，一键将顶层函数拆分到新文件，并自动管理 `import` / `export`。

## [3.2.0] - 2026-10-24
### Added (AI Native)
- **`tred map`**：生成代码库全息地图（JSON 结构树）。
- **`tred patch`**：原生差异合并。
- **`skill.md`**：面向 AI 的系统级提示词指南。

## [3.1.0] - 2026-10-22
### Added
- 多级 Context 嵌套 / HTML 可视化报告 / Fuzzy 安全阈值。

## [3.0.0] - 2026-10-20
### Architecture Update
> 重构 AST 引擎，引入 `context` 空间感知。
### Added
- **`tred grep`** 与上下文过滤。

## [2.9.0] - 2026-10-18
### Performance
- C/WASM 模糊引擎 / 零分配 JS 兜底。

## [2.5.0 - 2.8.0] - 2026-10-18
### Added
- 模糊向量匹配 / 深度 AST / 失败诊断 / 文件级切分。

## [2.0.0] - 2026-10-15
### Added
- 多语言解析器 / 状态追踪 / 声明式流水线。

## [1.2.0] - 2026-10-10
### Added
- 首次发布至 npm (`@rtcn/tred`)。
