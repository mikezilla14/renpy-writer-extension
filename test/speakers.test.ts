import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/core/metrics';
import { parseRpy } from '../src/core/parser';
import { analyzeSpeakers } from '../src/core/speakers';

const SCRIPT = `define lady_eleanor = Character("Lady Eleanor")
define m = Character("Margaret")

label scene_one:
    lady_eleanor "You dare search my rooms?"
    "Lady Eleanor" "Hush, Margaret... if Sir John should wake..."
    "Margaret" "Then let him wake, my Lady."
    "Cora (reading)" "'...I have never felt such low, delicious agony...'"
    return
`;

describe('parser adhoc flag', () => {
  const model = parseRpy('script.rpy', SCRIPT);

  it('distinguishes string speakers from variable speakers', () => {
    const byLine = new Map(model.dialogue.map((d) => [d.line, d]));
    expect(byLine.get(4)).toMatchObject({ speaker: 'lady_eleanor', adhoc: false });
    expect(byLine.get(5)).toMatchObject({ speaker: 'Lady Eleanor', adhoc: true });
    expect(byLine.get(7)).toMatchObject({ speaker: 'Cora (reading)', adhoc: true });
  });
});

describe('metrics with string speakers', () => {
  const metrics = computeMetrics([parseRpy('script.rpy', SCRIPT)]);

  it('keeps string speakers separate from defined characters and marks them', () => {
    const variable = metrics.characters.find((c) => c.key === 'lady_eleanor')!;
    const stringSpeaker = metrics.characters.find((c) => c.key === 'Lady Eleanor')!;
    expect(variable.adhoc).toBe(false);
    expect(variable.displayName).toBe('Lady Eleanor');
    expect(stringSpeaker.adhoc).toBe(true);
    expect(stringSpeaker.lines).toBe(1);
  });
});

describe('analyzeSpeakers', () => {
  it('flags string speakers matching a defined character display name', () => {
    const findings = analyzeSpeakers([parseRpy('script.rpy', SCRIPT)]);
    expect(findings.map((f) => f.speaker).sort()).toEqual(['Lady Eleanor', 'Margaret']);
    const eleanor = findings.find((f) => f.speaker === 'Lady Eleanor')!;
    expect(eleanor).toMatchObject({ rule: 'duplicate-speaker', characterVar: 'lady_eleanor', line: 5 });
  });

  it('does not flag string speakers with no defined counterpart', () => {
    const findings = analyzeSpeakers([parseRpy('script.rpy', SCRIPT)]);
    expect(findings.some((f) => f.speaker === 'Cora (reading)')).toBe(false);
  });

  it('matches display names defined in other files', () => {
    const defs = parseRpy('defs.rpy', 'define e = Character("Eileen")\n');
    const story = parseRpy('story.rpy', 'label start:\n    "Eileen" "Hello."\n    return\n');
    const findings = analyzeSpeakers([defs, story]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ speaker: 'Eileen', characterVar: 'e', file: 'story.rpy' });
  });

  it('honors the string-speaker suppression comment', () => {
    const m = parseRpy(
      'x.rpy',
      [
        'define e = Character("Eileen")',
        '',
        'label start:',
        '    # renpy-analytics: string-speaker',
        '    "Eileen" "Intentionally distinct voice."',
        '    return',
        '',
      ].join('\n')
    );
    expect(analyzeSpeakers([m])).toEqual([]);
  });
});
