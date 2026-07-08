// Warp-to-cursor playtest: locate the Ren'Py project root and SDK executable,
// and build the `renpy <projectdir> run --warp file:line` invocation.
// Separated from vscode for unit testing; filesystem access is injected.

export interface WarpTarget {
  /** Ren'Py base directory — the folder containing game/. */
  projectDir: string;
  /** Warp spec relative to projectDir, e.g. "game/script.rpy:42" (1-based line). */
  spec: string;
}

/**
 * Derives the warp invocation for a script file and 0-based cursor line.
 * The project root is the parent of the last `game` directory in the path —
 * Ren'Py resolves --warp paths against the base directory, not game/.
 * Returns undefined when the file is not inside a game/ folder.
 */
export function findWarpTarget(filePath: string, line0: number): WarpTarget | undefined {
  const parts = filePath.replace(/\\/g, '/').split('/');
  let gameIdx = -1;
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i].toLowerCase() === 'game') {
      gameIdx = i;
      break;
    }
  }
  if (gameIdx <= 0) return undefined; // no game/ dir, or nothing above it
  const sep = filePath.includes('\\') ? '\\' : '/';
  const projectDir = parts.slice(0, gameIdx).join(sep);
  if (!projectDir) return undefined; // game/ sits at the filesystem root
  return {
    projectDir,
    spec: `${parts.slice(gameIdx).join('/')}:${line0 + 1}`,
  };
}

/** Launcher executable filenames for the platform, in preference order. */
export function sdkExecutableNames(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['renpy.exe'] : ['renpy.sh'];
}

/**
 * Resolves a user-supplied SDK path (either the SDK folder or the executable
 * itself) to a launcher executable, or undefined when nothing usable exists.
 */
export function resolveSdkExecutable(
  sdkPath: string,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean
): string | undefined {
  const trimmed = sdkPath.trim().replace(/[\\/]+$/, '');
  if (!trimmed) return undefined;
  const names = sdkExecutableNames(platform);
  const base = trimmed.replace(/\\/g, '/').split('/').pop() ?? '';
  if (names.some((n) => n.toLowerCase() === base.toLowerCase())) {
    return exists(trimmed) ? trimmed : undefined;
  }
  const sep = trimmed.includes('\\') ? '\\' : '/';
  for (const name of names) {
    const candidate = `${trimmed}${sep}${name}`;
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

/** True for directory names that look like a Ren'Py SDK install (renpy-8.3.4-sdk …). */
export function looksLikeSdkDir(name: string): boolean {
  return /^renpy[-_.\s]?\d/i.test(name) || /^renpy.*sdk$/i.test(name);
}

/**
 * Orders SDK directory names newest-version-first. Version is the first
 * dotted number sequence in the name; names without one sort last.
 */
export function rankSdkDirNames(names: string[]): string[] {
  const version = (n: string): number[] =>
    (n.match(/\d+(?:\.\d+)*/)?.[0] ?? '').split('.').filter(Boolean).map(Number);
  const cmp = (a: number[], b: number[]): number => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (b[i] ?? -1) - (a[i] ?? -1);
      if (d !== 0) return d;
    }
    return 0;
  };
  return [...names].sort((a, b) => cmp(version(a), version(b)) || a.localeCompare(b));
}
