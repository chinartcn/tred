# Changelog

## [3.2.0] - 2026-10-24
### Added (AI Native)
- **`tred map`**：生成代码库全息地图（JSON 结构树），包含所有类/函数层级与行数，大幅降低 AI 读取项目的 Token 消耗。
- **`tred patch`**：原生差异合并。支持通过管道或文件应用 unified diff（只给 `+` 和 `-` 行），替换后自动执行语法校验。
- **`skill.md`**：面向 AI 的系统级提示词指南，规范 AI 调用 tred 的工作流。

## [3.1.0] - 2026-10-22
### Added
- **多级 Context 嵌套**：支持数组锁定深层作用域 `["class:Worker", "method:onmessage"]`。
- **HTML 可视化报告**：`tred grep --ast --html` 生成带上下文标签的可视化报告。
- **Fuzzy 安全阈值**：`--fuzzy-threshold <n>` 拒绝低于该分数的模糊匹配。

## [3.0.0] - 2026-10-20
### Architecture Update
> 重构 AST 引擎，引入 `context` 空间感知。基于旧 AST 引擎的自定义适配器需重新接入。
### Added
- **`tred grep`**：极速全局扫描，支持 `--ast` 自动标注所在函数/类。
- **上下文级 AST 过滤**：支持 `"context": "worker.onmessage"`。

## [2.9.0] - 2026-10-18
### Performance
- **C/WASM 模糊引擎**：手写 C 语言编译 WASM。
- **零分配 JS 兜底**：短字符串 1.6 微秒极速比对。

## [2.5.0 - 2.8.0] - 2026-10-18
> 密集迭代版本，合并记录。
### Added
- (2.8.0) **模糊向量匹配**：支持 `"fuzzy": true`，基于 Dice 系数。
- (2.7.0) 深度 AST 支持：支持 `arrow-function` 和 `property`，JSDoc 注释完美保留。
- (2.6.0) 失败诊断升级：终端输出“原代码 vs 新代码”对比。
- (2.5.0) 文件级切分 (`kind: "file"`) 与 `--cut-to-end` 参数。

## [2.0.0] - 2026-10-15
### Added
- 多语言解析器（HTML / CSS / JSON / MD）。
- 外部状态追踪 (`.tred/state.json`)。
- `tred ops` 声明式流水线。

## [1.2.0] - 2026-10-10
### Added
- 首次发布至 npm (`@rtcn/tred`)。
