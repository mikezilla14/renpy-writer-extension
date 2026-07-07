// Choice-consequence extraction: what each menu choice does to game state.
// Approach adapted from universal-renpy-walkthrough (MIT,
// https://github.com/BCassO/universal-renpy-walkthrough) — reimplemented
// statically over our FileModel instead of at runtime.

import { ChoiceDecl, FileModel } from './model';

export interface ChoiceSummary {
  /** Line of the choice header */
  line: number;
  /** Human-readable consequence summary, e.g. "+corruption  ƒ apply_balanced_effect  → party_scene" */
  summary: string;
}

const MAX_PARTS = 8;
const MAX_CALLS = 3;

function short(rhs: string | undefined, max = 14): string {
  if (!rhs) return '…';
  return rhs.length > max ? rhs.slice(0, max - 1) + '…' : rhs;
}

export function analyzeChoices(model: FileModel): ChoiceSummary[] {
  const allChoices: ChoiceDecl[] = model.menus.flatMap((m) => m.choices);
  const out: ChoiceSummary[] = [];

  for (const menu of model.menus) {
    for (const choice of menu.choices) {
      // Exclude lines that belong to a nested menu's choices so an outer
      // choice doesn't absorb its sub-choices' consequences.
      const nested = allChoices.filter(
        (c) => c !== choice && c.headerLine > choice.headerLine && c.endLine <= choice.endLine
      );
      const within = (line: number): boolean =>
        line > choice.headerLine &&
        line <= choice.endLine &&
        !nested.some((c) => line > c.headerLine && line <= c.endLine);

      const parts: string[] = [];

      for (const a of model.assignments) {
        if (!within(a.line)) continue;
        if (a.mutation) parts.push(`${a.name}.${a.mutation}()`);
        else if (a.op === '+=') parts.push(`+${a.name}`);
        else if (a.op === '-=') parts.push(`-${a.name}`);
        else if (a.op === '=') parts.push(`${a.name}=${short(a.rhs)}`);
        else parts.push(`${a.name} ${a.op}`);
      }

      const calls: string[] = [];
      const seen = new Set<string>();
      for (const id of model.identifiers) {
        if (!within(id.line) || !id.call || seen.has(id.name)) continue;
        seen.add(id.name);
        calls.push(id.name);
      }
      for (const c of calls.slice(0, MAX_CALLS)) parts.push(`ƒ ${c}`);
      if (calls.length > MAX_CALLS) parts.push(`+${calls.length - MAX_CALLS} calls`);

      for (const j of model.jumps) {
        if (!within(j.line)) continue;
        const arrow = j.kind === 'jump' ? '→' : '↪';
        parts.push(`${arrow} ${j.dynamic ? '?' : j.target}`);
      }
      if (model.returns.some((r) => within(r))) parts.push('⏎ return');

      const shown = parts.slice(0, MAX_PARTS);
      const summary =
        parts.length === 0
          ? '(no state changes)'
          : shown.join('  ') + (parts.length > MAX_PARTS ? '  …' : '');
      out.push({ line: choice.headerLine, summary });
    }
  }

  out.sort((a, b) => a.line - b.line);
  return out;
}
