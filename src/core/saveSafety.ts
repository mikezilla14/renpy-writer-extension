// Save-file safety analysis.
//
// Ren'Py's save system only stores variables *changed after init* — and its
// rollback system only tracks objects it knows about. That creates a family of
// well-known footguns this module detects statically:
//
//  1. define-mutable-literal — `define inventory = []`. In-place changes to a
//     define'd list/dict/set are not saved and not rolled back.
//  2. define-reassigned — a `define`d name reassigned at runtime. `define` is
//     for constants; runtime changes interact badly with rollback and with
//     loading saves made on other versions of the script.
//  3. define-mutated — `.append(...)` / attribute assignment on a define'd
//     object at runtime. Silently lost on save/load.
//  4. missing-default — a variable first created inside a label (`$ x = 1`)
//     with no `default x = ...` anywhere. Loading an older save into a build
//     that reads the variable before that line runs raises NameError.
//  5. init-variable-changed — a variable assigned in an `init python` block
//     and changed at runtime without a `default`. Init assignments re-run on
//     every game start and can fight with values restored from saves.
//
// Suppress a finding with a trailing or preceding comment:
//     # renpy-analytics: save-safe

import { FileModel } from './model';

export type SaveSafetyRule =
  | 'define-mutable-literal'
  | 'define-reassigned'
  | 'define-mutated'
  | 'missing-default'
  | 'init-variable-changed';

export interface SaveSafetyFinding {
  rule: SaveSafetyRule;
  name: string;
  file: string;
  line: number;
  severity: 'warning' | 'info';
  message: string;
  related?: { file: string; line: number; message: string };
}

const MUTABLE_LITERAL_RE = /^(\[|\{|set\s*\(|list\s*\(|dict\s*\(|collections\.)/;

/** Store namespaces that are persisted/managed elsewhere or not user state. */
const IGNORED_BASES = new Set(['persistent', 'renpy', 'config', 'gui', 'preferences', 'store']);

function isSuppressed(model: FileModel, line: number): boolean {
  const tag = model.suppressions.get(line) ?? model.suppressions.get(line - 1);
  return tag !== undefined && /\b(save-safe|ignore)\b/.test(tag);
}

export function analyzeSaveSafety(models: FileModel[]): SaveSafetyFinding[] {
  const defines = new Map<string, { file: string; line: number }>();
  const defaults = new Set<string>();
  for (const m of models) {
    for (const d of m.defines) {
      if (!defines.has(d.name)) defines.set(d.name, { file: m.path, line: d.line });
    }
    for (const d of m.defaults) defaults.add(d.name);
  }

  const findings: SaveSafetyFinding[] = [];

  // Rule 1: mutable literals in define
  for (const m of models) {
    for (const d of m.defines) {
      if (isSuppressed(m, d.line)) continue;
      if (MUTABLE_LITERAL_RE.test(d.rhs)) {
        findings.push({
          rule: 'define-mutable-literal',
          name: d.name,
          file: m.path,
          line: d.line,
          severity: 'warning',
          message:
            `'${d.name}' is declared with 'define' but holds a mutable value. ` +
            `In-place changes are not stored in save files and are not rolled back. ` +
            `Declare it with 'default' instead.`,
        });
      }
    }
  }

  // Pass 1: collect init-time assignments (simple names only)
  const initAssigned = new Map<string, { file: string; line: number }>();
  for (const m of models) {
    for (const a of m.assignments) {
      if (a.context !== 'init' || a.mutation || a.op !== '=' || a.name.includes('.')) continue;
      if (!initAssigned.has(a.name)) initAssigned.set(a.name, { file: m.path, line: a.line });
    }
  }

  // Pass 2: runtime (label/screen) assignments — rules 2, 3, 4
  const missingDefaultSeen = new Set<string>();
  const runtimeAssigned = new Set<string>();
  for (const m of models) {
    for (const a of m.assignments) {
      if (a.context !== 'label' && a.context !== 'screen') continue;
      if (isSuppressed(m, a.line)) continue;
      const base = a.name.split('.')[0];
      if (IGNORED_BASES.has(base) || base.startsWith('_')) continue;

      if (a.mutation) {
        const def = defines.get(base);
        if (def) {
          findings.push({
            rule: 'define-mutated',
            name: base,
            file: m.path,
            line: a.line,
            severity: 'warning',
            message:
              `'${base}' was declared with 'define' but is mutated in place ` +
              `('.${a.mutation}(...)'). The change is not stored in save files and is not ` +
              `rolled back. Declare '${base}' with 'default'.`,
            related: { file: def.file, line: def.line, message: `'${base}' defined here` },
          });
        }
        continue;
      }

      if (defines.has(a.name)) {
        const def = defines.get(a.name)!;
        findings.push({
          rule: 'define-reassigned',
          name: a.name,
          file: m.path,
          line: a.line,
          severity: 'warning',
          message:
            `'${a.name}' was declared with 'define' but is reassigned at runtime. ` +
            `'define' is for constants — runtime changes interact badly with rollback ` +
            `and save loading. Declare it with 'default'.`,
          related: { file: def.file, line: def.line, message: `'${a.name}' defined here` },
        });
        continue;
      }

      if (a.name.includes('.')) {
        const def = defines.get(base);
        if (def) {
          findings.push({
            rule: 'define-mutated',
            name: base,
            file: m.path,
            line: a.line,
            severity: 'warning',
            message:
              `An attribute of '${base}' is assigned at runtime, but '${base}' was declared ` +
              `with 'define'. Attribute changes on define'd objects are not stored in save ` +
              `files and are not rolled back. Declare '${base}' with 'default'.`,
            related: { file: def.file, line: def.line, message: `'${base}' defined here` },
          });
        }
        continue;
      }

      runtimeAssigned.add(a.name);
      if (
        a.context === 'label' &&
        a.op === '=' &&
        !defaults.has(a.name) &&
        !initAssigned.has(a.name) &&
        !missingDefaultSeen.has(a.name)
      ) {
        missingDefaultSeen.add(a.name);
        findings.push({
          rule: 'missing-default',
          name: a.name,
          file: m.path,
          line: a.line,
          severity: 'info',
          message:
            `'${a.name}' is first created inside a label. If a player loads an older save ` +
            `into a build that reads it before this line runs, the game raises NameError. ` +
            `Declare 'default ${a.name} = ...' at the top level.`,
        });
      }
    }
  }

  // Rule 5: init-assigned variables changed at runtime without a default
  for (const [name, loc] of initAssigned) {
    if (!runtimeAssigned.has(name) || defaults.has(name) || defines.has(name)) continue;
    const m = models.find((mm) => mm.path === loc.file);
    if (m && isSuppressed(m, loc.line)) continue;
    findings.push({
      rule: 'init-variable-changed',
      name,
      file: loc.file,
      line: loc.line,
      severity: 'warning',
      message:
        `'${name}' is assigned in an init block and changed at runtime. Init assignments ` +
        `re-run on every game start and can fight with values restored from saves, ` +
        `especially across game updates. Declare '${name}' with 'default' instead.`,
    });
  }

  return findings;
}
