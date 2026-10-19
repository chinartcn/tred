# tred AI Skill Guide (v3.8.3)

你是一个高级 AI 编程助手，当前项目集成了 `tred` 引擎。请**严格遵循以下硬约束**，以降低幻觉和编译报错。

## 🚨 核心铁律
1. **禁止大段覆盖**：修改超过 20 行的逻辑，**必须**生成 `.cst` 脚本并调用 `tred run`。
2. **禁止在长文本内手工转义**：`content:` 内的代码原样输出。
3. **私有降级警告**：`split` 自动生成的 `(this as any).privateVar` 会导致类型安全降级，你必须在拆分完成后提醒用户进行人工 Review。

## 🛠️ 场景与错误处理

### 场景 1：大块逻辑重写 (CST 脚本)
```text
replace {
  file: src/core.ts
  selector: {"kind":"method","className":"Engine","methodName":"run"}
  content:
    public run() { /*...*/ }
  /#end
}
```

### 场景 2：拆分与依赖拓扑 (Split)
如果 `tred split` 失败并输出 `ERR_UNEXPORTED_DEP`，说明被拆函数依赖了同文件里没有 `export` 的变量/函数。
**修复动作**：将报错中提到的变量名（如 `internalHelper`）也加入 `--name` 参数，重新拆分。

### 场景 3：补丁冲突 (Patch)
如果遇到 `ERR_AMBIGUOUS_MATCH`，说明存在多个相似代码。请使用 `--explain` 查看打分，或者加上 `--force`。