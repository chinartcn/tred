# Changelog

## [3.5.1] - 2026-10-18
### Fixed
- 修复 `api.md` 未能同步 `tred patch --auto-heal` 和 `--html` 等新特性的问题。

## [3.5.0] - 2026-10-18
### Added (Smart Healing)
- **`--auto-heal`**：当模糊匹配因上下文微小差异（如 `count: 1` vs `count: 2`）而失败时，自动纠正补丁上下文，重新校验并精准应用。
- **`--html`**：当补丁无法自动应用时，生成 `tred-suggest.html`，在浏览器中以 Split Diff 视图查看当前代码与补丁目标代码的并排对比。

## [3.4.0] - 2026-10-18
### Added
- **智能纠错建议 (`tred suggest`)**：当 `tred patch --fuzzy` 失败时，自动展示最佳候选的上下文，并生成降低阈值的重试命令。

## [3.3.6] - 2026-10-18
### Performance
- **Rare-Token × TF-IDF 模糊匹配**：`tred patch --fuzzy` 基于稀有标识符与 TF-IDF 加权评分，大幅降低结构相似代码（如配方面板）的误伤率。
- 融合字符级 Dice 校验，可感知 `count: 1` vs `count: 2` 等细微语义差异。
- `oldStart` 超出文件末尾时自动退化为全文件扫描。

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
