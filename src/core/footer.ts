// Generated comment footer: a sentinel-delimited, idempotently-updatable
// summary block appended to a .rpy file. Everything between the sentinels is
// owned by the extension; regeneration replaces it, never duplicates it.

import {
  avgSentenceLength,
  collectCharacterDisplayNames,
  computeMetrics,
  NARRATOR_KEY,
} from './metrics';
import { FileModel } from './model';

export type FooterSection = 'summary' | 'characters' | 'callables' | 'variables';
export const ALL_FOOTER_SECTIONS: FooterSection[] = [
  'summary',
  'characters',
  'callables',
  'variables',
];

const BEGIN_PREFIX = '# ==== renpy-analytics:begin';
const END_PREFIX = '# ==== renpy-analytics:end';
export const FOOTER_BEGIN = `${BEGIN_PREFIX} (auto-generated - do not edit; regenerate via VS Code) ====`;
export const FOOTER_END = `${END_PREFIX} ====`;

/** Python builtins that add noise rather than information. */
const EXCLUDED_IDENTIFIERS = new Set([
  'abs', 'all', 'any', 'bool', 'dict', 'enumerate', 'float', 'int', 'isinstance',
  'len', 'list', 'max', 'min', 'object', 'range', 'round', 'set', 'sorted', 'str',
  'sum', 'tuple', 'type', 'zip',
]);

export interface FooterOptions {
  sections?: FooterSection[];
  /** YYYY-MM-DD; defaults to today. Injectable for deterministic tests. */
  date?: string;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function wrapList(items: string[], indent: string, width = 78): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const item of items) {
    const candidate = cur === '' ? item : `${cur}, ${item}`;
    if (cur !== '' && indent.length + candidate.length > width) {
      lines.push(indent + cur + ',');
      cur = item;
    } else {
      cur = candidate;
    }
  }
  if (cur !== '') lines.push(indent + cur);
  return lines;
}

export function buildFooter(
  target: FileModel,
  allModels: FileModel[],
  opts: FooterOptions = {}
): string {
  const sections = opts.sections ?? ALL_FOOTER_SECTIONS;
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const metrics = computeMetrics([target]);
  const file = metrics.files[0];
  const displayNames = collectCharacterDisplayNames(allModels);

  const lines: string[] = [FOOTER_BEGIN, `# File summary - generated ${date}`];

  if (sections.includes('summary')) {
    lines.push(
      `# Labels: ${fmt(file.labels)} | Menus: ${fmt(file.menus)} (${fmt(file.choices)} choices) | Total words: ${fmt(file.words)}`
    );
  }

  if (sections.includes('characters') && metrics.characters.length > 0) {
    lines.push('#', '# Words per character:');
    for (const c of metrics.characters) {
      let label: string;
      if (c.key === NARRATOR_KEY) label = 'narrator';
      else if (c.adhoc) label = `"${c.key}" (string speaker)`;
      else {
        const display = displayNames.get(c.key);
        label = display && display !== c.key ? `${c.key} (${display})` : c.key;
      }
      lines.push(
        `#   ${label}: ${fmt(c.words)} words | avg sentence ${avgSentenceLength(c).toFixed(1)}`
      );
    }
  }

  const calls = new Set<string>();
  const vars = new Set<string>();
  for (const id of target.identifiers) {
    if (EXCLUDED_IDENTIFIERS.has(id.name) || id.name.startsWith('_')) continue;
    (id.call ? calls : vars).add(id.name);
  }
  for (const a of target.assignments) {
    if (!a.name.startsWith('_')) vars.add(a.name);
  }
  for (const c of calls) vars.delete(c);

  if (sections.includes('callables') && calls.size > 0) {
    lines.push('#', '# Classes/functions called:');
    lines.push(...wrapList([...calls].sort(), '#   '));
  }

  if (sections.includes('variables') && vars.size > 0) {
    lines.push('#', '# Variables referenced:');
    lines.push(...wrapList([...vars].sort(), '#   '));
  }

  lines.push(FOOTER_END);
  return lines.join('\n');
}

export function hasFooter(text: string): boolean {
  return text.split(/\r?\n/).some((l) => l.trim().startsWith(BEGIN_PREFIX));
}

/**
 * Returns the file text with `footer` inserted: replacing an existing
 * sentinel block in place, or appended after one blank line. Preserves the
 * file's dominant EOL style and guarantees a trailing newline.
 */
export function applyFooter(text: string, footer: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const footerLines = footer.split('\n');

  const begin = lines.findIndex((l) => l.trim().startsWith(BEGIN_PREFIX));
  if (begin !== -1) {
    let end = -1;
    for (let i = begin; i < lines.length; i++) {
      if (lines[i].trim().startsWith(END_PREFIX)) {
        end = i;
        break;
      }
    }
    if (end === -1) end = lines.length - 1;
    lines.splice(begin, end - begin + 1, ...footerLines);
    let out = lines.join(eol);
    if (!out.endsWith(eol)) out += eol;
    return out;
  }

  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last--;
  const kept = lines.slice(0, last + 1);
  kept.push('', ...footerLines);
  return kept.join(eol) + eol;
}
