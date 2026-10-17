import ts from 'typescript';

/**
 * 用 TS 官方 parser 做语法门禁：
 * parseDiagnostics 只包含词法/语法级错误，毫秒级，不做类型检查。
 * 类型检查应放 CI，不要卡在写入路径上。
 */
export function checkSyntax(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.map((d) => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    if (d.file && typeof d.start === 'number') {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${d.file.fileName}:${line + 1}:${character + 1} - TS${d.code}: ${msg}`;
    }
    return `TS${d.code}: ${msg}`;
  });
}
