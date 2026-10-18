import type { TredParser, AstRange } from './types.js';

export const markdownParser: TredParser = {
  extensions: ['.md', '.markdown'],
  checkSyntax(source: string): string[] {
    return []; // Markdown 容错率极高，暂不严格拦截
  },
  findNode(source: string, selector: { heading?: string, codeLang?: string }): AstRange | null {
    const lines = source.split('\n');
    let pos = 0;
    
    if (selector.heading) {
      const target = selector.heading;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === target || lines[i].startsWith('#' + target) || lines[i].startsWith('##' + target)) {
          const start = pos;
          const end = pos + lines[i].length;
          return { start, end };
        }
        pos += lines[i].length + 1;
      }
    }
    
    if (selector.codeLang) {
      const startTag = '```' + selector.codeLang;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith(startTag)) {
          const start = pos + lines[i].length + 1;
          let j = i + 1;
          let end = start;
          while (j < lines.length && !lines[j].startsWith('```')) {
            end += lines[j].length + 1;
            j++;
          }
          return { start, end: end - 1 };
        }
        pos += lines[i].length + 1;
      }
    }
    return null;
  }
};
