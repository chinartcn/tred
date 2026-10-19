// 简单的 hash 函数
function hashStr(s: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  }
  return h >>> 0;
}

export function minHashJaccard(tokensA: string[], tokensB: string[], numHashes = 50): number {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let matches = 0;
  for (let i = 0; i < numHashes; i++) {
    let minA = Infinity, minB = Infinity;
    for (const t of setA) minA = Math.min(minA, hashStr(t, i));
    for (const t of setB) minB = Math.min(minB, hashStr(t, i));
    if (minA === minB) matches++;
  }
  return matches / numHashes;
}
