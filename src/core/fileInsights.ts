// Per-file writing/narrative insights for the "Current File" pane: structure
// counts, pacing, per-character speech stats, scene (label) word balance, and
// cross-file story connections.

import { FlowAnalysis, InaccessibleLabel } from './graph';
import {
  CharacterStats,
  collectCharacterDisplayNames,
  computeMetrics,
  countWords,
  NARRATOR_KEY,
  normalizeDialogue,
} from './metrics';
import { FileModel } from './model';

export interface LabelWordCount {
  name: string;
  line: number;
  words: number;
}

export interface IncomingEdge {
  from: string;
  fromFile: string;
  fromLine: number;
  to: string;
}

export interface OutgoingEdge {
  from: string;
  to: string;
  toFile: string;
  toLine: number;
}

export interface FileInsights {
  path: string;
  labels: number;
  menus: number;
  choices: number;
  words: number;
  dialogueLines: number;
  narratorWords: number;
  sentences: number;
  /** Estimated silent-reading time at the configured words-per-minute */
  readingMinutes: number;
  /** Pacing: dialogue words per menu choice; null when the file has no choices */
  wordsPerChoice: number | null;
  /** Per-character stats with display names resolved project-wide */
  characters: CharacterStats[];
  /** Dialogue words inside each label, largest first — scene balance */
  labelWords: LabelWordCount[];
  inaccessible: InaccessibleLabel[];
  /** Jumps/calls from labels in other files into this file */
  incoming: IncomingEdge[];
  /** Jumps/calls from this file's labels into other files */
  outgoing: OutgoingEdge[];
}

/**
 * Upper-bound playtime: all dialogue inside reachable labels at the given
 * reading speed. (A single route is shorter; branches are mutually exclusive.)
 */
export function estimatePlaytime(
  models: FileModel[],
  flow: FlowAnalysis,
  wpm = 200
): { words: number; minutes: number } {
  let words = 0;
  for (const m of models) {
    for (const l of m.labels) {
      if (!flow.reachable.has(l.name)) continue;
      for (const d of m.dialogue) {
        if (d.line > l.headerLine && d.line <= l.endLine) {
          words += countWords(normalizeDialogue(d.text));
        }
      }
    }
  }
  return { words, minutes: words / wpm };
}

export function computeFileInsights(
  target: FileModel,
  allModels: FileModel[],
  flow: FlowAnalysis,
  wpm = 200
): FileInsights {
  const metrics = computeMetrics([target]);
  const file = metrics.files[0];

  // Display names may be defined in another file (characters.rpy etc.)
  const displayNames = collectCharacterDisplayNames(allModels);
  const characters = metrics.characters.map((c) =>
    !c.adhoc && c.key !== NARRATOR_KEY && displayNames.has(c.key)
      ? { ...c, displayName: displayNames.get(c.key)! }
      : c
  );

  const narratorWords = characters.find((c) => c.key === NARRATOR_KEY)?.words ?? 0;
  const sentences = characters.reduce((n, c) => n + c.sentences, 0);
  const dialogueLines = characters.reduce((n, c) => n + c.lines, 0);

  const labelWords: LabelWordCount[] = target.labels
    .map((l) => {
      let words = 0;
      for (const d of target.dialogue) {
        if (d.line > l.headerLine && d.line <= l.endLine) {
          words += countWords(normalizeDialogue(d.text));
        }
      }
      return { name: l.name, line: l.headerLine, words };
    })
    .sort((a, b) => b.words - a.words);

  const labelHome = new Map<string, { file: string; line: number }>();
  for (const m of allModels) {
    for (const l of m.labels) {
      if (!labelHome.has(l.name)) labelHome.set(l.name, { file: m.path, line: l.headerLine });
    }
  }
  const inThisFile = new Set(target.labels.map((l) => l.name));

  const incoming: IncomingEdge[] = [];
  const outgoing: OutgoingEdge[] = [];
  for (const [from, targets] of flow.edges) {
    const fromHome = labelHome.get(from);
    for (const to of targets) {
      const toHome = labelHome.get(to);
      if (fromHome && fromHome.file !== target.path && inThisFile.has(to)) {
        incoming.push({ from, fromFile: fromHome.file, fromLine: fromHome.line, to });
      }
      if (fromHome && fromHome.file === target.path && toHome && toHome.file !== target.path) {
        outgoing.push({ from, to, toFile: toHome.file, toLine: toHome.line });
      }
    }
  }
  incoming.sort((a, b) => (a.to === b.to ? (a.from < b.from ? -1 : 1) : a.to < b.to ? -1 : 1));
  outgoing.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));

  return {
    path: target.path,
    labels: file.labels,
    menus: file.menus,
    choices: file.choices,
    words: file.words,
    dialogueLines,
    narratorWords,
    sentences,
    readingMinutes: file.words / wpm,
    wordsPerChoice: file.choices > 0 ? file.words / file.choices : null,
    characters,
    labelWords,
    inaccessible: flow.inaccessible.filter((l) => l.file === target.path),
    incoming,
    outgoing,
  };
}
