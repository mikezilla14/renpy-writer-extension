// Flag & variable explorer: a cross-file index of every story variable —
// where it is declared, every write (and the menu choice that triggers it),
// and every read/gate — plus orphan detection. Replaces the hand-maintained
// flag spreadsheets common in VN development.

import { FileModel, MenuDecl } from './model';

export type VarSiteKind = 'define' | 'default' | 'write' | 'read' | 'gate';

export interface VarSite {
  kind: VarSiteKind;
  file: string;
  line: number;
  /** e.g. `= 0`, `+= 1`, `.append(…)` for declarations and writes */
  detail?: string;
  /** Enclosing label, when inside one */
  label?: string;
  /** Text of the enclosing menu choice, when inside one */
  choice?: string;
}

export interface VariableInfo {
  name: string;
  kind: 'define' | 'default' | 'undeclared';
  decls: VarSite[];
  writes: VarSite[];
  /** Reads; sites with kind 'gate' sit inside an if/elif/while/for or choice condition */
  reads: VarSite[];
  /** Nothing ever reads it (only reported for default/undeclared vars — defines
   *  are often consumed by non-expression statements like `scene`/`show`). */
  unread: boolean;
  /** default'ed and read, but no statement ever assigns it — gates that can never open */
  unwritten: boolean;
}

/** Engine/config namespaces that aren't story state. */
const IGNORED_NS = /^(config|gui|style|audio|build|preferences|renpy|im|layeredimage|define|_)([.]|$)/;

/** define RHS values that declare characters/visuals rather than story flags. */
const NON_STORY_RHS = /^(Character|DynamicCharacter|ADVCharacter|NVLCharacter|Image|Transform|Solid|Frame|Movie|At)\s*\(/;

function short(s: string | undefined, max = 24): string | undefined {
  if (s === undefined) return undefined;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

interface FileContext {
  gateLines: Set<number>;
  labelAt: (line: number) => string | undefined;
  choiceAt: (line: number) => string | undefined;
}

function buildFileContext(model: FileModel): FileContext {
  const gateLines = new Set<number>();
  const walk = (blocks: FileModel['blocks']): void => {
    for (const b of blocks) {
      if (b.kind === 'if' || b.kind === 'elif' || b.kind === 'while' || b.kind === 'for') {
        gateLines.add(b.headerLine);
      }
      walk(b.children);
    }
  };
  walk(model.blocks);
  for (const menu of model.menus) {
    for (const c of menu.choices) gateLines.add(c.headerLine);
  }

  const labelAt = (line: number): string | undefined => {
    let best: { name: string; headerLine: number } | undefined;
    for (const l of model.labels) {
      if (l.headerLine <= line && line <= l.endLine) {
        if (!best || l.headerLine > best.headerLine) best = l;
      }
    }
    return best?.name;
  };

  const choiceAt = (line: number): string | undefined => {
    let best: { text: string; headerLine: number } | undefined;
    const scan = (menus: MenuDecl[]): void => {
      for (const m of menus) {
        for (const c of m.choices) {
          if (c.headerLine < line && line <= c.endLine) {
            if (!best || c.headerLine > best.headerLine) best = c;
          }
        }
      }
    };
    scan(model.menus);
    return best?.text;
  };

  return { gateLines, labelAt, choiceAt };
}

export function buildVariableIndex(models: FileModel[]): VariableInfo[] {
  const vars = new Map<string, VariableInfo>();
  const ensure = (name: string, kind: VariableInfo['kind']): VariableInfo => {
    let v = vars.get(name);
    if (!v) {
      v = { name, kind, decls: [], writes: [], reads: [], unread: false, unwritten: false };
      vars.set(name, v);
    }
    return v;
  };

  // Pass 1: declarations establish the tracked names.
  for (const m of models) {
    for (const d of m.defaults) {
      if (IGNORED_NS.test(d.name)) continue;
      ensure(d.name, 'default').decls.push({
        kind: 'default',
        file: m.path,
        line: d.line,
        detail: `= ${short(d.rhs)}`,
      });
    }
    for (const d of m.defines) {
      if (IGNORED_NS.test(d.name) || NON_STORY_RHS.test(d.rhs)) continue;
      ensure(d.name, 'define').decls.push({
        kind: 'define',
        file: m.path,
        line: d.line,
        detail: `= ${short(d.rhs)}`,
      });
    }
  }

  /** Longest declared prefix of a dotted name (player.hp → player), else undefined. */
  const resolve = (name: string): VariableInfo | undefined => {
    let n = name;
    for (;;) {
      const hit = vars.get(n);
      if (hit) return hit;
      const dot = n.lastIndexOf('.');
      if (dot === -1) return undefined;
      n = n.slice(0, dot);
    }
  };

  // Pass 2: writes. Label-context writes to unknown names create 'undeclared'
  // entries (story state born mid-script); other contexts only credit known vars.
  for (const m of models) {
    const ctx = buildFileContext(m);
    for (const a of m.assignments) {
      if (IGNORED_NS.test(a.name)) continue;
      let v = resolve(a.name);
      if (!v) {
        if (a.context !== 'label' || a.name.startsWith('_')) continue;
        v = ensure(a.name, 'undeclared');
      }
      const suffix = v.name === a.name ? '' : a.name.slice(v.name.length);
      const detail = a.mutation
        ? `${suffix}.${a.mutation}(…)`
        : `${suffix} ${a.op} ${short(a.rhs)}`.trim();
      v.writes.push({
        kind: 'write',
        file: m.path,
        line: a.line,
        detail,
        label: ctx.labelAt(a.line),
        choice: ctx.choiceAt(a.line),
      });
    }
  }

  // Pass 3: reads. An identifier matches the longest declared prefix; reads on
  // condition lines (if/elif/while/for headers, choice conditions) are gates.
  for (const m of models) {
    const ctx = buildFileContext(m);
    const declLines = new Map<number, string>();
    for (const d of [...m.defines, ...m.defaults]) declLines.set(d.line, d.name);
    const writeLines = new Set<string>();
    for (const a of m.assignments) writeLines.add(`${a.name}:${a.line}`);
    for (const id of m.identifiers) {
      if (id.call || IGNORED_NS.test(id.name)) continue;
      const v = resolve(id.name);
      if (!v) continue;
      // RHS identifiers on the variable's own declaration line aren't reads of it
      if (declLines.get(id.line) === v.name) continue;
      // Augmented assignments (`x += 1`) surface their own target as an
      // identifier — that's the write already recorded, not a separate read
      if (writeLines.has(`${id.name}:${id.line}`)) continue;
      v.reads.push({
        kind: ctx.gateLines.has(id.line) ? 'gate' : 'read',
        file: m.path,
        line: id.line,
        label: ctx.labelAt(id.line),
        choice: ctx.choiceAt(id.line),
      });
    }
  }

  for (const v of vars.values()) {
    v.unread = v.reads.length === 0 && v.kind !== 'define';
    v.unwritten = v.kind === 'default' && v.writes.length === 0 && v.reads.length > 0;
  }

  return [...vars.values()].sort((a, b) => a.name.localeCompare(b.name));
}
