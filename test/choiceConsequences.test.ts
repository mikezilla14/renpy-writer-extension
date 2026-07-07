import { describe, expect, it } from 'vitest';
import { analyzeChoices } from '../src/core/choiceConsequences';
import { parseRpy } from '../src/core/parser';
import { lineOf } from './fixture';

const SCRIPT = `label start:
    menu:
        "Search the bureau":
            $ corruption += 1
            $ trust -= 2
            $ story.set_prologue_found("read_letters")
            jump desk_branch
        "Walk away":
            $ mood = "calm"
            return
        "Just look around":
            "Nothing here."

label desk_branch:
    return
`;

describe('analyzeChoices', () => {
  const summaries = analyzeChoices(parseRpy('script.rpy', SCRIPT));

  it('produces one summary per choice, in line order', () => {
    expect(summaries).toHaveLength(3);
    expect(summaries[0].line).toBe(lineOf(SCRIPT, '"Search the bureau"'));
  });

  it('shows stat deltas, calls, and jump targets', () => {
    const s = summaries[0].summary;
    expect(s).toContain('+corruption');
    expect(s).toContain('-trust');
    expect(s).toContain('ƒ story.set_prologue_found');
    expect(s).toContain('→ desk_branch');
  });

  it('shows assignments with a truncated value and return markers', () => {
    const s = summaries[1].summary;
    expect(s).toContain('mood="calm"');
    expect(s).toContain('⏎ return');
  });

  it('marks choices without state changes', () => {
    expect(summaries[2].summary).toBe('(no state changes)');
  });

  it('does not leak nested-menu consequences into the outer choice', () => {
    const nested = `label start:
    menu:
        "Outer":
            menu:
                "Inner":
                    $ inner_flag = True
                    jump elsewhere

label elsewhere:
    return
`;
    const out = analyzeChoices(parseRpy('x.rpy', nested));
    const outer = out.find((s) => s.line === lineOf(nested, '"Outer"'))!;
    const inner = out.find((s) => s.line === lineOf(nested, '"Inner"'))!;
    expect(outer.summary).toBe('(no state changes)');
    expect(inner.summary).toContain('inner_flag=True');
    expect(inner.summary).toContain('→ elsewhere');
  });

  it('marks dynamic jumps with a question mark', () => {
    const dyn = 'label a:\n    menu:\n        "Go":\n            jump expression target_var\n';
    const out = analyzeChoices(parseRpy('x.rpy', dyn));
    expect(out[0].summary).toContain('→ ?');
  });
});
