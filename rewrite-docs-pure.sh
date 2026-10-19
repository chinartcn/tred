#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# 备份旧文档
cp README.md README.md.bak 2>/dev/null || true
cp skill.md skill.md.bak 2>/dev/null || true
cp api.md api.md.bak 2>/dev/null || true

cat > rewrite-pure.cst <<'CST_EOF'
replace {
  file: README.md
  selector: {"kind":"file","scope":"all"}
  content:
    # @rtcn/tred
    > **AI 原生的全栈代码语义感知与重构引擎**。基于 AST 定位、CST 宏脚本、MCP 协议，自带全语言语法门禁与外部状态追踪。

    [![npm version](https://img.shields.io/npm/v/@rtcn/tred.svg)](https://www.npmjs.com/package/@rtcn/tred)
    [![MCP Ready](https://img.shields.io/badge/MCP-Supported-blue.svg)](https://modelcontextprotocol.io)
    [![CI](https://github.com/chinartcn/tred/actions/workflows/test.yml/badge.svg)](https://github.com/chinartcn/tred)

    ---

    ## 💥 为什么需要 tred？

    在 AI 辅助编程的时代，大模型写代码有三个致命痛点：
    1. **Diff 匹配地狱**：AI 生成的 `unified diff` 一旦行号偏移、空格不对，直接打不上。
    2. **长文本转义灾难**：让 AI 输出包含代码块、反引号、正则的 JSON/YAML，转义符能把它逼疯。
    3. **重构一碰就碎**：让 AI 拆分一个巨型类，拆完后 `this` 丢失、`import` 缺失、`private` 报错，编译直接白屏。

    **`tred` 就是终结这些痛点的外科手术刀。**

    ---

    ## 🚀 四大核心超能力

    ### 1. 📝 CST 宏脚本：彻底告别转义地狱
    AI 不需要再吐复杂的 JSON 或 Diff，直接写 `.cst` (Changes Long Text) 脚本。支持原生长文本、无反转义、自带 Node.js 逻辑注入。

    ```text
    // refactor.cst
    /#nodejs
    import fs from 'node:fs';
    if (fs.existsSync('src/legacy.ts')) {
      console.log('开始重构旧逻辑...');
    }
    /#nodejs.end

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
    ```
    ```bash
    tred run refactor.cst
    ```

    ### 2. 🔪 全薄壳拆分 (Split)：编译 0 报错
    提取几千行文件中的巨型方法，自动处理所有依赖拓扑。

    ```bash
    tred split --file src/core/engine.ts --name renderNode,updateParticles --to src/render.ts
    ```
    - **全薄壳模式**：原类保留 `public foo() { return fooImpl.call(this); }`，彻底抛弃容易出错的 `Object.assign` mixin。
    - **依赖自动感知**：跨模块自动 import；同文件已导出成员自动反向 import；同文件未导出成员直接报错拦截。
    - **私有成员降级**：自动将 `this.privateField` 转为 `(this as any).privateField`，无视 TS 封闭性。

    ### 3. 🛡️ 智能补丁 (Patch)：防误伤、能自愈
    ```bash
    cat ai.patch | tred patch --file src/main.ts --fuzzy --explain
    ```
    - **多候选仲裁**：如果文件里有三个长相相似的方法，AI 的补丁命中多个位置时，引擎会直接拒绝，防止改错代码。
    - **Rare-Token × TF-IDF**：基于稀有标识符加权的模糊匹配，即使代码被 Prettier 格式化过也能精准打上。
    - **Auto-Heal**：自动修正上下文差异，无缝融合。

    ### 4. 🔌 MCP 原生支持：成为 AI 的双手
    内置 Model Context Protocol (MCP) Server，让 Cursor / Claude 直接调用底层引擎，告别终端黑盒。

    ```json
    {
      "mcpServers": {
        "tred": {
          "command": "npx",
          "args": ["@rtcn/tred", "mcp"]
        }
      }
    }
    ```
    *提供 `tred_map`、`tred_grep`、`tred_split`、`tred_patch` 等 6 个原生工具。*

    ---

    ## 🧠 全局感知与静态分析

    - `tred map --dir src`：输出 JSON 树状大纲。AI 不用读全量代码，瞬间掌握项目架构，节省 90% Token。
    - `tred impact ITEMS`：依赖影响分析。修改公共函数前，一键查出被引用的 10 个文件。
    - `tred verify`：锚点健康度、循环依赖、孤儿代码检测。

    ---

    ## 📦 安装
    要求 Node.js >= 20。
    ```bash
    npm i -D @rtcn/tred
    ```

    ## 📖 文档
    - AI 提示词指南：[skill.md](./skill.md)
    - CLI 与 API 手册：[api.md](./api.md)
  /#end
}

replace {
  file: skill.md
  selector: {"kind":"file","scope":"all"}
  content:
    # tred AI Skill Guide (v3.8.2)

    你是一个强大的 AI 编程助手，当前项目集成了 `tred` 引擎。在重构、阅读或修改代码时，请严格遵循以下准则：

    ## 🌟 核心原则：不要直接吐大段 Diff 或 JSON
    如果你需要修改超过 20 行的代码，**绝对不要**使用 `unified diff` 或构造复杂的 JSON 字符串，转义符极易导致错误。
    **请直接生成 `.cst` 长文本脚本，并让用户执行 `tred run`。**

    ### 场景 1：大块逻辑重写 / 方法替换 -> CST 脚本
    1. 创建 `refactor.cst`：
    ```text
    replace {
      file: src/core.ts
      selector: {"kind":"method","className":"Engine","methodName":"run"}
      content:
        public run() {
          // 在这里尽情输出长文本，不用管反引号或转义！
        }
      /#end
    }
    ```
    2. 执行 `tred run refactor.cst`

    ### 场景 2：拆分巨型文件 -> 全薄壳 AST
    执行 `tred split --file giant.ts --name foo,bar --to util.ts`
    - 若失败并提示“未导出依赖”，请把提示的依赖名也加入 `--name` 中。
    - 引擎会自动处理 `this` 和 `import`。

    ### 场景 3：应用小补丁 -> 智能融合
    如果已有补丁，使用 `tred patch --file a.ts --fuzzy`。
    - 如果报“多候选并列”，请用 `--explain` 查看打分，或者用 `--force`。

    ## 🛡️ 安全护栏
    - **先看全局**：改代码前，先跑 `tred map --dir src` 看架构，跑 `tred impact <name>` 查影响面。
    - **别用 writeFile 覆盖**：用 `tred replace` 或 `tred run` 来改，底层会做语法校验和事务回滚。
  /#end
}

replace {
  file: api.md
  selector: {"kind":"file","scope":"all"}
  content:
    # tred CLI & API Reference (v3.8.2)

    ## 1. 核心命令

    ### `tred run <file.cst>`
    执行 `.cst` 宏脚本。
    支持：
    - `/#nodejs ... /#nodejs.end`：透传任意 Node 逻辑。
    - `replace { ... content: ... /#end }`：AST 替换，长文本安全。
    - `patch { ... content: ... /#end }`：Diff 补丁。
    - `split { ... }`：自动拆分。

    ### `tred split`
    ```bash
    tred split --file <path> --name <func1,method1> --to <new.ts> [--class <ClassName>]
    ```
    - 自动推导类名，自动补齐 Import，自动降级 Private 访问。
    - 产出全薄壳实现（原类保留签名转发）。

    ### `tred patch`
    ```bash
    tred patch --file <path> [diff-file] [--fuzzy] [--explain] [--force]
    ```
    - 多级匹配：精确 -> ±50 行 -> 忽略空白 -> TF-IDF 模糊。
    - 模糊阈值默认 0.9。

    ### `tred replace`
    ```bash
    tred replace --file <path> (--anchor | --selector <json>) (--content <str> | --content-file <path>)
    ```

    ### `tred mcp`
    以 stdio 模式启动 MCP Server，提供 `tred_map`, `tred_grep`, `tred_split`, `tred_patch`, `tred_replace`, `tred_impact` 六大工具。

    ## 2. 辅助命令
    - `tred map [--dir]`：JSON 树状大纲。
    - `tred impact <name>`：依赖分析。
    - `tred verify`：锚点体检。
    - `tred ast --file <path>`：AST 树导出。

    ## 3. TS API
    ```typescript
    import { replace, splitFile, applyPatch, runCst } from '@rtcn/tred';

    await replace({
      file: 'src/a.ts',
      selector: { kind: 'method', className: 'A', methodName: 'foo' },
      content: 'public foo() {}'
    });
    ```
  /#end
}
CST_EOF

echo "=== 执行 tred run 更新文档 (纯 CST 模式) ==="
node dist/cli.js run rewrite-pure.cst

rm -f rewrite-pure.cst
