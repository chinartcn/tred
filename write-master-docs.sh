#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

cat > .master-docs.mjs <<'MJS_EOF'
import { writeFileSync } from 'node:fs';

const readme = `# @rtcn/tred
> **AI 原生时代的全栈代码语义感知与重构引擎。**

[![npm version](https://img.shields.io/npm/v/@rtcn/tred.svg)](https://www.npmjs.com/package/@rtcn/tred)
[![MCP Ready](https://img.shields.io/badge/MCP-Supported-blue.svg)](https://modelcontextprotocol.io)
[![CI](https://github.com/chinartcn/tred/actions/workflows/test.yml/badge.svg)](https://github.com/chinartcn/tred)

---

## 💥 AI 重构的三大死穴，tred 如何破局？

在 Cursor / Claude 等 AI 辅助编程工具大行其道的今天，大模型在“修改已有代码”时，依然面临着极其严峻的挑战：

1. **Diff 补丁的脆弱性**：AI 吐出的 \`unified diff\`，只要文件被格式化过、行号偏移了 5 行，或者空格不对，\`patch\` 就会直接失败。AI 只能盲目重试。
2. **长文本的转义地狱**：让 AI 修改超过 50 行的逻辑，它通常需要输出 JSON 或脚本。面对代码里的反引号、\`${\`、正则，转义符能把大模型逼疯，导致输出截断。
3. **重构导致的全盘崩溃**：让 AI 拆分一个巨型类。拆完后，\`this\` 上下文丢失、\`import\` 缺失、\`private\` 成员报红。原本只是想瘦身，结果整个项目白屏。

**\`tred\` 是专为 LLM 打造的外科手术级重构引擎。** 它把大模型的意图转化为高度安全的 AST 动作。

---

## 🚀 四大核心超能力

### 1. 📝 CST 宏脚本：彻底告别转义地狱

AI 不需要再吐复杂的 JSON 或 Diff，直接写 \`.cst\` (Changes Long Text) 脚本。
用 4 空格缩进代替所有的转义符，用原生 Node.js 编写控制流逻辑：

\`\`\`text
/#nodejs
// 原生 Node 逻辑，可读环境变量、遍历文件
import fs from 'node:fs';
if (fs.existsSync('src/legacy.ts')) {
  console.log('开始迁移旧逻辑...');
}
/#nodejs.end

// 原生长文本替换，无需转义
replace {
  file: src/core/engine.ts
  selector: {"kind":"method","className":"Engine","methodName":"renderNode"}
  content:
    public renderNode(node: NodeData) {
      // AI 可以随便写代码，无需反引号，无需转义！
      return this.renderer.draw(node);
    }
  /#end
}
\`\`\`
执行：\`tred run refactor.cst\`

### 2. 🔪 全薄壳拆分 (Split)：重构后 TS 编译 0 报错

提取几千行文件中的巨型方法，自动处理所有依赖拓扑。
传统工具（或 AI 手写）拆分后，对象原型注入（Mixin）会破坏 TS 类型系统，导致 \`this.render()\` 报红。
\`tred\` 采用全薄壳技术，在**拆分的同时保证闭包安全**：

\`\`\`bash
tred split --file src/core/engine.ts --name renderNode,updateParticles --to src/render.ts
\`\`\`
- **全薄壳**：原类保留 \`public foo() { return fooImpl.call(this); }\`，TS 类型完美推导。
- **依赖拓扑感知**：跨模块自动 import；同文件导出成员自动反向引入；同文件非导出成员直接报错拦截，绝不静默产出坏代码。
- **私有降级**：自动把 \`this.buffer\` 转为 \`(this as any).buffer\`，无视 TS 的 private 限制。

### 3. 🛡️ 智能补丁 (Patch)：防止 AI 乱改，多候选仲裁

AI 打补丁经常因为相似代码而“打错位置”。
\`\`\`bash
cat ai.patch | tred patch --file src/main.ts --fuzzy --explain
\`\`\`
- **多候选仲裁**：如果文件里有 3 个长得一样的方法，模糊匹配给 3 个位置打了一样的分数，引擎会直接**拒绝应用**，并输出警告。
- **可解释性**：\`--explain\` 会输出每次匹配的 \`charSim\`（字符相似度）、\`tokenSim\`（分词相似度）和行偏移，让调试清晰可见。

### 4. 🔌 MCP Server：原生接入大模型生态
内置 Model Context Protocol (MCP) Server，让 AI 助手直接获得重构双手。

\`\`\`json
{
  "mcpServers": {
    "tred": {
      "command": "npx",
      "args": ["@rtcn/tred", "mcp"]
    }
  }
}
\`\`\`
*暴露 \`tred_map\`、\`tred_grep\`、\`tred_split\`、\`tred_patch\` 等 6 个原生工具。*

---

## 🧠 全局感知与静态分析

- \`tred map --dir src\`：输出极其详尽的 JSON 树状大纲。AI 无需读取几万行源码，即可瞬间掌握项目架构，省下 90% 的 Token。
- \`tred impact ITEMS\`：依赖影响分析。修改公共函数前，一键查出被引用的 10 个文件和具体行号。
- \`tred verify\`：代码锚点健康度、循环依赖、孤儿代码检测。

---

## 📦 安装
要求 Node.js >= 20。
\`\`\`bash
npm i -D @rtcn/tred
\`\`\`

> 💡 **提示**：如果你在使用 Cursor 或 Claude，请将根目录的 \`skill.md\` 复制到 AI 的 Custom Instructions 中，以获得最佳重构体验。
`;

const skillMd = `# tred AI Skill Guide (v3.8.3)

你是一个高级 AI 编程助手，当前项目集成了 \`tred\` 引擎。为了最大限度降低幻觉和编译报错，在重构、阅读或修改代码时，请**严格遵循以下准则**。

## 🚨 核心铁律（绝对禁止）

1. **禁止大段覆盖**：如果你需要修改超过 20 行的代码，**绝对不要**使用 \`writeFile\` 或 \`unified diff\`。转义符会导致截断和编译失败。
2. **禁止在长文本里用反引号转义**：生成 \`.cst\` 时，\`content:\` 和 \`/#end\` 之间的代码原样输出，不要自己去转义反引号。
3. **禁止盲目拆分**：拆分类方法前，必须先用 \`tred impact <methodName>\` 查看依赖。

---

## 🛠️ 场景实战指南

### 场景 1：大块逻辑重写 / 方法替换 -> 必须使用 CST 脚本
如果你要替换一个函数的实现，或者修改一大段 JSX。

**步骤**：
1. 先用 \`tred grep "functionName" --ast\` 确认 AST 选择器。
2. 创建一个 \`refactor.cst\` 文件（在项目根目录）：
   (使用 4 空格缩进包裹)
   \`\`\`text
   replace {
     file: src/core.ts
     selector: {"kind":"method","className":"Engine","methodName":"run"}
     content:
       public run() {
         // 在这里输出你要写的所有代码，不用管任何转义
       }
     /#end
   }
   \`\`\`
3. 告诉用户：“我已经生成了 refactor.cst 脚本，请执行 \`tred run refactor.cst\`”。

### 场景 2：拆分巨型文件 -> 全薄壳 AST 引擎
当用户要求拆分一个包含上万行代码的类时。

**步骤**：
1. 执行：\`tred split --file giant.ts --name foo,bar --to util.ts\`
2. **观察引擎返回结果**：
   - 如果报错“未导出顶层声明”，说明目标方法依赖了同文件里未 export 的函数。请把那个函数名也加入 \`--name\` 参数中重新执行。
   - 成功后，原文件会生成薄壳函数，TS 编译器不会报错。

### 场景 3：应用补丁 -> 仲裁与自愈
如果你手里有一段修改前的 diff。

**步骤**：
1. 使用 \`tred patch --file a.ts --fuzzy\`。
2. 如果引擎报错“多候选并列”，说明当前 diff 的上下文不够独特。请使用 \`tred patch --file a.ts --fuzzy --explain\` 查看分数分解，或者加上 \`--force\` 强制接受第一个匹配项。

---

## 🔍 认知与规划
每次修改代码前，请执行以下指令建立全局观：
- \`tred map --dir src\`：理解架构。
- \`tred impact <symbol>\`：查受影响的范围。
`;

const apiMd = `# tred CLI & API Reference (v3.8.3)

## 1. CLI 完整语法

### \`tred run <file.cst>\`
执行 CST (Changes Long Text) 宏脚本。这是推荐给 AI 使用的主力命令。

**CST 语法组成**：
- \`/#nodejs ... /#nodejs.end\`：透传任意 Node.js 逻辑（自动提升至模块顶部）。
- \`replace { ... }\`：执行 AST 替换。
  - \`file\`: 目标文件。
  - \`selector\`: AST 选择器 JSON 字符串。
  - \`content:\` 到 \`/#end\`：包含的代码作为新方法体。
- \`patch { ... }\`：执行 Diff 补丁。
  - \`content:\` 到 \`/#end\`：输入标准 unified diff（无需缩进调整）。
- \`split { ... }\`：执行拆分。
  - \`file\`, \`name\` (逗号分隔), \`to\`, \`className\` (可选)。

### \`tred split\`
\`\`\`bash
tred split --file <path> --name <func1,method1> --to <new.ts> [--class <ClassName>]
\`\`\`
- **全薄壳模式**：原类保留签名转发（\`foo() { return fooImpl.call(this); }\`），废弃 Object.assign。
- **依赖拓扑感知**：同文件 export 自动反向 import；同文件非 export 直接抛出错误拦截。
- **私有降级**：自动替换为 \`(this as any).xxx\`，通过 TS 编译。

### \`tred patch\`
\`\`\`bash
tred patch --file <path> [diff-file] [options]
\`\`\`
- \`--fuzzy\`：开启 Rare-Token TF-IDF 加权模糊匹配。
- \`--explain\`：打印匹配得分分解（charSim, tokenSim, 并列候选数）。
- \`--force\`：忽略多候选并列警告，强制应用 top1。
- \`--auto-heal\`：上下文轻度偏移时自动修正补丁头。

### \`tred replace\`
\`\`\`bash
tred replace --file <path> --selector <json> --content-file <path>
\`\`\`

### \`tred mcp\`
\`\`\`bash
tred mcp
\`\`\`
启动 MCP 服务。提供工具：
- \`tred_map\`: 生成 JSON 树状大纲。
- \`tred_grep\`: AST 语义搜索。
- \`tred_split\`: 智能拆分。
- \`tred_patch\`: 智能打补丁。
- \`tred_replace\`: 单点精准替换。
- \`tred_impact\`: 依赖分析。

---

## 2. TS/JS 编程 API

\`\`\`typescript
import { replace, splitFile, applyPatch, runCst, generateMap } from '@rtcn/tred';

// 1. 脚本执行器
await runCst('refactor.cst');

// 2. 文件拆分
const res = splitFile('src/engine.ts', ['renderNode'], 'src/render.ts', 'Engine');
if (!res.ok) console.error(res.message);

// 3. 生成代码地图
const map = generateMap('src');
\`\`\`
`;

writeFileSync('README.md', readme);
writeFileSync('skill.md', skillMd);
writeFileSync('api.md', apiMd);
console.log('✅ 工业级、详尽版三大文档已生成完毕！');
MJS_EOF

node .master-docs.mjs
rm -f .master-docs.mjs
