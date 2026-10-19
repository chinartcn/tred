import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { generateMap } from './map.js';
import { grepDir } from './grep.js';
import { splitFile } from './split.js';
import { applyPatch } from './patch.js';
import { replace } from './index.js';
import { analyzeImpact } from './impact.js';

// 拦截 console.log，防止输出污染 JSON-RPC 协议流
function captureConsoleLog(fn: () => any): string {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (...args: any[]) => {
    logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' '));
  };
  try {
    const result = fn();
    return typeof result === 'string' ? result : logs.join('\n');
  } finally {
    console.log = originalLog;
  }
}

const server = new McpServer({
  name: "tred-mcp",
  version: "3.7.0",
});

server.tool(
  "tred_map",
  "生成代码库的 JSON 树状大纲结构，了解项目架构",
  { dir: z.string().describe("目标目录，默认 .") },
  async ({ dir }) => {
    const map = generateMap(dir || '.');
    return { content: [{ type: "text", text: JSON.stringify(map, null, 2) }] };
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
    const targets = name.split(',').map(s => s.trim());
    const res = splitFile(file, targets, to, className);
    return { 
      content: [{ type: "text", text: res.ok ? `✅ ${res.message}` : `❌ ${res.message}` }] 
    };
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
    const res = applyPatch(file, diff, { fuzzy: fuzzy || false, autoHeal: autoHeal || false });
    return { 
      content: [{ 
        type: "text", 
        text: res.ok ? `✅ Patch 应用成功: ${file}` : `❌ Patch 失败: ${res.message}` 
      }] 
    };
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
    let astSelector = undefined;
    if (selector) {
      try { astSelector = JSON.parse(selector); } catch {}
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
      content: [{ type: "text", text: `[tred replace] ${r.status.toUpperCase()} ${file}\n${r.message || ''}` }] 
    };
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
    const res = analyzeImpact(dir || '.', target);
    return { content: [{ type: "text", text: res }] };
  }
);

export async function startMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🚀 [tred mcp] MCP Server 已启动，等待 AI 连接...");
}
