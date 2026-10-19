import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateMap } from './map.js';
import { grepDir } from './grep.js';
import { splitFile } from './split.js';
import { applyPatch } from './patch.js';
import { replace } from './index.js';
import { analyzeImpact } from './impact.js';
import { runCst } from './cst.js';

// 🛡️ 全局劫持 console.log，彻底防止底层工具污染 JSON-RPC 的 stdout
console.log = (...args: any[]) => {
  console.error(...args);
};

// 捕获函数执行期间的 console.log (仅用于 tred_grep 这种直接打印的控制台输出)
function captureConsoleLog(fn: () => any): string {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: any[]) => {
    logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' '));
  };
  try {
    fn();
    return logs.join('\n');
  } catch (e) {
    return `❌ 执行出错: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    console.log = originalLog;
  }
}

const server = new McpServer({
  name: "tred-mcp",
  version: "3.7.7",
});

server.tool(
  "tred_map",
  "生成代码库的 JSON 树状大纲结构，了解项目架构",
  { dir: z.string().describe("目标目录，默认 .") },
  async ({ dir }) => {
    try {
      const map = generateMap(dir || '.');
      return { content: [{ type: "text", text: JSON.stringify(map, null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `❌ map 失败: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

server.tool(
  "tred_grep",
  "使用 AST 进行语义级全局搜索",
  { 
    pattern: z.string().describe("搜索模式"),
    dir: z.string().optional().describe("目标目录"),
    ast: z.boolean().optional().describe("是否输出 AST 上下文")
  },
  async ({ pattern, dir, ast }) => {
    const result = captureConsoleLog(() => {
      grepDir(dir || '.', pattern, ast || false, false);
    });
    if (result.startsWith('❌')) {
      return { isError: true, content: [{ type: "text", text: result }] };
    }
    return { content: [{ type: "text", text: result || "无匹配结果" }] };
  }
);

server.tool(
  "tred_split",
  "拆分巨型文件（全薄壳模式），自动提取方法/函数到新文件",
  {
    file: z.string().describe("源文件路径"),
    name: z.string().describe("要提取的函数或方法名，多个用逗号分隔"),
    to: z.string().describe("新文件路径（如 src/util.ts）"),
    className: z.string().optional().describe("所属类名（多类冲突时必填）")
  },
  async ({ file, name, to, className }) => {
    try {
      const targets = name.split(',').map(s => s.trim());
      const res = splitFile(file, targets, to, className);
      return { 
        isError: !res.ok,
        content: [{ type: "text", text: res.ok ? `✅ ${res.message}` : `❌ ${res.message}` }] 
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `❌ split 异常: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

server.tool(
  "tred_patch",
  "原生 Unified Diff 补丁合并，支持 fuzzy 模糊匹配与 auto-heal",
  {
    file: z.string().describe("目标文件路径"),
    diff: z.string().describe("Unified diff 补丁内容"),
    fuzzy: z.boolean().optional().describe("是否启用模糊匹配"),
    autoHeal: z.boolean().optional().describe("是否启用自动自愈")
  },
  async ({ file, diff, fuzzy, autoHeal }) => {
    try {
      const res = applyPatch(file, diff, { fuzzy: fuzzy || false, autoHeal: autoHeal || false });
      return { 
        isError: !res.ok,
        content: [{ 
          type: "text", 
          text: res.ok ? `✅ Patch 应用成功: ${file}` : `❌ Patch 失败: ${res.message}` 
        }] 
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `❌ patch 异常: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

server.tool(
  "tred_replace",
  "基于锚点或 AST 的精准代码替换",
  {
    file: z.string().describe("目标文件路径"),
    content: z.string().describe("替换后的新代码内容"),
    anchor: z.string().optional().describe("锚点名"),
    selector: z.string().optional().describe("JSON 格式的 AST 选择器")
  },
  async ({ file, content, anchor, selector }) => {
    try {
      let astSelector = undefined;
      if (selector) {
        try { astSelector = JSON.parse(selector); } 
        catch { return { isError: true, content: [{ type: "text", text: "❌ selector 解析失败：必须是合法 JSON" }] }; }
      }
      const r = await replace({
        file,
        anchor: anchor || '',
        content,
        fingerprint: '',
        astSelector,
        autoInjectAnchor: !!anchor
      });
      return { 
        isError: r.status === 'failed',
        content: [{ type: "text", text: `[tred replace] ${r.status.toUpperCase()} ${file}\n${r.message || ''}` }] 
      };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `❌ replace 异常: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);

server.tool(
  "tred_impact",
  "分析目标符号的依赖影响面",
  {
    target: z.string().describe("要分析的符号名（如 ITEMS）"),
    dir: z.string().optional().describe("目标目录")
  },
  async ({ target, dir }) => {
    try {
      const res = analyzeImpact(dir || '.', target);
      return { content: [{ type: "text", text: res }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `❌ impact 异常: ${e instanceof Error ? e.message : String(e)}` }] };
    }
  }
);


server.tool(
  "tred_run_cst",
  "执行 .cst (Changes Long Text) 宏脚本。AI 生成脚本后调用此工具执行。",
  {
    file: z.string().describe("CST 脚本的路径"),
    allowNodejs: z.boolean().optional().describe("是否允许执行脚本内的 /#nodejs 块（默认 false，防注入）")
  },
  async ({ file, allowNodejs }) => {
    try {
      const { spawnSync } = await import('node:child_process');
      const args = ['dist/cli.js', 'run', file];
      if (allowNodejs) args.push('--allow-nodejs');
      const res = spawnSync(process.execPath, args, { encoding: 'utf-8' });
      
      if (res.status === 0) {
        return { content: [{ type: "text", text: "✅ CST 脚本执行成功。\n" + res.stdout }] };
      } else {
        return { isError: true, content: [{ type: "text", text: "❌ CST 脚本执行失败：\n" + res.stderr }] };
      }
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: "❌ 执行异常: " + (e instanceof Error ? e.message : String(e)) }] };
    }
  }
);

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 [tred mcp] MCP Server 已启动，等待 AI 连接...");
}
