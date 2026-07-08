import { describe, expect, it } from 'vitest';
import { parseRpy } from '../src/core/parser';
import { buildVariableIndex } from '../src/core/variables';
import { FIXTURE, lineOf } from './fixture';

const byName = (src: string, path = 'a.rpy') => {
  const index = buildVariableIndex([parseRpy(path, src)]);
  return new Map(index.map((v) => [v.name, v]));
};

describe('buildVariableIndex', () => {
  it('indexes declarations, writes, and gate reads from the shared fixture', () => {
    const vars = byName(FIXTURE);

    const points = vars.get('points')!;
    expect(points.kind).toBe('default');
    expect(points.writes).toHaveLength(1);
    expect(points.writes[0].detail).toBe('+= 1');
    expect(points.writes[0].label).toBe('start');
    // "Stay home" if points > 0 → gate read on the choice line
    expect(points.reads.some((r) => r.kind === 'gate')).toBe(true);
    expect(points.unread).toBe(false);
    expect(points.unwritten).toBe(false);

    const inventory = vars.get('inventory')!;
    expect(inventory.kind).toBe('define');
    expect(inventory.writes).toHaveLength(1);
    expect(inventory.writes[0].detail).toBe('.append(…)');
    expect(inventory.writes[0].choice).toBe('Stay home');
  });

  it('creates undeclared entries for label-context writes without a default', () => {
    const vars = byName(FIXTURE);
    const mood = vars.get('mood')!;
    expect(mood.kind).toBe('undeclared');
    expect(mood.unread).toBe(true); // nothing reads it
  });

  it('excludes characters, engine namespaces, and non-label contexts', () => {
    const vars = byName(FIXTURE);
    expect(vars.has('e')).toBe(false); // Character define
    expect(vars.has('flags')).toBe(false); // init python assignment only
    const cfg = byName('define config.name = "Game"\ndefine gui.accent = "#f00"\n');
    expect(cfg.size).toBe(0);
  });

  it('credits attribute writes and dotted reads to the declared base variable', () => {
    const src = [
      'default player = Player()',
      '',
      'label start:',
      '    $ player.hp -= 5',
      '    if player.hp <= 0:',
      '        jump game_over',
      '    return',
      '',
      'label game_over:',
      '    return',
    ].join('\n');
    const vars = byName(src);
    const player = vars.get('player')!;
    expect(vars.has('player.hp')).toBe(false);
    expect(player.writes).toHaveLength(1);
    expect(player.writes[0].detail).toContain('.hp -= 5');
    expect(player.reads).toHaveLength(1);
    expect(player.reads[0].kind).toBe('gate');
  });

  it('flags default variables that are gated on but never set', () => {
    const src = [
      'default met_eve = False',
      '',
      'label start:',
      '    if met_eve:',
      '        "You know her."',
      '    return',
    ].join('\n');
    const vars = byName(src);
    const v = vars.get('met_eve')!;
    expect(v.unwritten).toBe(true);
    expect(v.unread).toBe(false);
  });

  it('tracks persistent variables written in labels', () => {
    const src = [
      'label ending:',
      '    $ persistent.seen_ending = True',
      '    return',
    ].join('\n');
    const vars = byName(src);
    const v = vars.get('persistent.seen_ending')!;
    expect(v.kind).toBe('undeclared');
    expect(v.writes).toHaveLength(1);
  });

  it('does not count RHS identifiers on a declaration line as reads of that variable', () => {
    const src = ['default total = base + 1', 'define base = 2', ''].join('\n');
    const vars = byName(src);
    expect(vars.get('base')!.reads).toHaveLength(1); // read on total's decl line
    expect(vars.get('total')!.reads).toHaveLength(0);
  });

  it('merges sites for the same variable across files', () => {
    const a = parseRpy('a.rpy', 'default trust = 0\n');
    const b = parseRpy(
      'b.rpy',
      ['label ch2:', '    $ trust += 1', '    if trust > 2:', '        jump good_end', '    return', '', 'label good_end:', '    return'].join('\n')
    );
    const index = buildVariableIndex([a, b]);
    const trust = index.find((v) => v.name === 'trust')!;
    expect(trust.decls[0].file).toBe('a.rpy');
    expect(trust.writes[0].file).toBe('b.rpy');
    expect(trust.reads[0].kind).toBe('gate');
  });
});

describe('flow-graph condition labels', () => {
  it('attaches the innermost if condition to jump edges', async () => {
    const { analyzeFlow } = await import('../src/core/graph');
    const { buildFlowGraph } = await import('../src/core/flowGraph');
    const src = [
      'label start:',
      '    if trust > 2:',
      '        jump good_end',
      '    jump bad_end',
      '',
      'label good_end:',
      '    return',
      '',
      'label bad_end:',
      '    return',
    ].join('\n');
    const models = [parseRpy('a.rpy', src)];
    const graph = buildFlowGraph(models, analyzeFlow(models, []));
    const good = graph.edges.find((e) => e.to === 'good_end')!;
    const bad = graph.edges.find((e) => e.to === 'bad_end')!;
    expect(good.cond).toBe('trust > 2');
    expect(bad.cond).toBeUndefined();
  });

  it('carries choice consequence summaries onto choice nodes', async () => {
    const { analyzeFlow } = await import('../src/core/graph');
    const { buildFlowGraph } = await import('../src/core/flowGraph');
    const models = [parseRpy('a.rpy', FIXTURE)];
    const graph = buildFlowGraph(models, analyzeFlow(models, []));
    const stay = graph.nodes.find((n) => n.kind === 'choice' && n.title === 'Stay home')!;
    expect(stay.detail).toContain('inventory.append()');
  });
});
