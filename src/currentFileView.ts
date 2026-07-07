import * as vscode from 'vscode';
import { BaseTreeProvider, fmt, TreeNode } from './analysisView';
import { FileInsights } from './core/fileInsights';
import { avgSentenceLength, CharacterStats, NARRATOR_KEY } from './core/metrics';
import { SaveSafetyFinding } from './core/saveSafety';
import { SpeakerFinding } from './core/speakers';

function characterLabel(c: CharacterStats): string {
  if (c.key === NARRATOR_KEY) return 'narrator';
  if (c.adhoc) return `"${c.key}" (string speaker)`;
  return c.key === c.displayName ? c.displayName : `${c.displayName} (${c.key})`;
}

export class CurrentFileTreeProvider extends BaseTreeProvider {
  constructor() {
    super();
    this.setMessage('Open a .rpy file to see its analysis');
  }

  setMessage(message: string): void {
    this.roots = [{ label: message, icon: new vscode.ThemeIcon('info') }];
    this.refresh();
  }

  setResults(
    insights: FileInsights,
    safety: SaveSafetyFinding[],
    speakers: SpeakerFinding[]
  ): void {
    const rel = (p: string): string => vscode.workspace.asRelativePath(p);
    const narratorPct =
      insights.words > 0 ? Math.round((insights.narratorWords / insights.words) * 100) : 0;
    const avgSentence = insights.sentences > 0 ? insights.words / insights.sentences : 0;
    const reading =
      insights.readingMinutes >= 1
        ? `~${Math.round(insights.readingMinutes)} min read`
        : '<1 min read';

    const overview: TreeNode = {
      label: 'Overview',
      icon: new vscode.ThemeIcon('book'),
      children: [
        {
          label: `${fmt(insights.words)} words · ${reading}`,
          icon: new vscode.ThemeIcon('symbol-text'),
        },
        {
          label: `${fmt(insights.labels)} labels · ${fmt(insights.menus)} menus (${fmt(insights.choices)} choices)`,
          icon: new vscode.ThemeIcon('list-tree'),
        },
        {
          label: `${fmt(insights.dialogueLines)} dialogue lines · narration ${narratorPct}%`,
          tooltip: 'Share of words spoken by the narrator vs named characters',
          icon: new vscode.ThemeIcon('comment'),
        },
        {
          label: `Avg sentence length: ${avgSentence.toFixed(1)} words`,
          icon: new vscode.ThemeIcon('dashboard'),
        },
        {
          label:
            insights.wordsPerChoice === null
              ? 'Pacing: no choices in this file (kinetic)'
              : `Pacing: ${fmt(Math.round(insights.wordsPerChoice))} words per choice`,
          tooltip:
            'Dialogue words divided by menu choices — lower means the player decides more often',
          icon: new vscode.ThemeIcon('git-branch'),
        },
      ],
    };

    const inaccessibleChildren: TreeNode[] =
      insights.inaccessible.length === 0
        ? [{ label: 'All labels reachable', icon: new vscode.ThemeIcon('check') }]
        : insights.inaccessible.map((l) => ({
            label: l.name,
            description: `line ${l.line + 1}`,
            icon: new vscode.ThemeIcon('debug-disconnect'),
            file: l.file,
            line: l.line,
          }));

    const issues: TreeNode[] = [
      ...safety.map((f) => ({
        label: `${f.name} — ${f.rule}`,
        description: `line ${f.line + 1}`,
        tooltip: f.message,
        icon: new vscode.ThemeIcon(f.severity === 'warning' ? 'warning' : 'info'),
        file: f.file,
        line: f.line,
      })),
      ...speakers.map((f) => ({
        label: `"${f.speaker}" vs ${f.characterVar} — ${f.rule}`,
        description: `line ${f.line + 1}`,
        tooltip: f.message,
        icon: new vscode.ThemeIcon('comment-discussion'),
        file: f.file,
        line: f.line,
      })),
    ];

    const charChildren: TreeNode[] = insights.characters.map((c) => ({
      label: characterLabel(c),
      description: `${fmt(c.words)} words (${insights.words > 0 ? Math.round((c.words / insights.words) * 100) : 0}%) · ${fmt(c.lines)} lines · ${avgSentenceLength(c).toFixed(1)} w/sentence`,
      tooltip: c.adhoc
        ? 'Ad-hoc string speaker — a separate one-off character, not a defined Character variable'
        : undefined,
      icon: new vscode.ThemeIcon(c.adhoc ? 'quote' : 'person'),
    }));

    const sceneChildren: TreeNode[] = insights.labelWords.map((l) => ({
      label: l.name,
      description: `${fmt(l.words)} words${insights.words > 0 ? ` (${Math.round((l.words / insights.words) * 100)}%)` : ''}`,
      icon: new vscode.ThemeIcon('bookmark'),
      file: insights.path,
      line: l.line,
    }));

    const connectionChildren: TreeNode[] = [
      ...insights.incoming.map((e) => ({
        label: `← ${e.from} jumps to ${e.to}`,
        description: rel(e.fromFile),
        icon: new vscode.ThemeIcon('arrow-left'),
        file: e.fromFile,
        line: e.fromLine,
      })),
      ...insights.outgoing.map((e) => ({
        label: `→ ${e.from} jumps to ${e.to}`,
        description: rel(e.toFile),
        icon: new vscode.ThemeIcon('arrow-right'),
        file: e.toFile,
        line: e.toLine,
      })),
    ];

    this.roots = [
      overview,
      {
        label: `Inaccessible labels (${fmt(insights.inaccessible.length)})`,
        icon: new vscode.ThemeIcon('debug-disconnect'),
        children: inaccessibleChildren,
      },
      {
        label: `Issues (${fmt(issues.length)})`,
        icon: new vscode.ThemeIcon('shield'),
        children: issues.length
          ? issues
          : [{ label: 'No findings in this file', icon: new vscode.ThemeIcon('check') }],
      },
      {
        label: `Characters (${fmt(insights.characters.length)})`,
        icon: new vscode.ThemeIcon('organization'),
        children: charChildren.length
          ? charChildren
          : [{ label: 'No dialogue in this file', icon: new vscode.ThemeIcon('info') }],
      },
      {
        label: `Scenes — words per label (${fmt(insights.labelWords.length)})`,
        icon: new vscode.ThemeIcon('bookmark'),
        collapsed: true,
        children: sceneChildren.length
          ? sceneChildren
          : [{ label: 'No labels in this file', icon: new vscode.ThemeIcon('info') }],
      },
      {
        label: `Connections (${fmt(insights.incoming.length)} in · ${fmt(insights.outgoing.length)} out)`,
        icon: new vscode.ThemeIcon('references'),
        collapsed: true,
        children: connectionChildren.length
          ? connectionChildren
          : [
              {
                label: 'No cross-file jumps or calls',
                icon: new vscode.ThemeIcon('info'),
              },
            ],
      },
    ];
    this.refresh();
  }
}
