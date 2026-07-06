import { describe, expect, it } from 'vitest';
import { parseRpy } from '../src/core/parser';
import { FIXTURE, lineOf } from './fixture';

describe('parseRpy', () => {
  const model = parseRpy('script.rpy', FIXTURE);

  it('finds all labels, resolving local labels against their parent', () => {
    expect(model.labels.map((l) => l.name)).toEqual([
      'start',
      'party',
      'party.after_party',
      'ending',
    ]);
    expect(model.labels.map((l) => l.local)).toEqual([false, false, true, false]);
  });

  it('spans label bodies to the last significant line', () => {
    const start = model.labels.find((l) => l.name === 'start')!;
    expect(start.headerLine).toBe(lineOf(FIXTURE, 'label start:'));
    expect(start.endLine).toBe(lineOf(FIXTURE, 'return', 0));
  });

  it('finds menus and their choices (captions are not choices)', () => {
    expect(model.menus).toHaveLength(1);
    expect(model.menus[0].choices.map((c) => c.text)).toEqual(['Go to the party', 'Stay home']);
  });

  it('records defines and defaults', () => {
    expect(model.defines.map((d) => d.name)).toEqual(['e', 'inventory']);
    expect(model.defines[1].rhs).toBe('[]');
    expect(model.defaults.map((d) => d.name)).toEqual(['points']);
  });

  it('records assignments with the right save-relevant context', () => {
    const byName = Object.fromEntries(model.assignments.map((a) => [a.name, a]));
    expect(byName['points']).toMatchObject({ op: '+=', context: 'label' });
    expect(byName['mood']).toMatchObject({ op: '=', context: 'label' });
    expect(byName['inventory']).toMatchObject({ mutation: 'append', context: 'label' });
    expect(byName['flags']).toMatchObject({ op: '=', context: 'init' });
  });

  it('records jumps', () => {
    expect(model.jumps.map((j) => j.target)).toEqual(['party', 'ending']);
    expect(model.jumps.every((j) => !j.dynamic)).toBe(true);
  });

  it('attributes dialogue, including attribute form and menu captions', () => {
    expect(model.dialogue.map((d) => d.speaker)).toEqual(['e', null, null, 'e']);
    expect(model.dialogue[0].text).toBe('Hello there! How are you?');
    expect(model.dialogue[3].text).toBe('Welcome!');
  });

  it('does not treat screen text statements as dialogue', () => {
    expect(model.dialogue.some((d) => d.text === 'Points')).toBe(false);
  });

  it('resolves local jump targets against the enclosing global label', () => {
    const m = parseRpy('x.rpy', 'label chapter:\n    jump .part_two\n\nlabel .part_two:\n    return\n');
    expect(m.jumps[0].target).toBe('chapter.part_two');
  });

  it('marks expression jumps as dynamic', () => {
    const m = parseRpy('x.rpy', 'label a:\n    jump expression dest_var\n');
    expect(m.jumps[0].dynamic).toBe(true);
    expect(m.jumps[0].target).toBeUndefined();
  });

  it('joins bracketed logical lines across physical lines', () => {
    const m = parseRpy(
      'x.rpy',
      'define cast = Character(\n    "Long Name",\n    color="#fff")\n\nlabel start:\n    return\n'
    );
    expect(m.defines).toHaveLength(1);
    expect(m.defines[0].name).toBe('cast');
    expect(m.labels.map((l) => l.name)).toEqual(['start']);
  });

  it('captures renpy.jump calls inside python', () => {
    const m = parseRpy('x.rpy', 'label a:\n    python:\n        renpy.jump("ending")\n');
    expect(m.jumps[0]).toMatchObject({ kind: 'jump', target: 'ending', dynamic: false });
  });

  it('records suppression comments', () => {
    const m = parseRpy('x.rpy', 'define palette = [] # renpy-analytics: save-safe\n');
    expect(m.suppressions.get(0)).toBe('save-safe');
  });
});
