import { describe, expect, it } from 'vitest';
import {
  findWarpTarget,
  looksLikeSdkDir,
  rankSdkDirNames,
  resolveSdkExecutable,
} from '../src/core/warp';

describe('findWarpTarget', () => {
  it('splits at the game/ directory and emits a 1-based forward-slash spec', () => {
    const t = findWarpTarget('C:\\vn\\myproject\\game\\script.rpy', 41);
    expect(t).toEqual({ projectDir: 'C:\\vn\\myproject', spec: 'game/script.rpy:42' });
  });

  it('handles posix paths and nested script folders', () => {
    const t = findWarpTarget('/home/me/vn/game/days/day1.rpy', 0);
    expect(t).toEqual({ projectDir: '/home/me/vn', spec: 'game/days/day1.rpy:1' });
  });

  it('uses the innermost game/ directory when nested', () => {
    const t = findWarpTarget('/repo/game/mods/game/script.rpy', 5);
    expect(t?.projectDir).toBe('/repo/game/mods');
    expect(t?.spec).toBe('game/script.rpy:6');
  });

  it('matches game/ case-insensitively (Windows checkouts)', () => {
    const t = findWarpTarget('C:\\vn\\proj\\Game\\script.rpy', 9);
    expect(t?.projectDir).toBe('C:\\vn\\proj');
    expect(t?.spec).toBe('Game/script.rpy:10');
  });

  it('returns undefined when the file is not under a game/ folder', () => {
    expect(findWarpTarget('C:\\vn\\scratch\\script.rpy', 3)).toBeUndefined();
    expect(findWarpTarget('/game/script.rpy', 3)).toBeUndefined(); // nothing above game/
  });
});

describe('resolveSdkExecutable', () => {
  const fsOf = (existing: string[]) => (p: string) => existing.includes(p);

  it('accepts the SDK folder and appends the platform launcher', () => {
    const exists = fsOf(['C:\\renpy-8.3.4-sdk\\renpy.exe']);
    expect(resolveSdkExecutable('C:\\renpy-8.3.4-sdk', 'win32', exists)).toBe(
      'C:\\renpy-8.3.4-sdk\\renpy.exe'
    );
    expect(resolveSdkExecutable('C:\\renpy-8.3.4-sdk\\', 'win32', exists)).toBe(
      'C:\\renpy-8.3.4-sdk\\renpy.exe'
    );
  });

  it('accepts a direct path to the launcher', () => {
    const exe = '/opt/renpy-8.3.4-sdk/renpy.sh';
    expect(resolveSdkExecutable(exe, 'linux', fsOf([exe]))).toBe(exe);
  });

  it('returns undefined for empty or unusable paths', () => {
    expect(resolveSdkExecutable('', 'win32', () => true)).toBeUndefined();
    expect(resolveSdkExecutable('C:\\nowhere', 'win32', () => false)).toBeUndefined();
    expect(
      resolveSdkExecutable('C:\\sdk\\renpy.exe', 'win32', fsOf([]))
    ).toBeUndefined();
  });
});

describe('SDK directory detection', () => {
  it('recognizes typical SDK folder names and rejects others', () => {
    expect(looksLikeSdkDir('renpy-8.3.4-sdk')).toBe(true);
    expect(looksLikeSdkDir('renpy-7.4.11-sdk')).toBe(true);
    expect(looksLikeSdkDir('RenPy-8.2.0')).toBe(true);
    expect(looksLikeSdkDir('renpy-sdk')).toBe(true);
    expect(looksLikeSdkDir('my-vn-project')).toBe(false);
    expect(looksLikeSdkDir('renpy-vs-code-extension')).toBe(false);
  });

  it('ranks SDK folders newest version first', () => {
    expect(
      rankSdkDirNames(['renpy-7.4.11-sdk', 'renpy-8.3.4-sdk', 'renpy-8.10.1-sdk'])
    ).toEqual(['renpy-8.10.1-sdk', 'renpy-8.3.4-sdk', 'renpy-7.4.11-sdk']);
  });

  it('sorts versionless names last, alphabetically', () => {
    expect(rankSdkDirNames(['renpy-sdk', 'renpy-8.3.4-sdk'])).toEqual([
      'renpy-8.3.4-sdk',
      'renpy-sdk',
    ]);
  });
});
