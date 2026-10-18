import postcss from 'postcss';
import type { TredParser, AstRange } from './types.js';

export const cssParser: TredParser = {
  extensions: ['.css', '.scss', '.less'],
  checkSyntax(source: string): string[] {
    try {
      postcss.parse(source);
      return [];
    } catch (e) {
      return [(e as Error).message];
    }
  },
  findNode(source: string, selector: { selector?: string }): AstRange | null {
    if (!selector.selector) return null;
    const root = postcss.parse(source);
    let found = false;
    root.walkRules(rule => {
      if (rule.selector === selector.selector) {
        if (rule.source && rule.source.start && rule.source.end) {
          const start = rule.source.start.offset!;
          const end = rule.source.end.offset! + 1;
          (selector as any).__res = { start, end };
          found = true;
        }
      }
    });
    return found ? (selector as any).__res : null;
  }
};