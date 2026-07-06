// Exportable analysis report (Markdown for humans, JSON for CI).

import { FlowAnalysis } from './graph';
import { avgSentenceLength, ProjectMetrics } from './metrics';
import { SaveSafetyFinding } from './saveSafety';
import { SpeakerFinding } from './speakers';

export interface ReportInput {
  flow: FlowAnalysis;
  metrics: ProjectMetrics;
  safety: SaveSafetyFinding[];
  speakers?: SpeakerFinding[];
  /** Function that shortens absolute paths for display */
  relativize?: (path: string) => string;
  generatedAt?: Date;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function buildMarkdownReport(input: ReportInput): string {
  const { flow, metrics, safety } = input;
  const rel = input.relativize ?? ((p: string) => p);
  const when = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const lines: string[] = [];

  lines.push(`# Ren'Py Analytics report`, '', `Generated ${when}`, '');
  lines.push('## Summary', '');
  lines.push(`- Files analyzed: ${fmt(metrics.files.length)}`);
  lines.push(`- Labels: ${fmt(metrics.totalLabels)} (${fmt(flow.inaccessible.length)} inaccessible)`);
  lines.push(`- Choice menus: ${fmt(metrics.totalMenus)} (${fmt(metrics.totalChoices)} choices)`);
  lines.push(`- Total words: ${fmt(metrics.totalWords)}`);
  lines.push(`- Save-file safety findings: ${fmt(safety.length)}`);
  if (flow.dynamicJumps > 0) {
    lines.push(
      `- ⚠ ${fmt(flow.dynamicJumps)} dynamic jump/call target(s) could not be resolved statically — reachability results may be incomplete.`
    );
  }
  lines.push('');

  lines.push('## Inaccessible labels', '');
  if (flow.inaccessible.length === 0) {
    lines.push('None — every label is reachable from an entry point.', '');
  } else {
    for (const l of flow.inaccessible) {
      lines.push(`- \`${l.name}\` — ${rel(l.file)}:${l.line + 1}`);
    }
    lines.push('', `Suppress with \`# renpy-analytics: reachable\` on or above the label line.`, '');
  }

  lines.push('## Save-file safety', '');
  if (safety.length === 0) {
    lines.push('No risks found.', '');
  } else {
    for (const f of safety) {
      lines.push(`- **${f.rule}** \`${f.name}\` — ${rel(f.file)}:${f.line + 1}`);
    }
    lines.push('');
  }

  const speakers = input.speakers ?? [];
  lines.push('## Speaker consistency', '');
  if (speakers.length === 0) {
    lines.push('No string speakers colliding with defined characters.', '');
  } else {
    for (const f of speakers) {
      lines.push(
        `- \`"${f.speaker}"\` used as a string speaker but matches defined character \`${f.characterVar}\` — ${rel(f.file)}:${f.line + 1}`
      );
    }
    lines.push('', 'Suppress with `# renpy-analytics: string-speaker` on or above the line.', '');
  }

  lines.push('## Per-file statistics', '');
  lines.push('| File | Labels | Menus | Choices | Words |');
  lines.push('|---|---:|---:|---:|---:|');
  for (const f of metrics.files) {
    lines.push(`| ${rel(f.path)} | ${fmt(f.labels)} | ${fmt(f.menus)} | ${fmt(f.choices)} | ${fmt(f.words)} |`);
  }
  lines.push('');

  lines.push('## Per-character statistics', '');
  lines.push('| Character | Words | Lines | Avg sentence length |');
  lines.push('|---|---:|---:|---:|');
  for (const c of metrics.characters) {
    const name = c.adhoc
      ? `"${c.key}" (string speaker)`
      : c.key === c.displayName
        ? c.displayName
        : `${c.displayName} (${c.key})`;
    lines.push(`| ${name} | ${fmt(c.words)} | ${fmt(c.lines)} | ${avgSentenceLength(c).toFixed(1)} |`);
  }
  lines.push('');

  return lines.join('\n');
}

export function buildJsonReport(input: ReportInput): string {
  const { flow, metrics, safety } = input;
  const rel = input.relativize ?? ((p: string) => p);
  return JSON.stringify(
    {
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      summary: {
        files: metrics.files.length,
        labels: metrics.totalLabels,
        inaccessibleLabels: flow.inaccessible.length,
        menus: metrics.totalMenus,
        choices: metrics.totalChoices,
        words: metrics.totalWords,
        dynamicJumps: flow.dynamicJumps,
        saveSafetyFindings: safety.length,
      },
      inaccessibleLabels: flow.inaccessible.map((l) => ({
        name: l.name,
        file: rel(l.file),
        line: l.line + 1,
      })),
      saveSafety: safety.map((f) => ({
        rule: f.rule,
        name: f.name,
        file: rel(f.file),
        line: f.line + 1,
        severity: f.severity,
      })),
      speakerFindings: (input.speakers ?? []).map((f) => ({
        rule: f.rule,
        speaker: f.speaker,
        characterVar: f.characterVar,
        file: rel(f.file),
        line: f.line + 1,
      })),
      files: metrics.files.map((f) => ({ ...f, path: rel(f.path) })),
      characters: metrics.characters.map((c) => ({
        key: c.key,
        displayName: c.displayName,
        adhoc: c.adhoc,
        words: c.words,
        lines: c.lines,
        sentences: c.sentences,
        avgSentenceLength: Number(avgSentenceLength(c).toFixed(2)),
      })),
    },
    null,
    2
  );
}
