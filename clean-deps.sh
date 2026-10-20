#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== 1. 暴力卸载残留依赖 ==="
# 卸载实体包
pnpm remove onnxruntime-node protobufjs @huggingface/transformers 2>/dev/null || true

echo "=== 2. 清理 package.json 中的残余 ==="
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  let changed = false;

  const removeFrom = (obj) => {
    if (!obj) return;
    if (obj["onnxruntime-node"]) { delete obj["onnxruntime-node"]; changed = true; }
    if (obj["protobufjs"]) { delete obj["protobufjs"]; changed = true; }
    if (obj["@huggingface/transformers"]) { delete obj["@huggingface/transformers"]; changed = true; }
  };

  removeFrom(pkg.dependencies);
  removeFrom(pkg.devDependencies);
  removeFrom(pkg.optionalDependencies);

  if (changed) {
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
    console.log("✓ package.json 已彻底清理完毕");
  } else {
    console.log("· package.json 干净得很，无需清理");
  }
'

echo "=== 3. 重新构建和冒烟测试 ==="
npm run build
bash smoke.sh | tail -3

echo "=== 4. 发布无依赖纯净版 4.3.2 ==="
npm version 4.3.2 --no-git-tag-version
echo '4.3.2' > .tred-version
npm run build

git add -A
git commit -m "chore(deps): 彻底清理残留的 ONNX 与 protobufjs 依赖

- 移除 v3.9.0 引入向量模型时残留的 onnxruntime-node 和 protobufjs
- 保持 tred 核心 100% 纯 TS 算法与零重型原生依赖
- 重新打包发布 v4.3.2"
git tag v4.3.2
npm publish --access public
git push origin main --tags
