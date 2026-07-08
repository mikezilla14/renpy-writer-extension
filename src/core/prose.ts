// Prose → Ren'Py conversion for "Paste as Ren'Py Dialogue". Accepts the
// formats writers actually draft in — screenplay cues (ALL-CAPS name, then
// dialogue), chat format (Name: line), plain narration paragraphs — plus a
// Fountain-flavored logic dialect adapted from the fountain-flow .fflow spec
// (MIT, https://github.com/mikezilla14/fountain-flow):
//   # SECTION            → label section:
//   INT. RUINS - NIGHT   → label int_ruins_night:
//   ? prompt             → menu with caption
//   + [Label] body text  → menu choice with body
//   -> #target           → jump target
//   ~ expr               → $ expr
//   ! BG:/SHOW:/HIDE:/MUSIC:/SFX:  → scene/show/hide/play
//
// One-way by design: .rpy is the source of truth afterwards (see ROADMAP.md,
// "Lessons from fountain-flow" — structure round-trips lose information).

export interface ConvertOptions {
  /** lower-cased display name or variable → character variable */
  characterMap: Map<string, string>;
  /** lower-cased display names to keep as ad-hoc string speakers */
  stringSpeakers?: Set<string>;
}

export interface ProseConversion {
  /** Converted script, 4-space indent units, no trailing newline */
  rpy: string;
  /** Unique speaker display names, in order of appearance */
  speakers: string[];
  /** Speakers that had no mapping (emitted as slug variables + TODO defines) */
  unknown: string[];
}

const CUE_RE = /^[A-Z][A-Z0-9 .'\-]{1,29}(\s*\([^)]*\))?$/;
const CHAT_RE = /^([A-Za-z][\w .'\-]{0,29}):\s+(\S.*)$/;
const SCENE_RE = /^(INT|EXT|INT\.\/EXT|I\/E)[. ].+/i;

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'l$1') || 'unnamed'
  );
}

function escapeRpy(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

interface Token {
  kind:
    | 'blank'
    | 'section'
    | 'scene-heading'
    | 'asset'
    | 'state'
    | 'prompt'
    | 'choice'
    | 'jump'
    | 'cue'
    | 'chat'
    | 'text';
  raw: string;
  indent: number;
  // parsed pieces, per kind
  name?: string;
  text?: string;
  target?: string;
}

function tokenize(lines: string[]): Token[] {
  const out: Token[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    if (t === '') {
      out.push({ kind: 'blank', raw, indent: 0 });
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^#+\s*(.+)$/.exec(t))) {
      out.push({ kind: 'section', raw, indent, name: m[1].trim() });
    } else if (SCENE_RE.test(t)) {
      out.push({ kind: 'scene-heading', raw, indent, name: t });
    } else if ((m = /^!\s*(BG|SHOW|HIDE|MUSIC|SFX)\s*:\s*(.+)$/i.exec(t))) {
      out.push({ kind: 'asset', raw, indent, name: m[1].toUpperCase(), text: m[2].trim() });
    } else if ((m = /^~\s*(.+)$/.exec(t))) {
      out.push({ kind: 'state', raw, indent, text: m[1].trim() });
    } else if ((m = /^\?\s*(.+)$/.exec(t))) {
      out.push({ kind: 'prompt', raw, indent, text: m[1].trim() });
    } else if ((m = /^\+\s*(?:\[([^\]]+)\]\s*)?(.*)$/.exec(t))) {
      out.push({
        kind: 'choice',
        raw,
        indent,
        name: (m[1] ?? m[2] ?? '').trim() || 'Choice',
        text: m[1] ? m[2].trim() : '',
      });
    } else if ((m = /^(?:(.*\S)\s+)?->\s*#?([\w.]+)\.?$/.exec(t))) {
      out.push({ kind: 'jump', raw, indent, text: m[1]?.trim(), target: m[2] });
    } else if (CUE_RE.test(t)) {
      out.push({ kind: 'cue', raw, indent, name: t });
    } else if ((m = CHAT_RE.exec(t))) {
      out.push({ kind: 'chat', raw, indent, name: m[1].trim(), text: m[2].trim() });
    } else {
      out.push({ kind: 'text', raw, indent, text: t });
    }
  }
  return out;
}

/** Speaker display names in order of appearance (for pre-conversion prompting). */
export function extractSpeakers(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of tokenize(text.split(/\r?\n/))) {
    if ((tok.kind === 'cue' || tok.kind === 'chat') && tok.name) {
      // Normalize screenplay cues like "EVE (V.O.)"
      const name = tok.name.replace(/\s*\(.*\)\s*$/, '').trim();
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(name);
      }
    }
  }
  return out;
}

export function convertProse(text: string, options: ConvertOptions): ProseConversion {
  const tokens = tokenize(text.split(/\r?\n/));
  const speakers: string[] = [];
  const unknown: string[] = [];
  const seenSpeakers = new Set<string>();

  const resolveSpeaker = (rawName: string): { prefix: string } => {
    const name = rawName.replace(/\s*\(.*\)\s*$/, '').trim();
    const key = name.toLowerCase();
    if (!seenSpeakers.has(key)) {
      seenSpeakers.add(key);
      speakers.push(name);
    }
    const mapped = options.characterMap.get(key);
    if (mapped) return { prefix: mapped + ' ' };
    if (options.stringSpeakers?.has(key)) return { prefix: `"${escapeRpy(name)}" ` };
    if (!unknown.some((u) => u.toLowerCase() === key)) unknown.push(name);
    return { prefix: slug(name) + ' ' };
  };

  const body: string[] = [];
  const IND = '    ';
  /** Depth in indent units for regular statements (0 top, +1 inside choice body…) */
  let menuDepth: { menuIndent: number; choiceIndent: number } | null = null;

  const emit = (line: string, extraDepth = 0): void => {
    const depth = (menuDepth ? 2 : 0) + extraDepth;
    body.push(line === '' ? '' : IND.repeat(depth) + line);
  };
  const closeMenu = (): void => {
    menuDepth = null;
  };

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];

    // A choice body is any following line indented past the '+' marker.
    const inChoiceBody = menuDepth !== null && tok.indent > menuDepth.choiceIndent;
    if (menuDepth && !inChoiceBody && tok.kind !== 'choice' && tok.kind !== 'blank') {
      closeMenu();
    }

    switch (tok.kind) {
      case 'blank':
        // Inside a menu, blank lines just separate choices — keep it compact
        if (!menuDepth && body.length && body[body.length - 1] !== '') body.push('');
        break;
      case 'section':
        emit(`label ${slug(tok.name!)}:`);
        break;
      case 'scene-heading':
        emit(`label ${slug(tok.name!)}:  # ${tok.name}`);
        break;
      case 'asset': {
        const data = tok.text!;
        if (tok.name === 'BG') emit(`scene ${data.replace(/[,\s]+/g, ' ')}`);
        else if (tok.name === 'SHOW') {
          const parts = data.split(',').map((p) => p.trim()).filter(Boolean);
          const at = parts.length > 2 ? ` at ${parts[2]}` : '';
          emit(`show ${parts[0]}${parts[1] ? ' ' + parts[1] : ''}${at}`);
        } else if (tok.name === 'HIDE') emit(`hide ${data}`);
        else if (tok.name === 'MUSIC') {
          const track = data.split(',')[0].trim();
          emit(`play music "${escapeRpy(track)}"`);
        } else emit(`play sound "${escapeRpy(data)}"`);
        break;
      }
      case 'state':
        emit(`$ ${tok.text}`);
        break;
      case 'prompt':
        closeMenu();
        emit('menu:');
        emit(IND + `"${escapeRpy(tok.text!)}"`);
        menuDepth = { menuIndent: tok.indent, choiceIndent: tok.indent };
        break;
      case 'choice': {
        if (!menuDepth) {
          emit('menu:');
          menuDepth = { menuIndent: tok.indent, choiceIndent: tok.indent };
        }
        menuDepth.choiceIndent = tok.indent;
        body.push(IND + `"${escapeRpy(tok.name!)}":`);
        // Inline jump at the end of the description: "text -> #TARGET"
        const inline = tok.text ? /^(.*?)\s*->\s*#?([\w.]+)\.?$/.exec(tok.text) : null;
        const desc = inline ? inline[1].trim() : tok.text;
        if (desc) body.push(IND + IND + `"${escapeRpy(desc)}"`);
        if (inline) body.push(IND + IND + `jump ${slug(inline[2])}`);
        break;
      }
      case 'jump':
        if (tok.text) emit(`"${escapeRpy(tok.text)}"`);
        emit(`jump ${slug(tok.target!)}`);
        break;
      case 'cue': {
        // Collect dialogue lines until blank; skip/comment parentheticals.
        const { prefix } = resolveSpeaker(tok.name!);
        const parts: string[] = [];
        let j = i + 1;
        while (j < tokens.length && tokens[j].kind !== 'blank') {
          const t = tokens[j];
          if (t.kind === 'text' && /^\(.+\)$/.test(t.text!)) {
            emit(`# ${t.text}`);
          } else if (t.kind === 'text' || t.kind === 'chat') {
            parts.push(t.kind === 'chat' ? `${t.name}: ${t.text}` : t.text!);
          } else {
            break;
          }
          j++;
        }
        if (parts.length) emit(`${prefix}"${escapeRpy(parts.join(' '))}"`);
        i = j - 1;
        break;
      }
      case 'chat': {
        const { prefix } = resolveSpeaker(tok.name!);
        emit(`${prefix}"${escapeRpy(tok.text!)}"`);
        break;
      }
      case 'text': {
        // Join consecutive plain lines into one narration paragraph.
        const parts = [tok.text!];
        let j = i + 1;
        while (j < tokens.length && tokens[j].kind === 'text') {
          parts.push(tokens[j].text!);
          j++;
        }
        emit(`"${escapeRpy(parts.join(' '))}"`);
        i = j - 1;
        break;
      }
    }
    i++;
  }

  // Trim leading/trailing blank lines
  while (body.length && body[0] === '') body.shift();
  while (body.length && body[body.length - 1] === '') body.pop();

  let rpy = body.join('\n');
  if (unknown.length) {
    const todos = [
      '# TODO(renpy-analytics): define these characters, e.g. near your other defines:',
      ...unknown.map((n) => `#     define ${slug(n)} = Character("${escapeRpy(n)}")`),
    ];
    rpy = todos.join('\n') + '\n' + rpy;
  }
  return { rpy, speakers, unknown };
}
