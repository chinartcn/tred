import { ParsedCst } from './cst.js';

export interface TredPluginContext {
  // 允许插件直接访问底层算法的能力
  utils: {
    tokenize: (text: string) => string[];
    getAstShape: (code: string) => string[];
    minHashJaccard: (a: string[], b: string[]) => number;
  };
}

export interface TredPlugin {
  name: string;
  version: string;
  // 插件初始化
  setup?: (ctx: TredPluginContext) => void;
  // CST 生命周期钩子：在解析 CST 后、执行前调用
  onCstParsed?: (parsed: ParsedCst) => ParsedCst | void;
  // 补丁拦截钩子：在 Patch 应用前调用
  onBeforePatch?: (file: string, diffText: string) => string | void;
}

const registeredPlugins: TredPlugin[] = [];
let pluginContext: TredPluginContext | null = null;

// 初始化底层工具暴露
export function initPluginContext(utils: TredPluginContext['utils']): void {
  pluginContext = { utils };
  for (const p of registeredPlugins) {
    if (p.setup && pluginContext) p.setup(pluginContext);
  }
}

export function registerPlugin(plugin: TredPlugin): void {
  if (registeredPlugins.find(p => p.name === plugin.name)) {
    console.warn(`[tred] 插件 ${plugin.name} 已存在，将被覆盖。`);
  }
  registeredPlugins.push(plugin);
  if (pluginContext && plugin.setup) plugin.setup(pluginContext);
  console.log(`[tred] 插件已注册: ${plugin.name}@${plugin.version}`);
}

export function getPlugins(): TredPlugin[] {
  return registeredPlugins;
}
