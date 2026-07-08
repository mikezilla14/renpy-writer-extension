// Dialogue export for proofreading + anchored re-import. The Markdown carries
// one paragraph per dialogue line with a `<!-- file:line -->` anchor; apply
// diffs only the dialogue *text* back into the script by anchor — structure
// never round-trips (see ROADMAP.md, "Lessons from fountain-flow").

import { collectCharacterDisplayNames } from './metrics';
import { DialogueLine, FileModel } from './model';

const EXPORT_MARKER = '<!-- renpy-analytics dialogue export v1 -->';

function containingLabelName(model: FileModel, line: number): string | undefined {
  let best: { name: string; headerLine: number } | undefined;
  for (const l of model.labels) {
    if (l.headerLine <= line && line <= l.endLine) {
      if (!best || l.headerLine > best.headerLine) best = l;
    }
  }
  return best?.name;
}

export function exportDialogueMarkdown(
  models: FileModel[],
  relativize: (p: string) => string
): string {
  const displayNames = collectCharacterDisplayNames(models);
  const out: string[] = [
    '# Dialogue for proofreading',
    EXPORT_MARKER,
    '',
    '> Edit the dialogue text freely. **Do not** edit or delete the `<!-- … -->` anchors — ',
    '> they map each paragraph back to its script line. Speaker prefixes (`**Name:**`) are ',
    '> labels only; changing them does not change the script. Apply your edits with ',
    "> _Ren'Py: Apply Proofread Dialogue_.",
    '',
  ];
  for (const m of models) {
    if (m.dialogue.length === 0) continue;
    const rel = relativize(m.path).replace(/\\/g, '/');
    out.push(`## ${rel}`, '');
    let lastLabel: string | undefined | null = null;
    for (const d of m.dialogue) {
      const label = containingLabelName(m, d.line);
      if (label !== lastLabel) {
        out.push(`### ${label ?? '(top of file)'}`, '');
        lastLabel = label;
      }
      const prefix =
        d.speaker === null
          ? ''
          : d.adhoc
            ? `**"${d.speaker}":** `
            : `**${displayNames.get(d.speaker) ?? d.speaker}:** `;
      out.push(`${prefix}${d.text} <!-- ${rel}:${d.line + 1} -->`, '');
    }
  }
  return out.join('\n');
}

export interface ProofreadEdit {
  file: string;
  /** 0-based line in the script */
  line: number;
  newText: string;
  adhoc: boolean;
}

export interface ProofreadSkip {
  anchor: string;
  reason: string;
}

export interface ProofreadPlan {
  edits: ProofreadEdit[];
  skipped: ProofreadSkip[];
  unchanged: number;
  isExport: boolean;
}

/**
 * Parses an edited proofreading document and plans the script edits.
 * `lookup` resolves the anchor path (as exported, forward slashes, workspace-
 * relative) to the current FileModel.
 */
export function planProofreadEdits(
  md: string,
  lookup: (relPath: string) => FileModel | undefined
): ProofreadPlan {
  const plan: ProofreadPlan = {
    edits: [],
    skipped: [],
    unchanged: 0,
    isExport: md.includes(EXPORT_MARKER),
  };
  // Paragraphs = blocks separated by blank lines; each relevant block ends
  // with an anchor comment.
  const blocks = md.split(/\r?\n\s*\r?\n/);
  const ANCHOR_RE = /<!--\s*(.+?):(\d+)\s*-->\s*$/;
  for (const block of blocks) {
    const joined = block.trim().split(/\r?\n/).join(' ').trim();
    const am = ANCHOR_RE.exec(joined);
    if (!am) continue;
    const anchor = `${am[1]}:${am[2]}`;
    const relPath = am[1].trim();
    const line = parseInt(am[2], 10) - 1;
    let text = joined.slice(0, am.index).trim();
    // Strip the speaker prefix label (**Name:** or **"Name":**)
    text = text.replace(/^\*\*[^*]+\*\*\s*/, '');
    const model = lookup(relPath);
    if (!model) {
      plan.skipped.push({ anchor, reason: 'file not found in the analyzed workspace' });
      continue;
    }
    const d: DialogueLine | undefined = model.dialogue.find((x) => x.line === line);
    if (!d) {
      plan.skipped.push({
        anchor,
        reason: 'no dialogue on that line anymore (script changed since export?)',
      });
      continue;
    }
    if (d.text === text) {
      plan.unchanged++;
      continue;
    }
    plan.edits.push({ file: model.path, line, newText: text, adhoc: d.adhoc });
  }
  return plan;
}

/**
 * Replaces the dialogue string literal on a raw script line. For ad-hoc
 * speakers ("Name" "text") the second literal is the dialogue. Returns null
 * when the expected literal isn't found (line changed since export).
 */
export function replaceDialogueOnLine(
  rawLine: string,
  newText: string,
  adhoc: boolean
): string | null {
  const literals: { start: number; end: number }[] = [];
  let i = 0;
  while (i < rawLine.length && literals.length < 2) {
    const q = rawLine[i];
    if (q === '"' || q === "'") {
      let j = i + 1;
      while (j < rawLine.length) {
        if (rawLine[j] === '\\') {
          j += 2;
          continue;
        }
        if (rawLine[j] === q) break;
        j++;
      }
      if (j >= rawLine.length) return null; // unterminated
      literals.push({ start: i, end: j + 1 });
      i = j + 1;
    } else if (rawLine[i] === '#') {
      break;
    } else {
      i++;
    }
  }
  const target = literals[adhoc ? 1 : 0];
  if (!target) return null;
  const escaped = newText.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return rawLine.slice(0, target.start) + `"${escaped}"` + rawLine.slice(target.end);
}
