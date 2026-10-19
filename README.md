# @rtcn/tred
> **AI 原生时代的全栈代码语义感知与重构引擎**。基于 AST 图聚类、纯算法混合检索与长文本宏脚本，为 LLM 提供安全、幂等、永不崩溃的重构契约。

[![npm version](https://img.shields.io/npm/v/@rtcn/tred.svg)](https://www.npmjs.com/package/@rtcn/tred)
[![MCP Ready](https://img.shields.io/badge/MCP-Supported-blue.svg)](https://modelcontextprotocol.io)

---

## 🏗️ 核心引擎版本矩阵

`tred` 的底层并非单一算法，而是由四大独立进化的子引擎协同驱动：

| 引擎模块 | 当前版本 | 核心技术 | 解决的问题 |
|---|---|---|---|
| 🧠 **CST 宏引擎** | `v1.5` | 自定义状态机 + 长文本 Dedent | 解决 AI 生成代码时的 JSON 转义地狱 |
| 🪓 **CodeChopper 引擎** | `v2.0` | AST 依赖图 + 拓扑排序 + 连通分量 | 自动解耦无标号、互相引用的“屎山”代码 |
| 🔪 **Split 薄壳引擎** | `v3.2` | AST 节点替换 + 依赖拓扑 | 拆分大文件时保证 TS 编译 0 报错 |
| 🔍 **Hybrid 匹配引擎** | `v4.0` | BM25 + AST Shape (LCS) + MinHash | 纯算法实现抗改名、抗重构的精准模糊匹配 |

---

## 💥 为什么需要 tred？

在 Cursor / Claude 等 AI 辅助编程工具大行其道的今天，大模型在“修改已有代码”时，依然面临着极其严峻的挑战：

1. **Diff 补丁的脆弱性**：AI 吐出的 `unified diff`，只要文件被格式化过、行号偏移了 5 行，或者空格不对，`patch` 就会直接失败。
2. **长文本的转义地狱**：让 AI 修改超过 50 行的逻辑，它通常需要输出 JSON 或脚本。面对代码里的反引号、`${`、正则，转义符能把大模型逼疯。
3. **重构导致的全盘崩溃**：让 AI 拆分一个巨型类。拆完后，`this` 上下文丢失、`import` 缺失、`private` 成员报红。

**`tred` 把大模型的意图转化为高度安全的 AST 动作，且完全不需要庞大的神经网络。**

---

## ⚡ 30 秒极速体验

    # 1. 生成项目配置（生成 .tred/config.json）
    npx @rtcn/tred init

    # 2. 查看源码架构树
    npx @rtcn/tred map --dir src

    # 3. 执行 AST 安全替换
    npx @rtcn/tred replace --file src/main.ts --selector '{"kind":"function","functionName":"main"}' --content-file new-main.ts

---

## 🚀 核心超能力详解

### 1. 📝 CST 宏脚本：彻底告别转义地狱
AI 不需要再吐复杂的 JSON，直接写 `.cst` 脚本，用 4 空格缩进代替转义符。

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

执行：`tred run refactor.cst`

### 2. 🔪 全薄壳拆分 (Split)：重构后 TS 编译 0 报错
提取类方法，原类保留转发壳（`fooImpl.call(this)`），废弃 `Object.assign`。

    tred split --file src/engine.ts --name renderNode --to src/render.ts

- **依赖拓扑感知**：同文件 export 自动反向 import；未 export 直接报错拦截。
- **私有降级**：自动把 `this.buffer` 转为 `(this as any).buffer`。

### 3. 🪓 智能图聚类 (Chop)：自动解耦屎山
基于 AST 依赖图（区分立即引用与延迟回调），将千行文件自动聚类拆分，提取枢纽变量，并生成保持 API 兼容的引导器。

    tred chop --file giant.ts --dir ./src/chunks

### 4. 🧠 纯算法混合匹配 (v4.0)：极速且抗改名
彻底告别笨重的 Embedding 模型，纯 TS 算法实现：
- **BM25 + Token n-gram**：超强文本粗排，长度归一化。
- **AST Shape (LCS)**：检测控制流骨架，AI 把变量名全改了也能认出来。
- **MinHash Jaccard**：基于 Token 集合的精排。
- **Jaro-Winkler**：专治 `updateStatus` vs `update_state` 这种标识符变异。

---

## 🛡️ 安全与事务声明
- **原子写入**：底层 `tmp + rename`，断电不损坏文件。
- **RCE 防护**：`/#nodejs` 块默认禁用。需在 `.tred/config.json` 设置 `{"allowNodejs": true}` 或加 CLI `--allow-nodejs` 才能执行。
- **事务边界**：`tred run` 内的多操作不保证全局回滚，请配合 Git 使用。
