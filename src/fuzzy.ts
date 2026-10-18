/**
 * 将名称拆解为词根。支持 CamelCase 拆分和中文提取。
 * 例如: updateStatsPanel -> ['update', 'stats', 'panel']
 */
export function tokenize(str: string): string[] {
  if (!str) return [];
  const camelRegex = /([a-z0-9])([A-Z])/g;
  const snakeRegex = /[-_]/g;
  const normalized = str.replace(camelRegex, '$1 $2').replace(snakeRegex, ' ');
  const tokens = normalized.match(/[a-zA-Z0-9]+|[\u4e00-\u9fa5]+/g) || [];
  return tokens.map(t => t.toLowerCase());
}

/**
 * 使用 Dice 系数计算两个字符串的相似度（0 ~ 1）
 */
export function getSimilarity(query: string, target: string): number {
  const qTokens = new Set(tokenize(query));
  const tTokens = new Set(tokenize(target));
  if (qTokens.size === 0 || tTokens.size === 0) return 0;

  let intersection = 0;
  for (const t of qTokens) {
    if (tTokens.has(t)) intersection++;
  }
  return (2 * intersection) / (qTokens.size + tTokens.size);
}