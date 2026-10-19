# @rtcn/tred
> **AI 原生代码语义感知与重构引擎**。基于 AST 与长文本宏脚本，为大模型提供安全、幂等的重构契约。

[![npm version](https://img.shields.io/npm/v/@rtcn/tred.svg)](https://www.npmjs.com/package/@rtcn/tred)
[![MCP Ready](https://img.shields.io/badge/MCP-Supported-blue.svg)](https://modelcontextprotocol.io)

---

## ⚡ 30 秒极速体验

```bash
# 1. 生成项目配置（生成 .tred/config.json）
npx @rtcn/tred init

# 2. 查看源码架构树
npx @rtcn/tred map --dir src

# 3. 执行 AST 安全替换
npx @rtcn/tred replace --file src/main.ts --selector '{"kind":"function","functionName":"main"}' --content-file new-main.ts
```

## 💥 为什么需要 tred？

在 AI 辅助编程时代，大模型修改代码面临三大致命伤：
1. **Diff 匹配地狱**：行号偏移、空格不对，`unified diff` 直接失败。
2. **长文本转义灾难**：复杂 JSON 导致模型输出截断。
3. **重构全盘崩溃**：拆分类方法导致 `this` 丢失、依赖缺失、编译白屏。

**`tred` 提供了一套防御性架构，让大模型不仅能写新代码，更能安全地改旧代码。**

## 🚀 核心特性

### 1. CST 宏脚本：彻底告别转义地狱
用 4 空格缩进代替转义符，允许在脚本中混写 Node.js 逻辑与代码替换指令：
```text
// refactor.cst
/#nodejs
import fs from "node:fs";
if (fs.existsSync("src/legacy.ts")) console.log("Migrating...");
/#nodejs.end

replace {
  file: src/core/engine.ts
  selector: {"kind":"method","className":"Engine","methodName":"renderNode"}
  content:
    public renderNode(node: NodeData) {
      return this.renderer.draw(node);
    }
  /#end
}
```
执行：`npx @rtcn/tred run refactor.cst`

### 2. 全薄壳拆分 (Split)：为 TS 类型系统设计
提取类方法，原类保留转发壳（`fooImpl.call(this)`），不破坏原型链。
```bash
tred split --file src/engine.ts --name renderNode --to src/render.ts
```
**已知边界（需人工确认的场景）**：
- **泛型 / 装饰器（Decorators）**：目前在剥离时保留了修饰符，但若修饰器依赖特定的 AST 上下文，剥离后可能会失效。
- **私有成员降级**：引擎自动将 `this.buffer` 转为 `(this as any).buffer` 以绕过 TS 的 `private` 编译报错，但**这属于类型安全降级**，请在运行时确保上下文完整。
- **Static 成员**：不支持拆分，会直接报错拒绝。

### 3. 智能补丁 (Patch)：多候选仲裁与模糊匹配
```bash
cat ai.patch | tred patch --file src/main.ts --fuzzy --explain
```
- 采用 Rare-Token TF-IDF 加权计算相似度。
- 若 top1 / top2 相似度差距 < 5%，拒绝应用，防止 AI 改错同名方法。

### 4. MCP 原生接入
内置 Model Context Protocol (MCP) Server。详见 [SPEC.md](./SPEC.md) 中的工具 Schema。

## 🛡️ 安全与幂等声明
- **原子写入**：所有替换底层均采用 `tmp + rename`，断电或中断不会导致文件损坏。
- **事务回滚**：若 `patch` 或 `split` 触发语法报错，引擎会直接回滚内存中的变更，绝不写入磁盘。
- **CST 执行权限**：`/#nodejs` 块默认被禁用（防 RCE 注入）。若确需运行，请加 `--allow-nodejs`。

## ⚖️ 与同类工具的对比
- **jscodeshift / ast-grep**：侧重于 CLI 或单次规则匹配。`tred` 侧重于 AI 工作流，内置了大模型需要的约束（转义、薄壳、仲裁）。
- **Cursor 自带 Edit**：Cursor 内部的 edit 往往直接覆盖文本。`tred` 提供了语法门禁与 AST 定位。