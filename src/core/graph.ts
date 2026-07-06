// Label flow graph and reachability analysis.
//
// Graph concept modeled after renpy-graphviz (https://github.com/EwenQuim/renpy-graphviz,
// AGPLv3) — independent TypeScript implementation, no code reused.
//
// Edges:
//  - jump / call statements (menu choice bodies included — their jumps are
//    ordinary statements inside the enclosing label)
//  - renpy.jump("x") / renpy.call("x") with a string-literal argument
//  - fall-through: a label whose body does not end in return/jump continues
//    into the next label in file order
//
// Roots:
//  - Ren'Py's special entry-point labels (start, splashscreen, after_load, …)
//  - labels referenced by screen actions (Jump/Call/Start) or by jumps that
//    occur outside any label (e.g. renpy.jump in an init python block)
//  - user-configured extra entry points
//  - labels tagged `# renpy-analytics: reachable`
//
// Dynamic jumps (`jump expression …`, renpy.jump(variable)) can't be resolved
// statically; callers use `dynamicJumps` to decide how confidently to report.

import { FileModel, LabelDecl } from './model';

export const DEFAULT_ENTRY_POINTS = [
  'start',
  'splashscreen',
  'main_menu',
  'before_main_menu',
  'after_load',
  'after_warp',
  'quit',
  'hide_windows',
];

export interface InaccessibleLabel {
  name: string;
  file: string;
  line: number;
}

export interface FlowAnalysis {
  labelCount: number;
  roots: string[];
  reachable: Set<string>;
  inaccessible: InaccessibleLabel[];
  /** Count of jumps/calls whose target is a runtime expression */
  dynamicJumps: number;
  /** name -> outgoing targets, for later graph visualization / export */
  edges: Map<string, Set<string>>;
}

function isTaggedReachable(model: FileModel, label: LabelDecl): boolean {
  const tag =
    model.suppressions.get(label.headerLine) ?? model.suppressions.get(label.headerLine - 1);
  return tag !== undefined && /\breachable\b/.test(tag);
}

/** Innermost label containing `line`, or undefined for screen/init/top-level code. */
function containingLabel(labels: LabelDecl[], line: number): LabelDecl | undefined {
  let best: LabelDecl | undefined;
  for (const l of labels) {
    if (l.headerLine < line && line <= l.endLine) {
      if (!best || l.headerLine > best.headerLine) best = l;
    }
  }
  return best;
}

export function analyzeFlow(models: FileModel[], extraEntryPoints: string[] = []): FlowAnalysis {
  const allLabels = new Map<string, { model: FileModel; label: LabelDecl }>();
  for (const m of models) {
    for (const l of m.labels) {
      if (!allLabels.has(l.name)) allLabels.set(l.name, { model: m, label: l });
    }
  }

  const edges = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string): void => {
    let set = edges.get(from);
    if (!set) edges.set(from, (set = new Set()));
    set.add(to);
  };

  const roots = new Set<string>();
  for (const name of [...DEFAULT_ENTRY_POINTS, ...extraEntryPoints]) {
    if (allLabels.has(name)) roots.add(name);
  }

  let dynamicJumps = 0;

  for (const m of models) {
    const terminators = new Set<number>(m.returns);
    for (const j of m.jumps) {
      if (j.kind === 'jump') terminators.add(j.line);
    }

    for (const j of m.jumps) {
      if (j.dynamic) {
        dynamicJumps++;
        continue;
      }
      if (!j.target) continue;
      const src = containingLabel(m.labels, j.line);
      if (src) addEdge(src.name, j.target);
      else if (allLabels.has(j.target)) roots.add(j.target); // screen/init/top-level code
    }

    for (const a of m.actionTargets) {
      const src = containingLabel(m.labels, a.line);
      if (src) addEdge(src.name, a.target);
      else if (allLabels.has(a.target)) roots.add(a.target);
    }

    // Fall-through: file-ordered labels; a label whose last significant line
    // is not a return/jump continues into the next label.
    const ordered = [...m.labels].sort((a, b) => a.headerLine - b.headerLine);
    for (let i = 0; i < ordered.length; i++) {
      const cur = ordered[i];
      const next = ordered.find((l) => l.headerLine > cur.endLine);
      if (!next) continue;
      if (!terminators.has(cur.endLine)) addEdge(cur.name, next.name);
    }

    for (const l of m.labels) {
      if (isTaggedReachable(m, l)) roots.add(l.name);
    }
  }

  // BFS
  const reachable = new Set<string>();
  const queue = [...roots].filter((r) => allLabels.has(r));
  for (const r of queue) reachable.add(r);
  while (queue.length) {
    const cur = queue.pop()!;
    for (const to of edges.get(cur) ?? []) {
      if (allLabels.has(to) && !reachable.has(to)) {
        reachable.add(to);
        queue.push(to);
      }
    }
  }

  const inaccessible: InaccessibleLabel[] = [];
  for (const [name, { model, label }] of allLabels) {
    if (!reachable.has(name)) {
      inaccessible.push({ name, file: model.path, line: label.headerLine });
    }
  }
  inaccessible.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));

  return {
    labelCount: allLabels.size,
    roots: [...roots].sort(),
    reachable,
    inaccessible,
    dynamicJumps,
    edges,
  };
}
