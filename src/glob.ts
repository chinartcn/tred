export function globToRegex(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; }
      else { re += '[^/]*'; }
    } else if (ch === '?') { re += '[^/]'; }
    else if ('.+^$()|[]\\\\{}'.indexOf(ch) >= 0) { re += '\\\\' + ch; }
    else { re += ch; }
  }
  re += '$';
  return new RegExp(re);
}

export function matchesAnyGlob(relPath: string, globs: string[]): boolean {
  if (globs.length === 0) return false;
  const base = relPath.split('/').pop() ?? relPath;
  for (const g of globs) {
    const re = globToRegex(g);
    if (re.test(relPath) || re.test(base)) return true;
  }
  return false;
}
