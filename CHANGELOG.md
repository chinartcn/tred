# Changelog

所有重要变更都记录在此文件。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [1.2.0] - 2026-10-17

首次公开发布。

### 核心能力

- **replace**：锚点替换 + AST 兜底 + 语法门禁 + 原子写 + 指纹幂等
- **replace-many**：批量事务（全成功或全回滚），支持 `--continue-on-error`
- **ast**：AST 大纲（class / method / function + selector）
- **annotate**：自动加锚点（单文件 / 目录批量），支持 `--order=source|name|kind`
- **verify**：锚点健康度（孤儿 / 重复 / 指纹不一致），支持 `--cache` / `--since` / `--since-file` / `--exclude`
- **verify --fix**：修复孤儿 END，`--fix-orphan-start` 保守补 END
- **diff**：锚点级 / 目录级 / 历史版本对比
- **serve**：起 HTTP 服务查看 HTML 报告
- **watch**：文件变化自动重跑 verify
- **check**：`verify --strict` 或 `--pre-commit` 基线比较
- **init**：生成 `.tred/config.json` + pre-commit hook
- **doctor**：环境诊断

### 输出格式

- `text`：人类可读（默认）
- `json`：脚本解析
- `markdown`：PR 注释
- `github-annotations`：GitHub PR 原生红叉
- `sarif`：GitHub Code Scanning / Security 面板
- `html`：单文件 HTML 报告

### 治理

- 基线冻结：`verify --save-baseline` + `--baseline`（只报新增问题）
- 增量：`--since <ref>` / `--since-file <path>`

## 早期里程碑

- **0.1.0**：锚点 + AST 双轨制，替换 API
- **0.2.0**：dry-run + unified diff + 缩进归一化
- **0.3.0**：CLI（replace / replace-many / ast）
- **0.4.0**：replace-many 事务 + ast selector
- **0.5.0**：verify + fix（保守策略）
- **0.6.0**：dist 编译 + `--format markdown`
- **0.7.0**：`--fix-orphan-start`
- **0.11.0**：`--cache` 增量
- **0.12.0**：`--rollback-log` 审计
- **0.13.0**：`--continue-on-error`
- **0.14.0**：锚点级 diff + fix 后更新缓存
- **0.15.0**：目录级 diff + 自动加锚点
- **0.16.0**：`annotate --dir`
- **0.17.0**：`--since` + `--exclude` + `--format markdown`（diff-dir）
- **0.18.0**：`--since-file` + `doctor` + git 完整集成
- **0.19.0**：`--baseline` + `check` + `init` + `--order`
- **0.20.0**：`--format sarif` + `watch` + `--diff-from`
- **1.0.0**：版本号确定 + 发布元数据
- **1.1.0**：`--format sarif` + `--format html`
- **1.1.1**：`serve` 一键
- **1.1.3**：代码审查 + 类型收紧 + 路径鲁棒性
