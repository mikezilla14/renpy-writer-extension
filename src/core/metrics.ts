// Writing statistics: per-file structure counts and per-character word /
// sentence metrics computed from dialogue lines.

import { FileModel } from './model';

export interface CharacterStats {
  /** Variable name of the character, display name for ad-hoc characters, or '<narrator>' */
  key: string;
  displayName: string;
  /** True for ad-hoc string speakers ("Name" "dialogue") — a distinct character in Ren'Py */
  adhoc: boolean;
  words: number;
  sentences: number;
  lines: number;
}

export interface FileStats {
  path: string;
  labels: number;
  menus: number;
  choices: number;
  words: number;
}

export interface ProjectMetrics {
  files: FileStats[];
  characters: CharacterStats[];
  totalWords: number;
  totalLabels: number;
  totalMenus: number;
  totalChoices: number;
}

export const NARRATOR_KEY = '<narrator>';

const ESC_OPEN_BRACE = String.fromCharCode(1);
const ESC_CLOSE_BRACE = String.fromCharCode(2);
const ESC_OPEN_BRACKET = String.fromCharCode(3);
const ESC_CLOSE_BRACKET = String.fromCharCode(4);
const INTERP_PLACEHOLDER = '✱'; // ✱ — counts as one word

/**
 * Strips Ren'Py text tags ({b}, {w=0.5}, …) and replaces interpolations
 * ([points]) with a single-word placeholder. {{ and [[ are Ren'Py escapes
 * for literal braces/brackets — shield them with control-char placeholders
 * while tags are stripped.
 */
export function normalizeDialogue(text: string): string {
  let t = text
    .replace(/\{\{/g, ESC_OPEN_BRACE)
    .replace(/\}\}/g, ESC_CLOSE_BRACE)
    .replace(/\[\[/g, ESC_OPEN_BRACKET)
    .replace(/\]\]/g, ESC_CLOSE_BRACKET);
  t = t.replace(/\{[^{}]*\}/g, '');
  t = t.replace(/\[[^\[\]]*\]/g, ` ${INTERP_PLACEHOLDER} `);
  return t
    .replace(new RegExp(ESC_OPEN_BRACE, 'g'), '{')
    .replace(new RegExp(ESC_CLOSE_BRACE, 'g'), '}')
    .replace(new RegExp(ESC_OPEN_BRACKET, 'g'), '[')
    .replace(new RegExp(ESC_CLOSE_BRACKET, 'g'), ']');
}

export function countWords(normalized: string): number {
  const wordish = new RegExp(`[\\p{L}\\p{N}${INTERP_PLACEHOLDER}]`, 'u');
  return normalized.split(/\s+/).filter((t) => wordish.test(t)).length;
}

export function countSentences(normalized: string): number {
  const words = countWords(normalized);
  if (words === 0) return 0;
  const marks = normalized.match(/[.!?…]+/g);
  return marks && marks.length > 0 ? marks.length : 1;
}

/** define e = Character("Eileen") → display name, handling _("…") wrappers. */
function characterDisplayName(rhs: string): string | undefined {
  const m = /^(?:Character|DynamicCharacter)\s*\(\s*(?:_\(\s*)?(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/.exec(
    rhs
  );
  if (!m) return undefined;
  return m[1] ?? m[2];
}

/** Character variable -> display name, from define'd Character(...) calls. */
export function collectCharacterDisplayNames(models: FileModel[]): Map<string, string> {
  const displayNames = new Map<string, string>();
  for (const m of models) {
    for (const d of m.defines) {
      if (/^(?:Character|DynamicCharacter)\s*\(/.test(d.rhs)) {
        const dn = characterDisplayName(d.rhs);
        if (dn) displayNames.set(d.name, dn);
      }
    }
  }
  return displayNames;
}

export function computeMetrics(models: FileModel[]): ProjectMetrics {
  const displayNames = collectCharacterDisplayNames(models);

  // Ad-hoc string speakers are distinct characters in Ren'Py, so they must
  // never merge with a variable of the same name — key the map accordingly.
  const charStats = new Map<string, CharacterStats>();
  const bump = (key: string, adhoc: boolean, words: number, sentences: number): void => {
    const mapKey = (adhoc ? 'S:' : 'V:') + key;
    let cs = charStats.get(mapKey);
    if (!cs) {
      const displayName =
        key === NARRATOR_KEY ? 'narrator' : adhoc ? key : displayNames.get(key) ?? key;
      charStats.set(mapKey, (cs = { key, displayName, adhoc, words: 0, sentences: 0, lines: 0 }));
    }
    cs.words += words;
    cs.sentences += sentences;
    cs.lines += 1;
  };

  const files: FileStats[] = [];
  let totalChoices = 0;

  for (const m of models) {
    let fileWords = 0;
    let prev: { key: string; adhoc: boolean } = { key: NARRATOR_KEY, adhoc: false };
    const ordered = [...m.dialogue].sort((a, b) => a.line - b.line);
    for (const d of ordered) {
      const normalized = normalizeDialogue(d.text);
      const words = countWords(normalized);
      const sentences = countSentences(normalized);
      fileWords += words;
      let cur: { key: string; adhoc: boolean };
      if (d.speaker === null) cur = { key: NARRATOR_KEY, adhoc: false };
      else if (d.speaker === 'extend' && !d.adhoc) cur = prev;
      else cur = { key: d.speaker, adhoc: d.adhoc };
      bump(cur.key, cur.adhoc, words, sentences);
      prev = cur;
    }
    const choices = m.menus.reduce((n, menu) => n + menu.choices.length, 0);
    totalChoices += choices;
    files.push({
      path: m.path,
      labels: m.labels.length,
      menus: m.menus.length,
      choices,
      words: fileWords,
    });
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const characters = [...charStats.values()].sort((a, b) => b.words - a.words);

  return {
    files,
    characters,
    totalWords: files.reduce((n, f) => n + f.words, 0),
    totalLabels: files.reduce((n, f) => n + f.labels, 0),
    totalMenus: files.reduce((n, f) => n + f.menus, 0),
    totalChoices,
  };
}

export function avgSentenceLength(cs: CharacterStats): number {
  return cs.sentences === 0 ? 0 : cs.words / cs.sentences;
}
