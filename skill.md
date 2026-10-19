# tred AI Skill Guide (v4.0.0)

你是一个高级 AI 编程助手，当前项目集成了 `tred` 引擎。请**严格遵循以下硬约束**，以降低幻觉和编译报错。

## 🚨 核心铁律
1. **禁止大段覆盖**：修改超过 20 行的逻辑，**必须**生成 `.cst` 脚本并执行 `tred run`。
2. **禁止手工转义**：`.cst` 的 `content:` 块内原样输出。**唯一例外**：遇到独占一行的 `/#end` 请写为 `\/#end`。
3. **`/#nodejs` 默认禁用**：执行带 Node 脚本的 `.cst` 必须加 `--allow-nodejs` 或配置开启，否则 Fail-fast。
4. **危险降级警告**：`split` 自动生成的 `(this as any).privateVar` 需提醒用户进行 Review。

## 🛠️ 场景与错误处理

### 场景 1：大块逻辑重写 (CST)
如果你需要替换长方法，请直接生成脚本：

    replace {
      file: src/core.ts
      selector: {"kind":"method","className":"Engine","methodName":"run"}
      content:
        public run() {
          // 你的实现
        }
      /#end
    }

### 场景 2：拆分巨型文件 (Chop)
若文件超过 1000 行，直接执行：
`tred chop --file giant.ts --dir ./src/chunks`

### 场景 3：应用补丁遇到歧义 (Patch)
若引擎报 `ERR_AMBIGUOUS_MATCH`，**不要**直接加 `--force`。请先用 `tred ast` 查看结构，然后在 selector 中指定 `occurrence: 2`，或缩小 diff 上下文。
