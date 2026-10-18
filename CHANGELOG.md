# Changelog

## [3.0.0] - 2026-10-20
### Architecture Update
> 为什么跳到 3.0.0？因为 AST 引擎内部结构发生了重构，引入了 `context` 空间感知。
> 现有基于锚点和 selector 的语法**完全向后兼容**，但如果有人基于旧的 AST 引擎写了自定义适配器，需要重新接入。

### Added
- **`tred grep`**：极速全局扫描，支持 `--ast` 自动标注所在函数/类。
- **上下文级 AST 过滤**：支持 `"context": "worker.onmessage"`，精准匹配父节点。
- AST 引擎全面支持嵌套属性、箭头函数、赋值表达式。

## [2.9.0] - 2026-10-18
> 性能专版，因涉及 C/WASM 架构升级，单独记录。
### Performance
- **C/WASM 模糊引擎**：手写 C 语言编译 WASM。
- **零分配 JS 兜底**：短字符串 1.6 微秒极速比对。

## [2.5.0 - 2.8.0] - 2026-10-18
> 密集迭代版本，合并记录。
### Added
- (2.8.0) **模糊向量匹配**：支持 `"fuzzy": true`，基于 Dice 系数。
- (2.7.0) 深度 AST 支持：支持 `arrow-function` 和 `property`，JSDoc 注释完美保留。
- (2.6.0) 失败诊断升级：终端输出“原代码 vs 新代码”对比，并缓存到 `.tred/last-failure.json`。
- (2.5.0) 文件级切分 (`kind: "file"`)，支持无结构残骸文件的暴力覆盖。新增 `--cut-to-end` 参数。

## [2.0.0] - 2026-10-15
### Added
- 多语言解析器（HTML / CSS / JSON / MD）。
- 外部状态追踪 (`.tred/state.json`)。
- `tred ops` 声明式流水线。

## [1.2.0] - 2026-10-10
### Added
- 首次发布至 npm (`@rtcn/tred`)。
