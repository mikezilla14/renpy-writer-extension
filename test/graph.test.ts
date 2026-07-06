import { describe, expect, it } from 'vitest';
import { analyzeFlow } from '../src/core/graph';
import { parseRpy } from '../src/core/parser';

describe('analyzeFlow', () => {
  const SCRIPT = `label start:
    jump route_a

label route_a:
    "This label ends with dialogue, so it falls through."

label after_a:
    return

label orphan:
    return

# renpy-analytics: reachable
label tagged_orphan:
    return

screen nav():
    textbutton "Go" action Jump("from_screen")

label from_screen:
    return
`;
  const flow = analyzeFlow([parseRpy('script.rpy', SCRIPT)]);

  it('reaches labels via jump edges from the start entry point', () => {
    expect(flow.reachable.has('start')).toBe(true);
    expect(flow.reachable.has('route_a')).toBe(true);
  });

  it('follows fall-through when a label does not end with return/jump', () => {
    expect(flow.reachable.has('after_a')).toBe(true);
  });

  it('does not fall through past a return', () => {
    // orphan ends with return and nothing jumps to tagged_orphan's successor
    expect(flow.reachable.has('orphan')).toBe(false);
  });

  it('reports inaccessible labels with location', () => {
    expect(flow.inaccessible).toHaveLength(1);
    expect(flow.inaccessible[0]).toMatchObject({ name: 'orphan', file: 'script.rpy' });
  });

  it('honors the "# renpy-analytics: reachable" tag', () => {
    expect(flow.reachable.has('tagged_orphan')).toBe(true);
  });

  it('treats screen-action targets as roots', () => {
    expect(flow.reachable.has('from_screen')).toBe(true);
  });

  it('counts dynamic jumps', () => {
    const f = analyzeFlow([
      parseRpy('x.rpy', 'label start:\n    jump expression dest\n\nlabel hidden:\n    return\n'),
    ]);
    expect(f.dynamicJumps).toBe(1);
    expect(f.inaccessible.map((l) => l.name)).toEqual(['hidden']);
  });

  it('resolves cross-file jumps and call edges', () => {
    const a = parseRpy('a.rpy', 'label start:\n    call helper\n    return\n');
    const b = parseRpy('b.rpy', 'label helper:\n    return\n');
    const f = analyzeFlow([a, b]);
    expect(f.reachable.has('helper')).toBe(true);
    expect(f.inaccessible).toEqual([]);
  });

  it('treats renpy.jump in init python as a root reference', () => {
    const m = parseRpy('x.rpy', 'init python:\n    renpy.jump("bootstrap")\n\nlabel bootstrap:\n    return\n');
    const f = analyzeFlow([m]);
    expect(f.reachable.has('bootstrap')).toBe(true);
  });

  it('supports user-configured extra entry points', () => {
    const m = parseRpy('x.rpy', 'label custom_entry:\n    return\n');
    expect(analyzeFlow([m]).inaccessible).toHaveLength(1);
    expect(analyzeFlow([m], ['custom_entry']).inaccessible).toEqual([]);
  });

  it('reaches local labels via resolved local jumps', () => {
    const m = parseRpy(
      'x.rpy',
      'label chapter:\n    jump .part_two\n\nlabel .part_two:\n    return\n'
    );
    const f = analyzeFlow([m], ['chapter']);
    expect(f.reachable.has('chapter.part_two')).toBe(true);
  });
});
