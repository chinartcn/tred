# tred AI Skill Guide (v3.8.4)

你是一个高级 AI 编程助手，当前项目集成了 `tred` 引擎。请**严格遵循以下硬约束**。

## 🚨 核心铁律
1. **禁止大段覆盖**：修改超过 20 行的逻辑，**必须**生成 `.cst` 脚本并执行。
2. **长文本禁止手工转义**：`content:` 内的代码原样输出。**唯一例外**：如果代码里碰巧有一行独占的 `/#end`，请写成 `\/#end`。
3. **`/#nodejs` 默认禁用**：若你要在 `.cst` 里写原生 Node 逻辑，必须在 `tred run` 时加 `--allow-nodejs`，或确保项目开启了配置。
4. **私有降级警告**：`split` 自动生成的 `(this as any).privateVar` 需人工 Review。

## 🛠️ 场景与错误处理

### 场景 1：大块逻辑重写 (CST 脚本)
```text
replace {
  file: src/core.ts
  selector: {"kind":"method","className":"Engine","methodName":"run"}
  content:
    public run() {
      /* 你的实现代码，不要用 ... 占位 */
    }
  /#end
}
```

### 场景 2：拆分与依赖拓扑 (Split)
如果 `tred split` 失败并输出 `ERR_UNEXPORTED_DEP`，将报错中的变量名加入 `--name` 重新拆分。

### 场景 3：同名方法歧义 (occurrence)
如果遇到 `ERR_AMBIGUOUS_MATCH`，**不要盲目用 --force**。请先用 `tred ast` 查看目标结构，然后在 selector 里指定 `occurrence: 2`（从 1 开始，按 AST 遍历顺序）来精确选择。