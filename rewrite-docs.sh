#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# 备份旧文档
cp README.md README.md.bak
cp skill.md skill.md.bak
cp api.md api.md.bak

cat > rewrite-docs.cst <<'CST_EOF'
/#nodejs
import fs from 'node:fs';

const apiMd = `# tred API 与 CLI 参考手册 (v3.8.2)

## 一、 CLI 完整语法

### 1. \`tred run\` 执行重构脚本 (推荐)
\`\`\`bash
tred run <file.cst>
\`\`\`
支持用 \`.cst\` (Changes Long Text) DSL 编写无转义的长文本重构指令，支持原生 Node.js 透传。

### 2. \`tred replace\` 单文件精准替换
\`\`\`bash
tred replace --file <path> (--anchor | --selector <json>) (--content <str> | --content-file <path> | --content-stdin)
\`\`\`
- \`--fuzzy\` / \`--fuzzy-threshold\`：模糊匹配与阈值。
- \`--auto-inject\`：自动注入锚点。

### 3. \`tred patch\` 原生差异合并
\`\`\`bash
tred patch --file <path> [diff-file]
\`\`\`
- 支持 4 级匹配：精确 -> ±50行 -> 忽略空白 -> Rare-Token TF-IDF 模糊。
- \`--force\`：忽略多候选并列拦截。
- \`--explain\`：输出分数分解（charSim/tokenSim）。
- \`--auto-heal\`：上下文自动修正。

### 4. \`tred split\` 自动拆分 (全薄壳)
\`\`\`bash
tred split --file <path> --name <func1,method1> --to <new.ts>
\`\`\`
- **全薄壳模式**：原类保留 \`public/private foo() { return fooImpl.call(this); }\`。
- **依赖自动复制**：跨模块自动 import；同文件已导出自动反向 import；同文件未导出直接报错拦截。
- **私有成员降级**：自动将 \`this.privateField\` 转为 \`(this as any).privateField\`。

### 5. \`tred mcp\` 启动 MCP Server
\`\`\`bash
tred mcp
\`\`\`
以 stdio 模式启动 Model Context Protocol，供 Cursor / Claude 等 AI 直接调用 AST 引擎。

### 6. 其他辅助命令
- \`tred map [--dir]\`：生成 JSON 结构树。
- \`tred impact <name>\`：依赖影响分析。
- \`tred verify [--dir]\`：锚点健康度检查。
- \`tred grep <pattern> [--ast]\`：语义级全局搜索。
`;

const skillMd = `# tred (Code Semantic Engine) - AI Skill Guide (v3.8.2)

你是一个强大的 AI 编程助手。当前项目集成了 \`tred\` 引擎。请遵循以下工作流：

## 0. 优先使用 MCP 或 .cst
如果你支持 MCP，请直接调用 \`tred_*\` 工具（如 \`tred_split\`, \`tred_patch\`）。
如果需要修改长文本代码，**严禁**直接返回大段 diff，请用 \`.cst\` 脚本：
1. 创建 \`refactor.cst\` 文件：
   \`\`\`text
   replace {
     file: src/a.ts
     selector: {"kind":"method","className":"A","methodName":"foo"}
     content:
       public foo() {
         // 这里随意写长文本，无需转义
       }
     /#end
   }
   \`\`\`
2. 执行 \`tred run refactor.cst\`

## 1. 全局感知 (不要直接读文件)
使用 \`tred map --dir src\` 获取 JSON 结构树，瞬间掌握架构。

## 2. 修改代码 (禁止整块覆盖)
- **场景 A：短逻辑替换** -> \`tred replace --selector '{...}'\`
- **场景 B：长逻辑重构** -> \`tred run refactor.cst\`
- **场景 C：已有 diff** -> \`tred patch --file a.ts --fuzzy --explain\`

## 3. 安全护栏
- \`patch\` 默认拒绝并列候选，若不确信请加 \`--explain\` 查看。
- 修改公共函数前，必须用 \`tred impact <name>\` 检查影响面。

## 4. 拆分巨型文件
使用 \`tred split --file giant.ts --name foo,bar --to util.ts\`。
- 引擎会自动处理 \`this\` 上下文、私有字段降级和 Import 拓扑。
- 若报错未导出依赖，请把依赖一起加进 \`--name\` 里。
`;

fs.writeFileSync('api.md', apiMd);
fs.writeFileSync('skill.md', skillMd);
console.log('✅ api.md 和 skill.md 覆写完成');
/#nodejs.end

// 下面用 cst 语法替换 README.md 的占位符
replace {
  file: README.md
  selector: {"kind":"variable","variableName":"__TRED_README_PLACEHOLDER__"}
  content:
    # @rtcn/tred
    > **全栈代码语义感知引擎**：基于 AST / MCP / CST 极速定位，自带全语言语法门禁与外部状态追踪。

    ## 🚀 核心痛点解决
    1. **正则替换太脆弱**：多一个空格、换行就崩溃。
    2. **AI 生成代码不可靠**：少个括号直接白屏，长文本 diff 永远是转义地狱。
    3. **传统重构容易崩**：拆个方法，TS 报红一片（this 丢失、import 缺失）。

    **tred 的答案：** 多轨制精准定位 + AST 全薄壳拆分 + MCP 协议 + .cst 长文本 DSL。

    ## 📦 安装
    \`\`\`bash
    npm i -D @rtcn/tred
    \`\`\`

    ## 🔥 五大杀手锏 (v3.8.2)

    ### 1. CST 重构脚本 (彻底告别 diff 转义)
    用 4 空格缩进代替转义，用原生 Node.js 编写逻辑：
    \`\`\`bash
    tred run refactor.cst
    \`\`\`

    ### 2. MCP 原生支持
    直接在 Cursor / Claude 配置：
    \`\`\`json
    { "mcpServers": { "tred": { "command": "npx", "args": ["@rtcn/tred", "mcp"] } } }
    \`\`\`

    ### 3. 全薄壳拆分 (split)
    \`\`\`bash
    tred split --file engine.ts --name renderNode --to render.ts
    \`\`\`
    - 自动生成 \`renderNodeImpl.call(this)\` 薄壳，TS 编译 0 报错。
    - 自动降级 \`private\` 访问，自动补齐同文件/跨文件 import。

    ### 4. 智能补丁 (patch)
    \`\`\`bash
    cat diff.patch | tred patch --file a.ts --fuzzy --explain
    \`\`\`
    - 多候选并列自动拒绝，防误伤。
    - Rare-Token TF-IDF 模糊加权。

    ### 5. 语义扫描 (map / grep / impact)
    \`\`\`bash
    tred map --dir src
    tred impact ITEMS
    \`\`\`

    ## 📖 文档
    参阅 [api.md](./api.md) 与 [skill.md](./skill.md)。
  /#end
}
CST_EOF

# 先在 README 里放个合法的占位符变量，供 cst 替换
echo "const __TRED_README_PLACEHOLDER__ = 1;" > README.md

echo "=== 执行 tred run 更新文档 ==="
node dist/cli.js run rewrite-docs.cst

# 清理临时文件
rm -f rewrite-docs.cst
