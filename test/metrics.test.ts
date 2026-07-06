import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  countSentences,
  countWords,
  NARRATOR_KEY,
  normalizeDialogue,
} from '../src/core/metrics';
import { parseRpy } from '../src/core/parser';

describe('normalizeDialogue', () => {
  it('strips text tags', () => {
    expect(normalizeDialogue('I have {b}bold{/b} plans.').trim()).toBe('I have bold plans.');
  });

  it('replaces interpolations with a single placeholder word', () => {
    const n = normalizeDialogue('You have [points] points.');
    expect(countWords(n)).toBe(4); // You, have, ✱, points.
  });

  it('preserves escaped literal braces and brackets', () => {
    expect(normalizeDialogue('Use {{b}} for bold and [[x] for vars.')).toBe(
      'Use {b} for bold and [x] for vars.'
    );
  });
});

describe('word and sentence counting', () => {
  it('counts words, ignoring punctuation-only tokens', () => {
    expect(countWords('Hello there — how are you?')).toBe(5);
  });

  it('counts sentences by terminal punctuation runs', () => {
    expect(countSentences('Hello there! How are you?')).toBe(2);
    expect(countSentences('Wait...')).toBe(1);
    expect(countSentences('no punctuation at all')).toBe(1);
    expect(countSentences('')).toBe(0);
  });
});

describe('computeMetrics', () => {
  const SCRIPT = `define e = Character("Eileen")

label start:
    e "Hello there! How are you?"
    e "I have {b}bold{/b} plans. [points] points."
    extend "Right now!"
    "Narration."
    menu:
        "Choice A":
            return
        "Choice B":
            return
`;
  const metrics = computeMetrics([parseRpy('script.rpy', SCRIPT)]);

  it('resolves character display names from Character() defines', () => {
    const e = metrics.characters.find((c) => c.key === 'e')!;
    expect(e.displayName).toBe('Eileen');
  });

  it('attributes extend lines to the previous speaker', () => {
    const e = metrics.characters.find((c) => c.key === 'e')!;
    expect(e.lines).toBe(3);
    // 5 + 6 + 2 words
    expect(e.words).toBe(13);
    expect(e.sentences).toBe(5);
  });

  it('tracks the narrator separately', () => {
    const n = metrics.characters.find((c) => c.key === NARRATOR_KEY)!;
    expect(n.displayName).toBe('narrator');
    expect(n.words).toBe(1);
  });

  it('computes per-file structure stats', () => {
    expect(metrics.files).toHaveLength(1);
    expect(metrics.files[0]).toMatchObject({ labels: 1, menus: 1, choices: 2, words: 14 });
  });

  it('aggregates totals', () => {
    expect(metrics.totalWords).toBe(14);
    expect(metrics.totalLabels).toBe(1);
    expect(metrics.totalMenus).toBe(1);
    expect(metrics.totalChoices).toBe(2);
  });
});
