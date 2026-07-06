import { describe, expect, it } from 'vitest';
import { computeFoldingRanges, FoldRange } from '../src/core/folding';
import { parseRpy } from '../src/core/parser';
import { FIXTURE, lineOf } from './fixture';

function find(ranges: FoldRange[], start: number): FoldRange | undefined {
  return ranges.find((r) => r.start === start);
}

describe('computeFoldingRanges', () => {
  const ranges = computeFoldingRanges(parseRpy('script.rpy', FIXTURE));

  it('folds label bodies up to the last significant line before the next label', () => {
    const start = find(ranges, lineOf(FIXTURE, 'label start:'))!;
    expect(start).toMatchObject({ blockKind: 'label', region: true });
    expect(start.end).toBe(lineOf(FIXTURE, 'return', 0));

    const party = find(ranges, lineOf(FIXTURE, 'label party:'))!;
    expect(party.end).toBe(lineOf(FIXTURE, 'jump ending'));
  });

  it('folds menus and each individual choice', () => {
    const menu = find(ranges, lineOf(FIXTURE, 'menu:'))!;
    expect(menu).toMatchObject({ blockKind: 'menu', region: true });
    expect(menu.end).toBe(lineOf(FIXTURE, 'return', 0));

    const choiceA = find(ranges, lineOf(FIXTURE, '"Go to the party":'))!;
    expect(choiceA).toMatchObject({ blockKind: 'choice', name: 'Go to the party' });
    expect(choiceA.end).toBe(lineOf(FIXTURE, 'jump party'));

    const choiceB = find(ranges, lineOf(FIXTURE, '"Stay home"'))!;
    expect(choiceB.end).toBe(lineOf(FIXTURE, 'return', 0));
  });

  it('folds init python and screen blocks', () => {
    const init = find(ranges, lineOf(FIXTURE, 'init python:'))!;
    expect(init).toMatchObject({ blockKind: 'init', region: true });
    expect(init.end).toBe(lineOf(FIXTURE, 'flags = 0'));

    const screen = find(ranges, lineOf(FIXTURE, 'screen stats'))!;
    expect(screen).toMatchObject({ blockKind: 'screen', region: true });
    expect(screen.end).toBe(lineOf(FIXTURE, 'text "Points"'));
  });

  it('does not emit ranges for empty blocks', () => {
    expect(ranges.every((r) => r.end > r.start)).toBe(true);
  });
});
