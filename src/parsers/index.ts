import { jsonParser } from './json.js';
import { markdownParser } from './markdown.js';
import { htmlParser } from './html.js';
import { cssParser } from './css.js';
import type { TredParser } from './types.js';

const parsers: TredParser[] = [jsonParser, markdownParser, htmlParser, cssParser];

export function getParser(file: string): TredParser | null {
  const ext = '.' + file.split('.').pop();
  return parsers.find(p => p.extensions.includes(ext)) || null;
}

export * from './types.js';
