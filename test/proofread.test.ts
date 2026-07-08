import { describe, expect, it } from 'vitest';
import { parseRpy } from '../src/core/parser';
import {
  exportDialogueMarkdown,
  planProofreadEdits,
  replaceDialogueOnLine,
} from '../src/core/proofread';
import { FIXTURE } from './fixture';

const rel = (p: string): string => p;

describe('exportDialogueMarkdown', () => {
  it('exports dialogue with speaker prefixes, label headings, and line anchors', () => {
    const md = exportDialogueMarkdown([parseRpy('game/script.rpy', FIXTURE)], rel);
    expect(md).toContain('## game/script.rpy');
    expect(md).toContain('### start');
    expect(md).toContain('**Eileen:** Hello there! How are you? <!-- game/script.rpy:6 -->');
    expect(md).toContain('Narration line. <!-- game/script.rpy:7 -->');
    expect(md).toContain('### party');
  });

  it('skips files with no dialogue', () => {
    const md = exportDialogueMarkdown([parseRpy('empty.rpy', 'define x = 1\n')], rel);
    expect(md).not.toContain('## empty.rpy');
  });
});

describe('planProofreadEdits', () => {
  const model = parseRpy('game/script.rpy', FIXTURE);
  const lookup = (p: string) => (p === 'game/script.rpy' ? model : undefined);

  it('round-trips: unedited export produces no edits', () => {
    const md = exportDialogueMarkdown([model], rel);
    const plan = planProofreadEdits(md, lookup);
    expect(plan.isExport).toBe(true);
    expect(plan.edits).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
    expect(plan.unchanged).toBeGreaterThan(0);
  });

  it('plans an edit for changed dialogue text and strips the speaker prefix', () => {
    const md = exportDialogueMarkdown([model], rel).replace(
      'Hello there! How are you?',
      'Hey there! How have you been?'
    );
    const plan = planProofreadEdits(md, lookup);
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]).toMatchObject({
      file: 'game/script.rpy',
      line: 5,
      newText: 'Hey there! How have you been?',
      adhoc: false,
    });
  });

  it('joins multi-line paragraph edits into one dialogue line', () => {
    const md = exportDialogueMarkdown([model], rel).replace(
      'Hello there! How are you? <!-- game/script.rpy:6 -->',
      'Hello there!\nHow are you doing today? <!-- game/script.rpy:6 -->'
    );
    const plan = planProofreadEdits(md, lookup);
    expect(plan.edits[0].newText).toBe('Hello there! How are you doing today?');
  });

  it('skips anchors pointing at lines that no longer hold dialogue', () => {
    const md = [
      '<!-- renpy-analytics dialogue export v1 -->',
      '',
      'Edited text. <!-- game/script.rpy:3 -->',
      '',
      'Other file. <!-- missing.rpy:1 -->',
    ].join('\n');
    const plan = planProofreadEdits(md, lookup);
    expect(plan.edits).toHaveLength(0);
    expect(plan.skipped).toHaveLength(2);
  });
});

describe('replaceDialogueOnLine', () => {
  it('replaces the dialogue literal, preserving speaker and trailing clauses', () => {
    expect(replaceDialogueOnLine('    e "Hello." with vpunch', 'Goodbye.', false)).toBe(
      '    e "Goodbye." with vpunch'
    );
  });

  it('replaces the second literal for ad-hoc speakers', () => {
    expect(replaceDialogueOnLine('    "Guard" "Halt!"', 'Stop right there!', true)).toBe(
      '    "Guard" "Stop right there!"'
    );
  });

  it('escapes quotes and backslashes in the new text', () => {
    expect(replaceDialogueOnLine('    e "old"', 'She said "hi" \\ waved.', false)).toBe(
      '    e "She said \\"hi\\" \\\\ waved."'
    );
  });

  it('returns null when no literal exists on the line', () => {
    expect(replaceDialogueOnLine('    jump ending', 'text', false)).toBeNull();
  });
});
