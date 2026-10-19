#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "══════════════════════════════════════════════"
echo "1. 准备测试文件"
echo "══════════════════════════════════════════════"

# 目标被修改的文件
cat > test-plugin-target.ts <<'TS'
export function greet(name: string) {
  return "Hello, " + name;
}
TS

# CST 宏脚本
cat > test-plugin.cst <<'CST'
replace {
  file: test-plugin-target.ts
  selector: {"kind":"function","functionName":"greet"}
  content:
    export function greet(name: string) {
      return "Hello, " + name;
    }
  /#end
}
CST

# 插件代码
cat > test-plugin.ts <<'TS'
import { registerPlugin, tokenize } from './src/index.js';

registerPlugin({
  name: 'MyCustomInterceptor',
  version: '1.0.0',
  
  setup: (ctx) => {
    console.log('\n[插件] 🚀 初始化成功！');
    console.log('[插件] 底层分词器测试 "fetchUserData":', ctx.utils.tokenize('fetchUserData'));
  },

  onCstParsed: (parsed) => {
    console.log(`\n[插件] 拦截到 CST 解析，共 ${parsed.ops.length} 个操作。`);
    
    for (const op of parsed.ops) {
      if (op.type === 'replace' && op.props.file === 'test-plugin-target.ts') {
        console.log('[插件] 强行篡改 AI 生成的代码内容...');
        // 在 AI 生成的内容里注入一行代码
        op.content = op.content?.replace(
          'return "Hello, " + name;',
          'console.log("🚀 这行代码是插件注入的！");\n  return "Hacked by Plugin: " + name;'
        );
      }
    }
    return parsed; // 返回修改后的结果
  }
});

// 启动 CLI 执行 CST
import { cliMain } from './src/cli.js';
cliMain(['run', 'test-plugin.cst']);
TS

echo "══════════════════════════════════════════════"
echo "2. 执行带插件的 CST 脚本"
echo "══════════════════════════════════════════════"
npx tsx test-plugin.ts

echo
echo "══════════════════════════════════════════════"
echo "3. 查看最终被修改的代码（看看插件是否生效）"
echo "══════════════════════════════════════════════"
cat test-plugin-target.ts

# 清理现场
rm -f test-plugin.ts test-plugin.cst test-plugin-target.ts
