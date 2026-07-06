import { describe, expect, it } from 'vitest';
import { parseRpy } from '../src/core/parser';
import { analyzeSaveSafety, SaveSafetyFinding } from '../src/core/saveSafety';

function rulesFor(findings: SaveSafetyFinding[], name: string): string[] {
  return findings.filter((f) => f.name === name).map((f) => f.rule);
}

describe('analyzeSaveSafety', () => {
  const SCRIPT = `define inventory = []
define e = Character("Eileen")
define max_hp = 100
default points = 0

label start:
    $ inventory.append("sword")
    $ max_hp = 200
    $ mood = "happy"
    $ points = 1
    return

init python:
    chapter = 1

label two:
    $ chapter = 2
    return
`;
  const findings = analyzeSaveSafety([parseRpy('script.rpy', SCRIPT)]);

  it('flags mutable literals in define', () => {
    expect(rulesFor(findings, 'inventory')).toContain('define-mutable-literal');
  });

  it('flags in-place mutation of a define\'d value', () => {
    expect(rulesFor(findings, 'inventory')).toContain('define-mutated');
  });

  it('flags runtime reassignment of a define\'d name', () => {
    expect(rulesFor(findings, 'max_hp')).toEqual(['define-reassigned']);
  });

  it('flags variables first created inside a label without a default', () => {
    const f = findings.find((f) => f.name === 'mood')!;
    expect(f.rule).toBe('missing-default');
    expect(f.severity).toBe('info');
  });

  it('flags init-assigned variables changed at runtime (and not as missing-default)', () => {
    expect(rulesFor(findings, 'chapter')).toEqual(['init-variable-changed']);
  });

  it('does not flag defaulted variables or immutable defines', () => {
    expect(rulesFor(findings, 'points')).toEqual([]);
    expect(rulesFor(findings, 'e')).toEqual([]);
  });

  it('resolves defines/defaults across files', () => {
    const a = parseRpy('defs.rpy', 'default mood = "calm"\n');
    const b = parseRpy('story.rpy', 'label start:\n    $ mood = "happy"\n    return\n');
    expect(analyzeSaveSafety([a, b])).toEqual([]);
  });

  it('ignores persistent, config, and underscore-prefixed names', () => {
    const m = parseRpy(
      'x.rpy',
      'label start:\n    $ persistent.seen_intro = True\n    $ _tmp = 1\n    return\n'
    );
    expect(analyzeSaveSafety([m])).toEqual([]);
  });

  it('honors suppression comments on the same or preceding line', () => {
    const m = parseRpy(
      'x.rpy',
      [
        'define palette = [] # renpy-analytics: save-safe',
        '',
        'label start:',
        '    # renpy-analytics: save-safe',
        '    $ palette.append("red")',
        '    return',
        '',
      ].join('\n')
    );
    expect(analyzeSaveSafety([m])).toEqual([]);
  });

  it('reports missing-default only once per variable', () => {
    const m = parseRpy(
      'x.rpy',
      'label start:\n    $ mood = "a"\n    $ mood = "b"\n    return\n'
    );
    expect(analyzeSaveSafety([m])).toHaveLength(1);
  });
});
