# Changelog

## [3.6.6] - 2026-10-19

### Fixed

- split: P1-4 未定义标识符只报大写标识符，避免局部小写变量（i / e / container）噪音
- 修复 dist 重新 build 后 P1_4_uppercase_filter 标记缺失

## [3.6.5] - 2026-10-19

### Added

- split: P0-2 全薄壳模式（废弃 Object.assign mixin）
  - public / protected / private 方法统一走薄壳 + Impl 后缀
  - 保留修饰符 / async / generator / 参数签名
- split: P0-1 import 自动复制（含 import type 语义，verbatimModuleSyntax 兼容）
  - collectFreeIdentifiers 分析 impl 自由标识符（含参数类型 / 返回类型 / 类型参数 / 默认值）
- split: P1-3 private 方法交叉检测（未拆时阻断，避免运行时 this.private undefined）
- split: P1-4 未定义标识符警告
- split: `--to` 支持完整相对路径

## [3.6.4] - 2026-10-19

### Added

- patch: P0-2 多候选仲裁（top1/top2 margin < 5% 拒绝）
- patch: `--force` / `--fuzzy-min-margin`
- patch: `--explain` 结构化分数分解（charSim / tokenSim / keyLines / positionOffset）
- patch: P1 稀有词行全命中提升到 93%
- patch: P1 token 集相同给高分

### Fixed

- patch: 修复 patch 文本末尾 \n 产生假空行，拉低模糊匹配得分

### Chore

- pnpm 12 allowBuilds 配置（esbuild）

## [3.6.3] - 2026-10-19

### Added

- split: 无 `--class` 时自动识别类方法（单类命中 / 多类冲突 / 不存在列可用节点）
- split: 后置统一检查拒绝 static / private / protected 方法
- skill.md: 第 10 节补 `--auto-heal` / `--html` / split 边界
- ci: `.github/workflows/test.yml`（Node 20/22 + smoke，Ubuntu + macOS）

### Fixed

- split: PropertyDeclaration 用 `getFullStart()` 保留 JSDoc
- split: async / generator 语义保留（`function*` 位置修正）
- split: 删除未使用的 prefix 死代码
- patch: `approxIdx` clamp 上下界

### Test

- smoke 覆盖 11 条关键路径

## [3.6.2] - 2026-10-18
### Fixed
- `tred split` 提取类属性（箭头函数）时，完美保留前置 JSDoc 注释，原文件不再残留孤儿注释。
- 修复箭头函数拆分后缺失尾部分号的问题。

## [3.6.1] - 2026-10-18
### Fixed
- `tred split` 提取成员时自动包含前导 JSDoc 注释，不再留下孤儿注释。
- 修复箭头函数属性拆分时未进行 Dedent 导致缩进错乱的问题。

## [3.6.0] - 2026-10-18
### Added
- **`tred split` 支持类方法提取**：新增 `--class <ClassName>` 参数，自动从大型类中剥离指定方法。
- **原型注入 (Prototype Mixin)**：拆分出的方法自动转换为 `this` 参数格式，原类通过 `Object.assign` 混入，保留 `this` 上下文且零破坏。
- **代码美化**：拆分时自动执行 Dedent（缩进修正）与连续空行清理，确保代码格式与手写一致。

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
