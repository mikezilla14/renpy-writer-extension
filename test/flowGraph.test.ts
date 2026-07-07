import { describe, expect, it } from 'vitest';
import { buildFlowGraph, toDot } from '../src/core/flowGraph';
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
