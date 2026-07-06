// Line-based, indentation-aware Ren'Py parser. One pass per file produces a
// FileModel consumed by folding, save-safety analysis, and (later) metrics.
//
// Deliberately not a full grammar: Ren'Py is a line/indent language and the
// features we build need block structure, declarations, and flow edges — not
// expression trees.
//
// Known limitations (acceptable for M1):
// - Inline blocks after a colon on the same line ("if x: jump y") are treated
//   as a plain statement, not a block.
// - Python inside triple-quoted strings is skipped wholesale.

import {
  AssignContext,
  Block,
  BlockKind,
  ChoiceDecl,
  FileModel,
  LabelDecl,
  MenuDecl,
  VarDef,
} from './model';

// ---------------------------------------------------------------------------
// Line scanning: strip comments, track bracket depth and triple-quoted strings
// so logical lines spanning several physical lines are joined correctly.

interface ScanState {
  triple: '"""' | "'''" | null;
}

interface ScannedLine {
  code: string;
  bracketDelta: number;
  continuation: boolean;
  comment: string | null;
}

function scanLine(raw: string, st: ScanState): ScannedLine {
  let code = '';
  let delta = 0;
  let comment: string | null = null;
  let i = 0;
  while (i < raw.length) {
    if (st.triple) {
      const close = raw.indexOf(st.triple, i);
      if (close === -1) {
        code += raw.slice(i);
        i = raw.length;
      } else {
        code += raw.slice(i, close + 3);
        i = close + 3;
        st.triple = null;
      }
      continue;
    }
    const c = raw[i];
    if (c === '"' || c === "'") {
      const maybeTriple = raw.slice(i, i + 3);
      if (maybeTriple === '"""' || maybeTriple === "'''") {
        st.triple = maybeTriple as ScanState['triple'];
        code += maybeTriple;
        i += 3;
        continue;
      }
      let j = i + 1;
      let closed = false;
      while (j < raw.length) {
        if (raw[j] === '\\') {
          j += 2;
          continue;
        }
        if (raw[j] === c) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        code += raw.slice(i, j + 1);
        i = j + 1;
      } else {
        code += raw.slice(i);
        i = raw.length;
      }
      continue;
    }
    if (c === '#') {
      comment = raw.slice(i + 1).trim();
      break;
    }
    if (c === '(' || c === '[' || c === '{') delta++;
    else if (c === ')' || c === ']' || c === '}') delta--;
    code += c;
    i++;
  }
  const trimmedEnd = code.replace(/\s+$/, '');
  const continuation = trimmedEnd.endsWith('\\');
  return {
    code: continuation ? trimmedEnd.slice(0, -1) : trimmedEnd,
    bracketDelta: delta,
    continuation,
    comment,
  };
}

function measureIndent(code: string): number {
  let n = 0;
  for (const ch of code) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 8 - (n % 8);
    else break;
  }
  return n;
}

/** Reads a quoted string literal starting at `start`; returns unescaped value. */
function readString(s: string, start: number): { value: string; end: number } | null {
  const q = s[start];
  if (q !== '"' && q !== "'") return null;
  let out = '';
  let i = start + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      out += s[i + 1];
      i += 2;
      continue;
    }
    if (c === q) return { value: out, end: i + 1 };
    out += c;
    i++;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Statement recognition

const RESERVED_DIALOGUE_PREFIX = new Set([
  'add', 'at', 'call', 'camera', 'default', 'define', 'elif', 'else', 'expression',
  'for', 'hide', 'if', 'image', 'init', 'jump', 'key', 'label', 'menu', 'music',
  'nvl', 'onlayer', 'pass', 'pause', 'play', 'python', 'queue', 'return', 'scene',
  'screen', 'show', 'sound', 'stop', 'style', 'text', 'transform', 'translate',
  'voice', 'while', 'window', 'with',
]);

const ASSIGN_RE =
  /^([A-Za-z_][\w.]*)\s*(\+=|-=|\*\*=|\*=|\/\/=|\/=|%=|\|=|&=|\^=|>>=|<<=|=(?!=))\s*(.+)$/;

const MUTATION_RE =
  /^([A-Za-z_][\w.]*)\.(append|extend|insert|remove|pop|add|discard|update|clear|sort|reverse|setdefault|popitem)\s*\(/;

function stripStore(name: string): string {
  return name.replace(/^store\./, '');
}

const PY_KEYWORDS = new Set([
  'and', 'or', 'not', 'in', 'is', 'if', 'else', 'elif', 'for', 'while', 'def', 'class',
  'return', 'pass', 'break', 'continue', 'lambda', 'None', 'True', 'False', 'import',
  'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'global', 'nonlocal',
  'del', 'yield', 'assert', 'print',
]);

/**
 * Collects identifiers used in an expression, distinguishing calls (name
 * followed by '(') from plain references. Keyword-argument names and
 * assignment targets (name followed by a single '=') are skipped — targets
 * are recorded separately as assignments.
 */
function extractIdentifiers(
  model: FileModel,
  expr: string,
  line: number,
  callsOnly = false
): void {
  const cleaned = expr.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, ' ');
  const re = /[A-Za-z_][\w.]*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) {
    const name = m[0];
    if (PY_KEYWORDS.has(name) || PY_KEYWORDS.has(name.split('.')[0])) continue;
    let j = m.index + name.length;
    while (j < cleaned.length && cleaned[j] === ' ') j++;
    const next = cleaned[j];
    const call = next === '(';
    if (!call && next === '=' && cleaned[j + 1] !== '=') continue;
    if (callsOnly && !call) continue;
    model.identifiers.push({ name: stripStore(name), call, line });
  }
}

interface OpenBlock {
  block: Block;
  label?: LabelDecl;
  menu?: MenuDecl;
  choice?: ChoiceDecl;
  /** Body is python code */
  python: boolean;
  init: boolean;
  screen: boolean;
}

function ctxOf(stack: OpenBlock[]): AssignContext {
  const top = stack[stack.length - 1];
  if (!top) return 'top';
  if (top.init) return 'init';
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].block.kind === 'label') return 'label';
  }
  if (top.screen) return 'screen';
  if (top.python) return 'python';
  return 'top';
}

function handlePythonLine(model: FileModel, s: string, line: number, context: AssignContext): void {
  s = s.trim();
  const mut = MUTATION_RE.exec(s);
  if (mut) {
    model.assignments.push({ name: stripStore(mut[1]), op: '', mutation: mut[2], line, context });
    return;
  }
  const asg = ASSIGN_RE.exec(s);
  if (asg) {
    model.assignments.push({ name: stripStore(asg[1]), op: asg[2], line, context });
  }
  const jc = /\brenpy\.(jump|call)\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/.exec(s);
  if (jc) {
    const target = jc[2] ?? jc[3];
    model.jumps.push({ kind: jc[1] as 'jump' | 'call', target, dynamic: target === undefined, line });
  }
}

function handleJumpCall(
  model: FileModel,
  kind: 'jump' | 'call',
  rest: string,
  line: number,
  lastGlobalLabel: string | null
): void {
  rest = rest.trim();
  if (/^expression\b/.test(rest)) {
    model.jumps.push({ kind, dynamic: true, line });
    return;
  }
  const m = /^([\w.]+)/.exec(rest);
  if (!m) return;
  let target = m[1];
  if (target.startsWith('.') && lastGlobalLabel) target = lastGlobalLabel + target;
  model.jumps.push({ kind, target, dynamic: false, line });
}

function parseDialogueLine(s: string): { speaker: string | null; text: string } | null {
  let q = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' || s[i] === "'") {
      q = i;
      break;
    }
  }
  if (q === -1) return null;
  const prefix = s.slice(0, q).trim();
  let speaker: string | null = null;
  if (prefix !== '') {
    const toks = prefix.split(/\s+/);
    if (!toks.every((t) => /^[A-Za-z_][\w.]*$/.test(t))) return null;
    if (RESERVED_DIALOGUE_PREFIX.has(toks[0])) return null;
    speaker = toks[0];
  }
  const lit = readString(s, q);
  if (!lit) return null;
  let text = lit.value;
  let rest = s.slice(lit.end).trim();
  // Ad-hoc character: "Name" "dialogue"
  if (speaker === null && (rest.startsWith('"') || rest.startsWith("'"))) {
    const lit2 = readString(rest, 0);
    if (lit2) {
      speaker = text;
      text = lit2.value;
      rest = rest.slice(lit2.end).trim();
    }
  }
  if (
    rest !== '' &&
    !/^((with|id)\s+\S+|nointeract)(\s+((with|id)\s+\S+|nointeract))*$/.test(rest)
  ) {
    return null;
  }
  return { speaker, text };
}

function recordComment(model: FileModel, line: number, comment: string): void {
  const m = /^\s*renpy-analytics:\s*(.+)$/.exec(comment);
  if (m) model.suppressions.set(line, m[1].trim());
}

// ---------------------------------------------------------------------------
// Main parse

export function parseRpy(path: string, text: string): FileModel {
  const model: FileModel = {
    path,
    blocks: [],
    labels: [],
    menus: [],
    defines: [],
    defaults: [],
    assignments: [],
    jumps: [],
    returns: [],
    actionTargets: [],
    identifiers: [],
    dialogue: [],
    suppressions: new Map(),
  };

  const lines = text.split(/\r?\n/);
  const st: ScanState = { triple: null };
  const stack: OpenBlock[] = [];
  let lastSignificant = 0;
  let lastGlobalLabel: string | null = null;

  const finalize = (ob: OpenBlock): void => {
    ob.block.endLine = Math.max(lastSignificant, ob.block.headerLine);
    if (ob.label) ob.label.endLine = ob.block.endLine;
    if (ob.menu) ob.menu.endLine = ob.block.endLine;
    if (ob.choice) ob.choice.endLine = ob.block.endLine;
  };

  const open = (
    kind: BlockKind,
    indent: number,
    headerLine: number,
    extra: Partial<OpenBlock> = {},
    name?: string
  ): void => {
    const block: Block = { kind, name, headerLine, endLine: headerLine, indent, children: [] };
    const parent = stack[stack.length - 1];
    if (parent) parent.block.children.push(block);
    else model.blocks.push(block);
    const inherited = parent
      ? { python: parent.python, init: parent.init, screen: parent.screen }
      : { python: false, init: false, screen: false };
    stack.push({ block, ...inherited, ...extra });
  };

  let phys = 0;
  while (phys < lines.length) {
    const headerLine = phys;
    const first = scanLine(lines[phys], st);
    if (first.comment !== null) recordComment(model, phys, first.comment);
    let code = first.code;
    let depth = first.bracketDelta;
    let cont = first.continuation;
    while ((depth > 0 || st.triple !== null || cont) && phys + 1 < lines.length) {
      phys++;
      const next = scanLine(lines[phys], st);
      if (next.comment !== null) recordComment(model, phys, next.comment);
      code += ' ' + next.code.trim();
      depth += next.bracketDelta;
      cont = next.continuation;
    }
    const stmtEndLine = phys;
    phys++;

    const s = code.trim();
    if (s === '') continue;
    const indent = measureIndent(code);

    while (stack.length && indent <= stack[stack.length - 1].block.indent) {
      finalize(stack.pop()!);
    }
    lastSignificant = stmtEndLine;

    const top = stack[stack.length - 1];
    const endsColon = s.endsWith(':');

    // Screen actions referencing labels make those labels reachable — scan
    // every statement (they appear in screens, defines, and python alike).
    const actionRe = /\b(?:Jump|Call|Start)\s*\(\s*(?:"([^"]+)"|'([^']+)')/g;
    let am: RegExpExecArray | null;
    while ((am = actionRe.exec(s))) {
      model.actionTargets.push({ target: am[1] ?? am[2], line: headerLine });
    }

    if (top?.python) {
      handlePythonLine(model, s, headerLine, ctxOf(stack));
      extractIdentifiers(model, s, headerLine);
      if (endsColon) open('block', indent, headerLine);
      continue;
    }

    let m: RegExpExecArray | null;

    if ((m = /^label\s+([\w.]+)\s*(?:\([^)]*\))?\s*(?:hide\s*)?:$/.exec(s))) {
      const raw = m[1];
      const local = raw.startsWith('.');
      const name = local && lastGlobalLabel ? lastGlobalLabel + raw : raw;
      if (!local) lastGlobalLabel = raw;
      const decl: LabelDecl = { name, local, headerLine, endLine: headerLine };
      model.labels.push(decl);
      open('label', indent, headerLine, { label: decl }, name);
      continue;
    }

    if ((m = /^menu(?:\s+([\w.]+))?\s*(?:\([^)]*\))?\s*:$/.exec(s))) {
      const decl: MenuDecl = { name: m[1], headerLine, endLine: headerLine, choices: [] };
      model.menus.push(decl);
      open('menu', indent, headerLine, { menu: decl }, m[1]);
      continue;
    }

    if (endsColon && (m = /^screen\s+(\w+)/.exec(s))) {
      open('screen', indent, headerLine, { screen: true }, m[1]);
      continue;
    }

    if (endsColon && (m = /^init(?:\s+[-+]?\d+)?(\s+python\b[^:]*)?\s*:$/.exec(s))) {
      open('init', indent, headerLine, { init: true, python: !!m[1] });
      continue;
    }

    if (endsColon && /^python\b[^:]*:$/.test(s)) {
      open('python', indent, headerLine, { python: true });
      continue;
    }

    if (endsColon) {
      const kw = /^(if|elif|else|while|for)\b/.exec(s)?.[1] as BlockKind | undefined;
      if (kw) {
        extractIdentifiers(model, s.slice(kw.length, -1), headerLine);
        open(kw, indent, headerLine);
        continue;
      }
    }

    // Menu choice: a string-headed block directly inside a menu
    if (endsColon && top && top.block.kind === 'menu' && (s.startsWith('"') || s.startsWith("'"))) {
      const lit = readString(s, 0);
      if (lit) {
        const rest = s.slice(lit.end, s.length - 1).trim();
        if (rest === '' || /^\([^)]*\)$/.test(rest) || /^if\b/.test(rest) || /^\([^)]*\)\s+if\b/.test(rest)) {
          const cond = /\bif\b(.+)$/.exec(rest);
          if (cond) extractIdentifiers(model, cond[1], headerLine);
          const choice: ChoiceDecl = { text: lit.value, headerLine, endLine: headerLine };
          top.menu?.choices.push(choice);
          open('choice', indent, headerLine, { choice }, lit.value);
          continue;
        }
      }
    }

    if ((m = /^\$\s*(.*)$/.exec(s))) {
      handlePythonLine(model, m[1], headerLine, ctxOf(stack));
      extractIdentifiers(model, m[1], headerLine);
      continue;
    }

    if ((m = /^(define|default)\s+(?:[-+]?\d+\s+)?([\w.]+)\s*(?:\+=|\|=|=)\s*(.+)$/.exec(s))) {
      const c = ctxOf(stack);
      // Screen-language `default` is per-interaction scope, not a store variable
      if (c === 'top' || c === 'init') {
        const def: VarDef = {
          kind: m[1] as 'define' | 'default',
          name: stripStore(m[2]),
          rhs: m[3].trim(),
          line: headerLine,
        };
        (m[1] === 'define' ? model.defines : model.defaults).push(def);
        extractIdentifiers(model, def.rhs, headerLine);
      }
      continue;
    }

    if ((m = /^jump\s+(.+)$/.exec(s))) {
      handleJumpCall(model, 'jump', m[1], headerLine, lastGlobalLabel);
      continue;
    }

    if ((m = /^call\s+(.+)$/.exec(s))) {
      if (!/^screen\b/.test(m[1].trim())) {
        handleJumpCall(model, 'call', m[1], headerLine, lastGlobalLabel);
      }
      continue;
    }

    if (/^return\b/.test(s)) {
      model.returns.push(headerLine);
      continue;
    }

    // Screen-language statements (textbutton … action SetVariable(…)): record
    // invoked actions/functions only — plain tokens are screen keywords.
    if (top?.screen) {
      extractIdentifiers(model, s, headerLine, true);
    }

    if (endsColon) {
      open('block', indent, headerLine);
      continue;
    }

    if (ctxOf(stack) === 'label') {
      const dlg = parseDialogueLine(s);
      if (dlg) model.dialogue.push({ ...dlg, line: headerLine });
    }
  }

  while (stack.length) finalize(stack.pop()!);
  return model;
}
