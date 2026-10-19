# tred (Code Semantic Engine) - AI Skill Guide

> 🚀 **MCP 优先**：如果你的环境支持 MCP Server，请**优先直接调用 `tred_*` 工具**（如 `tred_split`, `tred_patch`）。它们比执行 `bash tred` 命令更安全、响应更快，且不会污染终端输出。

你是一个强大的 AI 编程助手，当前项目集成了 `tred` 代码语义引擎。在执行重构、阅读代码或修改代码时，请严格遵循以下工作流。

## 1. 全局感知（不要直接读取文件源码）
当你需要了解项目架构，或者寻找某个类/函数在哪里时，**不要**使用 `cat` 或读取整个文件，这会浪费大量 Token。
请使用以下命令获取 JSON 树状大纲：
```bash
tred map --dir src
```
返回结果包含所有文件的行数、Class、Function 的层级关系。读这个 JSON 就能瞬间掌握整个项目。

## 2. 精准搜索
寻找特定变量或函数的调用位置，使用语义搜索：
```bash
tred grep "findUser" --ast
```
它会告诉你 `findUser` 属于哪个函数或类。

## 3. 修改代码（禁止整块覆盖）
如果需要修改某段逻辑，**禁止**直接用 `writeFileSync` 覆盖整个文件。

**场景 A：修改整个函数/方法**
```bash
tred replace --file src/main.ts --selector '{"kind":"function","functionName":"main"}' --content "..."
```
如果是嵌套作用域或中文属性，可使用 `context` 数组锁定：
```bash
tred replace --file src/main.ts --selector '{"kind":"arrow-function","functionName":"run","context":["class:Worker"]}' --content "..."
```

**场景 B：只修改某几行（推荐，最省 Token）**
使用 `tred patch`。你只需生成一段类似于 git 的 diff 文本：
```diff
@@ -10,2 +10,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
```
然后用管道传给 tred：
```bash
cat << 'EOF' | tred patch src/main.ts
@@ ... @@
-const b = 2;
+const b = 3;
EOF
```
tred 会自动替换这几行，并执行语法校验，绝不会破坏整个文件的括号平衡。

## 4. 安全护栏
如果你不确定变量名，可使用 `fuzzy` 和阈值：
```bash
tred replace --file src/a.ts --selector '{"kind":"function","functionName":"updStat","fuzzy":true,"fuzzyThreshold":0.8}' --content "..."
```

## 5. 防范重构崩溃（重要）
在修改全局常量、接口或公共函数之前，**必须**运行影响分析：
```bash
tred impact ITEMS --dir src
```
如果输出报告显示被 10 个文件引用，务必检查这些文件。

## 6. 拆分巨型文件 (v3.6.7+)
如果文件超过 1000 行，需要将部分函数/方法拆分出去，使用：
```bash
# 不用写 --class，自动识别类方法
tred split --file giant.ts --name foo,bar --to util.ts
```
**AI 必读特性**：
1. **免 --class**：自动推导成员所属类。若多个类包含同名方法，它会报错要求指定 `--class`。
2. **全薄壳模式**：拆分出的方法在原类中保留签名（如 `public foo() { return fooImpl.call(this); }`），**没有原型注入**，对 TS 类型系统完全透明。
3. **Import 自动复制**：被拆方法用到的模块引用会被自动复制到新文件。
4. **私有方法阻断 (P1-3)**：若被拆方法的实现体里调用了**未被一起拆分**的 `private/protected` 方法，会直接报错。此时你需要把那个被依赖的私有方法也加进 `--name` 列表。

## 7. tred patch 打不上怎么办？
如果 `tred patch` 报"未找到匹配位置"，说明：
1. 补丁的 hunk 行号偏离真实位置超过 50 行
2. 且上下文里的稀有标识符（唯一常量名、唯一函数名）不足以触发模糊匹配

解决方案：
```bash
# 显式开启模糊匹配（Rare-Token × TF-IDF 加权）
tred patch --file a.ts diff.patch --fuzzy

# 调低阈值放宽匹配（默认 0.9）
tred patch --file a.ts diff.patch --fuzzy --fuzzy-threshold 0.8

# 允许更少的稀有标识符（默认 2 个）
tred patch --file a.ts diff.patch --fuzzy --fuzzy-min-rare 1
```

核心原则：**"打不上"比"打错了"安全**。模糊匹配只在显式 `--fuzzy` 时启用，且要求 hunk 具备足够的稀有标识符作为锚点。

## 8. 遇到打不上补丁怎么办？
如果你的 diff 匹配分数不够（如 88%），`tred` 会提示你。你可以复制它给出的 `--fuzzy-threshold` 命令直接重试。

### 多候选仲裁 (v3.6.4+)
如果 diff 同时匹配到多个相似位置（比如三个 `render*` 方法），且得分差距 < 5%，`tred` 会**拒绝应用**以防误伤。
- 查看详细打分：`tred patch ... --fuzzy --explain`
- 如果确认打第一个：`tred patch ... --fuzzy --force`

## 9. 补丁自愈与可视化
如果你的 diff 因为文件被格式化过而打不上，可以：
1. 使用 `--auto-heal` 让引擎自动修正上下文并打入。
2. 使用 `--html` 生成浏览器视图，自己肉眼 review 后再调低阈值重试。

## 10. 补丁自愈、可视化与 split 边界 (v3.7.4)

### 10.1 `--auto-heal`：文件被格式化后的补丁

**场景**：文件被 Prettier / ESLint 跑过，`-` 行里的空格、引号、分号已变，但结构没变。

```bash
cat diff.patch | tred patch --file a.ts --fuzzy --auto-heal
```

引擎会：
1. 走 4 级匹配：精确 → ±50 行精确 → ±50 行忽略空白 → 模糊
2. 模糊阶段相似度 ≥ 阈值-0.15 时，自动把补丁上下文替换为当前文件真实内容，只应用真正的 `-`/`+` 行
3. 打完后走语法门禁，语法错回滚

### 10.2 `--html`：Split Diff 可视化

**场景**：`--auto-heal` 也打不上，或你想肉眼 review 后再决定。

```bash
cat diff.patch | tred patch --file a.ts --fuzzy --html
```

失败时生成 `tred-suggest.html`：左栏当前代码、右栏补丁目标、顶部相似度。

### 10.3 什么时候不要用 `--fuzzy`

- 文件里有 3 个以上结构几乎一样的方法（典型：React 组件的 3 个 `render*`）
- 补丁里只有 `return x;` 这类常见行，无稀有标识符（引擎会自己拒绝）
- CI 里跑 —— `--fuzzy` 只适合交互式修复，CI 应精确匹配失败即报错

### 10.4 `tred split` 与私有成员的边界 (v3.7.4+)

当拆分的方法内部访问了 `private` / `protected` 成员时：

1. **私有字段/方法（已拆或未拆）**：引擎会自动在 AST 层将其降级替换为 `(this as any).buffer` 或 `(this as any).render()`，确保新文件能通过 TS 编译门禁。
2. **未拆的私有方法**：如果拆出去的代码调用了**未被一起拆分**的私有方法，引擎会**直接报错阻断**（防止运行时 undefined）。此时，你需要把这个私有方法也加进 `--name` 列表。
3. **拆完必跑 `tsc --noEmit --strict`**：这是所有 AI 重构后的硬性检查，引擎虽然做了 AST 降级，但 AI 仍应确认最终产物不污染项目。

```bash
# 正确示例：将 public 方法和它依赖的 private 方法一起拆走
tred split --file engine.ts --name renderNode,calculatePosition --to render.ts
```
