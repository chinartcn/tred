export interface AstRange { start: number; end: number; }

export interface TredParser {
  extensions: string[];
  findNode(source: string, selector: any): AstRange | null;
  /** v2.1.0: 每种语言负责自己的语法校验 */
  checkSyntax(source: string): string[];
}