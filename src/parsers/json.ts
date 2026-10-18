import type { TredParser, AstRange } from './types.js';

export const jsonParser: TredParser = {
  extensions: ['.json'],
  checkSyntax(source: string): string[] {
    try {
      JSON.parse(source);
      return [];
    } catch (e) {
      return [e instanceof Error ? e.message : String(e)];
    }
  },
  findNode(source: string, selector: { path?: string }): AstRange | null {
    if (!selector.path) return null;
    const keys = selector.path.split('.');
    const lastKey = keys[keys.length - 1];
    // 利用正则寻找最内层的 key: value
    const re = new RegExp('"' + lastKey + '"\\s*:\\s*(\\{[^}]*\\}|\\[[^\\]]*\\]|"[^"]*"|true|false|null|\\d+)', 'm');
    const match = source.match(re);
    if (match && match.index !== undefined) {
      const keyPrefixLen = match[0].indexOf(match[1]);
      return {
        start: match.index + keyPrefixLen,
        end: match.index + match[0].length
      };
    }
    return null;
  }
};
