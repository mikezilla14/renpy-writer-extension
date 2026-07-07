import { describe, expect, it } from 'vitest';
import { buildFlowGraph, filterGraphToFile, toDot } from '../src/core/flowGraph';
import { analyzeFlow } from '../src/core/graph';
import { parseRpy } from '../src/core/parser';

const SCRIPT = `label start:
    menu:
        "Go to the party":
            jump party
        "Stay":
            return

label party:
    "Fun."
    return

label orphan:
    return
`;

describe('buildFlowGraph', () => {
  const models = [parseRpy('script.rpy', SCRIPT)];
  const graph = buildFlowGraph(models, analyzeFlow(models));

  it('creates label nodes with reachability and entry flags', () => {
    const start = graph.nodes.find((n) => n.id === 'start')!;
    const orphan = graph.nodes.find((n) => n.id === 'orphan')!;
    expect(start).toMatchObject({ kind: 'label', entry: true, reachable: true });
    expect(orphan).toMatchObject({ kind: 'label', entry: false, reachable: false });
  });

  it('creates choice nodes owned by the containing label', () => {
    const choices = graph.nodes.filter((n) => n.kind === 'choice');
    expect(choices.map((c) => c.title)).toEqual(['Go to the party', 'Stay']);
    expect(graph.edges).toContainEqual({ from: 'start', to: choices[0].id, kind: 'choice' });
  });

  it('routes jumps inside a choice from the choice node', () => {
    const choice = graph.nodes.find((n) => n.title === 'Go to the party')!;
    expect(graph.edges).toContainEqual({ from: choice.id, to: 'party', kind: 'jump' });
  });

  it('adds a dynamic pseudo-node only when dynamic jumps exist', () => {
    expect(graph.nodes.some((n) => n.kind === 'dynamic')).toBe(false);
    const dynModels = [parseRpy('x.rpy', 'label a:\n    jump expression v\n')];
    const dynGraph = buildFlowGraph(dynModels, analyzeFlow(dynModels));
    expect(dynGraph.nodes.some((n) => n.kind === 'dynamic')).toBe(true);
  });
});

describe('filterGraphToFile', () => {
  const DAY1 = `label day1_main:
    menu:
        "Continue":
            jump day2_main

label day1_side:
    return
`;
  const DAY2 = `label day2_main:
    jump day1_side

label day2_unrelated:
    jump day2_end

label day2_end:
    return
`;
  const models = [parseRpy('day1.rpy', DAY1), parseRpy('day2.rpy', DAY2)];
  const full = buildFlowGraph(models, analyzeFlow(models, ['day1_main', 'day2_unrelated']));
  const graph = filterGraphToFile(full, 'day1.rpy');

  it('keeps this file\'s labels and choices without the external flag', () => {
    const ids = graph.nodes.filter((n) => !n.external).map((n) => n.id);
    expect(ids).toContain('day1_main');
    expect(ids).toContain('day1_side');
    expect(graph.nodes.some((n) => n.kind === 'choice' && !n.external)).toBe(true);
  });

  it('keeps directly connected neighbors from other files, marked external', () => {
    const day2 = graph.nodes.find((n) => n.id === 'day2_main')!;
    expect(day2.external).toBe(true);
    expect(day2.file).toBe('day2.rpy'); // still clickable to its source
  });

  it('drops unconnected labels from other files and their edges', () => {
    expect(graph.nodes.some((n) => n.id === 'day2_unrelated')).toBe(false);
    expect(graph.nodes.some((n) => n.id === 'day2_end')).toBe(false);
    expect(graph.edges.every((e) => {
      const ok = (id: string) => graph.nodes.some((n) => n.id === id);
      return ok(e.from) && ok(e.to);
    })).toBe(true);
  });

  it('keeps edges crossing the file boundary in both directions', () => {
    const choiceId = graph.nodes.find((n) => n.kind === 'choice')!.id;
    expect(graph.edges).toContainEqual({ from: choiceId, to: 'day2_main', kind: 'jump' });
    expect(graph.edges).toContainEqual({ from: 'day2_main', to: 'day1_side', kind: 'jump' });
  });

  it('styles external nodes as dashed gray in DOT output', () => {
    const dot = toDot(graph);
    expect(dot).toMatch(/"day2_main" \[label="day2_main", style="rounded,dashed"/);
  });
});

describe('toDot', () => {
  const models = [parseRpy('script.rpy', SCRIPT)];
  const dot = toDot(buildFlowGraph(models, analyzeFlow(models)));

  it('emits a valid digraph with styled nodes and edges', () => {
    expect(dot).toContain('digraph renpy {');
    expect(dot).toContain('"start" [label="start", color=green, penwidth=2];');
    expect(dot).toContain('color=red');
    expect(dot).toContain('shape=diamond');
    expect(dot).toMatch(/"start#c0" -> "party";/);
    expect(dot.trim().endsWith('}')).toBe(true);
  });
});
