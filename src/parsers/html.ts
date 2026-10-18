import { parse } from 'node-html-parser';
import type { TredParser, AstRange } from './types.js';

export const htmlParser: TredParser = {
  extensions: ['.html', '.htm'],
  checkSyntax(source: string): string[] {
    try {
      parse(source);
      return []; // node-html-parser 容错极高，仅拦截严重崩溃
    } catch (e) {
      return [(e as Error).message];
    }
  },
  findNode(source: string, selector: { cssSelector?: string }): AstRange | null {
    if (!selector.cssSelector) return null;
    const root = parse(source);
    const el = root.querySelector(selector.cssSelector);
    if (!el) return null;
    const start = el.range[0];
    const end = el.range[1];
    return { start, end };
  }
};