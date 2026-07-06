import { describe, expect, it } from 'vitest';
import { isUnder } from '../src/core/paths';

describe('isUnder', () => {
  it('matches files inside the root across separator styles', () => {
    expect(isUnder('C:\\repo\\prod\\game', 'C:\\repo\\prod\\game\\script.rpy', true)).toBe(true);
    expect(isUnder('C:/repo/prod/game', 'C:\\repo\\prod\\game\\sub\\a.rpy', true)).toBe(true);
  });

  it('rejects sibling folders, including prefix-sharing names', () => {
    expect(isUnder('C:/repo/prod/game', 'C:/repo/nonprod/game/script.rpy', true)).toBe(false);
    expect(isUnder('C:/repo/prod', 'C:/repo/prod-old/script.rpy', true)).toBe(false);
  });

  it('matches the root itself and honors case sensitivity flag', () => {
    expect(isUnder('C:/repo/game', 'C:/repo/game', true)).toBe(true);
    expect(isUnder('C:/Repo/Game', 'c:/repo/game/a.rpy', true)).toBe(true);
    expect(isUnder('/repo/Game', '/repo/game/a.rpy', false)).toBe(false);
  });
});
