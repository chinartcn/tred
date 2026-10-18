# tred (Code Semantic Engine) - AI Skill Guide

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

## 6. 拆分巨型文件
如果文件超过 1000 行，需要将部分函数拆分出去，使用：
```bash
tred split --file giant.ts --name foo,bar --to util.ts
```

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

## 9. 补丁自愈与可视化
如果你的 diff 因为文件被格式化过而打不上，可以：
1. 使用 `--auto-heal` 让引擎自动修正上下文并打入。
2. 使用 `--html` 生成浏览器视图，自己肉眼 review 后再调低阈值重试。
