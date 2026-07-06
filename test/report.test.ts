import { describe, expect, it } from 'vitest';
import { analyzeFlow } from '../src/core/graph';
import { computeMetrics } from '../src/core/metrics';
import { parseRpy } from '../src/core/parser';
import { buildJsonReport, buildMarkdownReport } from '../src/core/report';
import { analyzeSaveSafety } from '../src/core/saveSafety';

describe('report generation', () => {
  const SCRIPT = `define e = Character("Eileen")
define inventory = []

label start:
    e "Hello!"
    return

label orphan:
    return
`;
  const models = [parseRpy('game/script.rpy', SCRIPT)];
  const input = {
    flow: analyzeFlow(models),
    metrics: computeMetrics(models),
    safety: analyzeSaveSafety(models),
    generatedAt: new Date('2026-07-06T00:00:00Z'),
  };

  it('produces a markdown report with all sections', () => {
    const md = buildMarkdownReport(input);
    expect(md).toContain('# Ren\'Py Analytics report');
    expect(md).toContain('`orphan` — game/script.rpy:8');
    expect(md).toContain('define-mutable-literal');
    expect(md).toContain('| Eileen (e) |');
    expect(md).toContain('| game/script.rpy | 2 | 0 | 0 | 1 |');
  });

  it('produces machine-readable JSON with 1-based lines', () => {
    const data = JSON.parse(buildJsonReport(input));
    expect(data.summary).toMatchObject({
      files: 1,
      labels: 2,
      inaccessibleLabels: 1,
      saveSafetyFindings: 1,
    });
    expect(data.inaccessibleLabels[0]).toMatchObject({ name: 'orphan', line: 8 });
    expect(data.characters[0]).toMatchObject({ key: 'e', displayName: 'Eileen', words: 1 });
  });
});
