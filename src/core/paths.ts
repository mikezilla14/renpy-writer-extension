// Path containment helpers, separated from vscode for unit testing.

function normalize(p: string, caseInsensitive: boolean): string {
  let n = p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (caseInsensitive) n = n.toLowerCase();
  return n;
}

/** True when the two paths refer to the same file (separator/case tolerant). */
export function samePath(
  a: string,
  b: string,
  caseInsensitive: boolean = process.platform === 'win32'
): boolean {
  return normalize(a, caseInsensitive) === normalize(b, caseInsensitive);
}

/** True when `p` is `root` or lives underneath it. */
export function isUnder(
  root: string,
  p: string,
  caseInsensitive: boolean = process.platform === 'win32'
): boolean {
  const r = normalize(root, caseInsensitive);
  const n = normalize(p, caseInsensitive);
  return n === r || n.startsWith(r + '/');
}
