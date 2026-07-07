import { describe, expect, it } from 'vitest';
import { computeFileInsights } from '../src/core/fileInsights';
import { analyzeFlow } from '../src/core/graph';
import { parseRpy } from '../src/core/parser';

const CHAPTER = `label start:
    e "Hello there! How are you?"
    "The room is quiet."
    menu:
        "Stay":
            jump stay_scene
        "Leave":
            call helper_scene

label stay_scene:
    e "Glad you stayed. Sit down."
    return

label lonely_orphan:
    return
`;

const SUPPORT = `define e = Character("Eileen")

label helper_scene:
    "A short interlude."
    jump stay_scene
`;

describe('computeFileInsights', () => {
  const a = parseRpy('chapter.rpy', CHAPTER);
  const b = parseRpy('support.rpy', SUPPORT);
  const flow = analyzeFlow([a, b]);
  const insights = computeFileInsights(a, [a, b], flow, 100);

  it('summarizes structure and words', () => {
    expect(insights.labels).toBe(3);
    expect(insights.menus).toBe(1);
    expect(insights.choices).toBe(2);
    expect(insights.words).toBe(14); // 5 + 4 + 5
    expect(insights.dialogueLines).toBe(3);
  });

  it('computes reading time from the given wpm', () => {
    expect(insights.readingMinutes).toBeCloseTo(0.14, 2);
  });

  it('computes pacing as words per choice', () => {
    expect(insights.wordsPerChoice).toBe(7);
  });

  it('splits narrator words from character words', () => {
    expect(insights.narratorWords).toBe(4);
  });

  it('resolves character display names from other files', () => {
    const e = insights.characters.find((c) => c.key === 'e')!;
    expect(e.displayName).toBe('Eileen');
    expect(e.words).toBe(10);
  });

  it('ranks labels by dialogue words (scene balance)', () => {
    expect(insights.labelWords[0]).toMatchObject({ name: 'start', words: 9 });
    expect(insights.labelWords[1]).toMatchObject({ name: 'stay_scene', words: 5 });
    expect(insights.labelWords[2]).toMatchObject({ name: 'lonely_orphan', words: 0 });
  });

  it('lists only this file\'s inaccessible labels', () => {
    expect(insights.inaccessible.map((l) => l.name)).toEqual(['lonely_orphan']);
  });

  it('finds incoming and outgoing cross-file connections', () => {
    expect(insights.incoming).toHaveLength(1);
    expect(insights.incoming[0]).toMatchObject({
      from: 'helper_scene',
      fromFile: 'support.rpy',
      to: 'stay_scene',
    });
    expect(insights.outgoing).toHaveLength(1);
    expect(insights.outgoing[0]).toMatchObject({
      from: 'start',
      to: 'helper_scene',
      toFile: 'support.rpy',
    });
  });

  it('reports null pacing for files without choices', () => {
    const other = computeFileInsights(b, [a, b], flow, 200);
    expect(other.wordsPerChoice).toBeNull();
    expect(other.incoming.map((e) => e.to)).toEqual(['helper_scene']);
  });
});
