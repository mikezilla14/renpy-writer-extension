// Script-consistency check: ad-hoc string speakers ("Name" "dialogue") that
// collide with a defined character. Ren'Py treats the string form as a
// separate one-off character — it gets none of the defined Character's
// styling and is counted separately in statistics — so a matching name is
// almost always an authoring inconsistency.
//
// Suppress with a comment on the same or preceding line:
//     # renpy-analytics: string-speaker

import { collectCharacterDisplayNames } from './metrics';
import { FileModel } from './model';

export interface SpeakerFinding {
  rule: 'duplicate-speaker';
  /** The string used as the ad-hoc speaker */
  speaker: string;
  /** The defined character variable it collides with */
  characterVar: string;
  file: string;
  line: number;
  message: string;
}

export function analyzeSpeakers(models: FileModel[]): SpeakerFinding[] {
  const displayNames = collectCharacterDisplayNames(models); // var -> display name
  const varByDisplay = new Map<string, string>();
  for (const [v, d] of displayNames) {
    if (!varByDisplay.has(d)) varByDisplay.set(d, v);
  }
  const characterVars = new Set<string>();
  for (const m of models) {
    for (const d of m.defines) {
      if (/^(?:Character|DynamicCharacter)\s*\(/.test(d.rhs)) characterVars.add(d.name);
    }
  }

  const findings: SpeakerFinding[] = [];
  for (const m of models) {
    for (const d of m.dialogue) {
      if (!d.adhoc || d.speaker === null) continue;
      const tag = m.suppressions.get(d.line) ?? m.suppressions.get(d.line - 1);
      if (tag !== undefined && /\b(string-speaker|ignore)\b/.test(tag)) continue;
      const characterVar =
        varByDisplay.get(d.speaker) ?? (characterVars.has(d.speaker) ? d.speaker : undefined);
      if (!characterVar) continue;
      const display = displayNames.get(characterVar);
      findings.push({
        rule: 'duplicate-speaker',
        speaker: d.speaker,
        characterVar,
        file: m.path,
        line: d.line,
        message:
          `String speaker "${d.speaker}" matches the defined character '${characterVar}'` +
          (display && display !== d.speaker ? ` ("${display}")` : '') +
          `. Ren'Py treats it as a separate ad-hoc character with its own styling and word counts — ` +
          `use '${characterVar} "..."' if the same person is speaking, or suppress with ` +
          `'# renpy-analytics: string-speaker' if the distinct voice is intentional.`,
      });
    }
  }
  return findings;
}
